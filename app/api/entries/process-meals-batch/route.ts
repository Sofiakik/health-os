import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processMealEntry } from "@/lib/mealNutrition";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  try {
    const userId = await getUserIdFromBearer(req);
    const body = (await req.json().catch(() => ({}))) as { limit?: number };

    const maxToProcess =
      typeof body.limit === "number" ? Math.max(1, Math.floor(body.limit)) : 50;

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
      .or(`
  nutrition_extracted_at.is.null,
  nutrition_confidence.is.null,
  nutrition_confidence.lt.0.6
`)
      .order("created_at", { ascending: true })
      .limit(maxToProcess);

    if (error) throw error;

    const page = meals ?? [];

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
        skipped_count += 1;
        results.push({
          entry_id: m.id,
          status: "skipped",
          reason: e?.message ?? "exception",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      processed_count,
      skipped_count,
      limit: maxToProcess,
      found_count: page.length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

