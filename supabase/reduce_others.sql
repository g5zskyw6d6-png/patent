-- =============================================================================
-- 「その他」を減らす：①支配的IPC/トピックを既存小分類へ割当 ②受け皿を改称
-- =============================================================================
-- 実行場所: Supabase Dashboard → SQL Editor（STEP 1〜4を順に実行）
--
-- 方針（両方併用）:
--   ・taxonomy_patent_keyword にルールを追加（IPC/word/phrase）
--     → 支配的な技術を「その他」から既存の6小分類へ引き上げる
--   ・どの小分類にも入らない一般技術の受け皿「その他」を「汎用・基盤技術」に改称
--   ・マテビュー定義は変更不要。ルール追加後に REFRESH するだけ。
--
-- 注意: 小分類は「その分野のホットな先端テーマ」に絞られているため、
--       改称後の「汎用・基盤技術」も一定量は残ります（分野の主流・確立技術）。
--       これは設計上妥当な状態です。
--
-- 前提スキーマ: integration.taxonomy_patent_keyword(taxonomy_id, term, match_mode)
--   match_mode: 'ipc'（IPCコード前方一致）/ 'word'（単語境界一致）/ 'phrase'（部分一致）
--   ※ 実際の列が上記と異なる場合はエラー内容を共有してください（列名調整します）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: 受け皿「その他」→「汎用・基盤技術」に改称
-- ---------------------------------------------------------------------------
UPDATE integration.technology_taxonomy
SET name_ja = '汎用・基盤技術'
WHERE level = 2 AND code LIKE '%\_other' ESCAPE '\';

-- ---------------------------------------------------------------------------
-- STEP 2: 特許向け IPC ルール追加（支配的サブクラス → 最寄りの小分類）
--   ※ ルールは「その小分類の親大分類」の特許にのみ作用します（マテビュー仕様）
-- ---------------------------------------------------------------------------
INSERT INTO integration.taxonomy_patent_keyword (taxonomy_id, term, match_mode) VALUES
  -- 蓄電・電力
  (55, 'H01M', 'ipc'),   -- 電池 → リチウムイオン電池・電極材料
  -- 次世代通信
  (23, 'H01Q', 'ipc'),   -- アンテナ → Massive MIMO / ビームフォーミング
  -- コンピューティング基盤
  (54, 'G06F', 'ipc'),   -- 電子計算機 → ソフトウェア基盤・開発技術
  (52, 'H04L9', 'ipc'),  -- 暗号（H04L9）→ サイバーセキュリティ・暗号
  -- 映像・ディスプレイ
  (65, 'H04N', 'ipc'),   -- 画像通信 → 映像符号化・圧縮
  (63, 'G02B', 'ipc'),   -- 光学 → 撮像・カメラ
  (66, 'G09G', 'ipc'),   -- 表示制御 → ディスプレイパネル・OLED
  (62, 'G06T', 'ipc')    -- 画像データ処理 → 画像処理・レンダリング
