import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("whoop_tokens")
    .insert({
      user_id: "d677b416-3e41-4739-9eb2-3fe3231b7bd7",
      access_token: "TEST",
      refresh_token: "TEST",
      expires_at: new Date().toISOString()
    })
    .select();

  return NextResponse.json({ data, error });
}