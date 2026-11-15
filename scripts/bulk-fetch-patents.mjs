#!/usr/bin/env node
// =============================================================================
// scripts/bulk-fetch-patents.mjs
// ─────────────────────────────────────────────────────────────────────────
// 「決まった企業リスト(Supabaseのcompaniesテーブル)」をまとめて定期的に
// Google Patents Public Datasets(BigQuery)から取得し、Supabaseのpatents
// テーブルへ反映するバッチスクリプト。
//
// ★ なぜ1クエリにまとめるのか:
//   patents-public-data.patents.publications はクラスタリング/パーティ
//   ショニングが設定されていない公開データセットのため、BigQueryの課金は
//   「WHERE条件の絞り込み具合」ではなく「参照しているカラムの全データ量」
//   で決まる。つまり1社ずつ問い合わせても80社まとめて問い合わせても、
//   スキャンされるバイト数(＝課金額)はほぼ変わらない。
//   → 企業ごとに実行すると「企業数 × 1回分の料金」がかかってしまうため、
//     全社ぶんを1回のクエリにまとめることで、課金をほぼ1回分に抑える。
//
// ★ 企業の紐付け方:
//   全社の「出願人名パターン(正規表現)」を1つのBigQueryクエリパラメータ
//   (ARRAY<STRUCT<id, pattern>>)として渡し、各ファミリーがどの企業の
//   パターンにマッチしたかをSQL側で判定(matched_company_ids)。これを
//   ファミリー代表レコードまで引き継ぐことで、1回の全体スキャンのまま
//   「どのレコードがどの企業のものか」を正しく割り当てる。
//
// 必要な環境変数:
//   GCP_PROJECT_ID              … BigQueryクエリの課金先プロジェクトID
//   GCP_SA_KEY_JSON              … サービスアカウントキー(JSON文字列)
//   SUPABASE_URL                 … (省略時は下記デフォルト値を使用)
//   SUPABASE_SERVICE_ROLE_KEY    … Supabaseのservice_role鍵(RLSを越えて書き込むため)
//   DATE_FROM                    … 取得対象の公開日範囲 開始 (YYYY-MM-DD, 省略時 2024-01-01)
//   DATE_TO                      … 取得対象の公開日範囲 終了 (YYYY-MM-DD, 省略時 今日)
//   BQ_MAX_BYTES_BILLED          … 誤爆防止の上限バイト数 (省略時 2TiB)
//   DRY_RUN                      … "true" にするとBigQueryのdry-runで
//                                   スキャン見積もりだけ表示して終了(課金なし・書き込みなし)
//
// 実行方法:
//   node scripts/bulk-fetch-patents.mjs
// =============================================================================

import { BigQuery } from '@google-cloud/bigquery';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://oqttbviuzlpggetmvkgi.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATE_FROM = process.env.DATE_FROM || '2024-01-01';
const DATE_TO = process.env.DATE_TO || new Date().toISOString().slice(0, 10);
const MAX_BYTES_BILLED = process.env.BQ_MAX_BYTES_BILLED || String(2 * 1024 ** 4); // 2 TiB
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!process.env.GCP_PROJECT_ID) fail('GCP_PROJECT_ID が未設定です');
if (!process.env.GCP_SA_KEY_JSON) fail('GCP_SA_KEY_JSON が未設定です');
if (!SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY が未設定です');

function normalize(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function toYYYYMMDD(dateStr) {
  return parseInt(String(dateStr).replace(/-/g, ''), 10);
}
const INDEP_REF_RE = /\b(claim|claims)\s+\d+/i;
function splitClaims(text) {
  if (!text) return { all: '', independent: '' };
  const parts = text.split(/\n(?=\s*\d+\s*[.)])/).map(s => s.trim()).filter(Boolean);
  const indep = parts.filter(p => !INDEP_REF_RE.test(p));
  return { all: parts.join('\n\n'), independent: indep.join('\n\n') };
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      ...(options.headers || {}),
    },
  });
  return res;
}

