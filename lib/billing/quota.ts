/**
 * Billing quota — pure module that the booking-job entry points and
 * /api/mcp OAuth path consult before letting a user start work.
 *
 * Pricing v0.1:
 *   Free  — 3 bookings / calendar month + 1 Decision Room / month
 *   Pro   — unlimited (everything)
 *
 * The "calendar month" choice is intentional: simpler than tracking each
 * user's Stripe billing-cycle anchor, and the gap between "anniversary
 * billing" and "calendar quota" is a rounding error at this scale. Every
 * user's quota refills at UTC 0:00 on the 1st of the month.
 *
 * Source of truth for tier:
 *   user_subscriptions row exists AND tier='pro' AND status in active set
 *     → pro
 *   otherwise → free (default — no row needed)
 *
 * The "active set" is the union of states where Stripe still considers the
 * subscription valid for use:
 *   - active: paid, current
 *   - trialing: in trial period (we don't offer trials yet, but be safe)
 *   - past_due: payment failed but Stripe is retrying — still grant access
 *     until canceled or unpaid (Stripe's smart retry recovers ~50% of these)
 *
 * Excluded states (treated as free):
 *   - canceled, unpaid, incomplete, incomplete_expired, paused
 */

import {
  getCurrentUsage,
  getUserSubscription,
  type BillingTier,
} from "@/lib/db";

export const FREE_BOOKINGS_PER_MONTH = 3;
export const FREE_DECISION_ROOMS_PER_MONTH = 1;

const PRO_ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export type QuotaCheckResult =
  | {
      allowed: true;
      tier: BillingTier;
      used: number;
      limit: number | null; // null = unlimited (Pro)
    }
  | {
      allowed: false;
      tier: BillingTier;
      used: number;
      limit: number;
      reason: "quota_exceeded";
      kind: "booking" | "room";
    };

/**
 * Resolves the effective billing tier for a user. Free is the default for
 * anyone who's never been through Stripe — no row required.
 *
 * Reads user_subscriptions in 1 query. Cheap enough to call on the booking
 * hot path. If you need to call it 100x per request, cache at the request
 * level (no in-memory cache here — Vercel is stateless and the row is
 * already indexed by user_id PK).
 */
export async function getUserTier(userId: string): Promise<BillingTier> {
  const sub = await getUserSubscription(userId);
  if (!sub) return "free";
  if (sub.tier !== "pro") return "free";
  if (!sub.status || !PRO_ACTIVE_STATUSES.has(sub.status)) return "free";
  return "pro";
}

/**
 * Returns whether the user can start one more booking this calendar month.
 *
 * For Pro users: always { allowed: true, limit: null }.
 * For Free users: enforces FREE_BOOKINGS_PER_MONTH against the current
 * user_usage_counters row (zero if the user hasn't booked this month).
 *
 * Caller should: if !allowed, return HTTP 402 with { error: "quota_exceeded",
 * upgrade_url: "https://onegent.one/pricing", used, limit } so the frontend
 * (or claude.ai / ChatGPT) can render an upgrade prompt.
 */
export async function canBookMore(userId: string): Promise<QuotaCheckResult> {
  const tier = await getUserTier(userId);
  if (tier === "pro") {
    return { allowed: true, tier, used: 0, limit: null };
  }
  const usage = await getCurrentUsage(userId);
  const limit = FREE_BOOKINGS_PER_MONTH;
  if (usage.bookings_used >= limit) {
    return {
      allowed: false,
      tier,
      used: usage.bookings_used,
      limit,
      reason: "quota_exceeded",
      kind: "booking",
    };
  }
  return { allowed: true, tier, used: usage.bookings_used, limit };
}

/**
 * Same shape as canBookMore but for Decision Room creation. The "rooms_used"
 * counter is incremented per Decision Room CREATED, not per vote/proposal —
 * inviting members and voting on existing rooms is always free (otherwise
 * we'd kill viral coefficient).
 */
export async function canCreateRoom(userId: string): Promise<QuotaCheckResult> {
  const tier = await getUserTier(userId);
  if (tier === "pro") {
    return { allowed: true, tier, used: 0, limit: null };
  }
  const usage = await getCurrentUsage(userId);
  const limit = FREE_DECISION_ROOMS_PER_MONTH;
  if (usage.rooms_used >= limit) {
    return {
      allowed: false,
      tier,
      used: usage.rooms_used,
      limit,
      reason: "quota_exceeded",
      kind: "room",
    };
  }
  return { allowed: true, tier, used: usage.rooms_used, limit };
}

/**
 * Composes the standard 402 response body. Both the REST API path
 * (/api/booking-jobs/start) and the JSON-RPC path (/api/mcp OAuth) use this
 * to produce a consistent, machine-readable upgrade prompt.
 */
export function buildQuotaExceededBody(result: {
  used: number;
  limit: number;
  kind: "booking" | "room";
}): {
  error: "quota_exceeded";
  message: string;
  upgrade_url: string;
  used: number;
  limit: number;
  kind: "booking" | "room";
} {
  const human =
    result.kind === "booking"
      ? `You've used ${result.used} of ${result.limit} free bookings this month.`
      : `You've created ${result.used} of ${result.limit} free Decision Rooms this month.`;
  return {
    error: "quota_exceeded",
    message: `${human} Upgrade to Onegent Pro for unlimited.`,
    upgrade_url: "https://onegent.one/pricing",
    used: result.used,
    limit: result.limit,
    kind: result.kind,
  };
}
