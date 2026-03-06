import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "WHOOP env variables missing" },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:recovery read:sleep read:cycles read:workout",
  });

  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}