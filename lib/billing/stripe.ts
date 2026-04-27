/**
 * Shared Stripe client.
 *
 * Why a module-level singleton: Stripe's Node SDK opens a TCP keep-alive
 * pool to api.stripe.com — instantiating it per request burns connections
 * on Vercel's serverless. One client per process is the documented pattern.
 *
 * Env contract (set on Vercel for prod, .env.local for dev):
 *   STRIPE_SECRET_KEY        sk_test_… (dev) / sk_live_… (prod)
 *   STRIPE_PUBLISHABLE_KEY   pk_test_… / pk_live_… (frontend reads this)
 *   STRIPE_WEBHOOK_SECRET    whsec_… (signature verify in /api/billing/webhook)
 *   STRIPE_PRICE_MONTHLY     price_… ($9/mo recurring price id)
 *   STRIPE_PRICE_YEARLY      price_… ($79/year recurring price id)
 *
 * Until env is configured, getStripeClient() throws — the routes catch and
 * return a friendly 503 so the rest of the site keeps rendering.
 */
import Stripe from "stripe";

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "STRIPE_SECRET_KEY missing — pricing routes are disabled until billing env is provisioned.",
    );
  }
  // apiVersion intentionally unset: lets the SDK use its pinned default
  // (matches the version we tested against). Pin explicitly only when we
  // need a feature on a newer version.
  cachedClient = new Stripe(secret);
  return cachedClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_PRICE_MONTHLY &&
      process.env.STRIPE_PRICE_YEARLY,
  );
}

export function getPriceIds(): { monthly: string; yearly: string } {
  const monthly = process.env.STRIPE_PRICE_MONTHLY;
  const yearly = process.env.STRIPE_PRICE_YEARLY;
  if (!monthly || !yearly) {
    throw new Error("Stripe price IDs missing — STRIPE_PRICE_MONTHLY / _YEARLY required.");
  }
  return { monthly, yearly };
}
