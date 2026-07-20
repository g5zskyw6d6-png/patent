-- =============================================================================
-- 【更新用・まとめSQL】特許/論文の追加取得後に、技術シグナルを最新化する
-- =============================================================================
-- いつ使う: openalex.works（論文）や patents（特許）に新データを取り込んだ後。
-- 何をする: 大分類・小分類の集計（マテビュー）を全て作り直す/更新する。
--
-- 依存関係（この順序で実行する必要がある）:
--   _paper_base → _paper_parent → taxonomy_paper_topic_map → tech_signals_paper_subcat
--   ※ 分類ルール（taxonomy_patent_class / taxonomy_patent_keyword /
--      taxonomy_paper_topic_pattern）と 7つ目の小分類は永続化済みのため再投入不要。
--
-- 実行の注意（Supabase SQL Editor はゲートウェイ上限≈60秒）:
--   ・STEP は1つずつ実行。特に STEP 3（_paper_base）と STEP 6（マテビュー）は単独で。
--   ・「upstream timeout」が出る場合は末尾の「直接接続(psql/GUI)」で本ファイルを一括実行。
-- =============================================================================

SET statement_timeout = '600s';

-- ---------------------------------------------------------------------------
-- STEP 1: 特許の大分類・小分類マテビューを更新（標準 REFRESH・各単独）
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW integration.tech_signals_patent;
-- ↓ 別クエリで
REFRESH MATERIALIZED VIEW integration.tech_signals_subcat;

-- ---------------------------------------------------------------------------
-- STEP 2: 論文の大分類マテビューを更新
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW integration.tech_signals_paper;

-- ---------------------------------------------------------------------------
-- STEP 3: 論文トピック展開テーブルを作り直し（★単独実行・最重量）
--   既存マテビューが _paper_base に依存するため、先に外してから作り直す
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_paper_subcat;

DROP TABLE IF EXISTS integration._paper_base;
CREATE TABLE integration._paper_base AS
SELECT wc.company_slug AS slug,
       w.publication_year AS year,
       w.openalex_id,
       (t.value ->> 'subfield')     AS subfield,
       (t.value ->> 'display_name') AS display_name
FROM openalex.works w
JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
CROSS JOIN LATERAL jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) t(value)
WHERE w.publication_year IS NOT NULL AND w.topics IS NOT NULL;
CREATE INDEX ON integration._paper_base (subfield);
CREATE INDEX ON integration._paper_base (display_name);
CREATE INDEX ON integration._paper_base (openalex_id);

-- ---------------------------------------------------------------------------
-- STEP 4: 論文×親大分類テーブルを作り直し（★単独実行）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS integration._paper_parent;
CREATE TABLE integration._paper_parent AS
SELECT DISTINCT b.slug, b.year, b.openalex_id, tt.id AS parent_taxonomy_id
FROM integration._paper_base b
JOIN integration.paper_subfield_taxonomy m ON m.subfield = b.subfield
JOIN integration.technology_taxonomy tt ON tt.code = m.taxonomy_code;
CREATE INDEX ON integration._paper_parent (openalex_id);
CREATE INDEX ON integration._paper_parent (parent_taxonomy_id);

-- ---------------------------------------------------------------------------
-- STEP 5: トピック→小分類 対応表を再構築（パターンは永続化済みを利用）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS integration.taxonomy_paper_topic_map;
CREATE TABLE integration.taxonomy_paper_topic_map AS
SELECT DISTINCT dn.display_name, tp.taxonomy_id
FROM (SELECT DISTINCT display_name FROM integration._paper_base) dn
JOIN integration.taxonomy_paper_topic_pattern tp
  ON dn.display_name ILIKE '%' || tp.pattern || '%';
CREATE INDEX ON integration.taxonomy_paper_topic_map (display_name);
GRANT SELECT ON integration.taxonomy_paper_topic_map TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 6: 論文の小分類マテビューを作り直し（★単独実行）
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW integration.tech_signals_paper_subcat AS
WITH m_topic AS (
  SELECT DISTINCT pp.slug AS canonical_slug, pp.year, pp.openalex_id, mp.taxonomy_id
  FROM integration._paper_base b
  JOIN integration.taxonomy_paper_topic_map mp ON mp.display_name = b.display_name
  JOIN integration.technology_taxonomy c ON c.id = mp.taxonomy_id
  JOIN integration._paper_parent pp
    ON pp.openalex_id = b.openalex_id
   AND pp.parent_taxonomy_id = c.parent_id
),
others AS (
  SELECT DISTINCT pp.slug AS canonical_slug, pp.year, pp.openalex_id, o.id AS taxonomy_id
  FROM integration._paper_parent pp
  JOIN integration.technology_taxonomy p1 ON p1.id = pp.parent_taxonomy_id
  JOIN integration.technology_taxonomy o
    ON o.parent_id = p1.id AND o.code = p1.code || '_other'
  WHERE NOT EXISTS (
    SELECT 1 FROM m_topic s
    JOIN integration.technology_taxonomy tt ON tt.id = s.taxonomy_id
    WHERE s.openalex_id = pp.openalex_id
      AND tt.parent_id = pp.parent_taxonomy_id)
),
allm AS (
  SELECT * FROM m_topic
  UNION
  SELECT * FROM others
)
SELECT canonical_slug, taxonomy_id, year,
       count(DISTINCT openalex_id) AS paper_count
FROM allm
GROUP BY canonical_slug, taxonomy_id, year;

GRANT SELECT ON integration.tech_signals_paper_subcat TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 7: 検算（大分類=特許/論文、汎用比率の一覧）
-- ---------------------------------------------------------------------------
SELECT '特許' AS 種別, p1.name_ja AS 大分類,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END) AS 汎用基盤,
       SUM(ss.patent_count) AS 延べ計
FROM integration.tech_signals_subcat ss
JOIN integration.technology_taxonomy c  ON c.id = ss.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order
UNION ALL
SELECT '論文', p1.name_ja,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.paper_count ELSE 0 END),
       SUM(ss.paper_count)
FROM integration.tech_signals_paper_subcat ss
JOIN integration.technology_taxonomy c  ON c.id = ss.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order
ORDER BY 1, 2;

-- =============================================================================
-- ★ SQL Editor でタイムアウトする場合（直接接続で一括実行）:
--   1) Supabase Dashboard → Project Settings → Database → Connection string の URI をコピー
--      （[YOUR-PASSWORD] を実際のDBパスワードに置換）
--   2) ターミナル:  psql "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"
--   3) \i でこのファイルを流すか、内容を貼り付けて実行（ゲートウェイ制限なし）
--   ※ psql が無ければ TablePlus / DBeaver でも同じ URI で実行可。
-- =============================================================================
