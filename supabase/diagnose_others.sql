-- =============================================================================
-- 「その他」の中身を診断するSQL（結果を貼り付けてください）
-- =============================================================================
-- 目的: 「その他」に落ちている特許・論文の傾向（IPCコード/論文トピック）を把握し、
--       キーワードルールを補強して「その他」を減らす。
-- 実行: ①→②→③ の順に実行し、それぞれの結果を共有してください。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ① 「その他」比率の確認（特許・論文）
-- ---------------------------------------------------------------------------
SELECT '特許' AS 種別, p1.name_ja AS 大分類,
       SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END) AS その他,
       SUM(ss.patent_count) AS 延べ計,
       ROUND(100.0 * SUM(CASE WHEN c.code LIKE '%\_other' ESCAPE '\' THEN ss.patent_count ELSE 0 END)
             / NULLIF(SUM(ss.patent_count),0), 1) AS その他比率pct
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

-- ---------------------------------------------------------------------------
-- ② 特許:「その他」に落ちた特許の頻出IPCサブクラス（大分類別・上位のみ）
--    → このIPCを既存小分類に紐付ける／新小分類を作る材料にします
-- ---------------------------------------------------------------------------
WITH pat AS (
  SELECT DISTINCT x.canonical_slug, p.id AS patent_id,
         tc.taxonomy_id AS parent_taxonomy_id, p.ipc,
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
hit AS (
  SELECT DISTINCT pat.patent_id, pat.parent_taxonomy_id
  FROM pat
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = pat.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_patent_keyword k ON k.taxonomy_id = t2.id
  WHERE ( (k.match_mode = 'word'   AND pat.txt ~* ('\m' || k.term || '\M'))
       OR (k.match_mode = 'phrase' AND pat.txt LIKE '%' || lower(k.term) || '%')
       OR (k.match_mode = 'ipc'    AND EXISTS (
             SELECT 1 FROM unnest(COALESCE(pat.ipc,'{}'::text[])) cc(code)
             WHERE upper(cc.code) LIKE k.term || '%')) )
),
others AS (
  SELECT DISTINCT pat.patent_id, pat.parent_taxonomy_id, pat.ipc
  FROM pat
  WHERE NOT EXISTS (SELECT 1 FROM hit h
                    WHERE h.patent_id = pat.patent_id
                      AND h.parent_taxonomy_id = pat.parent_taxonomy_id)
)
SELECT p1.name_ja AS 大分類,
       substring(upper(u.code) from 1 for 4) AS ipcサブクラス,
       count(DISTINCT o.patent_id) AS 件数
FROM others o
JOIN integration.technology_taxonomy p1 ON p1.id = o.parent_taxonomy_id
CROSS JOIN LATERAL unnest(COALESCE(o.ipc, '{}'::text[])) u(code)
GROUP BY p1.name_ja, p1.sort_order, 2
HAVING count(DISTINCT o.patent_id) >= 100
ORDER BY p1.sort_order, 3 DESC;

-- ---------------------------------------------------------------------------
-- ③ 論文:「その他」に落ちた論文の頻出トピック（大分類別・上位のみ）
-- ---------------------------------------------------------------------------
WITH paper AS (
  SELECT DISTINCT wc.company_slug AS canonical_slug, w.openalex_id,
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
hit AS (
  SELECT DISTINCT paper.openalex_id, paper.parent_taxonomy_id
  FROM paper
  JOIN integration.technology_taxonomy t2
    ON t2.parent_id = paper.parent_taxonomy_id AND t2.level = 2
  JOIN integration.taxonomy_patent_keyword k ON k.taxonomy_id = t2.id
  WHERE ( (k.match_mode = 'word'   AND paper.txt ~* ('\m' || k.term || '\M'))
       OR (k.match_mode = 'phrase' AND paper.txt LIKE '%' || lower(k.term) || '%') )
),
others AS (
  SELECT DISTINCT paper.openalex_id, paper.parent_taxonomy_id, paper.topics
  FROM paper
  WHERE NOT EXISTS (SELECT 1 FROM hit h
                    WHERE h.openalex_id = paper.openalex_id
                      AND h.parent_taxonomy_id = paper.parent_taxonomy_id)
)
SELECT p1.name_ja AS 大分類,
       (t.value ->> 'display_name') AS トピック,
       count(DISTINCT o.openalex_id) AS 件数
FROM others o
JOIN integration.technology_taxonomy p1 ON p1.id = o.parent_taxonomy_id
CROSS JOIN LATERAL jsonb_array_elements(((o.topics #>> '{}'::text[]))::jsonb) t(value)
GROUP BY p1.name_ja, p1.sort_order, 2
HAVING count(DISTINCT o.openalex_id) >= 30
ORDER BY p1.sort_order, 3 DESC;
