-- daily_insights already exists in production.
-- Add the columns requested by the current spec (non-destructive / idempotent).

alter table public.daily_insights
  add column if not exists insight_text text,
  add column if not exists hypothesis text,
  add column if not exists confidence float;

