import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {

    const { data: metrics, error } = await supabase
      .from("health_metrics")
      .select("*")
      .order("metric_timestamp", { ascending: false });

    if (error) throw error;

    const summaries: Record<string, any> = {};

    for (const m of metrics ?? []) {

      const date = new Date(m.metric_timestamp)
        .toISOString()
        .slice(0, 10);

      const key = `${m.user_id}_${date}`;

      if (!summaries[key]) {
        summaries[key] = {
          user_id: m.user_id,
          date,
        };
      }

      const s = summaries[key];

      switch (m.metric_type) {

        case "sleep_duration":
          s.sleep_duration = Number(m.metric_value);
          break;

        case "recovery_score":
          s.recovery_score = Number(m.metric_value);
          break;

        case "hrv":
          s.hrv = Number(m.metric_value);
          break;

        case "resting_hr":
          s.resting_hr = Number(m.metric_value);
          break;

        case "strain":
          s.strain = Number(m.metric_value);
          break;

        case "calories":
          s.calories_estimated = Number(m.metric_value);
          break;

        case "protein":
          s.protein = Number(m.metric_value);
          break;

        case "carbs":
          s.carbs = Number(m.metric_value);
          break;

        case "fat":
          s.fat = Number(m.metric_value);
          break;

      }

    }

    const rows = Object.values(summaries);

    for (const r of rows) {

      await supabase
        .from("daily_health_summary")
        .upsert(r, {
          onConflict: "user_id,date"
        });

    }

    return NextResponse.json({
      success: true,
      rows_processed: rows.length
    });

  } catch (err: any) {

    return NextResponse.json({
      error: err.message
    });

  }
}