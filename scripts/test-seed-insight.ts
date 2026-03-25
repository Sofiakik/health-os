/**
 * Seeds `daily_health_summary` with a controlled 5-day window for testing insights.
 *
 * Run (loads env from .env.local if you use Node 20+):
 *   npx tsx --env-file=.env.local scripts/test-seed-insight.ts
 *
 * Or:
 *   USER_ID=<uuid> npx tsx --env-file=.env.local scripts/test-seed-insight.ts
 */
import { supabaseAdmin } from "../lib/supabaseAdmin";

const userId =
  process.env.USER_ID ?? process.env.TEST_USER_ID ?? "YOUR_USER_ID";

async function run() {
  if (!userId || userId === "YOUR_USER_ID") {
    console.error(
      "Set USER_ID or TEST_USER_ID to your Supabase auth user UUID, or edit scripts/test-seed-insight.ts"
    );
    process.exit(1);
  }

  // Clean last 5 days of test window
  const { error: delError } = await supabaseAdmin
    .from("daily_health_summary")
    .delete()
    .eq("user_id", userId)
    .gte("date", "2026-03-20");

  if (delError) {
    console.error("Delete failed", delError);
    process.exit(1);
  }

  const rows = [
    {
      date: "2026-03-20",
      sleep_duration: 7.5,
      recovery_score: 78,
      late_meal: false,
      calories_kcal: 1800,
    },
    {
      date: "2026-03-21",
      sleep_duration: 7.5,
      recovery_score: 80,
      late_meal: false,
      calories_kcal: 1900,
    },
    {
      date: "2026-03-22",
      sleep_duration: 7.5,
      recovery_score: 62,
      late_meal: true,
      calories_kcal: 2000,
    },
    {
      date: "2026-03-23",
      sleep_duration: 7.5,
      recovery_score: 60,
      late_meal: true,
      calories_kcal: 2100,
    },
    {
      date: "2026-03-24",
      sleep_duration: 7.5,
      recovery_score: 59,
      late_meal: true,
      calories_kcal: 2000,
    },
  ];

  const { error } = await supabaseAdmin.from("daily_health_summary").insert(
    rows.map((r) => ({
      ...r,
      user_id: userId,
    }))
  );

  if (error) {
    console.error("Seed failed", error);
    process.exit(1);
  }

  console.log("Seed done", { userId, rows: rows.length });
}

run();
