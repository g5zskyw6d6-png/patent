-- =============================================================================
-- フリーテキストキーワードのバースト検知用: 対象期間の論文本文を取得するRPC
-- =============================================================================
-- 目的:
--   detect_keyword_bursts（OpenAlexトピック単位）とは別に、title/abstractの
--   フリーテキストから独自にキーワードを抽出してバースト検知したい場合に、
--   対象期間・対象企業の論文本文をクライアント側（BurstDetector.jsx）へ
--   まとめて返す。実際のキーワード抽出・集計・バーストスコア計算は
--   フロントエンド側（簡易頻度カウント）で行う。
--
-- 依存: openalex.works（publication_date は text 型のため ::date キャスト）、
--       openalex.work_companies
--
-- 注意:
--   企業を指定しない場合（全社横断）は対象論文数が非常に多くなるため、
--   直近 LIMIT 20000 件に制限している。全社横断でのフリーテキスト抽出は
--   非推奨（OpenAlexトピック方式を使うこと）。
--
-- 実行場所: Supabase Dashboard → SQL Editor
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_papers_for_burst_text(
  p_company_slug    text DEFAULT NULL,
  p_months_recent   int  DEFAULT 3,
  p_months_baseline int  DEFAULT 12
)
RETURNS TABLE (
  openalex_id   text,
  title         text,
  abstract_text text,
  pub_month     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (date_trunc('month', now())
        - ((greatest(p_months_recent,1) - 1 + greatest(p_months_baseline,1))::text || ' months')::interval)::date AS baseline_start
  )
  SELECT
    w.openalex_id,
    w.title,
    w.abstract_text,
    to_char(date_trunc('month', w.publication_date::date), 'YYYY-MM') AS pub_month
  FROM openalex.works w
  JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
  CROSS JOIN bounds b
  WHERE w.publication_date IS NOT NULL
    AND w.publication_date::date >= b.baseline_start
    AND (p_company_slug IS NULL OR wc.company_slug = p_company_slug)
    AND (w.title IS NOT NULL OR w.abstract_text IS NOT NULL)
  ORDER BY w.publication_date DESC
  LIMIT 20000;
$$;

GRANT EXECUTE ON FUNCTION public.get_papers_for_burst_text(text,int,int) TO anon, authenticated;

-- 動作確認:
-- SELECT count(*) FROM public.get_papers_for_burst_text('apple', 3, 12);
