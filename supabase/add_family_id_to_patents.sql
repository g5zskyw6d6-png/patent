-- Google Patents Datasets切り替えに伴う追加カラム
-- (cpc / ipc / classifications_fetched_at は enrich-classifications.js で既に使用されているため既存の想定。
--  family_id のみ今回新規に必要になる可能性があるため、存在しなければ追加する)
ALTER TABLE public.patents
  ADD COLUMN IF NOT EXISTS family_id text;

CREATE INDEX IF NOT EXISTS idx_patents_family_id ON public.patents (family_id);
