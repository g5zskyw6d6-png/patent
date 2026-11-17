#!/usr/bin/env node
// =============================================================================
// scripts/tape-adhesive-patents.mjs
// ─────────────────────────────────────────────────────────────────────────
// ニチバン向け:「テープ／接着」関連特許を、企業を限定せず全世界から
// キーワード/CPC分類ベースで抽出する調査スクリプト。
//
// patent-woad本体のbulk-fetch-patents.mjsとの違い:
//   あちらは「決まった企業リストのどれに該当するか」を判定する必要が
//   あったが、こちらは企業を問わず「tape/adhesive関連か」だけを判定
//   すればよいので、単純な WHERE EXISTS 方式(以前の1社検索と同じ、
//   実績のある軽いパターン)だけで済む。
//
// 2つのモード:
//   MODE=count   (既定) … 候補となる絞り込み条件ごとに該当件数を
//                          表示するだけ(データ取得・書き出しなし)。
//                          まずはこちらで件数感を確認する。
//   MODE=extract … 実際にタイトル・要約・請求項・明細書等を取得し、
//                   JSON Lines ファイルに書き出す。
//
// 必要な環境変数:
//   GCP_PROJECT_ID / GCP_SA_KEY_JSON … bulk-fetch-patents.mjsと同じもの
//   DATE_FROM / DATE_TO               … 省略時 2024-01-01 〜 実行日
//   MODE                               … count | extract (既定 count)
//   EXTRACT_FILTER                    … extract時にどの絞り込み条件を
//                                        使うか(下記FILTERSのキー名)
//   MAX_ROWS                          … extract時の最大取得件数(既定 3000)
// =============================================================================

import { BigQuery } from '@google-cloud/bigquery';
import fs from 'node:fs';

const DATE_FROM = process.env.DATE_FROM || '2024-01-01';
const DATE_TO = process.env.DATE_TO || new Date().toISOString().slice(0, 10);
const MODE = (process.env.MODE || 'count').toLowerCase();
const EXTRACT_FILTER = process.env.EXTRACT_FILTER || 'cpc_and_keyword';
const MAX_ROWS = parseInt(process.env.MAX_ROWS || '3000', 10);
const MAX_BYTES_BILLED = process.env.BQ_MAX_BYTES_BILLED || String(2 * 1024 ** 4); // 2 TiB

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}
if (!process.env.GCP_PROJECT_ID) fail('GCP_PROJECT_ID が未設定です');
if (!process.env.GCP_SA_KEY_JSON) fail('GCP_SA_KEY_JSON が未設定です');

function toYYYYMMDD(dateStr) {
  return parseInt(String(dateStr).replace(/-/g, ''), 10);
}

// 候補となる絞り込み条件の定義。それぞれ `fam` CTE 内のbool列の組み合わせ。
// (SQL文字列の断片として埋め込むので、ここでは「名前 → SQL式」のペアのみ管理)
const FILTERS = {
  cpc_c09j: 'has_c09j',
  cpc_b32b: 'has_b32b',
  cpc_c09j_and_title_tape: '(has_c09j AND title_has_tape)',
  cpc_b32b_and_adhesive_kw: '(has_b32b AND (title_has_adhesive OR abstract_has_keyword))',
  title_tape_or_adhesive: '(title_has_tape OR title_has_adhesive)',
  cpc_and_keyword: '((has_c09j OR has_b32b) AND (title_has_tape OR title_has_adhesive OR abstract_has_keyword))',
};

function baseCTE() {
  return `
    WITH base AS (
      SELECT
        p.family_id,
        p.publication_number,
        p.country_code,
        p.publication_date,
        EXISTS (SELECT 1 FROM UNNEST(p.cpc) AS c WHERE STARTS_WITH(c.code, 'C09J')) AS has_c09j,
        EXISTS (SELECT 1 FROM UNNEST(p.cpc) AS c WHERE STARTS_WITH(c.code, 'B32B')) AS has_b32b,
        EXISTS (
          SELECT 1 FROM UNNEST(p.title_localized) AS t
          WHERE REGEXP_CONTAINS(LOWER(t.text), r'\\btape\\b')
        ) AS title_has_tape,
        EXISTS (
          SELECT 1 FROM UNNEST(p.title_localized) AS t
          WHERE REGEXP_CONTAINS(LOWER(t.text), r'adhesive')
        ) AS title_has_adhesive,
        EXISTS (
          SELECT 1 FROM UNNEST(p.abstract_localized) AS t
          WHERE REGEXP_CONTAINS(LOWER(t.text), r'\\btape\\b|adhesive')
        ) AS abstract_has_keyword
      FROM \`patents-public-data.patents.publications\` p
      WHERE p.publication_date BETWEEN @dateFromNum AND @dateToNum
        AND p.family_id IS NOT NULL AND p.family_id != '0'
        -- ★ ここで先に軽く絞り込む(以前の1社検索と同じWHERE EXISTSパターン)。
        --   これをせずに全世界・無条件でper-row計算すると前回の
        --   LEFT SEMI JOIN/実行時間の問題を繰り返すことになる。
        AND (
          EXISTS (SELECT 1 FROM UNNEST(p.cpc) AS c WHERE STARTS_WITH(c.code, 'C09J') OR STARTS_WITH(c.code, 'B32B'))
          OR EXISTS (SELECT 1 FROM UNNEST(p.title_localized) AS t WHERE REGEXP_CONTAINS(LOWER(t.text), r'\\btape\\b|adhesive'))
          OR EXISTS (SELECT 1 FROM UNNEST(p.abstract_localized) AS t WHERE REGEXP_CONTAINS(LOWER(t.text), r'\\btape\\b|adhesive'))
        )
    )
  `;
}

