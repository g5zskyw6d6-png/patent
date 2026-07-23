-- =============================================================================
-- 論文キーワード（OpenAlexトピック）のバースト検知 RPC
-- =============================================================================
-- 目的:
--   直近数ヶ月で出現頻度が急増した研究トピック（=論文のキーワード）を検出する。
--   「新出キーワード」（それまでほぼ出現がなく、直近で急に増えたもの）ほど
--   スコアが高くなるよう、ベースライン期間の平均出現数に平滑化項(+0.5)を
--   加えた比率をバーストスコアとしている。
--
-- キーワードの単位について:
--   OpenAlexが論文ごとに付与する上位5件の topics（研究トピック分類タグ、
--   例: "Generative Adversarial Networks", "Solid-State Batteries" 等）を
--   キーワード単位として使用する。フリーテキストからの独自キーワード抽出
--   （KeywordsTabのAI/簡易抽出）とは異なるボキャブラリなので注意。
--
-- 依存:
--   openalex.works（列: openalex_id, publication_date, topics jsonb）
--   openalex.work_companies（列: openalex_id, company_slug）
--   ※ topics の展開は refresh_all_signals.sql 等で使われている実績パターン
--     jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) を採用。
--
-- 実行場所: Supabase Dashboard → SQL Editor（このファイルをそのまま実行）
--
-- 呼び出し例（フロントエンドから）:
--   POST {SUPABASE_URL}/rest/v1/rpc/detect_keyword_bursts
--   headers: apikey, Authorization: Bearer <anon key>, Content-Type: application/json
--   body: { "p_company_slug": "apple", "p_months_recent": 3,
--           "p_months_baseline": 12, "p_min_recent": 5, "p_top_n": 30 }
--   ※ update_paper_translation と同様、public スキーマに作成するため
--     Accept-Profile / Content-Profile ヘッダーは不要。
-- =============================================================================

-- パフォーマンス用インデックス（未作成の場合のみ）
-- ※ publication_date::date のキャストは STABLE（DateStyleに依存）のため、
--   関数インデックスには使えない（IMMUTABLE制約）。件数的にも不要なため省略。
CREATE INDEX IF NOT EXISTS idx_work_companies_slug ON openalex.work_companies (company_slug);

CREATE OR REPLACE FUNCTION public.detect_keyword_bursts(
  p_company_slug    text DEFAULT NULL,
  p_months_recent   int  DEFAULT 3,
  p_months_baseline int  DEFAULT 12,
  p_min_recent      int  DEFAULT 5,
  p_top_n           int  DEFAULT 30
)
RETURNS TABLE (
  topic                text,
  field                text,
  domain               text,
  recent_count         bigint,
  baseline_count       bigint,
  recent_avg_monthly   numeric,
  baseline_avg_monthly numeric,
  burst_score          numeric,
  growth_pct           numeric,
  monthly_series       jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', now())::date AS this_month,
      (date_trunc('month', now())
        - ((greatest(p_months_recent,1) - 1)::text || ' months')::interval)::date AS recent_start,
      (date_trunc('month', now())
        - ((greatest(p_months_recent,1) - 1 + greatest(p_months_baseline,1))::text || ' months')::interval)::date AS baseline_start
  ),
  base AS (
    SELECT
      date_trunc('month', w.publication_date::date)::date AS month,
      (t.value ->> 'display_name') AS topic,
      (t.value ->> 'field')        AS field,
      (t.value ->> 'domain')       AS domain,
      w.openalex_id
    FROM openalex.works w
    JOIN openalex.work_companies wc ON wc.openalex_id = w.openalex_id
    CROSS JOIN LATERAL jsonb_array_elements(((w.topics #>> '{}'::text[]))::jsonb) t(value)
    CROSS JOIN bounds b
    WHERE w.publication_date IS NOT NULL
      AND w.topics IS NOT NULL
      AND (t.value ->> 'display_name') IS NOT NULL
      AND (p_company_slug IS NULL OR wc.company_slug = p_company_slug)
      AND w.publication_date::date >= b.baseline_start
  ),
  monthly AS (
    SELECT topic, field, domain, month, count(DISTINCT openalex_id) AS cnt
    FROM base
    GROUP BY topic, field, domain, month
  ),
  agg AS (
    SELECT
      m.topic,
      max(m.field)  AS field,
      max(m.domain) AS domain,
      sum(CASE WHEN m.month >= b.recent_start THEN m.cnt ELSE 0 END) AS recent_count,
      sum(CASE WHEN m.month <  b.recent_start THEN m.cnt ELSE 0 END) AS baseline_count,
      jsonb_agg(
        jsonb_build_object('month', to_char(m.month,'YYYY-MM'), 'count', m.cnt)
        ORDER BY m.month
      ) AS monthly_series
    FROM monthly m
    CROSS JOIN bounds b
    GROUP BY m.topic
  )
  SELECT
    topic, field, domain,
    recent_count, baseline_count,
    round(recent_count::numeric   / greatest(p_months_recent,1), 2)   AS recent_avg_monthly,
    round(baseline_count::numeric / greatest(p_months_baseline,1), 2) AS baseline_avg_monthly,
    round(
      (recent_count::numeric / greatest(p_months_recent,1)) /
      ((baseline_count::numeric / greatest(p_months_baseline,1)) + 0.5)
    , 2) AS burst_score,
    round(
      100 * (
        (recent_count::numeric / greatest(p_months_recent,1))
        - (baseline_count::numeric / greatest(p_months_baseline,1))
      ) / ((baseline_count::numeric / greatest(p_months_baseline,1)) + 0.5)
    , 1) AS growth_pct,
    monthly_series
  FROM agg
  WHERE recent_count >= p_min_recent
  ORDER BY burst_score DESC, recent_count DESC
  LIMIT greatest(p_top_n,1);
$$;

GRANT EXECUTE ON FUNCTION public.detect_keyword_bursts(text,int,int,int,int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 動作確認（実行後、下記を単独で実行してみてください）
-- ---------------------------------------------------------------------------
-- 全社・直近3ヶ月 vs 直前12ヶ月のバースト上位20件
-- SELECT * FROM public.detect_keyword_bursts(NULL, 3, 12, 5, 20);
--
-- 特定企業（例: apple）のみ
-- SELECT * FROM public.detect_keyword_bursts('apple', 3, 12, 3, 20);
