import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { syncGoogleBusySlots } from "@/lib/calendar-service";
import { upsertCalendarConnection } from "@/lib/calendar-db";
import {
  exchangeGoogleCalendarCode,
  fetchGooglePrimaryCalendar,
} from "@/lib/google-calendar";

const STATE_COOKIE = "og_gc_state";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/calendar?google_calendar=signin", req.url));

  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const redirectToCalendar = new URL("/calendar", req.url);

  if (error) {
    redirectToCalendar.searchParams.set("google_calendar", "denied");
    return NextResponse.redirect(redirectToCalendar);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    redirectToCalendar.searchParams.set("google_calendar", "invalid_state");
    return NextResponse.redirect(redirectToCalendar);
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/calendar/google/callback`;
    const tokens = await exchangeGoogleCalendarCode({ code, redirectUri });
    const primary = await fetchGooglePrimaryCalendar(tokens.accessToken);
    await upsertCalendarConnection({
      userId,
      provider: "google",
      externalAccountId: primary.id,
      externalAccountEmail: primary.id,
      calendarTimezone: primary.timeZone,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      scope: tokens.scope,
      tokenType: tokens.tokenType,
    });
    const today = new Date();
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, 0));
    await syncGoogleBusySlots({
      userId,
      rangeStart: from.toISOString().slice(0, 10),
      rangeEnd: to.toISOString().slice(0, 10),
    });
    redirectToCalendar.searchParams.set("google_calendar", "connected");
  } catch (error) {
    console.error("[google-calendar/callback] failed", error);
    redirectToCalendar.searchParams.set("google_calendar", "error");
    redirectToCalendar.searchParams.set(
      "google_calendar_error_detail",
      error instanceof Error ? error.message.slice(0, 180) : "Unknown callback error",
    );
  }

  const res = NextResponse.redirect(redirectToCalendar);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
