import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { upsertGmailConnection } from "@/lib/gmail-db";
import {
  exchangeGoogleGmailCode,
  fetchGoogleGmailProfile,
} from "@/lib/google-gmail";

const STATE_COOKIE = "og_gmail_state";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/calendar?gmail=signin", req.url));
  }

  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const redirectToCalendar = new URL("/calendar", req.url);

  if (error) {
    redirectToCalendar.searchParams.set("gmail", "denied");
    return NextResponse.redirect(redirectToCalendar);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    redirectToCalendar.searchParams.set("gmail", "invalid_state");
    return NextResponse.redirect(redirectToCalendar);
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/gmail/google/callback`;
    const tokens = await exchangeGoogleGmailCode({ code, redirectUri });
    const profile = await fetchGoogleGmailProfile(tokens.accessToken);
    await upsertGmailConnection({
      userId,
      provider: "google",
      externalAccountId: profile.emailAddress,
      externalAccountEmail: profile.emailAddress,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      scope: tokens.scope,
      tokenType: tokens.tokenType,
    });
    redirectToCalendar.searchParams.set("gmail", "connected");
  } catch (error) {
    console.error("[gmail/google/callback] failed", error);
    redirectToCalendar.searchParams.set("gmail", "error");
    redirectToCalendar.searchParams.set(
      "gmail_error_detail",
      error instanceof Error ? error.message.slice(0, 180) : "Unknown callback error",
    );
  }

  const res = NextResponse.redirect(redirectToCalendar);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
