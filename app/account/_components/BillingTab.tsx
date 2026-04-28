"use client";

import { useEffect, useState } from "react";
import { EyebrowLabel } from "@/app/_shared/editorial";

type BillingState = {
  tier: "free" | "pro";
  bookings: { used: number; limit: number | null };
  rooms: { used: number; limit: number | null };
  period_start: string;
  subscription: {
    status: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    plan_interval: string | null;
  } | null;
};

/**
 * Account → Billing tab. Reads /api/billing/me on mount, renders tier +
 * usage progress + actions (manage Pro / upgrade Free).
 *
 * Designed to work even when Stripe env isn't configured: tier resolves
 * to "free" by default, usage counters work independently, only the
 * Manage / Upgrade actions hit Stripe-dependent routes (and degrade
 * gracefully to a 503-handled error state).
 */
export function BillingTab() {
  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/me");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to load billing (${res.status})`);
        return;
      }
      setState((await res.json()) as BillingState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function openPortal() {
    setActionPending(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (res.status === 503) {
        setError("Billing portal is launching soon — check back in a day or two.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Portal failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) {
        window.location.href = body.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionPending(false);
    }
  }

  if (loading) {
    return (
      <>
        <EyebrowLabel>Billing</EyebrowLabel>
        <p style={leadTextStyle}>Loading…</p>
      </>
    );
  }
  if (error || !state) {
    return (
      <>
        <EyebrowLabel>Billing</EyebrowLabel>
        <p style={{ ...leadTextStyle, color: "var(--danger, #dc2626)" }}>
          {error ?? "Couldn't load billing state."}
        </p>
        <button onClick={load} style={ghostButtonStyle}>
          Retry
        </button>
      </>
    );
  }

  const isPro = state.tier === "pro";
  const periodEnd = state.subscription?.current_period_end
    ? new Date(state.subscription.current_period_end)
    : null;

  // Stripe stores the interval as "month" / "year" — make it grammatical
  // English for end-user copy ("billed monthly" not "billed month").
  const planIntervalAdverb =
    state.subscription?.plan_interval === "year"
      ? "annually"
      : state.subscription?.plan_interval === "month"
      ? "monthly"
      : "monthly";

  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-4)",
        }}
      >
        <EyebrowLabel>Billing</EyebrowLabel>
        <span
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "5px 12px",
            borderRadius: 999,
            color: isPro ? "var(--gold-text, #5A4416)" : "var(--text-secondary, #666)",
            background: isPro ? "var(--gold-soft, #F5E9C8)" : "var(--card-2, #f5f5f5)",
            border: isPro ? "1px solid var(--gold, #C9A84C)" : "1px solid var(--border, #e5e7eb)",
          }}
        >
          {isPro ? "Pro" : "Free"}
        </span>
      </header>

      {/* ── Pro state ──────────────────────────────────────────────────── */}
      {isPro && (
        <>
          <h3 style={editorialHeadingStyle}>Onegent Pro.</h3>
          <p style={leadTextStyle}>
            Unlimited bookings, unlimited Decision Rooms, daily price re-checks,
            priority autopilot queue.
          </p>
          {periodEnd && state.subscription?.cancel_at_period_end && (
            <p style={{ ...mutedTextStyle, color: "var(--warning, #b45309)" }}>
              Cancellation scheduled — Pro stays active until{" "}
              {periodEnd.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}.
            </p>
          )}
          {periodEnd && !state.subscription?.cancel_at_period_end && (
            <p style={mutedTextStyle}>
              Renews{" "}
              {periodEnd.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}{" "}
              · billed {planIntervalAdverb}.
            </p>
          )}
          {state.subscription?.status === "past_due" && (
            <p style={{ ...mutedTextStyle, color: "var(--warning, #b45309)" }}>
              Last payment failed — Stripe is retrying. Update your card to avoid losing Pro access.
            </p>
          )}

          <div style={{ marginTop: "var(--space-6)" }}>
            <button
              onClick={openPortal}
              disabled={actionPending}
              style={primaryButtonStyle}
            >
              {actionPending ? "Opening Stripe…" : "Manage subscription"}
            </button>
          </div>
        </>
      )}

      {/* ── Free state — show usage progress + upgrade CTA ────────────── */}
      {!isPro && (
        <>
          <h3 style={editorialHeadingStyle}>On the Free plan.</h3>
          <p style={leadTextStyle}>
            Three bookings a month, one Decision Room. Quotas reset on the 1st.
          </p>

          <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <UsageBar
              label="Bookings this month"
              used={state.bookings.used}
              limit={state.bookings.limit ?? 0}
            />
            <UsageBar
              label="Decision Rooms this month"
              used={state.rooms.used}
              limit={state.rooms.limit ?? 0}
            />
          </div>

          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
            <a
              href="/pricing"
              style={{ ...primaryButtonStyle, textDecoration: "none", display: "inline-block" }}
            >
              Upgrade to Pro · $9/month
            </a>
            <a href="/pricing" style={{ ...ghostButtonStyle, textDecoration: "none", display: "inline-block" }}>
              Compare plans
            </a>
          </div>
        </>
      )}
    </>
  );
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const exceeded = used >= limit && limit > 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "var(--space-2)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 15,
            color: "var(--ink-8)",
            fontWeight: 500,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 14,
            color: exceeded ? "var(--danger, #dc2626)" : "var(--ink-5)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {used} / {limit}
        </span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--ink-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: exceeded ? "var(--danger, #dc2626)" : "var(--gold, #C9A84C)",
            transition: "width 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}

// ── Style fragments (parent /account wraps in EditorialCard for chrome) ─
// Hierarchy mirrors /pricing: Playfair serif for primary heading + 17px lead
// + 14px muted secondary, so the card content reads as same product family
// as the page hero rather than a separate functional widget.

const editorialHeadingStyle: React.CSSProperties = {
  fontFamily: "var(--font-playfair), Georgia, serif",
  fontSize: "28px",
  fontWeight: 600,
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  color: "var(--ink-9)",
  margin: 0,
};

const leadTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 17,
  color: "var(--ink-7)",
  lineHeight: 1.55,
  marginTop: "var(--space-3)",
  marginBottom: 0,
  maxWidth: "52ch",
};

const mutedTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 14,
  color: "var(--ink-5)",
  lineHeight: 1.6,
  margin: 0,
  marginTop: "var(--space-3)",
};

const primaryButtonStyle: React.CSSProperties = {
  appearance: "none",
  border: "none",
  fontFamily: "var(--font-dm-sans)",
  fontWeight: 500,
  fontSize: 15,
  padding: "12px 22px",
  borderRadius: 999,
  background: "var(--ink-9, #1A150D)",
  color: "var(--ink-1, #FBF8F2)",
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  appearance: "none",
  fontFamily: "var(--font-dm-sans)",
  fontWeight: 500,
  fontSize: 15,
  padding: "12px 22px",
  borderRadius: 999,
  background: "transparent",
  color: "var(--ink-8)",
  border: "1px solid var(--ink-3)",
  cursor: "pointer",
};
