import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.WHOOP_CLIENT_ID!;
  const redirectUri = process.env.WHOOP_REDIRECT_URI!;

  const url =
    `https://api.prod.whoop.com/oauth/oauth2/auth` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=read:recovery read:sleep read:cycles read:workout`;

  return NextResponse.redirect(url);
}