import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function GET() {
  return Response.json({ ok: true, hint: "Use POST (Authorization: Bearer <token>)" });
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return Response.json(
        { error: "Not authenticated (missing Authorization: Bearer token)" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr || !userData?.user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = userData.user.id;

    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data: entries, error: entriesErr } = await supabaseAdmin
      .from("entries")
      .select("id,user_id,date,created_at,note,note_type,meal_type,image_url,portion_grams,calories_kcal,calories_source")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true });

    if (entriesErr) {
      return Response.json({ error: entriesErr.message }, { status: 500 });
    }

    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const prompt = `
You are a precise, concise health analyst.
Read the last 7 days entries and generate insights (<=600 words total).

Output sections:
Digestion
Performance
Immunity
Energy

For each section:
- 1 short insight
- 1 action for tomorrow

If an image_url exists, mention calories as an estimate.

Entries JSON:
${JSON.stringify(entries ?? [], null, 2)}
`.trim();

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Be concise. No fluff. Actionable." },
        { role: "user", content: prompt },
      ],
    });

    const insightText = completion.choices[0]?.message?.content?.trim() ?? "";

    const day = new Date().toISOString().slice(0, 10);

    const { error: insErr } = await supabaseAdmin.from("daily_insights").insert({
      user_id: userId,
      day,
      window_end_at: new Date().toISOString(),
      provider: "openai",
      model,
      insight: { text: insightText },
    });

    if (insErr) {
      return Response.json({ error: insErr.message }, { status: 500 });
    }

    return Response.json({ ok: true, insight: insightText });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}