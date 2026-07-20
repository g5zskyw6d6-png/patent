-- =============================================================================
-- 分類ルールのエクスポート（各クエリを実行し、結果をドキュメントへ反映）
-- 各クエリは「大分類 or 小分類ごとに1行」へ集約するので出力は数十行に収まります。
-- =============================================================================

-- Q1: 大分類の IPCコード一覧（特許）
SELECT t.name_ja AS 大分類,
       string_agg(pc.match_mode || ':' || pc.code, ', ' ORDER BY pc.code) AS IPCルール
FROM integration.taxonomy_patent_class pc
JOIN integration.technology_taxonomy t ON t.id = pc.taxonomy_id
GROUP BY t.name_ja, t.sort_order
ORDER BY t.sort_order;

-- Q2: 大分類の OpenAlex subfield 一覧（論文）
SELECT t.name_ja AS 大分類,
       count(*) AS subfield数,
       string_agg(m.subfield, ', ' ORDER BY m.subfield) AS subfield一覧
FROM integration.paper_subfield_taxonomy m
JOIN integration.technology_taxonomy t ON t.code = m.taxonomy_code
GROUP BY t.name_ja, t.sort_order
ORDER BY t.sort_order;

-- Q3: 小分類のキーワード/IPCルール一覧（特許）
SELECT p1.name_ja AS 大分類, c.name_ja AS 小分類,
       string_agg(k.match_mode || ':' || k.term, ', ' ORDER BY k.match_mode, k.term) AS ルール
FROM integration.taxonomy_patent_keyword k
JOIN integration.technology_taxonomy c  ON c.id = k.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order, c.name_ja, c.sort_order
ORDER BY p1.sort_order, c.sort_order;

-- Q4: 小分類のトピック名パターン一覧（論文）
SELECT p1.name_ja AS 大分類, c.name_ja AS 小分類,
       string_agg(tp.pattern, ', ' ORDER BY tp.pattern) AS トピックパターン
FROM integration.taxonomy_paper_topic_pattern tp
JOIN integration.technology_taxonomy c  ON c.id = tp.taxonomy_id
JOIN integration.technology_taxonomy p1 ON p1.id = c.parent_id
GROUP BY p1.name_ja, p1.sort_order, c.name_ja, c.sort_order
ORDER BY p1.sort_order, c.sort_order;
