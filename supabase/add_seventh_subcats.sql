-- =============================================================================
-- 案3: 各大分類に「7つ目の小分類」を新設し、残存トピックを割当（論文中心）
-- =============================================================================
-- 前提: 実体テーブル integration._paper_base（topics展開済・約50万行）と
--       integration._paper_parent（論文×親大分類）が存在すること。
--       無い場合は reduce_others_papers_v3.sql の STEP1・2 を先に実行。
--
-- 手順（SQL Editorで STEP1→5 を順に。STEP4は単独推奨）:
--   STEP1 7つ目の小分類を追加
--   STEP2 その小分類へトピックパターンを投入
--   STEP3 トピック対応表を再構築（_paper_base から軽量に）
--   STEP4 論文の小分類マテビューを再定義（★単独実行）
--   STEP5 「汎用・基盤技術」比率の再確認
-- =============================================================================

SET statement_timeout = '600s';

-- ---------------------------------------------------------------------------
-- STEP 1: 7つ目の小分類を新設（兄弟 T0x-01 から親IDを引く・重複ガード付き）
-- ---------------------------------------------------------------------------
WITH newsub(pcode, code, name_ja) AS (
  VALUES
    ('T01-01','T01-07','ネットワーク基盤・分散システム'),
    ('T02-01','T02-07','機械学習理論・最適化'),
    ('T03-01','T03-07','計算アーキテクチャ・組込み'),
    ('T04-01','T04-07','車両・モビリティ'),
    ('T05-01','T05-07','音声・オーディオ処理'),
    ('T06-01','T06-07','高周波・無線デバイス'),
    ('T07-01','T07-07','臨床医学・診療研究'),
    ('T08-01','T08-07','無機・金属・計算材料'),
    ('T09-01','T09-07','制御・ロボティクス・機械')
)
INSERT INTO integration.technology_taxonomy (code, name_ja, parent_id, level, sort_order)
SELECT n.code, n.name_ja, ref.parent_id, 2, 7
FROM newsub n
JOIN integration.technology_taxonomy ref ON ref.code = n.pcode
WHERE NOT EXISTS (
  SELECT 1 FROM integration.technology_taxonomy x WHERE x.code = n.code
);

