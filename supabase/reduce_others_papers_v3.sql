-- =============================================================================
-- 論文の「その他」削減（軽量版 v3）: トピック照合のみ・base を実体テーブル化
-- =============================================================================
-- 前提: パターン表 taxonomy_paper_topic_pattern と対応表 taxonomy_paper_topic_map
--       は作成済み（reduce_others_papers.sql STEP1-2 と v2 STEP A/B）。
--
-- 変更点（高速化）:
--   ・キーワード(word/phrase)照合を廃止 → 論文はトピック照合が主戦力のため精度ほぼ不変
--   ・topics 展開を実体テーブル _paper_base に1回だけ落とし、以降は軽い結合のみ
--   ・各 STEP を単独実行すれば、1回のスキャンが60秒に収まりやすい
--
-- タイムアウトが続く場合は末尾の「直接接続」手順（psql / GUI）を使用。
-- =============================================================================

SET statement_timeout = '600s';

-- ---------------------------------------------------------------------------
-- STEP 1: topics を1回だけ展開して実体テーブル化（★単独実行）
--   openalex_id × topic ごとに subfield / display_name を1行に展開
-- ---------------------------------------------------------------------------
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
-- STEP 2: 論文×親大分類の対応を実体テーブル化（★単独実行）
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
-- STEP 3: マテビュー再定義（トピック照合＋汎用受け皿・★単独実行）
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_paper_subcat;

CREATE MATERIALIZED VIEW integration.tech_signals_paper_subcat AS
WITH m_topic AS (
  -- トピック名 → 小分類（親が一致する場合のみ）
  SELECT DISTINCT pp.slug AS canonical_slug, pp.year, pp.openalex_id, mp.taxonomy_id
  FROM integration._paper_base b
  JOIN integration.taxonomy_paper_topic_map mp ON mp.display_name = b.display_name
  JOIN integration.technology_taxonomy c ON c.id = mp.taxonomy_id
  JOIN integration._paper_parent pp
    ON pp.openalex_id = b.openalex_id
   AND pp.parent_taxonomy_id = c.parent_id
),
others AS (
  -- どの小分類にも入らない → 汎用・基盤技術（_other）
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
-- STEP 4: 確認（★単独実行）
-- ---------------------------------------------------------------------------
SELECT p1.name_ja AS 大分類,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.paper_count ELSE 0 END) AS 汎用基盤,
       SUM(ss.paper_count) AS 延べ計,
       ROUND(100.0 * SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.paper_count ELSE 0 END)
             / NULLIF(SUM(ss.paper_count),0), 1) AS 汎用比率pct
FROM integration.tech_signals_paper_subcat ss
JOIN integration.technology_taxonomy c  ON c.id = ss.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order
ORDER BY 汎用比率pct DESC;

-- ---------------------------------------------------------------------------
-- 後片付け（任意・STEP4確認後に実行可）
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS integration._paper_base;
-- DROP TABLE IF EXISTS integration._paper_parent;

-- =============================================================================
-- ★ SQL Editor で STEP1 や STEP3 が「upstream timeout」になる場合（直接接続）:
--   1) Supabase Dashboard → Project Settings → Database → Connection string
--      の「URI」をコピー（[YOUR-PASSWORD] を実際のDBパスワードに置換）
--   2) 手元ターミナルで:
--        psql "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"
--   3) 本ファイルを丸ごと貼り付けて実行（\i でも可）。ゲートウェイ制限を受けません。
--   ※ psql が無い場合は TablePlus / DBeaver 等のGUIで同じ接続文字列を使えばOK。
-- =============================================================================
