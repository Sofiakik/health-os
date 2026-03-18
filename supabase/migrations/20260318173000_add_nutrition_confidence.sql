alter table public.entries
  add column if not exists nutrition_confidence double precision,
  add column if not exists nutrition_notes text;

