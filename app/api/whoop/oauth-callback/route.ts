import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "Missing OAuth code" }, { status: 400 });
    }

    console.log("WHOOP CODE RECEIVED");

    const tokenRes = await fetch(
      "https://api.prod.whoop.com/oauth/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: process.env.WHOOP_CLIENT_ID!,
          client_secret: process.env.WHOOP_CLIENT_SECRET!,
          redirect_uri: process.env.WHOOP_REDIRECT_URI!,
        }),
      }
    );

    const tokens = await tokenRes.json();

    console.log("WHOOP TOKEN RESPONSE", tokens);

    if (!tokens.access_token) {
      return NextResponse.json(tokens, { status: 400 });
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const insert = await supabase.from("whoop_tokens").insert({
      user_id: "d677b416-3e41-4739-9eb2-3fe3231b7bd7",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt.toISOString(),
    });

    console.log("SUPABASE INSERT RESULT", insert);

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/calendar`
    );
  } catch (err: any) {
    console.error("WHOOP CALLBACK ERROR", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}