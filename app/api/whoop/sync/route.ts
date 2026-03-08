import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: tokens } = await supabase
    .from("whoop_tokens")
    .select("*");

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ error: "No whoop tokens found" });
  }

  const token = tokens[0];

  const res = await fetch(
    "https://api.prod.whoop.com/developer/v1/recovery",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    }
  );

  const data = await res.json();

  return NextResponse.json(data);
}