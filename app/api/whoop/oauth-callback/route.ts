import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "Missing OAuth code" }, { status: 400 });
    }

    // Exchange code for WHOOP tokens
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

    if (!tokens.access_token) {
      return NextResponse.json(tokens, { status: 400 });
    }

    // Connect to Supabase with service role
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const expiresInSeconds = typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Upsert tokens (insert or update on conflict) so re-connecting WHOOP doesn't fail
    const { error } = await supabase.from("whoop_tokens").upsert(
      {
        user_id: "d677b416-3e41-4739-9eb2-3fe3231b7bd7",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) {
      return NextResponse.json({
        error: "DB insert failed",
        details: error.message,
      });
    }

    // Redirect to calendar
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/calendar`
    );

  } catch (err: any) {
    return NextResponse.json({
      error: "Callback failed",
      details: err.message,
    });
  }
}