async function loadCompanies() {
  const res = await supabaseFetch('/rest/v1/companies?select=id,name,legal,sector,flag,group_id&order=name.asc');
  if (!res.ok) fail('企業リストの取得に失敗しました (HTTP ' + res.status + '): ' + (await res.text()));
  const companies = await res.json();
  if (!Array.isArray(companies) || companies.length === 0) fail('companiesテーブルが空です');
  return companies;
}

function buildCompanyPatterns(companies) {
  const entries = [];
  const skipped = [];
  for (const c of companies) {
    const names = Array.isArray(c.legal) ? c.legal : (c.legal ? [c.legal] : [c.name]);
    const pattern = names.map(n => escapeForRegex(normalize(n))).filter(Boolean).join('|');
    if (!pattern) { skipped.push(c.name || c.id); continue; }
    entries.push({ id: String(c.id), pattern });
  }
  return { entries, skipped };
}

function buildQuery() {
  return `
    WITH all_in_range AS (
      SELECT
        p.family_id,
        -- ★ EXISTS(...)を使った入れ子の相関サブクエリは、BigQueryのオプティマイザが
        --   LEFT SEMI JOINとして実行しようとして
        --   "LEFT SEMI JOIN cannot be used without a condition that is an equality
        --   of fields from both sides of the join." というエラーになることがある
        --   (正規表現マッチは等価条件ではないため)。
        --   EXISTSを使わず、2つの配列(出願人名 × 企業パターン)の直積を
        --   ARRAY_AGG(DISTINCT ...)で集約する形に書き換えることで回避する。
        --   スキャン対象カラムは変わらないため、課金額への影響はない。
        IFNULL((
          SELECT ARRAY_AGG(DISTINCT c.id)
          FROM UNNEST(p.assignee_harmonized) AS a, UNNEST(@companies) AS c
          WHERE REGEXP_CONTAINS(REGEXP_REPLACE(LOWER(a.name), r'[^a-z0-9]', ''), c.pattern)
        ), []) AS matched_ids
      FROM \`patents-public-data.patents.publications\` p
      WHERE p.publication_date BETWEEN @dateFromNum AND @dateToNum
        AND p.family_id IS NOT NULL AND p.family_id != '0'
    ),
    family_company_map AS (
      SELECT family_id, ARRAY_CONCAT_AGG(matched_ids) AS matched_company_ids
      FROM all_in_range
      WHERE ARRAY_LENGTH(matched_ids) > 0
      GROUP BY family_id
    ),
    family_docs AS (
      SELECT
        p.family_id,
        f.matched_company_ids,
        p.publication_number,
        p.country_code,
        p.publication_date,
        p.filing_date,
        ARRAY_LENGTH(IFNULL(p.claims_localized, [])) AS claims_n,
        ARRAY_LENGTH(IFNULL(p.description_localized, [])) AS desc_n,
        COALESCE(
          (SELECT text FROM UNNEST(p.title_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.title_localized) LIMIT 1)
        ) AS title_en,
        COALESCE(
          (SELECT text FROM UNNEST(p.abstract_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.abstract_localized) LIMIT 1)
        ) AS abstract_en,
        -- ★ claims_text/description_textはSQL側でSUBSTRして長さを制限する。
        --   後段のJS側でもdescription_textは30000文字に切り詰めていたが、
        --   制限前の全文をBigQueryから転送するとNode側のJSONパース時に
        --   メモリを大量消費し(117社分×全世界2〜3年分の結果セットで
        --   OOM/JavaScript heap out of memoryが発生した実績あり)、
        --   スキャン課金額には影響しないため早めに切り詰めておく。
        SUBSTR(COALESCE(
          (SELECT text FROM UNNEST(p.claims_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.claims_localized) LIMIT 1)
        ), 1, 50000) AS claims_text,
        SUBSTR(COALESCE(
          (SELECT text FROM UNNEST(p.description_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.description_localized) LIMIT 1)
        ), 1, 35000) AS description_text,
        ARRAY(SELECT name FROM UNNEST(p.inventor_harmonized)) AS inventors,
        ARRAY(SELECT code FROM UNNEST(p.cpc)) AS cpc_codes
      FROM \`patents-public-data.patents.publications\` p
      JOIN family_company_map f ON p.family_id = f.family_id
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY family_id
          ORDER BY
            (CASE WHEN claims_n > 0 AND desc_n > 0 THEN 0 ELSE 1 END),
            (claims_n + desc_n) DESC,
            publication_date DESC
        ) AS rn
      FROM family_docs
    )
    SELECT * EXCEPT(rn, claims_n, desc_n) FROM ranked WHERE rn = 1
  `;
}

