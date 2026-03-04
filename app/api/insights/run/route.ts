import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function POST(req: Request) {
  try {

    const token = getBearerToken(req);

    if (!token) {
      return Response.json(
        { error: "Missing bearer token" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } =
      await supabaseAnon.auth.getUser(token);

    if (userErr || !userData.user) {
      return Response.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const userId = userData.user.id;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } =
      await supabaseAdmin
        .from("entries")
        .select(
          "id,date,created_at,note,note_type,meal_type,image_url,portion_grams,calories_kcal,calories_source"
        )
        .eq("user_id", userId)
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json(
        { error: entriesError.message },
        { status: 500 }
      );
    }

    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const prompt = `
You are a concise health analyst.

Analyze the user's last 7 days of entries.

Return insights with these sections:
- Digestion
- Performance
- Immunity
- Energy

Each section must contain:
1 short insight  
1 suggested action for tomorrow

Max length: 600 words.
Avoid repetition.

Entries JSON:
${JSON.stringify(entries, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are precise and concise." },
        { role: "user", content: prompt },
      ],
    });

    const insightText =
      completion.choices?.[0]?.message?.content ?? "";

    const today = new Date().toISOString().slice(0, 10);

    const { error: insertError } =
      await supabaseAdmin
        .from("daily_insights")
        .insert({
          user_id: userId,
          day: today,
          window_end_at: new Date(),
          provider: "openai",
          model,
          insight: { text: insightText },
        });

    if (insertError) {
      return Response.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      insight: insightText,
    });

  } catch (err: any) {

    return Response.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );

  }
}