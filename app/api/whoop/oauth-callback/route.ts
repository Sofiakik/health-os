import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code" });
  }

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

  // Temporary safe logging: do not log token values
  const keys = Object.keys(tokens ?? {});
  const refreshRelated = keys.filter((k) => /refresh/i.test(k));
  console.log("[whoop oauth-callback] token response keys:", keys);
  console.log("[whoop oauth-callback] access_token exists:", "access_token" in (tokens ?? {}));
  console.log("[whoop oauth-callback] refresh_token exists:", "refresh_token" in (tokens ?? {}));
  console.log("[whoop oauth-callback] expires_in:", tokens?.expires_in);
  console.log("[whoop oauth-callback] token_type:", tokens?.token_type);
  console.log("[whoop oauth-callback] refresh-related keys:", refreshRelated);

  if (!tokens.access_token) {
    return NextResponse.json({
      error: "Token exchange failed",
      tokens
    });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const { error } = await supabase
    .from("whoop_tokens")
    .insert({
      user_id: "d677b416-3e41-4739-9eb2-3fe3231b7bd7",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: expiresAt.toISOString(),
    });

  if (error) {
    return NextResponse.json({
      error: "Supabase insert failed",
      details: error
    });
  }

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/calendar`
  );
}