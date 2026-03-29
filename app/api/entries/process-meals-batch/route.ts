import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateDailyInsights } from "@/lib/insights";
import { processMealEntry } from "@/lib/mealNutrition";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseBatchLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 50;
  return raw;
}

function entryCalendarDate(m: {
  date?: string | null;
  event_time?: string | null;
}): string | null {
  if (typeof m.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) {
    return m.date;
  }
  if (m.event_time) {
    const t = new Date(m.event_time);
    if (!Number.isNaN(t.getTime())) return t.toISOString().slice(0, 10);
  }
  return null;
}

async function getUserIdFromBearer(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Missing Authorization Bearer token");

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`Not authenticated (${res.status}): ${details}`);
  }

  const user = (await res.json()) as { id: string };
  return user.id;
}

export async function POST(req: Request) {
  console.log("BATCH_VERSION_V2_NO_OR_FILTER");
  try {
    const userId = await getUserIdFromBearer(req);
    const body = (await req.json().catch(() => ({}))) as { limit?: unknown };

    const limit = parseBatchLimit(body?.limit);
    const maxToProcess = Math.max(1, Math.floor(limit));

    let processed_count = 0;
    let skipped_count = 0;
    const results: Array<{
      entry_id: string;
      status: "processed" | "skipped";
      reason?: string;
    }> = [];

    const { data: meals, error } = await supabaseAdmin
      .from("entries")
      .select("*")
      .eq("user_id", userId)
      .eq("note_type", "meal")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const allMeals = meals ?? [];
    const filtered = allMeals.filter(
      (m) =>
        m.nutrition_extracted_at === null ||
        m.nutrition_confidence === null ||
        m.nutrition_confidence < 0.6
    );

    console.log("[batch] total:", allMeals.length, "filtered:", filtered.length);

    const page = filtered.slice(0, maxToProcess);

    for (const m of page) {
      try {
        const res = await processMealEntry({ entry_id: m.id, user_id: userId });
        if (res.skipped) {
          skipped_count += 1;
          results.push({ entry_id: m.id, status: "skipped", reason: res.reason });
        } else {
          processed_count += 1;
          results.push({ entry_id: m.id, status: "processed" });
        }
      } catch (e: any) {
        console.error("[nutrition] ERROR:", e);
        skipped_count += 1;
        results.push({
          entry_id: m.id,
          status: "skipped",
          reason: e?.message ?? "exception",
        });
      }
    }

    const affectedDates = new Set<string>();
    for (let i = 0; i < page.length; i++) {
      if (results[i]?.status !== "processed") continue;
      const d = entryCalendarDate(page[i] as { date?: string | null; event_time?: string | null });
      if (d) affectedDates.add(d);
    }

    const datesSorted = Array.from(affectedDates).sort();
    for (const date of datesSorted) {
      try {
        const { error: aggErr } = await supabaseAdmin.rpc(
          "upsert_daily_health_summary_entries",
          { p_user_id: userId, p_date: date }
        );
        if (aggErr) {
          console.error("[batch] upsert_daily_health_summary_entries failed", date, aggErr);
        }
        await generateDailyInsights(userId, date);
        console.log("[batch] insights regenerated for", date);
      } catch (e) {
        console.error("[batch] aggregation/insights failed for date", date, e);
      }
    }

    return NextResponse.json({
      debug: "BATCH_VERSION_V2_NO_OR_FILTER",
      ok: true,
      processed_count,
      skipped_count,
      limit: maxToProcess,
      found_count: page.length,
      results,
    });
  } catch (e: any) {
    console.error("[nutrition] ERROR:", e);
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

