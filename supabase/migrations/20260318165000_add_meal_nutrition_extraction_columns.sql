-- Add columns needed for LLM-based meal nutrition extraction.
-- Idempotent: uses IF NOT EXISTS and non-destructive changes.

-- Ensure numeric types are compatible with double precision computations.
alter table public.entries
  alter column calories_kcal type double precision
  using calories_kcal::double precision;

alter table public.entries
  add column if not exists protein_g double precision,
  add column if not exists carbs_g double precision,
  add column if not exists fat_g double precision,
  add column if not exists nutrition_extracted_at timestamptz;

-- Speed up batch processing: only scan meals that still need extraction.
create index if not exists entries_meals_needing_nutrition_idx
  on public.entries (user_id, id)
  where note_type = 'meal' and nutrition_extracted_at is null;

