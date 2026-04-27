/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for the signed-in user. The
 * Portal handles cancellation, payment-method updates, invoice history,
 * and tax-ID collection — everything we'd otherwise need to build ourselves.
 *
 * Returns: 200 { url } | 401 unauth | 404 no_subscription | 503 stripe down
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStripeClient, isStripeConfigured } from "@/lib/billing/stripe";
import { getUserSubscription } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://onegent.one";

export async function POST() {
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

  const sub = await getUserSubscription(userId);
  if (!sub?.stripe_customer_id) {
    return NextResponse.json(
      {
        error: "no_subscription",
        message:
          "You haven't checked out yet — there's nothing to manage. Visit /pricing to start.",
      },
      { status: 404 },
    );
  }

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${APP_URL}/account?tab=billing`,
  });
  return NextResponse.json({ url: session.url });
}
