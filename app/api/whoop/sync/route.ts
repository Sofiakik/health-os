import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // get token
    const { data: tokens } = await supabase
      .from("whoop_tokens")
      .select("*")
      .limit(1);

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ error: "No Whoop token found" });
    }

    const token = tokens[0];

    const headers = {
      Authorization: `Bearer ${token.access_token}`
    };

    // ---------- FETCH WHOOP DATA ----------

    const cycleRes = await fetch(
      "https://api.prod.whoop.com/v2/cycle?limit=5",
      { headers }
    );

    const recoveryRes = await fetch(
      "https://api.prod.whoop.com/v2/recovery?limit=5",
      { headers }
    );

    const sleepRes = await fetch(
      "https://api.prod.whoop.com/v2/activity/sleep?limit=5",
      { headers }
    );

    const workoutRes = await fetch(
      "https://api.prod.whoop.com/v2/activity/workout?limit=5",
      { headers }
    );

    const cycles = await cycleRes.json();
    const recoveries = await recoveryRes.json();
    const sleeps = await sleepRes.json();
    const workouts = await workoutRes.json();

    // ---------- STORE RAW ----------

    await supabase.from("whoop_raw").insert([
      {
        user_id: token.user_id,
        type: "cycle",
        payload: cycles
      },
      {
        user_id: token.user_id,
        type: "recovery",
        payload: recoveries
      },
      {
        user_id: token.user_id,
        type: "sleep",
        payload: sleeps
      },
      {
        user_id: token.user_id,
        type: "workout",
        payload: workouts
      }
    ]);

    // ---------- NORMALIZE RECOVERY ----------

    if (recoveries.records) {
      const metrics = recoveries.records.map((r: any) => [
        {
          user_id: token.user_id,
          metric_type: "recovery_score",
          metric_value: r.score?.recovery_score,
          metric_unit: "%",
          metric_timestamp: r.created_at,
          source: "whoop",
          raw_data: r
        },
        {
          user_id: token.user_id,
          metric_type: "hrv",
          metric_value: r.score?.hrv_rmssd_milli,
          metric_unit: "ms",
          metric_timestamp: r.created_at,
          source: "whoop",
          raw_data: r
        },
        {
          user_id: token.user_id,
          metric_type: "resting_hr",
          metric_value: r.score?.resting_heart_rate,
          metric_unit: "bpm",
          metric_timestamp: r.created_at,
          source: "whoop",
          raw_data: r
        }
      ]).flat();

      await supabase.from("health_metrics").insert(metrics);
    }

    // ---------- NORMALIZE SLEEP ----------

    if (sleeps.records) {
      const metrics = sleeps.records.map((s: any) => ({
        user_id: token.user_id,
        metric_type: "sleep_duration",
        metric_value: s.score?.stage_summary?.total_in_bed_time_milli / 3600000,
        metric_unit: "hours",
        metric_timestamp: s.created_at,
        source: "whoop",
        raw_data: s
      }));

      await supabase.from("health_metrics").insert(metrics);
    }

    // ---------- NORMALIZE STRAIN ----------

    if (cycles.records) {
      const metrics = cycles.records.map((c: any) => ({
        user_id: token.user_id,
        metric_type: "strain",
        metric_value: c.score?.strain,
        metric_unit: "score",
        metric_timestamp: c.start,
        source: "whoop",
        raw_data: c
      }));

      await supabase.from("health_metrics").insert(metrics);
    }

    return NextResponse.json({
      success: true,
      cycles: cycles.records?.length,
      recoveries: recoveries.records?.length,
      sleeps: sleeps.records?.length,
      workouts: workouts.records?.length
    });

  } catch (err: any) {
    return NextResponse.json({
      error: err.message
    });
  }
}