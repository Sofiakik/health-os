-- Fix meal aggregation in upsert_daily_health_summary_entries:
-- - filter meals by entries.event_time in [p_date, p_date + 1 day)
-- - ensure only note_type='meal' is included
-- - compute entries_count and coalesced macro sums (0 when no meals)
-- - upsert these values into daily_health_summary

create or replace function public.upsert_daily_health_summary_entries(
  p_user_id uuid,
  p_date date
)
returns void
language plpgsql
security definer
as $$
declare
  v_late_meal boolean;
  v_entries_count integer;
  v_calories_kcal double precision;
  v_protein_g double precision;
  v_carbs_g double precision;
  v_fat_g double precision;

  v_symptom_array text[];
  v_symptom_flags jsonb;
  v_mood_score integer;
  v_energy_score integer;
begin
  ----------------------------------------------------------------------
  -- MEAL SIGNALS (entries.note_type = 'meal')
  -- NOTE: follow spec exactly: filter by event_time in [p_date, p_date+1d)
  ----------------------------------------------------------------------
  with meal_entries as (
    select
      e.*
      , (e.event_time at time zone coalesce(
          (select up.timezone from public.user_profiles up where up.user_id = p_user_id),
          'UTC'
        )) as local_event_ts
    from public.entries e
    where e.user_id = p_user_id
      and e.note_type = 'meal'
      and e.event_time is not null
      and e.event_time >= p_date
      and e.event_time < p_date + interval '1 day'
  )
  select
    -- late_meal: keep earlier behavior (NULL when there are no meal rows)
    case
      when count(*) = 0 then null
      else exists (
        select 1
        from meal_entries m2
        where (m2.local_event_ts::time) > time '20:00'
      )
    end as late_meal,

    count(*) as entries_count,

    -- coalesced sums (0 when no meal rows)
    coalesce(sum(m.calories_kcal), 0)::double precision as calories_kcal,
    coalesce(sum(m.protein_g), 0)::double precision as protein_g,
    coalesce(sum(m.carbs_g), 0)::double precision as carbs_g,
    coalesce(sum(m.fat_g), 0)::double precision as fat_g
  into
    v_late_meal,
    v_entries_count,
    v_calories_kcal,
    v_protein_g,
    v_carbs_g,
    v_fat_g
  from meal_entries m;

  ----------------------------------------------------------------------
  -- SYMPTOM SIGNALS (keep existing whoop_day mapping)
  ----------------------------------------------------------------------
  with symptom_entries as (
    select coalesce(lower(e.note), '') as note
    from public.entries e
    where e.user_id = p_user_id
      and e.note_type = 'symptom'
      and e.event_time is not null
      and public.whoop_day_for_ts(p_user_id, e.event_time) = p_date
  )
  select array_remove(array[
    case when exists (
      select 1 from symptom_entries s
      where s.note like '%bloat%'
    ) then 'bloating' end,
    case when exists (
      select 1 from symptom_entries s
      where s.note like '%headache%'
    ) then 'headache' end,
    case when exists (
      select 1 from symptom_entries s
      where s.note like '%abdominal pain%' or s.note like '%stomach pain%'
    ) then 'abdominal_pain' end
  ], null)
  into v_symptom_array;

  if v_symptom_array is null or array_length(v_symptom_array, 1) is null then
    v_symptom_flags := '[]'::jsonb;
  else
    v_symptom_flags := to_jsonb(v_symptom_array);
  end if;

  ----------------------------------------------------------------------
  -- STATE SIGNALS (keep existing whoop_day mapping)
  ----------------------------------------------------------------------
  with state_entries as (
    select coalesce(lower(e.note), '') as note
    from public.entries e
    where e.user_id = p_user_id
      and e.note_type = 'state'
      and e.event_time is not null
      and public.whoop_day_for_ts(p_user_id, e.event_time) = p_date
  ),
  scored as (
    select
      -- MOOD score per entry
      (
        case
          -- Strong negative first
          when note like '%terrible%' or note like '%depressed%' then -2
          when note like '%bad%' or note like '%down%' then -1
          -- Then strong positive
          when note like '%great%' or note like '%amazing%' or note like '%happy%' then  2
          when note like '%good%' then  1
          -- Neutral last
          when note like '%neutral%' or note like '%ok%' then  0
          else null
        end
      )::integer as mood_delta,
      -- ENERGY score per entry
      (
        case
          -- Strong negative first
          when note like '%exhausted%' then -2
          when note like '%tired%' then -1
          -- Then strong positive
          when note like '%energetic%' or note like '%full of energy%' then  2
          when note like '%good energy%' then  1
          -- Neutral last
          when note like '%normal%' then  0
          else null
        end
      )::integer as energy_delta
    from state_entries
  )
  select
    case
      when count(*) = 0 then null
      else round(avg(mood_delta)::numeric)::integer
    end as mood_score,
    case
      when count(*) = 0 then null
      else round(avg(energy_delta)::numeric)::integer
    end as energy_score
  into
    v_mood_score,
    v_energy_score
  from scored;

  ----------------------------------------------------------------------
  -- UPSERT INTO daily_health_summary
  ----------------------------------------------------------------------
  insert into public.daily_health_summary (
    user_id,
    date,
    late_meal,
    entries_count,
    calories_kcal,
    protein_g,
    carbs_g,
    fat_g,
    symptom_flags,
    mood_score,
    energy_score,
    updated_at
  )
  values (
    p_user_id,
    p_date,
    v_late_meal,
    v_entries_count,
    v_calories_kcal,
    v_protein_g,
    v_carbs_g,
    v_fat_g,
    coalesce(v_symptom_flags, '[]'::jsonb),
    v_mood_score,
    v_energy_score,
    now()
  )
  on conflict (user_id, date)
  do update set
    late_meal = excluded.late_meal,
    entries_count = excluded.entries_count,
    calories_kcal = excluded.calories_kcal,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    symptom_flags = excluded.symptom_flags,
    mood_score = excluded.mood_score,
    energy_score = excluded.energy_score,
    updated_at = now();
end;
$$;

