import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

// Public URL is fine to use here (it's not a secret)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

// Server-only secrets (NEVER NEXT_PUBLIC_)
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

// Admin client (bypasses RLS) — server-only
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Public client (uses anon) — we use it only to validate the user via JWT from cookie
const supabaseAnon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function getAccessTokenFromCookie(cookieHeader: string | null) {
  if (!cookieHeader) return null;

  // Supabase sets: sb-access-token=... (and sb-refresh-token=...)
  const match = cookieHeader.match(/sb-access-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function POST(req: Request) {
  try {
    // 1) Auth: get user from Supabase access token cookie
    const accessToken = getAccessTokenFromCookie(req.headers.get("cookie"));
    if (!accessToken) {
      return Response.json({ error: "Not authenticated (no access token cookie)" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) Load entries: only columns that EXIST in your table
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .from("entries")
      .select(
        "id,date,created_at,note,note_type,meal_type,image_url,portion_grams,calories_kcal,calories_source"
      )
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json({ error: entriesError.message }, { status: 500 });
    }

    // 3) Prompt
    const prompt = [
      "You are a precise, concise health analyst.",
      "Read the user's last 7 days entries and generate an end-of-day insight.",
      "Output 4 sections exactly:",
      "Digestion / Performance / Immunity / Energy",
      "For each section: (1) 1 short insight (2) 1 action for tomorrow.",
      "Keep total under 600 words. No fluff, no repetition.",
      "If entries include images, use image_url as context (do not claim certainty).",
      "",
      "ENTRIES JSON:",
      JSON.stringify(entries ?? [], null, 2),
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "Be concise, structured, and practical." },
        { role: "user", content: prompt },
      ],
    });

    const insightText = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // 4) Save to daily_insights
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