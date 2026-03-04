import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

// ✅ Server-only envs (NO NEXT_PUBLIC for service role / OpenAI)
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";

// Hard fail early (and fix TS types)
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function yyyyMmDd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  return Response.json({
    ok: true,
    hint: "Use POST with Authorization: Bearer <access_token>",
  });
}

export async function POST(req: Request) {
  try {
    // 1) Auth via Bearer token (from browser localStorage)
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return Response.json(
        { error: "Not authenticated (missing Authorization Bearer token)" },
        { status: 401 }
      );
    }

    // 2) Validate token via Supabase Auth REST (avoids SSR cookie complexity)
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY, // ✅ now guaranteed string
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: "Not authenticated", details: text },
        { status: 401 }
      );
    }

    const user = (await res.json()) as { id: string };
    const userId = user.id;

    // 3) Pull last 7 days by `date` column (YYYY-MM-DD)
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);

    const endDate = yyyyMmDd(end);
    const startDate = yyyyMmDd(start);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .from("entries")
      .select(
        "id,date,note,note_type,meal_type,image_url,created_at,portion_grams,calories_kcal,calories_source"
      )
      .eq("user_id", userId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json({ error: entriesError.message }, { status: 500 });
    }

    const compact = (entries ?? []).map((e: any) => ({
      date: e.date,
      note_type: e.note_type,   // meal | symptom | state
      meal_type: e.meal_type,   // breakfast | lunch | dinner | snack (or null)
      note: e.note,
      image_url: e.image_url,
      portion_grams: e.portion_grams,
      calories_kcal: e.calories_kcal,
      calories_source: e.calories_source,
    }));

    const prompt = [
      "You are a precise, concise health analyst.",
      "Read the user's last 7 days of entries and produce DAILY INSIGHTS.",
      "Output format (exact sections):",
      "Digestion: (1 insight) + (1 action for tomorrow)",
      "Performance: (1 insight) + (1 action for tomorrow)",
      "Immunity: (1 insight) + (1 action for tomorrow)",
      "Energy: (1 insight) + (1 action for tomorrow)",
      "Rules: under 600 words total, no fluff, no repetition. If data is missing, say so briefly.",
      "",
      "Entries JSON:",
      JSON.stringify(compact),
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "Be concise. Be actionable. Use the required section headings." },
        { role: "user", content: prompt },
      ],
    });

    const insightText = completion.choices?.[0]?.message?.content ?? "";

    // 4) Save row (multiple per day allowed)
    const today = yyyyMmDd(new Date());

    const { error: insertError } = await supabaseAdmin.from("daily_insights").insert({
      user_id: userId,
      day: today,
      window_end_at: new Date().toISOString(),
      provider: "openai",
      model: OPENAI_MODEL,
      insight: { text: insightText, start_date: startDate, end_date: endDate },
    });

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ ok: true, insight: insightText, startDate, endDate });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}