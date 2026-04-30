import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildGoogleCalendarAuthUrl } from "@/lib/google-calendar";

const STATE_COOKIE = "og_gc_state";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/calendar?google_calendar=signin", req.url));

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/calendar/google/callback`;
  const state = randomUUID();
  const authUrl = buildGoogleCalendarAuthUrl({ redirectUri, state });
  const res = NextResponse.redirect(authUrl);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
