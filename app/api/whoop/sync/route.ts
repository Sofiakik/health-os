import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WHOOP_API = "https://api.prod.whoop.com/developer/v1";

async function refreshTokenIfNeeded(tokenRow: any) {
  const now = new Date();

  if (!tokenRow.expires_at || new Date(tokenRow.expires_at) > now) {
    return tokenRow.access_token;
  }

  if (!tokenRow.refresh_token) {
    throw new Error("No refresh token available");
  }

  const res = await fetch(
    "https://api.prod.whoop.com/oauth/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
        client_id: process.env.WHOOP_CLIENT_ID!,
        client_secret: process.env.WHOOP_CLIENT_SECRET!,
      }),
    }
  );

  const tokens = await res.json();

  if (!tokens.access_token) {
    throw new Error("WHOOP token refresh failed");
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await supabase
    .from("whoop_tokens")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? tokenRow.refresh_token,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", tokenRow.user_id);

  return tokens.access_token;
}

async function fetchWhoop(endpoint: string, token: string) {
  const res = await fetch(`${WHOOP_API}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.json();
}

export async function GET() {
  try {
    const { data: tokenRow } = await supabase
      .from("whoop_tokens")
      .select("*")
      .limit(1)
      .single();

    if (!tokenRow) {
      return NextResponse.json({ error: "No WHOOP token stored" });
    }

    const accessToken = await refreshTokenIfNeeded(tokenRow);

    const cycles = await fetchWhoop("/cycle", accessToken);
    const recoveries = await fetchWhoop("/recovery", accessToken);
    const sleeps = await fetchWhoop("/sleep", accessToken);
    const workouts = await fetchWhoop("/workout", accessToken);

    return NextResponse.json({
      success: true,
      cycles: cycles?.records?.length ?? 0,
      recoveries: recoveries?.records?.length ?? 0,
      sleeps: sleeps?.records?.length ?? 0,
      workouts: workouts?.records?.length ?? 0,
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err.message,
    });
  }
}