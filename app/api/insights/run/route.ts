import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

// Server-only Supabase client (DO NOT expose this key)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// OpenAI client (server-only)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    // 1️⃣ Get user from request cookies (auth session)
    const supabaseUserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { cookie: req.headers.get("cookie") ?? "" } },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseUserClient.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;

    // 2️⃣ Get last 7 days entries
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .from("entries")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true });

    if (entriesError) {
      return Response.json({ error: entriesError.message }, { status: 500 });
    }

    // 3️⃣ Build prompt
    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const prompt = `
You are a health analyst.
Read the last 7 days entries and generate concise insight.
Sections required:
- Digestion
- Performance
- Immunity
- Energy
Each section:
- 1 short insight
- 1 action for tomorrow

Keep under 600 words total.
Entries:
${JSON.stringify(entries, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a precise, concise health analyst." },
        { role: "user", content: prompt },
      ],
    });

    const insightText = completion.choices[0]?.message?.content ?? "";

    // 4️⃣ Save to daily_insights
    const today = new Date().toISOString().slice(0, 10);

    const { error: insertError } = await supabaseAdmin
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
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ ok: true, insight: insightText });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}