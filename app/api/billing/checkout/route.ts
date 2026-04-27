/**
 * POST /api/billing/checkout
 *
 * Create a Stripe Checkout Session for the authenticated user. The frontend
 * (UpgradeButton) redirects the user to the returned URL where Stripe
 * collects payment. On success the user lands at /account?tab=billing&checkout=success
 * and the webhook (/api/billing/webhook) writes the subscription row.
 *
 * Why we pre-create the Stripe Customer (instead of letting Checkout create
 * one): the Customer object holds metadata.user_id pointing back to Clerk,
 * which lets the webhook reliably resolve customer_id → user_id for any
 * subscription event (including the ones Stripe fires before our Checkout
 * Session resolves). We persist the customer_id to user_subscriptions on
 * this same call so findUserBySubscriptionCustomerId works in the webhook.
 *
 * Body: { plan: "monthly" | "yearly" }
 * Returns 200 { url: string } | 401 unauth | 503 stripe not configured
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getStripeClient,
  isStripeConfigured,
  getPriceIds,
} from "@/lib/billing/stripe";
import { getUserSubscription, upsertUserSubscription } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://onegent.one";

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "stripe_not_configured" },
      { status: 503 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const plan = body.plan;
  if (plan !== "monthly" && plan !== "yearly") {
    return NextResponse.json(
      { error: "invalid_plan", message: "plan must be 'monthly' or 'yearly'" },
      { status: 400 },
    );
  }

  const stripe = getStripeClient();
  const priceIds = getPriceIds();
  const priceId = plan === "monthly" ? priceIds.monthly : priceIds.yearly;

  // ── Reuse-or-create Stripe Customer ────────────────────────────────────
  // If the user has been through Checkout before they already have a row
  // with stripe_customer_id. New users get a fresh Customer with metadata
  // pointing back at Clerk so the webhook can resolve the relationship.
  let stripeCustomerId: string;
  const existing = await getUserSubscription(userId);
  if (existing?.stripe_customer_id) {
    stripeCustomerId = existing.stripe_customer_id;
  } else {
    const customer = await stripe.customers.create({
      metadata: { user_id: userId },
    });
    stripeCustomerId = customer.id;
    // Pre-write a free-tier row so the webhook's reverse lookup works even
    // if the subscription event arrives before Checkout completion writes
    // anything else. tier stays 'free' until the subscription event flips it.
    await upsertUserSubscription({
      userId,
      stripeCustomerId,
      stripeSubscriptionId: null,
      tier: "free",
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      planInterval: null,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/account?tab=billing&checkout=success`,
    cancel_url: `${APP_URL}/pricing`,
    // Allow promo codes — useful for early-user discounts ("first 50 users")
    // and lets us issue Stripe coupons without redeploying.
    allow_promotion_codes: true,
    // Subscription-level metadata so any subscription event we receive can
    // reliably attribute to this Clerk user even if Customer metadata is
    // overwritten or the customer is shared across products in the future.
    subscription_data: {
      metadata: { user_id: userId },
    },
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "checkout_url_missing" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: session.url });
}
