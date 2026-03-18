import { NextResponse } from "next/server";
import { processMealEntry } from "@/lib/mealNutrition";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const debugKey = req.headers.get("x-debug-key");
    if (!debugKey || debugKey !== process.env.DEBUG_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const user_id = url.searchParams.get("user_id");
    const date = url.searchParams.get("date"); // YYYY-MM-DD

    if (!user_id || !date) {
      return NextResponse.json({ error: "Missing user_id or date" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date format (expected YYYY-MM-DD)" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1) Fetch entries
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;

    const { data: entries, error } = await supabase
      .from("entries")
      .select("id, note, image_path, nutrition_extracted_at")
      .eq("user_id", user_id)
      .eq("note_type", "meal")
      .gte("event_time", start)
      .lte("event_time", end);

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    const results: Array<{
      entry_id: string;
      status: "processed" | "skipped" | "error";
      reason?: string;
      error?: string;
    }> = [];

    let processed_count = 0;
    let skipped_count = 0;

    // 2) Process each entry
    for (const e of entries ?? []) {
      try {
        const res = await processMealEntry({
          entry_id: e.id,
          user_id,
        });

        if (res?.skipped) {
          skipped_count++;
          results.push({
            entry_id: e.id,
            status: "skipped",
            reason: res.reason,
          });
        } else {
          processed_count++;
          results.push({
            entry_id: e.id,
            status: "processed",
          });
        }
      } catch (err: any) {
        skipped_count++;
        results.push({
          entry_id: e.id,
          status: "error",
          error: err?.message ? String(err.message) : String(err),
        });
      }
    }

    // 3) Fetch updated rows
    const ids = (entries ?? []).map((e: any) => e.id);
    let updated: any[] = [];

    if (ids.length > 0) {
      const { data: updatedRows } = await supabase
        .from("entries")
        .select(`
          id,
          calories_kcal,
          protein_g,
          carbs_g,
          fat_g,
          nutrition_confidence,
          nutrition_notes
        `)
        .in("id", ids);

      updated = updatedRows ?? [];
    }

    return NextResponse.json({
      processed_count,
      skipped_count,
      results,
      updated,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

