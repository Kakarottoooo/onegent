/**
 * GET /api/billing/me
 *
 * Returns the signed-in user's current billing state — tier, this month's
 * usage, period end if subscribed. Used by the /account billing tab and
 * any client-side surface that wants to show "X of N bookings used".
 *
 * Returns 200 { tier, used, limit, period_end?, cancel_at_period_end?, plan_interval? }
 *         401 unauthorized
 *
 * Note: this endpoint works fine without Stripe configured — it just reads
 * lib/db state. Free users without a subscription row get { tier: "free",
 * used: 0..N, limit: 3, period_end: null }.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCurrentUsage, getUserSubscription } from "@/lib/db";
import {
  FREE_BOOKINGS_PER_MONTH,
  FREE_DECISION_ROOMS_PER_MONTH,
  getUserTier,
} from "@/lib/billing/quota";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [tier, usage, sub] = await Promise.all([
    getUserTier(userId),
    getCurrentUsage(userId),
    getUserSubscription(userId),
  ]);
  return NextResponse.json({
    tier,
    bookings: {
      used: usage.bookings_used,
      limit: tier === "pro" ? null : FREE_BOOKINGS_PER_MONTH,
    },
    rooms: {
      used: usage.rooms_used,
      limit: tier === "pro" ? null : FREE_DECISION_ROOMS_PER_MONTH,
    },
    period_start: usage.period_start,
    subscription: sub
      ? {
          status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          plan_interval: sub.plan_interval,
        }
      : null,
  });
}
