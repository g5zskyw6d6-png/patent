// =============================================================================
// api/gpatents-search.js  ―  Google Patents Public Datasets (BigQuery) 検索API
// =============================================================================
// 旧 api/epo-proxy.js (EPO OPS経由) に代わる、特許取得画面の新しいデータ取得元。
//
// ★v2: WO(PCT公開公報)はGoogle Patents Datasets上で請求項・明細書全文が
//   ほぼ収録されていないことが判明したため(2018年〜2026年のサンプルで
//   claims_localized / description_localized が一貫して空配列)、国を
//   限定せず「出願人名＋公開日範囲」で対象発明(ファミリー)を特定した上で、
//   そのファミリー内で最も情報が充実した(請求項・明細書全文がある)公開公報を
//   1件選んで返す、2段階のファミリー代表選択ロジックに変更した。
//   これによりUS/EP/JP/CNなど各国移行後の公開公報も自動的に候補になり、
//   かつ同一発明の重複も出ない。
//
// 必要な環境変数(Vercel → Settings → Environment Variables):
//   GCP_PROJECT_ID        … クエリ実行時の課金先プロジェクトID
//   GCP_SA_KEY_JSON        … サービスアカウントキー(JSON)をそのまま1行の文字列として保存
//                             (BigQuery Job User + BigQuery Data Viewer ロールが必要)
//
// POST body: { legalNames: string[], dateFrom: "YYYY-MM-DD", dateTo: "YYYY-MM-DD" }
//   ※ countries は指定しても無視される(v2では国を限定しないため)。
// =============================================================================

import { BigQuery } from '@google-cloud/bigquery';

export const config = { maxDuration: 800 };

function normalize(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function toYYYYMMDD(dateStr) {
  return parseInt(String(dateStr).replace(/-/g, ''), 10);
}

function getClient() {
  const projectId = process.env.GCP_PROJECT_ID;
  const keyJson = process.env.GCP_SA_KEY_JSON;
  if (!projectId || !keyJson) {
    throw new Error('GCP_PROJECT_ID / GCP_SA_KEY_JSON が未設定です(Vercel環境変数を確認してください)');
  }
  let credentials;
  try { credentials = JSON.parse(keyJson); }
  catch (e) { throw new Error('GCP_SA_KEY_JSON のJSONパースに失敗しました: ' + e.message); }
  return new BigQuery({ projectId, credentials });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { legalNames, dateFrom, dateTo } = req.body || {};
  const names = (Array.isArray(legalNames) ? legalNames : [legalNames]).filter(Boolean);
  if (names.length === 0) return res.status(400).json({ error: 'legalNames が空です' });
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom / dateTo が必要です' });

  const namePattern = names.map(n => escapeForRegex(normalize(n))).filter(Boolean).join('|');
  if (!namePattern) return res.status(400).json({ error: '有効な企業名がありません' });

  // ① 出願人名＋公開日範囲で「対象ファミリー」を特定(国は限定しない)
  // ② そのファミリーに属する全公開公報の中から、請求項・明細書全文がある
  //    ものを優先して1件だけ選ぶ(同率なら公開日が新しい方)
  const query = `
    WITH target_families AS (
      SELECT DISTINCT family_id
      FROM \`patents-public-data.patents.publications\`
      WHERE publication_date BETWEEN @dateFromNum AND @dateToNum
        AND family_id IS NOT NULL AND family_id != '0'
        AND EXISTS (
          SELECT 1 FROM UNNEST(assignee_harmonized) AS a
          WHERE REGEXP_CONTAINS(REGEXP_REPLACE(LOWER(a.name), r'[^a-z0-9]', ''), @namePattern)
        )
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
        COALESCE(
          (SELECT text FROM UNNEST(p.claims_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.claims_localized) LIMIT 1)
        ) AS claims_text,
        COALESCE(
          (SELECT text FROM UNNEST(p.description_localized) WHERE language = 'en' LIMIT 1),
          (SELECT text FROM UNNEST(p.description_localized) LIMIT 1)
        ) AS description_text,
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
    LIMIT 3000
  `;

  try {
    const bigquery = getClient();
    const [rows] = await bigquery.query({
      query,
      location: 'US',
      params: {
        dateFromNum: toYYYYMMDD(dateFrom),
        dateToNum: toYYYYMMDD(dateTo),
        namePattern,
      },
    });

    // 独立請求項の抽出（EPO版のclaims_independentに相当する簡易ヒューリスティック）
    const INDEP_REF_RE = /\b(claim|claims)\s+\d+/i;
    const splitClaims = (text) => {
      if (!text) return { all: '', independent: '' };
      const parts = text.split(/\n(?=\s*\d+\s*[.\)])/).map(s => s.trim()).filter(Boolean);
      const indep = parts.filter(p => !INDEP_REF_RE.test(p));
      return { all: parts.join('\n\n'), independent: indep.join('\n\n') };
    };

    const patents = rows.map(r => {
      const { independent } = splitClaims(r.claims_text);
      const pubDateStr = r.publication_date
        ? String(r.publication_date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
        : null;
      return {
        patent_number: r.publication_number,
        patent_title: r.title_en || '(タイトル未取得)',
        patent_date: pubDateStr,
        patent_abstract: r.abstract_en || '',
        claims_independent: independent || null,
        description_text: r.description_text ? r.description_text.slice(0, 30000) : null,
        inventors: r.inventors || [],
        country: r.country_code,
        family_id: r.family_id || null,
        cpc: r.cpc_codes || [],
        docNum: (r.publication_number || '').replace(/^[A-Z]{2}/, '').replace(/[A-Z]\d?$/, ''),
        kind: (r.publication_number || '').match(/[A-Z]\d?$/)?.[0] || '',
      };
    });

    return res.status(200).json({ patents, total_patent_count: patents.length });
  } catch (e) {
    console.error('gpatents-search error:', e.message);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
