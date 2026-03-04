import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// server-only
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function POST(req: Request) {
  try {
    // ✅ Auth via Authorization header (MVP, avoids SSR cookies)
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return Response.json(
        { error: "Not authenticated", hint: "Send Authorization: Bearer <access_token>" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = userData.user.id;

    // last 7 days by created_at
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .from("entries")
      .select("id,date,created_at,note,note_type,meal_type,image_url,portion_grams,calories_kcal,calories_source")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json({ error: entriesError.message }, { status: 500 });
    }

    const prompt = `
You are a precise, concise health analyst.
Read the user's last 7 days entries and generate an end-of-day insight.

Output 4 sections exactly:
Digestion
Performance
Immunity
Energy

For each section:
- 1 short insight
- 1 action for tomorrow

Keep total under 600 words. No fluff. No repetition.

ENTRIES JSON:
${JSON.stringify(entries ?? [], null, 2)}
`.trim();

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "Be concise, structured, practical." },
        { role: "user", content: prompt },
      ],
    });

    const insightText = completion.choices?.[0]?.message?.content?.trim() ?? "";

    const today = new Date().toISOString().slice(0, 10);

    const { error: insertError } = await supabaseAdmin.from("daily_insights").insert({
      user_id: userId,
      day: today,
      window_end_at: new Date(),
      provider: "openai",
      model: OPENAI_MODEL,
      insight: { text: insightText },
    });

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ ok: true, insight: insightText });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}