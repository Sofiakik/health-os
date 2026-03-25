import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateDailyInsights } from "@/lib/insights";

const supabase = createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {

 const { data: summaries } = await supabase
   .from("daily_health_summary")
   .select("*")
   .order("date",{ascending:false})
   .limit(45);

 const { data: patterns } = await supabase
   .from("personal_patterns")
   .select("*");

 if (!summaries) return NextResponse.json({error:"no summaries"});

 const today = new Date().toISOString().slice(0,10);

 const insight = `
Recovery: ${summaries[0].recovery_score}
HRV: ${summaries[0].hrv}

Detected patterns: ${patterns?.length ?? 0}

Sleep duration was ${summaries[0].sleep_duration}h.
`;

  await supabase.from("daily_insights").upsert(
    {
      user_id: summaries[0].user_id,
      date: today,
      window_end_at: new Date().toISOString(),
      provider: "personal_patterns",
      model: "heuristic",
      insight_text: insight,
      hypothesis: null,
      confidence: null,
    },
    { onConflict: "user_id,date" }
  );

 return NextResponse.json({success:true});

}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { user_id?: string; date?: string };
    const user_id = body.user_id;
    const date = body.date;

    if (!user_id || !date) {
      return NextResponse.json(
        { ok: false, error: "Missing user_id or date" },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { ok: false, error: "Invalid date format (expected YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    console.log("[insights] generating for", user_id, date);

    // Generate + upsert normalized columns.
    const result = await generateDailyInsights(user_id, date);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}