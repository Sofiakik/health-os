import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {

  const { data: summaries } = await supabase
    .from("daily_health_summary")
    .select("*")
    .gte(
      "date",
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0,10)
    );

  if (!summaries) {
    return NextResponse.json({ error: "no data" });
  }

  const patterns:any[] = [];

  for (const s of summaries) {

    if (s.protein && s.hrv) {

      if (s.protein > 150 && s.hrv > 80) {

        patterns.push({
          user_id: s.user_id,
          pattern_type: "nutrition_recovery",
          pattern_key: "high_protein_high_hrv",
          signal_strength: 0.4,
          confidence: 0.6,
          first_seen: s.date,
          last_seen: s.date
        });

      }

    }

  }

  for (const p of patterns) {

    const { data: existing } = await supabase
      .from("personal_patterns")
      .select("*")
      .eq("user_id", p.user_id)
      .eq("pattern_key", p.pattern_key)
      .single();

    if (existing) {

      await supabase
        .from("personal_patterns")
        .update({
          occurrences: existing.occurrences + 1,
          last_seen: p.last_seen,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);

    } else {

      await supabase
        .from("personal_patterns")
        .insert({
          ...p,
          occurrences: 1
        });

    }

  }

  return NextResponse.json({
    patterns_found: patterns.length
  });

}