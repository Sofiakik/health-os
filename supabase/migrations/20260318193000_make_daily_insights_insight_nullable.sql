-- Allow new pipeline to write only normalized columns (insight_text/hypothesis/confidence).
-- Existing legacy rows keep their `insight` jsonb values.

alter table public.daily_insights
  alter column insight drop not null;

