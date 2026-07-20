-- =============================================================================
-- 7つ目の小分類を「特許」にも反映（IPC中心のルール追加 → 特許小分類を再計算）
-- =============================================================================
-- 前提: add_seventh_subcats.sql を実行済み（7つ目の小分類 T0x-07 が作成済み）。
-- 影響範囲: 特許の小分類マテビュー(tech_signals_subcat)のみ。
--   ※ 論文の小分類はトピック照合ロジックのため、本ルール追加の影響を受けません。
--
-- 手順: STEP1（ルール追加・軽量）→ STEP2（REFRESH・単独/重量）→ STEP3（確認）
-- =============================================================================

SET statement_timeout = '600s';

-- ---------------------------------------------------------------------------
-- STEP 1: 7つ目の小分類への特許ルールを追加（コード経由でID解決・重複ガード）
--   match_mode: 'ipc'（IPCコード前方一致）/ 'word'（単語一致）/ 'phrase'（部分一致）
-- ---------------------------------------------------------------------------
WITH pat(code, term, mode) AS (
  VALUES
    -- 次世代通信 → ネットワーク基盤・分散システム（一般無線/伝送を集約：最大の効果）
    ('T01-07','H04W','ipc'),('T01-07','H04L','ipc'),('T01-07','H04B','ipc'),
    ('T01-07','H04J','ipc'),('T01-07','H04M','ipc'),('T01-07','H04Q','ipc'),
    ('T01-07','cloud','word'),('T01-07','distributed','word'),('T01-07','blockchain','word'),

    -- AI・認識 → 機械学習理論・最適化
    ('T02-07','bayesian','word'),('T02-07','clustering','word'),
    ('T02-07','optimization algorithm','phrase'),('T02-07','metaheuristic','word'),

    -- コンピューティング基盤 → 計算アーキテクチャ・組込み
    ('T03-07','G06Q','ipc'),('T03-07','fpga','word'),
    ('T03-07','embedded system','phrase'),('T03-07','processor','word'),

    -- 蓄電・電力 → 車両・モビリティ
    ('T04-07','B60W','ipc'),('T04-07','G08G','ipc'),
    ('T04-07','autonomous driving','phrase'),('T04-07','vehicle control','phrase'),

    -- 映像・ディスプレイ → 音声・オーディオ処理
    ('T05-07','G10L','ipc'),('T05-07','H04R','ipc'),('T05-07','H04S','ipc'),
    ('T05-07','audio','word'),('T05-07','speech','word'),('T05-07','acoustic','word'),

    -- 半導体デバイス → 高周波・無線デバイス
    ('T06-07','H01P','ipc'),('T06-07','H03B','ipc'),('T06-07','H03F','ipc'),
    ('T06-07','H03H','ipc'),('T06-07','H03D','ipc'),
    ('T06-07','antenna','word'),('T06-07','microwave','word'),

    -- ヘルスケア・医薬 → 臨床医学・診療研究
    ('T07-07','A61B','ipc'),('T07-07','A61N','ipc'),
    ('T07-07','surgical','word'),('T07-07','diagnosis','word'),('T07-07','clinical','word'),

    -- 材料・高分子 → 無機・金属・計算材料
    ('T08-07','C22','ipc'),('T08-07','C01','ipc'),('T08-07','C04B','ipc'),
    ('T08-07','alloy','word'),('T08-07','ceramic','word'),('T08-07','catalyst','word'),

    -- センシング・測位 → 制御・ロボティクス・機械
    ('T09-07','B25J','ipc'),('T09-07','G05B','ipc'),('T09-07','G05D','ipc'),
    ('T09-07','control system','phrase'),('T09-07','robot','word'),('T09-07','fault detection','phrase')
)
INSERT INTO integration.taxonomy_patent_keyword (taxonomy_id, term, match_mode)
SELECT t.id, p.term, p.mode
FROM pat p
JOIN integration.technology_taxonomy t ON t.code = p.code
ON CONFLICT (taxonomy_id, term, match_mode) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STEP 2: 特許の小分類マテビューを再計算（★単独実行・重量）
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW integration.tech_signals_subcat;

-- ---------------------------------------------------------------------------
-- STEP 3: 特許の「汎用・基盤技術」比率を確認
-- ---------------------------------------------------------------------------
SELECT p1.name_ja AS 大分類,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END) AS 汎用基盤,
       SUM(CASE WHEN c.code LIKE '%-07'                THEN ss.patent_count ELSE 0 END) AS 第7小分類,
       SUM(ss.patent_count) AS 延べ計,
       ROUND(100.0 * SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END)
             / NULLIF(SUM(ss.patent_count),0), 1) AS 汎用比率pct
FROM integration.tech_signals_subcat ss
JOIN integration.technology_taxonomy c  ON c.id = ss.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order
ORDER BY 汎用比率pct DESC;

-- =============================================================================
-- タイムアウト時は直接接続(psql/GUI)で STEP2 を実行してください。
-- =============================================================================
