// app/api/insights/run/route.ts
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Env vars (Vercel):
 * - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 * - SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 * - SUPABASE_SERVICE_ROLE_KEY  (server-only)
 * - OPENAI_API_KEY             (server-only)
 * - OPENAI_MODEL               (e.g. gpt-5.2)
 *
 * NEVER put SUPABASE_SERVICE_ROLE_KEY or OPENAI_API_KEY in NEXT_PUBLIC_*
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type InsightSections = {
  digestion: { insight: string; action: string };
  performance: { insight: string; action: string };
  immunity: { insight: string; action: string };
  energy: { insight: string; action: string };
  notes?: string[];
};

function startOfDayISO(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return x.toISOString();
}

export async function POST(req: Request) {
  try {
    // 1) Auth (reads Supabase session from cookies)
    const cookieStore = await cookies();
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        // route handlers don't need set/remove for this endpoint
        set: () => {},
        remove: () => {},
      },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = userData?.user;

    if (userErr || !user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Inputs (optional)
    // body can be empty; if present may include { day: "YYYY-MM-DD" }
    let day = new Date().toISOString().slice(0, 10);
    try {
      const body = await req.json();
      if (body?.day && typeof body.day === "string") day = body.day;
    } catch {
      // ignore: no body
    }

    // 3) Fetch last 7 days entries (inclusive)
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .from("entries")
      .select(
        "id, user_id, created_at, type, note, meal_type, symptom_type, mood, image_url"
      )
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json({ error: entriesError.message }, { status: 500 });
    }

    // 4) Build prompt (MVP: include image_url as URL text; vision can be added later)
    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const prompt = [
      "You are a precise, concise health analyst.",
      "You will read the user's last 7 days of health entries and generate end-of-day insights.",
      "Output MUST be valid JSON ONLY (no markdown, no extra text).",
      "Schema:",
      `{
  "digestion":   { "insight": "...", "action": "..." },
  "performance": { "insight": "...", "action": "..." },
  "immunity":    { "insight": "...", "action": "..." },
  "energy":      { "insight": "...", "action": "..." },
  "notes": ["optional bullets if needed"]
}`,
      "Rules:",
      "- Keep it short: each insight/action 1–2 sentences max.",
      "- Avoid fluff and repetition.",
      "- Use entries-first reasoning; infer timing patterns (e.g., symptoms 1–2h after meals) if possible.",
      "- If a meal has an image_url, you may include a calorie estimate but label it clearly as an estimate.",
      "",
      "Entries (JSON):",
      JSON.stringify(entries ?? [], null, 2),
    ].join("\n");

    // 5) Call OpenAI (server-side)
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Return ONLY valid JSON. Be concise." },
        { role: "user", content: prompt },
      ],
      // keep responses tight
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return Response.json({ error: "Model returned empty output" }, { status: 500 });
    }

    // 6) Parse JSON safely
    let insightJson: InsightSections;
    try {
      insightJson = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "Model did not return valid JSON", raw },
        { status: 500 }
      );
    }

    // 7) Save to daily_insights
    // window_end_at: for MVP store "now"; you can later compute exact local 21:00 using stored timezone
    const { error: insertError } = await supabaseAdmin.from("daily_insights").insert({
      user_id: user.id,
      day,
      // store a useful marker for “end of day window”; MVP uses now
      window_end_at: new Date().toISOString(),
      provider: "openai",
      model,
      insight: insightJson, // jsonb
      // optional: keep a minimal audit trail
      input_range_start: startOfDayISO(sevenDaysAgo),
      input_range_end: now.toISOString(),
    });

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ ok: true, day, insight: insightJson });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}