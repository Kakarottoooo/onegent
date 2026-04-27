/**
 * POST /api/billing/webhook
 *
 * Stripe → us. Receives subscription lifecycle events and mirrors enough
 * state into user_subscriptions so /lib/billing/quota.ts can answer
 * "is this user Pro?" without round-tripping to Stripe on every booking.
 *
 * Events we care about (configure these on Stripe Dashboard → Webhooks):
 *   - customer.subscription.created  → tier flips to 'pro', period set
 *   - customer.subscription.updated  → renewal, plan change, cancel-at-end
 *   - customer.subscription.deleted  → tier flips back to 'free'
 *   - invoice.payment_failed         → status='past_due' (still grants
 *                                       access while Stripe smart-retries)
 *
 * Why HTTP 200 even on processing errors: Stripe retries non-2xx responses
 * with exponential backoff. We only return non-200 for signature/format
 * issues — anything we can't categorize, we 200 + log so Stripe stops
 * retrying a doomed event into our logs.
 *
 * Idempotency: upsertUserSubscription is idempotent (PRIMARY KEY user_id),
 * and Stripe events have stable IDs we could dedupe by, but the upsert
 * shape makes that unnecessary.
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  findUserBySubscriptionCustomerId,
  upsertUserSubscription,
  type BillingTier,
} from "@/lib/db";
import { getStripeClient, isStripeConfigured } from "@/lib/billing/stripe";

// Stripe signature verification needs the RAW request body. Next.js routes
// give us req.text() which preserves bytes — DON'T call req.json() here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "stripe_not_configured" },
      { status: 503 },
    );
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  const rawBody = await req.text();

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[billing/webhook] signature verification failed", err);
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Stripe sends many event types — only the ones above matter.
        // Returning 200 prevents retry storms for events we don't care about.
        break;
    }
  } catch (err) {
    console.error(
      `[billing/webhook] handler for ${event.type} threw — returning 200 to stop retries`,
      err,
    );
    // Intentionally fall through to 200 — see header docstring.
  }

  return NextResponse.json({ received: true });
}

async function resolveUserId(
  customerId: string,
  metadataUserId: string | undefined,
): Promise<string | null> {
  // Prefer subscription metadata.user_id (set on checkout); fall back to
  // looking up by Stripe customer_id via our own table (set when checkout
  // pre-created the row).
  if (metadataUserId) return metadataUserId;
  return findUserBySubscriptionCustomerId(customerId);
}

function tierFromSubscription(sub: Stripe.Subscription): BillingTier {
  // Any non-canceled / non-failed status counts as Pro for our purposes.
  // The active set in lib/billing/quota.ts (active|trialing|past_due) is
  // what actually grants access — we mirror those into tier='pro' here so
  // the column is the friendlier signal in /account UI.
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    return "free";
  }
  return "pro";
}

function planIntervalFromSubscription(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  return item?.price?.recurring?.interval ?? null;
}

async function handleSubscriptionUpdate(sub: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const metaUserId = (sub.metadata?.user_id ?? undefined) as string | undefined;
  const userId = await resolveUserId(customerId, metaUserId);
  if (!userId) {
    console.warn(
      `[billing/webhook] subscription ${sub.id} for customer ${customerId} — no Onegent user matched, skipping`,
    );
    return;
  }
  const periodEndUnix =
    (sub as unknown as { current_period_end?: number }).current_period_end ?? 0;
  await upsertUserSubscription({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    tier: tierFromSubscription(sub),
    status: sub.status,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    planInterval: planIntervalFromSubscription(sub),
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const metaUserId = (sub.metadata?.user_id ?? undefined) as string | undefined;
  const userId = await resolveUserId(customerId, metaUserId);
  if (!userId) return;
  await upsertUserSubscription({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    tier: "free",
    status: "canceled",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    planInterval: planIntervalFromSubscription(sub),
  });
}

async function handleInvoicePaymentFailed(inv: Stripe.Invoice): Promise<void> {
  // Older API versions surfaced subscription as a top-level field; newer
  // ones nest it under parent.subscription_details.subscription. Stripe's
  // SDK keeps the legacy field optional for backward compat. We probe both
  // shapes and bail if neither is populated (e.g. one-off invoices).
  const invAny = inv as unknown as {
    subscription?: string | { id?: string } | null;
    customer?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | null } | null } | null;
  };
  const subFromTop =
    typeof invAny.subscription === "string"
      ? invAny.subscription
      : invAny.subscription?.id ?? null;
  const subFromParent = invAny.parent?.subscription_details?.subscription ?? null;
  const subId = subFromTop ?? subFromParent;
  if (!subId) return;

  const customerId =
    typeof invAny.customer === "string" ? invAny.customer : invAny.customer?.id;
  if (!customerId) return;

  // We don't have the full Subscription object on this event payload, so
  // we just mark status='past_due' (tier stays 'pro' so the user keeps
  // access while Stripe smart-retries — quota check honors past_due).
  const userId = await findUserBySubscriptionCustomerId(customerId);
  if (!userId) return;
  await upsertUserSubscription({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subId,
    tier: "pro", // keep access during smart retry
    status: "past_due",
    currentPeriodEnd: null, // unchanged in DB; we'd need a fetch to update
    cancelAtPeriodEnd: false,
    planInterval: null,
  });
}
