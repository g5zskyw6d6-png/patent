-- =============================================================================
-- 小分類を大分類に階層整合させる ＋「その他」小分類を追加
-- =============================================================================
-- 実行場所: Supabase Dashboard → SQL Editor
-- 実行順: STEP 1 → 2 → 3 → 4 の順にそのまま実行してください。
--
-- 変更内容:
--   ・各大分類（小分類を持つもの）に「その他」小分類を追加
--   ・tech_signals_subcat / tech_signals_paper_subcat を再定義:
--       - キーワードヒットのうち「親の大分類に属する特許/論文」のみ計上
--       - 親に属するがどの小分類にもヒットしない件は「その他」に計上
--   → 親に属する全件が必ずいずれかの小分類に現れる（ユニーク和＝大分類）。
--     ※1件が複数小分類にヒットした場合の重複計上（非排他）は残るため、
--       単純合計は大分類を若干超えることがあります。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: 「その他」小分類を追加（小分類を持つ大分類ごと・重複追加は防止）
-- ---------------------------------------------------------------------------
INSERT INTO integration.technology_taxonomy (code, name_ja, parent_id, level, sort_order)
SELECT p.code || '_other', 'その他', p.id, 2, 999
FROM integration.technology_taxonomy p
WHERE p.level = 1
  AND EXISTS (SELECT 1 FROM integration.technology_taxonomy c
              WHERE c.parent_id = p.id AND c.level = 2)
  AND NOT EXISTS (SELECT 1 FROM integration.technology_taxonomy c2
                  WHERE c2.parent_id = p.id AND c2.code = p.code || '_other');

-- ---------------------------------------------------------------------------
-- STEP 2: 特許の小分類マテビューを再定義（親大分類に従属＋その他）
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_subcat;

CREATE MATERIALIZED VIEW integration.tech_signals_subcat AS
WITH pat AS (
  -- 特許×親大分類（大分類マテビューと同一のIPCロジック）
  SELECT DISTINCT x.canonical_slug,
         EXTRACT(year FROM p.publication_date)::smallint AS year,
         p.id AS patent_id,
         tc.taxonomy_id AS parent_taxonomy_id,
         p.ipc,
         lower(concat_ws(' ', p.title_en, p.title_ja, p.abstract_epo)) AS txt
  FROM integration.company_crosswalk x
  JOIN patents p ON p.company_id = x.patent_db_company_id
  CROSS JOIN LATERAL unnest(COALESCE(p.ipc, '{}'::text[])) c(code)
  JOIN integration.taxonomy_patent_class tc
    ON tc.scheme = 'ipc'
   AND ( (tc.match_mode = 'exact'  AND upper(c.code) = tc.code)
      OR (tc.match_mode = 'prefix' AND upper(c.code) LIKE tc.code || '%') )
  WHERE p.publication_date IS NOT NULL
),
sub AS (
  -- キーワード判定（word / phrase / ipc）— 親大分類が一致する小分類のみ
  SELECT DISTINCT pat.canonical_slug, pat.year, pat.patent_id, k.taxonomy_id
  FROM pat
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = pat.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_patent_keyword k
    ON k.taxonomy_id = t2.id
  WHERE ( (k.match_mode = 'word'   AND pat.txt ~* ('\m' || k.term || '\M'))
       OR (k.match_mode = 'phrase' AND pat.txt LIKE '%' || lower(k.term) || '%')
       OR (k.match_mode = 'ipc'    AND EXISTS (
             SELECT 1 FROM unnest(COALESCE(pat.ipc, '{}'::text[])) cc(code)
             WHERE upper(cc.code) LIKE k.term || '%')) )
),
others AS (
  -- 親に属するがどの小分類にもヒットしない → 「その他」へ
  SELECT DISTINCT pat.canonical_slug, pat.year, pat.patent_id, o.id AS taxonomy_id
  FROM pat
  JOIN integration.technology_taxonomy p1 ON p1.id = pat.parent_taxonomy_id
  JOIN integration.technology_taxonomy o
    ON o.parent_id = p1.id AND o.code = p1.code || '_other'
  WHERE NOT EXISTS (
    SELECT 1
    FROM sub s
    JOIN integration.technology_taxonomy tt ON tt.id = s.taxonomy_id
    WHERE s.patent_id = pat.patent_id
      AND tt.parent_id = pat.parent_taxonomy_id)
),
allm AS (
  SELECT * FROM sub
  UNION
  SELECT * FROM others
)
SELECT canonical_slug, taxonomy_id, year,
       count(DISTINCT patent_id) AS patent_count
