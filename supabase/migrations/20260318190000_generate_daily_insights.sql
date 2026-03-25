-- Heuristic daily insights generator from `daily_health_summary`.
-- Produces:
-- - insights (1-3 strings)
-- - hypothesis (1 string)
-- - confidence (0-1 float)
--
-- Intended for deterministic, non-LLM pattern extraction.

create or replace function public.generate_daily_insights(
  p_user_id uuid,
  p_date date
)
returns jsonb
language plpgsql
as $$
declare
  v_insights text[] := array[]::text[];
  v_hypothesis text := null;
  v_confidence double precision := 0.0;

  -- Evidence strengths (0..1-ish)
  v_sleep_strength double precision := 0.0;
  v_calories_strength double precision := 0.0;
  v_late_strength double precision := 0.0;
  v_macro_strength double precision := 0.0;

  v_sleep_diff double precision;
  v_calories_diff double precision;
  v_late_diff double precision;

  v_best_macro text;

  v_evidence_count integer := 0;
begin
  -- Default: build evidence in a single final pass
  declare
    r_rec_high double precision;
    r_rec_low double precision;
    r_n_high integer;
    r_n_low integer;

    r_strain_high double precision;
    r_strain_low double precision;
    r_n_cal_high integer;
    r_n_cal_low integer;

    r_rec_late_true double precision;
    r_rec_late_false double precision;
    r_n_true integer;
    r_n_false integer;

    r_corr_protein double precision;
    r_corr_carbs double precision;
    r_corr_fat double precision;

    r_best_corr double precision;
  begin
    with windowed as (
      select *
      from public.daily_health_summary
      where user_id = p_user_id
        and date >= (p_date - interval '45 days')
        and date <= p_date
    ),
    sleep_m as (
      select percentile_cont(0.5) within group (order by sleep_duration) as med
      from windowed
      where sleep_duration is not null
    ),
    sleep_stats as (
      select
        avg(case when w.sleep_duration >= sm.med then w.recovery_score end) as rec_high,
        avg(case when w.sleep_duration <  sm.med then w.recovery_score end) as rec_low,
        count(case when w.sleep_duration >= sm.med then 1 end) as n_high,
        count(case when w.sleep_duration <  sm.med then 1 end) as n_low
      from windowed w
      cross join sleep_m sm
      where sm.med is not null
    ),
    calories_m as (
      select percentile_cont(0.5) within group (order by calories_kcal) as med
      from windowed
      where calories_kcal is not null
    ),
    calories_stats as (
      select
        avg(case when w.calories_kcal >= cm.med then w.strain end) as strain_high,
        avg(case when w.calories_kcal <  cm.med then w.strain end) as strain_low,
        count(case when w.calories_kcal >= cm.med then 1 end) as n_high,
        count(case when w.calories_kcal <  cm.med then 1 end) as n_low
      from windowed w
      cross join calories_m cm
      where cm.med is not null
    ),
    late_stats as (
      select
        avg(case when w.late_meal = true then w.recovery_score end) as rec_late_true,
        avg(case when w.late_meal = false then w.recovery_score end) as rec_late_false,
        count(case when w.late_meal = true then 1 end) as n_true,
        count(case when w.late_meal = false then 1 end) as n_false
      from windowed w
      where w.late_meal is not null
    ),
    macro_energy_corr as (
      select
        corr(protein_g, energy_score) as corr_protein,
        corr(carbs_g, energy_score) as corr_carbs,
        corr(fat_g, energy_score)    as corr_fat
      from windowed
      where energy_score is not null
    )
    select
      ss.rec_high, ss.rec_low, ss.n_high, ss.n_low,
      cs.strain_high, cs.strain_low, cs.n_high, cs.n_low,
      ls.rec_late_true, ls.rec_late_false, ls.n_true, ls.n_false,
      mec.corr_protein, mec.corr_carbs, mec.corr_fat
    into
      r_rec_high, r_rec_low, r_n_high, r_n_low,
      r_strain_high, r_strain_low, r_n_cal_high, r_n_cal_low,
      r_rec_late_true, r_rec_late_false, r_n_true, r_n_false,
      r_corr_protein, r_corr_carbs, r_corr_fat
    from sleep_stats ss
    cross join calories_stats cs
    cross join late_stats ls
    cross join macro_energy_corr mec;

    -- Sleep vs recovery
    if r_n_high >= 5 and r_n_low >= 5 and r_rec_high is not null and r_rec_low is not null then
      v_sleep_diff := r_rec_high - r_rec_low;
      if abs(v_sleep_diff) >= 7 then
        v_sleep_strength := least(1.0, abs(v_sleep_diff) / 25.0);
        v_evidence_count := v_evidence_count + 1;
        if coalesce(array_length(v_insights, 1), 0) < 3 then
          v_insights := v_insights || array[
            case
              when v_sleep_diff > 0 then
                format(
                  'On average, higher sleep duration is associated with higher recovery (avg recovery Δ≈%s).',
                  round(v_sleep_diff::numeric, 1)
                )
              else
                format(
                  'On average, higher sleep duration is associated with lower recovery (avg recovery Δ≈%s).',
                  round(v_sleep_diff::numeric, 1)
                )
            end
          ];
        end if;
      end if;
    end if;

    -- Calories vs strain
    if r_n_cal_high >= 5 and r_n_cal_low >= 5 and r_strain_high is not null and r_strain_low is not null then
      v_calories_diff := r_strain_high - r_strain_low;
      if abs(v_calories_diff) >= 2.5 then
        v_calories_strength := least(1.0, abs(v_calories_diff) / 10.0);
        v_evidence_count := v_evidence_count + 1;
        if coalesce(array_length(v_insights, 1), 0) < 3 then
          v_insights := v_insights || array[
            case
              when v_calories_diff > 0 then
                format(
                  'Higher-calorie days tended to coincide with higher strain (avg strain Δ≈%s).',
                  round(v_calories_diff::numeric, 2)
                )
              else
                format(
                  'Higher-calorie days tended to coincide with lower strain (avg strain Δ≈%s).',
                  round(v_calories_diff::numeric, 2)
                )
            end
          ];
        end if;
      end if;
    end if;

    -- Late meal vs recovery
    if r_n_true >= 3 and r_n_false >= 3 and r_rec_late_true is not null and r_rec_late_false is not null then
      v_late_diff := r_rec_late_true - r_rec_late_false;
      if abs(v_late_diff) >= 7 then
        v_late_strength := least(1.0, abs(v_late_diff) / 25.0);
        v_evidence_count := v_evidence_count + 1;
        if coalesce(array_length(v_insights, 1), 0) < 3 then
          v_insights := v_insights || array[
            case
              when v_late_diff > 0 then
                format(
                  'Late meals are associated with higher recovery (avg recovery Δ≈%s).',
                  round(v_late_diff::numeric, 1)
                )
              else
                format(
                  'Late meals are associated with lower recovery (avg recovery Δ≈%s).',
                  round(v_late_diff::numeric, 1)
                )
            end
          ];
        end if;
      end if;
    end if;

    -- Macros vs energy (strongest correlation among protein/carbs/fat)
    if r_corr_protein is not null or r_corr_carbs is not null or r_corr_fat is not null then
      if r_corr_protein is null then r_corr_protein := 0; end if;
      if r_corr_carbs is null then r_corr_carbs := 0; end if;
      if r_corr_fat is null then r_corr_fat := 0; end if;

      if abs(r_corr_protein) >= abs(r_corr_carbs) and abs(r_corr_protein) >= abs(r_corr_fat) then
        v_best_macro := 'protein';
        r_best_corr := r_corr_protein;
      elsif abs(r_corr_carbs) >= abs(r_corr_protein) and abs(r_corr_carbs) >= abs(r_corr_fat) then
        v_best_macro := 'carbs';
        r_best_corr := r_corr_carbs;
      else
        v_best_macro := 'fat';
        r_best_corr := r_corr_fat;
      end if;

      if abs(r_best_corr) >= 0.25 then
        v_macro_strength := least(1.0, abs(r_best_corr) / 0.6);
        v_evidence_count := v_evidence_count + 1;
        if coalesce(array_length(v_insights, 1), 0) < 3 then
          v_insights := v_insights || array[
            format(
              'Energy_score shows the strongest relationship with %s intake (corr≈%s).',
              v_best_macro,
              round(r_best_corr::numeric, 2)
            )
          ];
        end if;
      end if;
    end if;

    -- Hypothesis: base it on strongest evidence strength
    declare
      v_max_strength double precision;
      v_strong_macro_label text;
    begin
      v_max_strength := greatest(v_sleep_strength, v_calories_strength, v_late_strength, v_macro_strength);

      if v_max_strength = 0 then
        v_hypothesis := 'Not enough signal in the last 45 days to form a reliable hypothesis.';
      elsif v_max_strength = v_sleep_strength then
        if v_sleep_diff >= 0 then
          v_hypothesis := 'Prioritizing sleep duration may improve next-day recovery based on your observed pattern.';
        else
          v_hypothesis := 'Adjusting sleep duration/timing may help stabilize your recovery, based on the observed association.';
        end if;
      elsif v_max_strength = v_late_strength then
        if v_late_diff >= 0 then
          v_hypothesis := 'Keeping meals late may support your recovery pattern; experimenting with timing consistency could help.';
        else
          v_hypothesis := 'Avoiding late meals may improve recovery based on your observed association.';
        end if;
      elsif v_max_strength = v_calories_strength then
        if v_calories_diff >= 0 then
          v_hypothesis := 'Calorie timing/volume may influence your strain; balancing meal size could reduce next-day strain.';
        else
          v_hypothesis := 'Higher-calorie days appear to align with lower strain for you; maintaining energy intake may help recovery readiness.';
        end if;
      else
        v_strong_macro_label := initcap(v_best_macro);
        v_hypothesis := format('Focusing on %s-rich meals may help improve your energy_score based on your recent correlations.', v_strong_macro_label);
      end if;
    end;
  end;

  if coalesce(array_length(v_insights, 1), 0) = 0 then
    v_insights := array['Not enough data to detect meaningful patterns from your last 45 days of summaries.'];
  end if;

  -- Confidence: combine evidence count with strongest pattern strength.
  v_confidence := least(
    0.95,
    greatest(
      0.15,
      (coalesce(v_evidence_count, 0) * 0.18)
      + (greatest(v_sleep_strength, v_calories_strength, v_late_strength, v_macro_strength) * 0.55)
    )
  );

  return jsonb_build_object(
    'insights', to_jsonb(v_insights),
    'hypothesis', v_hypothesis,
    'confidence', v_confidence
  );
end;
$$;

-- Compatibility wrapper for the requested camelCase name.
create or replace function public."generateDailyInsights"(
  p_user_id uuid,
  p_date date
)
returns jsonb
language sql
stable
as $$
  select public.generate_daily_insights(p_user_id, p_date)
$$;

