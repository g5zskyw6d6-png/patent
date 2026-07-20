-- =============================================================================
-- 論文の「その他」削減（最適化版）: ILIKEを事前解決し、ビューは等値結合のみ
-- =============================================================================
-- 前提: reduce_others_papers.sql の STEP 1・2（パターン表 taxonomy_paper_topic_pattern
--       とパターン投入）は実行済みであること。未実行なら先にそれを実行。
--
-- 変更点: ビュー構築時の重い ILIKE を廃止。
--   ① 自社論文に出現する distinct トピック名を1回だけ抽出（_topic_names）
--   ② パターン×トピック名の ILIKE を「対応表」に事前解決（taxonomy_paper_topic_map）
--   ③ マテビューは display_name = display_name の等値結合のみ → 高速
--
-- タイムアウト対策: 各 STEP を個別に実行。特に STEP C（マテビュー）は単独で。
--   なお SQL Editor のゲートウェイ上限（約60秒）に当たる場合は、末尾の
--   「直接接続で流す」手順（psql）を使ってください。
-- =============================================================================

-- セッションの実行時間上限を延長（可能な範囲で）
SET statement_timeout = '600s';

-- ---------------------------------------------------------------------------
-- STEP A: 自社論文に出現する distinct トピック名を抽出（1回だけ・軽量な受け皿）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS integration._topic_names;
CREATE TABLE integration._topic_names AS
SELECT DISTINCT (t.value ->> 'display_name') AS display_name
FROM openalex.works w
JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
CROSS JOIN LATERAL jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) t(value)
WHERE w.topics IS NOT NULL
  AND (t.value ->> 'display_name') IS NOT NULL;

CREATE INDEX ON integration._topic_names (display_name);

-- ---------------------------------------------------------------------------
-- STEP B: パターン→トピック名 を事前解決した対応表（小×小の ILIKE・高速）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS integration.taxonomy_paper_topic_map;
CREATE TABLE integration.taxonomy_paper_topic_map AS
SELECT DISTINCT tn.display_name, tp.taxonomy_id
FROM integration._topic_names tn
JOIN integration.taxonomy_paper_topic_pattern tp
  ON tn.display_name ILIKE '%' || tp.pattern || '%';

CREATE INDEX ON integration.taxonomy_paper_topic_map (display_name);
GRANT SELECT ON integration.taxonomy_paper_topic_map TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP C: 論文の小分類マテビューを再定義（等値結合のみ・単独実行推奨）
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_paper_subcat;

CREATE MATERIALIZED VIEW integration.tech_signals_paper_subcat AS
WITH base AS (
  -- topics を1回だけ展開（subfield と display_name を同時に取得）
  SELECT wc.company_slug AS slug,
         w.publication_year AS year,
         w.openalex_id,
         (t.value ->> 'subfield') AS subfield,
         (t.value ->> 'display_name') AS display_name,
         lower(concat_ws(' ', w.title, w.abstract_text)) AS txt
  FROM openalex.works w
  JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
  CROSS JOIN LATERAL jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) t(value)
  WHERE w.publication_year IS NOT NULL AND w.topics IS NOT NULL
),
paper AS (
  -- (論文, 親大分類) の対応（subfield 経由）
  SELECT DISTINCT b.slug, b.year, b.openalex_id, tt.id AS parent_taxonomy_id
  FROM base b
  JOIN integration.paper_subfield_taxonomy m ON m.subfield = b.subfield
  JOIN integration.technology_taxonomy tt ON tt.code = m.taxonomy_code
),
paper_txt AS (
  -- 論文ごとの結合テキスト（重複排除）
  SELECT DISTINCT openalex_id, txt FROM base
),
m_topic AS (
  -- トピック名の等値結合 → 小分類（親が一致する場合のみ採用）
  SELECT DISTINCT p.slug AS canonical_slug, p.year, p.openalex_id, mp.taxonomy_id
  FROM base b
  JOIN integration.taxonomy_paper_topic_map mp ON mp.display_name = b.display_name
  JOIN integration.technology_taxonomy c ON c.id = mp.taxonomy_id
  JOIN paper p ON p.openalex_id = b.openalex_id
              AND p.parent_taxonomy_id = c.parent_id
),
m_kw AS (
  -- 既存キーワード（word/phrase）照合
  SELECT DISTINCT p.slug AS canonical_slug, p.year, p.openalex_id, k.taxonomy_id
  FROM paper p
  JOIN paper_txt pt ON pt.openalex_id = p.openalex_id
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = p.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_patent_keyword k ON k.taxonomy_id = t2.id
  WHERE ( (k.match_mode = 'word'   AND pt.txt ~* ('\m' || k.term || '\M'))
       OR (k.match_mode = 'phrase' AND pt.txt LIKE '%' || lower(k.term) || '%') )
),
sub AS (
  SELECT * FROM m_topic
  UNION
  SELECT * FROM m_kw
),
others AS (
  SELECT DISTINCT p.slug AS canonical_slug, p.year, p.openalex_id, o.id AS taxonomy_id
  FROM paper p
  JOIN integration.technology_taxonomy p1 ON p1.id = p.parent_taxonomy_id
  JOIN integration.technology_taxonomy o
    ON o.parent_id = p1.id AND o.code = p1.code || '_other'
  WHERE NOT EXISTS (
    SELECT 1 FROM sub s
    JOIN integration.technology_taxonomy tt ON tt.id = s.taxonomy_id
    WHERE s.openalex_id = p.openalex_id
      AND tt.parent_id = p.parent_taxonomy_id)
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
-- STEP D: 「汎用・基盤技術」比率の再確認（論文）
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

-- =============================================================================
-- それでも STEP C がゲートウェイ上限で失敗する場合（直接接続で流す）:
--   1) Supabase Dashboard → Project Settings → Database → Connection string
--      （Session / psql 用）をコピー
--   2) 手元のターミナルで:  psql "貼り付けた接続文字列"
--   3) 本ファイルの STEP A〜C を貼り付けて実行（ゲートウェイ制限を受けません）
-- =============================================================================
