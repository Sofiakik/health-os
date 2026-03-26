-- Meal macro aggregation: COALESCE after SUM (not SUM(COALESCE(...))).
-- Explicit filter: note_type = 'meal', event_time in [p_date, p_date + 1 day), event_time IS NOT NULL.

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
  -- Filter: event_time in [p_date, p_date + 1 day)
  ----------------------------------------------------------------------
  with meal_entries as (
    select
      e.*,
      (e.event_time at time zone coalesce(
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
    case
      when count(*) = 0 then null
      else exists (
        select 1
        from meal_entries m2
        where (m2.local_event_ts::time) > time '20:00'
      )
    end as late_meal,

    count(*)::integer as entries_count,

    coalesce(sum(e.calories_kcal), 0)::double precision as calories_kcal,
    coalesce(sum(e.protein_g), 0)::double precision as protein_g,
    coalesce(sum(e.carbs_g), 0)::double precision as carbs_g,
    coalesce(sum(e.fat_g), 0)::double precision as fat_g
  into
    v_late_meal,
    v_entries_count,
    v_calories_kcal,
    v_protein_g,
    v_carbs_g,
    v_fat_g
  from meal_entries e;

  raise notice 'Meal sum: %', (select sum(x.calories_kcal) from public.entries x
    where x.user_id = p_user_id
      and x.note_type = 'meal'
      and x.event_time is not null
      and x.event_time >= p_date
      and x.event_time < p_date + interval '1 day');

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
      (
        case
          when note like '%terrible%' or note like '%depressed%' then -2
          when note like '%bad%' or note like '%down%' then -1
          when note like '%great%' or note like '%amazing%' or note like '%happy%' then  2
          when note like '%good%' then  1
          when note like '%neutral%' or note like '%ok%' then  0
          else null
        end
      )::integer as mood_delta,
      (
        case
          when note like '%exhausted%' then -2
          when note like '%tired%' then -1
          when note like '%energetic%' or note like '%full of energy%' then  2
          when note like '%good energy%' then  1
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
