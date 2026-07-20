-- =============================================================================
-- 論文の「その他」を減らす：OpenAlexトピック名で小分類へ直接マッピング
-- =============================================================================
-- 実行場所: Supabase Dashboard → SQL Editor（STEP 1〜4を順に、REFRESHは単独で）
--
-- 背景: 論文はタイトル・要約のテキスト照合では小分類に拾いにくい。
--       OpenAlexの topics[].display_name（構造化ラベル）を直接照合する方が確実。
--       本SQLは topic名 ILIKE '%パターン%' で小分類へ割り当てる仕組みを追加する。
--
-- 方式: パターン表 taxonomy_paper_topic_pattern を新設し、
--       tech_signals_paper_subcat を「トピック照合＋既存キーワード照合＋汎用受け皿」
--       に再定義する。各ルールは親大分類の子小分類にのみ作用（誤爆しない）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: トピック→小分類 パターン表を作成
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration.taxonomy_paper_topic_pattern (
  taxonomy_id integer NOT NULL,
  pattern     text    NOT NULL,
  PRIMARY KEY (taxonomy_id, pattern)
);
GRANT SELECT ON integration.taxonomy_paper_topic_pattern TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 2: パターン投入（topics[].display_name に対する ILIKE 部分一致）
-- ---------------------------------------------------------------------------
INSERT INTO integration.taxonomy_paper_topic_pattern (taxonomy_id, pattern) VALUES
  -- ===== 次世代通信（19-24）=====
  (19,'5G'),(20,'6G'),(21,'Satellite Communication'),(21,'Optical Network'),
  (22,'Vehicular Ad Hoc'),(22,'VANET'),(22,'V2X'),
  (23,'MIMO'),(23,'Beamforming'),(23,'Antenna'),
  (24,'Software-Defined Network'),(24,'Network Slicing'),

  -- ===== AI・認識（43-48）=====
  (43,'Generative Adversarial'),(43,'Language Model'),(43,'Diffusion'),
  (44,'Vision'),(44,'Image Recognition'),(44,'Object Detection'),(44,'Pose'),
  (44,'Face recognition'),(44,'Image Segmentation'),(44,'Visual'),
  (45,'Natural Language'),(45,'Speech Recognition'),(45,'Speech and'),
  (45,'Sentiment'),(45,'Topic Modeling'),(45,'Text'),
  (46,'Reinforcement Learning'),(46,'Domain Adaptation'),(46,'Few-Shot'),
  (46,'Machine Learning and Algorithms'),(46,'Neural Network'),
  (47,'Parallel Computing'),(47,'Memory and Neural'),
  (48,'Recommender'),(48,'Anomaly Detection'),

  -- ===== コンピューティング基盤（49-54）=====
  (49,'Cloud Computing'),(49,'Edge'),(49,'Fog Computing'),(49,'Distributed'),
  (50,'DNA and Biological Computing'),(50,'Biological Computing'),
  (51,'Database'),(51,'Data Storage'),(51,'Data Management'),(51,'Data Stream'),
  (52,'Malware'),(52,'Intrusion Detection'),(52,'Cryptograph'),(52,'Security'),
  (52,'Blockchain'),(52,'Phishing'),(52,'Authentication'),
  (53,'Quantum Comput'),(53,'Quantum Information'),
  (54,'Software Engineering'),(54,'Software Testing'),(54,'Software System'),
  (54,'Software Reliability'),(54,'Formal Methods'),(54,'Programming'),

  -- ===== 蓄電・電力（55-60）=====
  (55,'Battery'),(55,'Lithium'),
  (56,'Solid Oxide'),(56,'Solid-State Batter'),
  (57,'Fuel Cell'),(57,'Hydrogen'),
  (58,'Smart Grid'),(58,'Power System'),(58,'Microgrid'),(58,'Power Flow'),
  (59,'Electric Vehicle'),(59,'Electric and Hybrid'),(59,'Charging'),
  (60,'Energy Harvest'),

  -- ===== 映像・ディスプレイ（61-66）=====
  (61,'Broadcasting'),(61,'Streaming'),
  (65,'Video Coding'),(65,'Video Compression'),(65,'Data Compression'),
  (64,'Augmented Reality'),(64,'Virtual Reality'),(64,'Immersive'),
  (63,'CMOS Imaging'),(63,'Imaging Sensor'),(63,'Camera'),
  (62,'Image Processing'),(62,'Image Enhancement'),(62,'Image and Video'),
  (62,'Image Retrieval'),(62,'Computer Graphics'),(62,'Rendering'),

  -- ===== 半導体デバイス（67-72）=====
  (67,'Photonic'),(67,'Optical Network'),(67,'Semiconductor Laser'),
  (67,'Fiber Optic'),(67,'Fiber Laser'),(67,'Optical Wireless'),
  (70,'Silicon Carbide'),(70,'GaN'),(70,'Power Amplifier'),(70,'DC-DC'),
  (70,'Inverter'),(70,'Power Semiconductor'),(70,'Wide Bandgap'),
  (69,'Photolithograph'),(69,'Semiconductor Manufact'),(69,'Etching'),
  (68,'Packaging'),(68,'Soldering'),(68,'TSV'),(68,'Interconnect'),
  (71,'Memory'),(71,'Storage Technolog'),
  (72,'Transistor'),(72,'Semiconductor materials'),(72,'FinFET'),(72,'MOSFET'),

  -- ===== ヘルスケア・医薬（73-78）=====
  (77,'Imaging'),(77,'Radiomics'),(77,'MRI'),(77,'CT '),(77,'X-ray'),
  (77,'Radiology'),(77,'Ultrasound'),(77,'Diagnosis'),
  (78,'Cancer'),(78,'Tumor'),(78,'Carcinoma'),(78,'Oncology'),(78,'Chemotherapy'),
  (78,'Immunotherapy'),(78,'Drug'),(78,'Therapy'),(78,'Leukemia'),(78,'Lymphoma'),
  (74,'Genom'),(74,'Gene'),(74,'CRISPR'),(74,'Transcriptom'),(74,'Protein'),
  (74,'RNA'),(74,'Stem Cell'),(74,'Molecular'),
  (76,'Wearable'),(76,'mHealth'),(76,'Digital Health'),(76,'Monitoring'),
  (76,'ECG'),(76,'Telemedicine'),(76,'Telehealth'),
  (75,'Skin'),(75,'Dermatolog'),(75,'Cosmetic'),(75,'Hair'),
  (73,'Surgical'),(73,'Surgery'),(73,'Implant'),(73,'Prosthetic'),(73,'Medical Device'),

  -- ===== 材料・高分子（79-84）=====
  (84,'Polymer'),(84,'Copolymer'),(84,'Polymerization'),
  (83,'Coating'),(83,'Thin Film'),(83,'Surface Modification'),(83,'Superhydrophob'),
  (81,'Composite'),(81,'Carbon Nanotube'),(81,'Graphene'),(81,'Fiber-reinforced'),
  (80,'Adhesi'),(80,'Epoxy'),
  (79,'Recycl'),(79,'Sustainab'),(79,'Biomass'),(79,'CO2 Capture'),(79,'Carbon Dioxide Capture'),

  -- ===== センシング・測位（85-90）=====
  (90,'LiDAR'),
  (89,'Radar'),(89,'Antenna'),(89,'Microwave'),(89,'SAR Imaging'),
  (88,'GNSS'),(88,'Positioning'),(88,'Localization'),(88,'Navigation'),
  (87,'Sensor Fusion'),(87,'Sensor-Based Localization'),(87,'Robot Manipulation'),
  (87,'Fault Detection'),(87,'Robotic'),(87,'Autonomous Vehicle'),
  (86,'Inertial'),(86,'Motion'),(86,'IMU'),
  (85,'Vision and Imaging'),(85,'3D Shape'),(85,'Optical'),(85,'CCD and CMOS')
