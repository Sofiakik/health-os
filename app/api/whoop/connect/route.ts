import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
  const clientId = process.env.WHOOP_CLIENT_ID!;
  const redirectUri = process.env.WHOOP_REDIRECT_URI!;

  // generate secure state value
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:recovery read:sleep read:cycles read:workout",
    state,
  });

  const authUrl =
    `https://api.prod.whoop.com/oauth/oauth2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}