FROM allm
GROUP BY canonical_slug, taxonomy_id, year;

GRANT SELECT ON integration.tech_signals_subcat TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 3: 論文の小分類マテビューを再定義（親大分類に従属＋その他）
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_paper_subcat;

CREATE MATERIALIZED VIEW integration.tech_signals_paper_subcat AS
WITH paper AS (
  -- 論文×親大分類（大分類マテビューと同一のsubfieldロジック）
  SELECT DISTINCT wc.company_slug AS canonical_slug,
         w.publication_year AS year,
         w.openalex_id,
         tt.id AS parent_taxonomy_id,
         lower(concat_ws(' ', w.title, w.abstract_text)) AS txt
  FROM openalex.works w
  JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
  CROSS JOIN LATERAL jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) t(value)
  JOIN integration.paper_subfield_taxonomy m ON m.subfield = (t.value ->> 'subfield')
  JOIN integration.technology_taxonomy tt ON tt.code = m.taxonomy_code
  WHERE w.publication_year IS NOT NULL AND w.topics IS NOT NULL
),
sub AS (
  SELECT DISTINCT paper.canonical_slug, paper.year, paper.openalex_id, k.taxonomy_id
  FROM paper
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = paper.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_patent_keyword k
    ON k.taxonomy_id = t2.id
  WHERE ( (k.match_mode = 'word'   AND paper.txt ~* ('\m' || k.term || '\M'))
       OR (k.match_mode = 'phrase' AND paper.txt LIKE '%' || lower(k.term) || '%') )
),
others AS (
  SELECT DISTINCT paper.canonical_slug, paper.year, paper.openalex_id, o.id AS taxonomy_id
  FROM paper
  JOIN integration.technology_taxonomy p1 ON p1.id = paper.parent_taxonomy_id
  JOIN integration.technology_taxonomy o
    ON o.parent_id = p1.id AND o.code = p1.code || '_other'
  WHERE NOT EXISTS (
    SELECT 1
    FROM sub s
    JOIN integration.technology_taxonomy tt ON tt.id = s.taxonomy_id
    WHERE s.openalex_id = paper.openalex_id
      AND tt.parent_id = paper.parent_taxonomy_id)
),
allm AS (
  SELECT * FROM sub
  UNION
  SELECT * FROM others
)
SELECT canonical_slug, taxonomy_id, year,
       count(DISTINCT openalex_id) AS paper_count
FROM allm
GROUP BY canonical_slug, taxonomy_id, year;

GRANT SELECT ON integration.tech_signals_paper_subcat TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 4: 整合性の検証（大分類 vs 小分類ユニーク和のサンプル比較）
-- ---------------------------------------------------------------------------
-- 特許: 大分類の件数と、その配下小分類の合計（重複込み延べ）を並べる
SELECT p1.name_ja AS 大分類,
       (SELECT COALESCE(SUM(ts.patent_count),0)
          FROM integration.tech_signals_patent ts
         WHERE ts.taxonomy_id = p1.id) AS 大分類計,
       (SELECT COALESCE(SUM(ss.patent_count),0)
          FROM integration.tech_signals_subcat ss
          JOIN integration.technology_taxonomy c ON c.id = ss.taxonomy_id
         WHERE c.parent_id = p1.id) AS 小分類延べ計
FROM integration.technology_taxonomy p1
WHERE p1.level = 1
ORDER BY p1.sort_order;
