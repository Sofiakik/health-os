import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  console.log("WHOOP CALLBACK HIT");
  console.log("CODE:", code);
  console.log("STATE:", state);

  return NextResponse.json({
    message: "callback reached",
    code,
    state
  });
}