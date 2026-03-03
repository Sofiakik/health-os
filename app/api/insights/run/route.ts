// app/api/insights/run/route.ts
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

/**
 * ENV (Vercel)
 * Public:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Server-only (NEVER NEXT_PUBLIC_):
 * - SUPABASE_SERVICE_ROLE_KEY
 * - OPENAI_API_KEY
 * - OPENAI_MODEL (e.g. gpt-5.2)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_ANON_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

// Server-only Supabase admin client (service role)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Server-only OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type InsightJson = {
  digestion: { insight: string; action: string };
  performance: { insight: string; action: string };
  immunity: { insight: string; action: string };
  energy: { insight: string; action: string };
  notes?: string[];
};

function safeJsonParse<T>(s: string): { ok: true; value: T } | { ok: false; raw: string } {
  try {
    return { ok: true, value: JSON.parse(s) as T };
  } catch {
    return { ok: false, raw: s };
  }
}

export async function GET() {
  return Response.json({ ok: true, hint: "Use POST" });
}

export async function POST(req: Request) {
  try {
    // 1) Auth: read session from cookies (cookie-based server client)
    const supabase = await supabaseServer();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = userData?.user;

    if (userErr || !user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Optional input: { day: "YYYY-MM-DD" }
    let day = new Date().toISOString().slice(0, 10);
    try {
      const body = await req.json();
      if (body?.day && typeof body.day === "string") day = body.day;
    } catch {
      // no body is fine
    }

    // 3) Fetch last 7 days entries for this user
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .from("entries")
      .select("id, created_at, type, meal_type, note, image_url")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json({ error: entriesError.message }, { status: 500 });
    }

    // 4) Prompt (MVP). We include image_url as text; vision comes later.
    const prompt = [
      "Return ONLY valid JSON (no markdown, no extra text).",
      "You are a precise, concise health analyst.",
      "Create end-of-day insights based on the last 7 days entries.",
      "Schema:",
      `{
  "digestion":   { "insight": "...", "action": "..." },
  "performance": { "insight": "...", "action": "..." },
  "immunity":    { "insight": "...", "action": "..." },
  "energy":      { "insight": "...", "action": "..." },
  "notes": ["optional bullets"]
}`,
      "Rules:",
      "- Each insight/action 1–2 sentences max.",
      "- Avoid fluff and repetition.",
      "- Use entries-first reasoning; infer timing patterns when possible.",
      "- If an entry has image_url, you MAY include a calorie estimate but label it as an estimate.",
      "",
      "Entries JSON:",
      JSON.stringify(entries ?? [], null, 2),
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "Return ONLY valid JSON. Be concise." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return Response.json({ error: "Model returned empty output" }, { status: 500 });

    const parsed = safeJsonParse<InsightJson>(raw);
    if (!parsed.ok) {
      return Response.json({ error: "Model did not return valid JSON", raw: parsed.raw }, { status: 500 });
    }

    // 5) Save to daily_insights (jsonb column "insight")
    const { error: insertError } = await supabaseAdmin.from("daily_insights").insert({
      user_id: user.id,
      day,
      window_end_at: new Date().toISOString(),
      provider: "openai",
      model: OPENAI_MODEL,
      insight: parsed.value,
    });

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ ok: true, day, insight: parsed.value });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}