ON CONFLICT (taxonomy_id, term, match_mode) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STEP 3: 論文/特許向け テキストルール追加（頻出トピック → 最寄りの小分類）
--   word  = 単語境界一致（短い語・略語向け） / phrase = 部分一致（複合語向け）
--   ※ 各ルールも「親大分類が一致する」文献にのみ作用します
-- ---------------------------------------------------------------------------
INSERT INTO integration.taxonomy_patent_keyword (taxonomy_id, term, match_mode) VALUES
  -- ===== 次世代通信（19-24）=====
  (19, '5g', 'word'),
  (20, '6g', 'word'),
  (21, 'satellite communication', 'phrase'),
  (22, 'v2x', 'word'),
  (22, 'vehicular ad hoc', 'phrase'),
  (23, 'mimo', 'word'),
  (23, 'beamforming', 'word'),
  (24, 'network slicing', 'phrase'),
  (24, 'software-defined network', 'phrase'),

  -- ===== AI・認識（43-48）=====
  (43, 'generative adversarial', 'phrase'),
  (43, 'large language model', 'phrase'),
  (43, 'diffusion model', 'phrase'),
  (44, 'object detection', 'phrase'),
  (44, 'image segmentation', 'phrase'),
  (44, 'image recognition', 'phrase'),
  (44, 'pose estimation', 'phrase'),
  (44, 'face recognition', 'phrase'),
  (45, 'natural language processing', 'phrase'),
  (45, 'speech recognition', 'phrase'),
  (45, 'sentiment analysis', 'phrase'),
  (45, 'topic modeling', 'phrase'),
  (46, 'reinforcement learning', 'phrase'),
  (46, 'domain adaptation', 'phrase'),
  (46, 'few-shot', 'phrase'),

  -- ===== コンピューティング基盤（49-54）=====
  (49, 'cloud computing', 'phrase'),
  (49, 'edge computing', 'phrase'),
  (49, 'fog computing', 'phrase'),
  (49, 'distributed comput', 'phrase'),
  (51, 'database', 'word'),
  (51, 'data storage', 'phrase'),
  (52, 'malware', 'word'),
  (52, 'intrusion detection', 'phrase'),
  (52, 'cryptograph', 'phrase'),
  (52, 'blockchain', 'word'),
  (53, 'quantum comput', 'phrase'),
  (54, 'software engineering', 'phrase'),
  (54, 'software testing', 'phrase'),
  (54, 'software reliability', 'phrase'),

  -- ===== 蓄電・電力（55-60）=====
  (55, 'lithium', 'word'),
  (56, 'solid-state batter', 'phrase'),
  (57, 'fuel cell', 'phrase'),
  (57, 'hydrogen', 'word'),
  (58, 'smart grid', 'phrase'),
  (58, 'power system', 'phrase'),
  (59, 'electric vehicle', 'phrase'),
  (60, 'energy harvest', 'phrase'),

  -- ===== 映像・ディスプレイ（61-66）=====
  (61, 'broadcasting', 'word'),
  (61, 'streaming', 'word'),
  (65, 'video coding', 'phrase'),
  (65, 'video compression', 'phrase'),
  (64, 'augmented reality', 'phrase'),
  (64, 'virtual reality', 'phrase'),
  (63, 'cmos image', 'phrase'),
  (62, 'image processing', 'phrase'),
  (62, 'image enhancement', 'phrase'),

  -- ===== 半導体デバイス（67-72）=====
  (67, 'photonic', 'word'),
  (67, 'silicon photonic', 'phrase'),
  (67, 'optical network', 'phrase'),
  (70, 'silicon carbide', 'phrase'),
  (70, 'gan-based', 'phrase'),
  (70, 'power amplifier', 'phrase'),
  (69, 'photolithograph', 'phrase'),
  (69, 'semiconductor manufactur', 'phrase'),
  (68, 'packaging', 'word'),
  (71, 'memory', 'word'),
  (72, 'transistor', 'word'),

  -- ===== ヘルスケア・医薬（73-78）=====
  (77, 'medical imaging', 'phrase'),
  (77, 'radiomics', 'word'),
  (77, 'mri', 'word'),
  (78, 'immunotherapy', 'word'),
  (78, 'chemotherapy', 'word'),
  (78, 'drug delivery', 'phrase'),
  (74, 'genom', 'phrase'),
  (74, 'crispr', 'word'),
  (76, 'wearable', 'word'),
  (76, 'digital health', 'phrase'),
  (75, 'cosmetic', 'word'),
  (75, 'skin care', 'phrase'),

  -- ===== 材料・高分子（79-84）=====
  (84, 'polymer', 'word'),
  (83, 'coating', 'word'),
  (81, 'composite', 'word'),
  (80, 'adhesi', 'phrase'),
  (79, 'recycl', 'phrase'),

  -- ===== センシング・測位（85-90）=====
  (90, 'lidar', 'word'),
  (89, 'radar', 'word'),
  (88, 'gnss', 'word'),
  (88, 'positioning', 'word'),
  (87, 'sensor fusion', 'phrase'),
  (86, 'inertial', 'word'),
  (85, 'cmos image', 'phrase')
ON CONFLICT (taxonomy_id, term, match_mode) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STEP 4: マテビュー再計算（ルール反映）
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW integration.tech_signals_subcat;
REFRESH MATERIALIZED VIEW integration.tech_signals_paper_subcat;

-- ---------------------------------------------------------------------------
-- STEP 5: 「汎用・基盤技術（旧その他）」比率の再確認
-- ---------------------------------------------------------------------------
SELECT '特許' AS 種別, p1.name_ja AS 大分類,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END) AS 汎用基盤,
       SUM(ss.patent_count) AS 延べ計,
       ROUND(100.0 * SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END)
             / NULLIF(SUM(ss.patent_count),0), 1) AS 汎用比率pct
FROM integration.tech_signals_subcat ss
JOIN integration.technology_taxonomy c  ON c.id = ss.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order
UNION ALL
SELECT '論文', p1.name_ja,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.paper_count ELSE 0 END),
       SUM(ss.paper_count),
       ROUND(100.0 * SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.paper_count ELSE 0 END)
             / NULLIF(SUM(ss.paper_count),0), 1)
FROM integration.tech_signals_paper_subcat ss
JOIN integration.technology_taxonomy c  ON c.id = ss.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order
ORDER BY 1, 5 DESC;