-- ---------------------------------------------------------------------------
-- STEP 2: 7つ目の小分類へ トピックパターンを投入（コード経由でIDを解決）
-- ---------------------------------------------------------------------------
WITH pat(code, pattern) AS (
  VALUES
    -- 次世代通信 → ネットワーク基盤・分散システム
    ('T01-07','Cloud Computing'),('T01-07','IoT'),('T01-07','Edge'),('T01-07','Fog Computing'),
    ('T01-07','Distributed'),('T01-07','Network Security'),('T01-07','Intrusion'),
    ('T01-07','Caching'),('T01-07','Content Delivery'),('T01-07','Peer-to-Peer'),
    ('T01-07','Network Traffic'),('T01-07','Software System'),('T01-07','Software Engineering'),
    ('T01-07','Blockchain'),('T01-07','Privacy-Preserving'),('T01-07','Wireless Network'),
    ('T01-07','Internet Traffic'),('T01-07','Malware'),
    -- AI・認識 → 機械学習理論・最適化
    ('T02-07','Machine Learning and Algorithms'),('T02-07','Stochastic Gradient'),
    ('T02-07','Bayesian'),('T02-07','Optimization'),('T02-07','Graph Neural'),
    ('T02-07','Clustering'),('T02-07','Metaheuristic'),('T02-07','Evolutionary Algorithm'),
    ('T02-07','Data Classification'),('T02-07','Bandit'),('T02-07','Data Stream'),
    ('T02-07','Time Series'),('T02-07','Data Mining'),
    -- コンピューティング基盤 → 計算アーキテクチャ・組込み
    ('T03-07','VLSI'),('T03-07','FPGA'),('T03-07','Embedded'),('T03-07','Parallel Computing'),
    ('T03-07','Interconnection'),('T03-07','Real-Time System'),('T03-07','Circuit'),
    ('T03-07','Radiation Effects'),('T03-07','Memory and Neural'),('T03-07','Low-power'),
    ('T03-07','3D IC'),('T03-07','Ferroelectric'),
    -- 蓄電・電力 → 車両・モビリティ
    ('T04-07','Autonomous Vehicle'),('T04-07','Vehicle Dynamics'),('T04-07','Transportation'),
    ('T04-07','Traffic'),('T04-07','Additive Manufacturing'),('T04-07','Vehicle emissions'),
    ('T04-07','Combustion Engine'),('T04-07','Vehicle Noise'),('T04-07','Vehicle Routing'),
    -- 映像・ディスプレイ → 音声・オーディオ処理
    ('T05-07','Speech and Audio'),('T05-07','Music and Audio'),('T05-07','Music Technology'),
    ('T05-07','Audio Processing'),('T05-07','Acoustic'),('T05-07','Speech Recognition'),
    ('T05-07','Speech and dialogue'),('T05-07','Voice'),('T05-07','Hearing'),
    -- 半導体デバイス → 高周波・無線デバイス
    ('T06-07','Antenna'),('T06-07','Microwave'),('T06-07','Radio Frequency'),
    ('T06-07','Millimeter-Wave'),('T06-07','Wireless Communication'),('T06-07','MIMO'),
    ('T06-07','Full-Duplex'),('T06-07','Radar'),('T06-07','Waveguide'),
    -- ヘルスケア・医薬 → 臨床医学・診療研究
    ('T07-07','Cardiac'),('T07-07','Cardiovascular'),('T07-07','Stroke'),('T07-07','Diabetes'),
    ('T07-07','Surgery'),('T07-07','Surgical'),('T07-07','Disease'),('T07-07','Clinical'),
    ('T07-07','Patient'),('T07-07','Respiratory'),('T07-07','Renal'),('T07-07','Neuro'),
    ('T07-07','Bone'),('T07-07','Pediatric'),('T07-07','Pregnancy'),('T07-07','Infection'),
    ('T07-07','Anesthesia'),('T07-07','Cardiology'),('T07-07','Pulmonary'),('T07-07','Arthr'),
    -- 材料・高分子 → 無機・金属・計算材料
    ('T08-07','Graphene'),('T08-07','2D Material'),('T08-07','Semiconductor material'),
    ('T08-07','Cataly'),('T08-07','Alloy'),('T08-07','Ceramic'),('T08-07','Oxide'),
    ('T08-07','Metal'),('T08-07','Nanomaterial'),('T08-07','Machine Learning in Materials'),
    ('T08-07','Corrosion'),('T08-07','Nanoparticle'),('T08-07','Thin Film'),
    ('T08-07','Perovskite'),('T08-07','Battery Material'),('T08-07','Fuel Cell'),
    -- センシング・測位 → 制御・ロボティクス・機械
    ('T09-07','Control System'),('T09-07','Fluid Dynamics'),('T09-07','Combustion'),
    ('T09-07','Turbomachinery'),('T09-07','Aerodynamics'),('T09-07','Vibration'),
    ('T09-07','Motor'),('T09-07','Robotic'),('T09-07','Robot'),('T09-07','Fault Detection'),
    ('T09-07','Heat Transfer'),('T09-07','Actuator'),('T09-07','Mechanical')
)
INSERT INTO integration.taxonomy_paper_topic_pattern (taxonomy_id, pattern)
SELECT t.id, p.pattern
FROM pat p
JOIN integration.technology_taxonomy t ON t.code = p.code
ON CONFLICT (taxonomy_id, pattern) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STEP 3: トピック対応表を再構築（_paper_base の distinct 名から・軽量）
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
-- STEP 4: 論文の小分類マテビューを再定義（★単独実行）
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_paper_subcat;

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
-- STEP 5: 「汎用・基盤技術」比率の再確認（論文）
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
