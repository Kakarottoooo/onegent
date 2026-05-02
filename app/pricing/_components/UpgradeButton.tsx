"use client";

/**
 * Upgrade CTA — POST /api/billing/checkout, follow Stripe-hosted Checkout.
 *
 * If the user isn't signed in, the route returns 401 → we redirect them to
 * Clerk sign-in with returnBackUrl=/pricing so they land back here after
 * auth and can click again.
 *
 * If Stripe isn't configured (env not set yet), the route returns 503 →
 * we surface a polite "billing setup pending" inline so the page itself
 * stays usable.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

type Plan = "monthly" | "yearly";

export function UpgradeButton({
  plan,
  variant = "primary",
  children,
}: {
  plan: Plan;
  variant?: "primary" | "ghost";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent("/pricing")}`);
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 503) {
        setError("Pricing is launching soon — check back in a day or two.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Couldn't start checkout. Try again?");
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) {
        window.location.href = body.url;
      } else {
        setError("Something went wrong starting checkout. Please try again in a moment.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection problem. Check your network and try again.");
    } finally {
      setPending(false);
    }
  };

  const baseStyle: React.CSSProperties = {
    appearance: "none",
    border: "none",
    fontFamily: "inherit",
    fontWeight: 500,
    fontSize: "15px",
    letterSpacing: "0.01em",
    padding: "14px 24px",
    borderRadius: "var(--radius-pill)",
    cursor: pending ? "wait" : "pointer",
    transition:
      "background var(--motion-base) var(--ease-out-soft), transform var(--motion-fast) var(--ease-out-soft), box-shadow var(--motion-base) var(--ease-out-soft)",
    width: "100%",
  };

  const primaryStyle: React.CSSProperties = {
    ...baseStyle,
    background: "var(--ink-9)",
    color: "var(--ink-1)",
    boxShadow: pending ? "none" : "var(--shadow-2)",
  };

  const ghostStyle: React.CSSProperties = {
    ...baseStyle,
    background: "transparent",
    color: "var(--ink-8)",
    border: "1px solid var(--ink-3)",
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={variant === "primary" ? primaryStyle : ghostStyle}
        onMouseEnter={(e) => {
          if (variant === "primary" && !pending) {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "var(--shadow-3)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          if (variant === "primary") {
            e.currentTarget.style.boxShadow = "var(--shadow-2)";
          }
        }}
      >
        {pending ? "Opening Stripe…" : children}
      </button>
      {error ? (
        <p
          role="alert"
          style={{
            marginTop: "var(--space-3)",
            fontSize: "13px",
            color: "var(--danger)",
            textAlign: "center",
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