ON CONFLICT (taxonomy_id, pattern) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STEP 3: 論文の小分類マテビューを再定義（トピック照合＋キーワード照合＋汎用）
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS integration.tech_signals_paper_subcat;

CREATE MATERIALIZED VIEW integration.tech_signals_paper_subcat AS
WITH paper AS (
  SELECT DISTINCT wc.company_slug AS canonical_slug,
         w.publication_year AS year,
         w.openalex_id,
         tt.id AS parent_taxonomy_id,
         lower(concat_ws(' ', w.title, w.abstract_text)) AS txt,
         w.topics
  FROM openalex.works w
  JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
  CROSS JOIN LATERAL jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) t(value)
  JOIN integration.paper_subfield_taxonomy m ON m.subfield = (t.value ->> 'subfield')
  JOIN integration.technology_taxonomy tt ON tt.code = m.taxonomy_code
  WHERE w.publication_year IS NOT NULL AND w.topics IS NOT NULL
),
m_topic AS (
  -- トピック名パターン一致（親大分類の子小分類のみ）
  SELECT DISTINCT paper.canonical_slug, paper.year, paper.openalex_id, tp.taxonomy_id
  FROM paper
  CROSS JOIN LATERAL jsonb_array_elements(((paper.topics #>> '{}'::text[]))::jsonb) t(value)
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = paper.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_paper_topic_pattern tp
    ON tp.taxonomy_id = t2.id
   AND (t.value ->> 'display_name') ILIKE '%' || tp.pattern || '%'
),
m_kw AS (
  -- 既存キーワード（word/phrase）照合
  SELECT DISTINCT paper.canonical_slug, paper.year, paper.openalex_id, k.taxonomy_id
  FROM paper
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = paper.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_patent_keyword k ON k.taxonomy_id = t2.id
  WHERE ( (k.match_mode = 'word'   AND paper.txt ~* ('\m' || k.term || '\M'))
       OR (k.match_mode = 'phrase' AND paper.txt LIKE '%' || lower(k.term) || '%') )
),
sub AS (
  SELECT * FROM m_topic
  UNION
  SELECT * FROM m_kw
),
others AS (
  -- どの小分類にも入らない → 汎用・基盤技術（_other）
  SELECT DISTINCT paper.canonical_slug, paper.year, paper.openalex_id, o.id AS taxonomy_id
  FROM paper
  JOIN integration.technology_taxonomy p1 ON p1.id = paper.parent_taxonomy_id
  JOIN integration.technology_taxonomy o
    ON o.parent_id = p1.id AND o.code = p1.code || '_other'
  WHERE NOT EXISTS (
    SELECT 1 FROM sub s
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
-- STEP 4: 「汎用・基盤技術」比率の再確認（論文）
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
