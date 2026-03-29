import { NextResponse } from "next/server";
import { processMealEntry } from "@/lib/mealNutrition";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: entries, error } = await supabase
      .from("entries")
      .select("*")
      .is("nutrition_extracted_at", null)
      .limit(5);

    if (error) {
      console.error("[debug] fetch error:", error);
      return NextResponse.json({ error });
    }

    let processed = 0;

    for (const entry of entries ?? []) {
      await processMealEntry({
        entry_id: entry.id,
        user_id: entry.user_id,
      });
      processed++;
    }

    return NextResponse.json({ processed });

  } catch (e) {
    console.error("[debug] crash:", e);
    return NextResponse.json({ error: String(e) });
  }
}