function rowToPatentsByCompany(r, companiesById) {
  // 1行(1ファミリー代表レコード)から、マッチした各企業ぶんのpatents行を作る。
  const { independent } = splitClaims(r.claims_text);
  const pubDateStr = r.publication_date
    ? String(r.publication_date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
    : null;
  const base = {
    patent_number: r.publication_number,
    title_en: r.title_en || '(タイトル未取得)',
    publication_date: pubDateStr,
    country: r.country_code,
    abstract_epo: r.abstract_en || null,
    inventors: r.inventors && r.inventors.length > 0 ? r.inventors : null,
    claims_independent: independent || null,
    description_text: r.description_text ? r.description_text.slice(0, 30000) : null,
    cpc: r.cpc_codes && r.cpc_codes.length > 0 ? r.cpc_codes : null,
    family_id: r.family_id || null,
    classifications_fetched_at: r.cpc_codes && r.cpc_codes.length > 0 ? new Date().toISOString() : null,
  };
  const out = [];
  const matchedIds = [...new Set(r.matched_company_ids || [])];
  for (const cid of matchedIds) {
    const company = companiesById.get(cid);
    if (!company) continue; // 念のため(通常は起きない)
    out.push({ ...base, company_id: company.id, company_name: company.name });
  }
  return out;
}

async function upsertCompanyPatents(companyId, companyName, rows) {
  const ids = [...new Set(rows.map(r => r.patent_number).filter(Boolean))];
  if (ids.length === 0) return { inserted: 0, error: null };

  // ① 既存レコードをDELETE
  const delUrl = '/rest/v1/patents?patent_number=in.(' + ids.map(id => encodeURIComponent(id)).join(',') + ')&company_id=eq.' + encodeURIComponent(companyId);
  const delRes = await supabaseFetch(delUrl, { method: 'DELETE' });
  if (!delRes.ok) {
    return { inserted: 0, error: 'DELETE失敗 (HTTP ' + delRes.status + '): ' + (await delRes.text()).slice(0, 300) };
  }

  // ② INSERT (100件ずつ)
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const res = await supabaseFetch('/rest/v1/patents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { inserted: i, error: 'INSERT失敗 (HTTP ' + res.status + ', ' + companyName + '): ' + detail.slice(0, 300) };
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return { inserted: rows.length, error: null };
}

const FLUSH_THRESHOLD = 500; // バッファ合計がこの件数を超えたら逐次Supabaseへ書き出す

async function flushBuffers(buffers, companiesById, stats) {
  const cids = [...buffers.keys()].filter(cid => buffers.get(cid).length > 0);
  for (const cid of cids) {
    const rows = buffers.get(cid);
    buffers.set(cid, []);
    const company = companiesById.get(cid);
    const withText = rows.filter(r => r.claims_independent || r.description_text).length;
    const { inserted, error } = await upsertCompanyPatents(cid, company ? company.name : cid, rows);
    const s = stats.get(cid) || { count: 0, withText: 0, error: null };
    s.count += inserted;
    s.withText += withText;
    if (error) s.error = error;
    stats.set(cid, s);
  }
}

function totalBuffered(buffers) {
  let n = 0;
  for (const rows of buffers.values()) n += rows.length;
  return n;
}

async function main() {
  console.log(`▶ 期間: ${DATE_FROM} 〜 ${DATE_TO}`);

  const companies = await loadCompanies();
  console.log(`▶ 対象企業数: ${companies.length}`);

  const { entries, skipped } = buildCompanyPatterns(companies);
  if (skipped.length > 0) {
    console.warn('⚠️ 出願人名パターンが作れず除外した企業: ' + skipped.join(', '));
  }
  if (entries.length === 0) fail('有効な企業パターンが1件もありません');

  const companiesById = new Map(companies.map(c => [String(c.id), c]));

  const credentials = JSON.parse(process.env.GCP_SA_KEY_JSON);
  const bigquery = new BigQuery({ projectId: process.env.GCP_PROJECT_ID, credentials });

  const query = buildQuery();
  const params = {
    companies: entries,
    dateFromNum: toYYYYMMDD(DATE_FROM),
    dateToNum: toYYYYMMDD(DATE_TO),
  };
  const types = { companies: [{ id: 'STRING', pattern: 'STRING' }] };

  // まず dry-run でスキャン見積もりを確認する(課金なし)
  const [dryJob] = await bigquery.createQueryJob({ query, location: 'US', params, types, dryRun: true });
  const estBytes = Number(dryJob.metadata.statistics.totalBytesProcessed || 0);
  console.log(`📊 スキャン見積もり: ${(estBytes / 1024 ** 4).toFixed(3)} TiB`);

  if (DRY_RUN) {
    console.log('DRY_RUN=true のため、ここで終了します(実クエリは実行していません)。');
    process.exit(0);
  }

  // ★ bigquery.query(...)は結果セット全体を1つの配列としてメモリに読み込むため、
  //   対象企業・期間が広いと(全世界2〜3年分の請求項・明細書全文を含むため)
  //   Node側でJavaScript heap out of memoryを起こす。createQueryStream()で
  //   1行ずつストリーミングし、一定件数ごとにSupabaseへ書き出すことで
  //   メモリ使用量を抑える。
  const stream = bigquery.createQueryStream({
    query,
    location: 'US',
    params,
    types,
    maximumBytesBilled: MAX_BYTES_BILLED,
  });

  const buffers = new Map(companies.map(c => [String(c.id), []]));
  const stats = new Map(companies.map(c => [String(c.id), { count: 0, withText: 0, error: null }]));
  let rowCount = 0;

  for await (const r of stream) {
    rowCount++;
    const patentRows = rowToPatentsByCompany(r, companiesById);
    for (const pr of patentRows) {
      const cid = String(pr.company_id);
      if (!buffers.has(cid)) buffers.set(cid, []);
      buffers.get(cid).push(pr);
    }
    if (totalBuffered(buffers) >= FLUSH_THRESHOLD) {
      await flushBuffers(buffers, companiesById, stats);
    }
  }
  await flushBuffers(buffers, companiesById, stats);

  console.log(`▶ BigQueryから取得したファミリー代表レコード数: ${rowCount}`);

  console.log('\n=== 実行結果サマリー ===');
  let hadError = false;
  for (const company of companies) {
    const cid = String(company.id);
    const s = stats.get(cid) || { count: 0, withText: 0, error: null };
    if (s.error) hadError = true;
    const mark = s.error ? '❌' : (s.count === 0 ? '— ' : '✅');
    console.log(`${mark} ${company.name}: ${s.count}件 (請求項/明細書あり: ${s.withText}件)` + (s.error ? `  エラー: ${s.error}` : ''));
  }
  const totalCount = [...stats.values()].reduce((a, s) => a + s.count, 0);
  console.log(`\n合計保存件数: ${totalCount}件`);

  if (hadError) {
    console.error('\n⚠️ 一部の企業でエラーが発生しました(上記ログ参照)。');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('❌ 予期しないエラー:', e);
  process.exit(1);
});
