-- Ensure daily_health_summary nutrition columns use double precision
-- to avoid text/numeric mismatches with the analytics + LLM nutrition layer.

alter table public.daily_health_summary
  alter column calories_kcal type double precision using calories_kcal::double precision,
  alter column protein_g type double precision using protein_g::double precision,
  alter column carbs_g type double precision using carbs_g::double precision,
  alter column fat_g type double precision using fat_g::double precision;

