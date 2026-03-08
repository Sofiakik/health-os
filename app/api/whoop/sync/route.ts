import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: tokens, error } = await supabase
      .from("whoop_tokens")
      .select("*");

    if (error) {
      return NextResponse.json({
        step: "supabase_read_failed",
        error
      });
    }

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({
        step: "no_tokens_found"
      });
    }

    const token = tokens[0];

    const res = await fetch(
      "https://api.prod.whoop.com/developer/v1/recovery",
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`
        }
      }
    );

    const body = await res.json();

    return NextResponse.json({
      step: "whoop_response",
      status: res.status,
      body
    });

  } catch (err: any) {
    return NextResponse.json({
      step: "server_crash",
      message: err.message
    });
  }
}