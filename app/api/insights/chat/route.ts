import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const body = await req.json();

  const { user_id, insight_id, message } = body;

  // store user message

  await supabase
    .from("insight_dialogue")
    .insert({
      user_id,
      insight_id,
      role: "user",
      message
    });

  // load insight

  const { data: insight } = await supabase
    .from("daily_insights")
    .select("*")
    .eq("id", insight_id)
    .single();

  // load last dialogue

  const { data: history } = await supabase
    .from("insight_dialogue")
    .select("role,message")
    .eq("insight_id", insight_id)
    .order("created_at", { ascending: true })
    .limit(10);

  const messages = [
    {
      role: "system",
      content:
        "You are a health analysis assistant. Help the user understand today's insight and suggest practical actions.",
    },
    {
      role: "system",
      content: `Today's insight: ${JSON.stringify(insight?.insight)}`,
    },
    ...(history || []).map((m: any) => ({
      role: m.role,
      content: m.message,
    })),
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  const response = completion.choices[0].message.content;

  // store assistant response

  await supabase
    .from("insight_dialogue")
    .insert({
      user_id,
      insight_id,
      role: "assistant",
      message: response
    });

  return NextResponse.json({
    reply: response
  });

}