async function runCount(bigquery) {
  const query = baseCTE() + `
    , fam AS (
      SELECT
        family_id,
        LOGICAL_OR(has_c09j) AS has_c09j,
        LOGICAL_OR(has_b32b) AS has_b32b,
        LOGICAL_OR(title_has_tape) AS title_has_tape,
        LOGICAL_OR(title_has_adhesive) AS title_has_adhesive,
        LOGICAL_OR(abstract_has_keyword) AS abstract_has_keyword
      FROM base
      GROUP BY family_id
    )
    SELECT
      ${Object.entries(FILTERS).map(([name, expr]) => `COUNTIF(${expr}) AS ${name}`).join(',\n      ')},
      COUNT(*) AS cnt_total_candidates
    FROM fam
  `;
  const params = { dateFromNum: toYYYYMMDD(DATE_FROM), dateToNum: toYYYYMMDD(DATE_TO) };

  const [dryJob] = await bigquery.createQueryJob({ query, location: 'US', params, dryRun: true });
  const estBytes = Number(dryJob.metadata.statistics.totalBytesProcessed || 0);
  console.log(`📊 スキャン見積もり: ${(estBytes / 1024 ** 4).toFixed(3)} TiB`);

  const [rows] = await bigquery.query({ query, location: 'US', params, maximumBytesBilled: MAX_BYTES_BILLED });
  console.log('\n=== 絞り込み条件ごとのファミリー件数(重複なし) ===');
  const r = rows[0];
  for (const name of Object.keys(FILTERS)) {
    console.log(`  ${name}: ${r[name]}件`);
  }
  console.log(`  (参考) 候補全体(いずれかの条件に該当): ${r.cnt_total_candidates}件`);
  console.log('\n▶ MODE=extract と EXTRACT_FILTER=<上記の名前> を指定して再実行すると、実際のデータを取得します。');
}

async function runExtract(bigquery) {
  const filterExpr = FILTERS[EXTRACT_FILTER];
  if (!filterExpr) fail(`EXTRACT_FILTER="${EXTRACT_FILTER}" は未定義です。候補: ${Object.keys(FILTERS).join(', ')}`);

  const query = baseCTE() + `
    , fam AS (
      SELECT
        family_id,
        LOGICAL_OR(has_c09j) AS has_c09j,
        LOGICAL_OR(has_b32b) AS has_b32b,
        LOGICAL_OR(title_has_tape) AS title_has_tape,
        LOGICAL_OR(title_has_adhesive) AS title_has_adhesive,
        LOGICAL_OR(abstract_has_keyword) AS abstract_has_keyword
      FROM base
      GROUP BY family_id
    ),
    target_families AS (
      SELECT family_id FROM fam WHERE ${filterExpr}
    ),
    family_docs AS (
      SELECT
        p.family_id,
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
        SUBSTR(COALESCE(
          (SELECT text FROM UNNEST(p.claims_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.claims_localized) LIMIT 1)
        ), 1, 50000) AS claims_text,
        SUBSTR(COALESCE(
          (SELECT text FROM UNNEST(p.description_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.description_localized) LIMIT 1)
        ), 1, 35000) AS description_text,
        ARRAY(SELECT name FROM UNNEST(p.assignee_harmonized)) AS assignees,
        ARRAY(SELECT name FROM UNNEST(p.inventor_harmonized)) AS inventors,
        ARRAY(SELECT code FROM UNNEST(p.cpc)) AS cpc_codes
      FROM \`patents-public-data.patents.publications\` p
      JOIN target_families f ON p.family_id = f.family_id
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
    LIMIT @maxRows
  `;
  const params = {
    dateFromNum: toYYYYMMDD(DATE_FROM),
    dateToNum: toYYYYMMDD(DATE_TO),
    maxRows: MAX_ROWS,
  };

  const [dryJob] = await bigquery.createQueryJob({ query, location: 'US', params, dryRun: true });
  const estBytes = Number(dryJob.metadata.statistics.totalBytesProcessed || 0);
  console.log(`📊 スキャン見積もり: ${(estBytes / 1024 ** 4).toFixed(3)} TiB (条件: ${EXTRACT_FILTER})`);

  const outPath = 'tape-adhesive-patents.jsonl';
  const stream = bigquery.createQueryStream({ query, location: 'US', params, maximumBytesBilled: MAX_BYTES_BILLED });
  const out = fs.createWriteStream(outPath);
  let n = 0;
  for await (const r of stream) {
    out.write(JSON.stringify(r) + '\n');
    n++;
  }
  out.end();
  console.log(`▶ ${n}件を ${outPath} に書き出しました。`);
}

async function main() {
  console.log(`▶ 期間: ${DATE_FROM} 〜 ${DATE_TO} / MODE=${MODE}`);
  const credentials = JSON.parse(process.env.GCP_SA_KEY_JSON);
  const bigquery = new BigQuery({ projectId: process.env.GCP_PROJECT_ID, credentials });

  if (MODE === 'count') {
    await runCount(bigquery);
  } else if (MODE === 'extract') {
    await runExtract(bigquery);
  } else {
    fail(`MODE="${MODE}" は不明です(count または extract)`);
  }
}

main().catch(e => {
  console.error('❌ 予期しないエラー:', e);
  process.exit(1);
});
