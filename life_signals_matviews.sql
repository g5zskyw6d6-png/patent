-- 生活領域ポートフォリオ用 集計マテビュー
-- 前提: life_domain_register.sql 実行済み（axis='life' の分類が登録済み）

DROP MATERIALIZED VIEW IF EXISTS integration.life_signals_subcat;
DROP MATERIALIZED VIEW IF EXISTS integration.life_signals_patent;

-- 小分類（company × 小分類 × 年）: IPC網掛け ∩ キーワード一致
CREATE MATERIALIZED VIEW integration.life_signals_subcat AS
WITH base AS (
  SELECT DISTINCT
    x.canonical_slug,
    (EXTRACT(year FROM p.publication_date))::smallint AS year,
    p.id AS patent_id,
    major.id AS major_id,
    p.ipc,
    lower(concat_ws(' ', p.title_en, p.title_ja, p.abstract_epo)) AS txt
  FROM integration.company_crosswalk x
  JOIN patents p ON p.company_id = x.patent_db_company_id
  CROSS JOIN LATERAL unnest(COALESCE(p.ipc, '{}'::text[])) c(code)
  JOIN integration.taxonomy_patent_class tc
    ON tc.scheme = 'ipc'
   AND ((tc.match_mode = 'exact'  AND upper(c.code) = tc.code)
     OR (tc.match_mode = 'prefix' AND upper(c.code) LIKE tc.code || '%'))
  JOIN integration.technology_taxonomy major
    ON major.id = tc.taxonomy_id AND major.axis = 'life' AND major.level = 1
  WHERE p.publication_date IS NOT NULL
),
matched AS (
  SELECT DISTINCT b.canonical_slug, b.year, b.patent_id, child.id AS taxonomy_id
  FROM base b
  JOIN integration.technology_taxonomy child
    ON child.parent_id = b.major_id AND child.level = 2 AND child.axis = 'life'
  JOIN integration.taxonomy_patent_keyword k
    ON k.taxonomy_id = child.id
  WHERE (k.match_mode = 'word'   AND b.txt ~* ('\m' || k.term || '\M'))
     OR (k.match_mode = 'phrase' AND b.txt LIKE '%' || lower(k.term) || '%')
     OR (k.match_mode = 'ipc'    AND EXISTS (
           SELECT 1 FROM unnest(COALESCE(b.ipc, '{}'::text[])) cc(code)
           WHERE upper(cc.code) LIKE k.term || '%'))
)
SELECT canonical_slug, taxonomy_id, year, count(DISTINCT patent_id) AS patent_count
FROM matched
GROUP BY canonical_slug, taxonomy_id, year;

-- 大分類（company × 大分類 × 年）: IPC網掛け中で、いずれかの小分類キーワードに一致
CREATE MATERIALIZED VIEW integration.life_signals_patent AS
WITH base AS (
  SELECT DISTINCT
    x.canonical_slug,
    (EXTRACT(year FROM p.publication_date))::smallint AS year,
    p.id AS patent_id,
    major.id AS major_id,
    p.ipc,
    lower(concat_ws(' ', p.title_en, p.title_ja, p.abstract_epo)) AS txt
  FROM integration.company_crosswalk x
  JOIN patents p ON p.company_id = x.patent_db_company_id
  CROSS JOIN LATERAL unnest(COALESCE(p.ipc, '{}'::text[])) c(code)
  JOIN integration.taxonomy_patent_class tc
    ON tc.scheme = 'ipc'
   AND ((tc.match_mode = 'exact'  AND upper(c.code) = tc.code)
     OR (tc.match_mode = 'prefix' AND upper(c.code) LIKE tc.code || '%'))
  JOIN integration.technology_taxonomy major
    ON major.id = tc.taxonomy_id AND major.axis = 'life' AND major.level = 1
  WHERE p.publication_date IS NOT NULL
),
matched AS (
  SELECT DISTINCT b.canonical_slug, b.year, b.patent_id, b.major_id AS taxonomy_id
  FROM base b
  JOIN integration.technology_taxonomy child
    ON child.parent_id = b.major_id AND child.level = 2 AND child.axis = 'life'
  JOIN integration.taxonomy_patent_keyword k
    ON k.taxonomy_id = child.id
  WHERE (k.match_mode = 'word'   AND b.txt ~* ('\m' || k.term || '\M'))
     OR (k.match_mode = 'phrase' AND b.txt LIKE '%' || lower(k.term) || '%')
     OR (k.match_mode = 'ipc'    AND EXISTS (
           SELECT 1 FROM unnest(COALESCE(b.ipc, '{}'::text[])) cc(code)
           WHERE upper(cc.code) LIKE k.term || '%'))
)
SELECT canonical_slug, taxonomy_id, year, count(DISTINCT patent_id) AS patent_count
FROM matched
GROUP BY canonical_slug, taxonomy_id, year;

-- 確認用
SELECT 'subcat' AS view, count(*) AS rows FROM integration.life_signals_subcat
UNION ALL
SELECT 'patent' AS view, count(*) AS rows FROM integration.life_signals_patent;
