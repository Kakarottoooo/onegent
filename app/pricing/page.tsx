import type { Metadata } from "next";
import GlobalNav from "@/components/GlobalNav";
import { UpgradeButton } from "./_components/UpgradeButton";
import {
  EditorialCard,
  EditorialHero,
  EyebrowLabel,
} from "@/app/_shared/editorial";

export const metadata: Metadata = {
  title: "Pricing — Onegent",
  description:
    "Free for casual use. Pro unlocks unlimited bookings and Decision Rooms. $9/month or $79/year.",
};

const FEATURES: Array<{ label: string; free: string; pro: string }> = [
  { label: "Bookings per month",        free: "3",          pro: "Unlimited" },
  { label: "Decision Rooms per month",  free: "1",          pro: "Unlimited" },
  { label: "All scenarios",             free: "✓",          pro: "✓" },
  { label: "Trip packages (multi-leg)", free: "✓",          pro: "✓" },
  { label: "Calendar export · share",   free: "✓",          pro: "✓" },
  { label: "Cross-device preferences",  free: "✓",          pro: "✓" },
  { label: "Price monitoring",          free: "—",          pro: "Daily re-check, push alerts" },
  { label: "Priority autopilot queue",  free: "—",          pro: "First in line during peak" },
  { label: "Email support",             free: "Best effort", pro: "Within one business day" },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What counts as a booking?",
    a: "A booking is one completed reservation step — a restaurant table held, a hotel room confirmed, a flight cart with payment ready. Failed runs and exploratory polling don't count. Multi-leg trips (e.g. flight + hotel + dinner) count once per step that completes.",
  },
  {
    q: "What if I'm using Onegent through Claude or ChatGPT?",
    a: "Same account, same quota. Whichever surface you use — onegent.one, Claude.ai connector, ChatGPT App, or your own agent via OAuth — usage rolls up to your Onegent account. There's no free ride by switching channels.",
  },
  {
    q: "Why are Decision Rooms metered? They're the best part.",
    a: "Only room creation counts — inviting friends and voting are always free. We want viral coefficient: A pays, B and C are free guests of A's room. Free tier gets one room per month so you can try the multi-person flow without paying first.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account billing tab — you'll keep Pro until your billing period ends, then drop back to Free automatically. No penalty, no retention dance.",
  },
  {
    q: "Is there a free trial?",
    a: "The Free tier is the trial. It's permanent, not 14-day. If 3 bookings a month is enough for you, stay on Free forever.",
  },
  {
    q: "I'm building an agent — is there an API tier?",
    a: "Yes — separate pricing track for agent builders integrating Onegent via OAuth or MCP. See /developers/pricing for usage-based rates. The C-end pricing here is for individual travelers.",
  },
];

export default function PricingPage() {
  return (
    <>
      <GlobalNav />
      <main
        style={{
          minHeight: "calc(100vh - 60px)",
          background: "var(--bg)",
          color: "var(--ink-8)",
          paddingBottom: "var(--space-32)",
        }}
      >
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section
          style={{
            padding: "var(--space-20) var(--space-6) var(--space-12)",
          }}
        >
          <EditorialHero
            eyebrow="Pricing"
            title="Free for casual use. Pro when you want more."
            subtitle="Three bookings a month is plenty if you're planning a date night now and a weekend trip later. Pro lifts every limit and adds priority queue, daily price re-checks, and same-day email support."
            align="center"
            size="marketing"
          />
        </section>

        {/* ── Tier cards ───────────────────────────────────────────────── */}
        <section
          style={{
            maxWidth: "880px",
            margin: "0 auto",
            padding: "0 var(--space-6)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {/* Free card */}
          <EditorialCard
            variant="flat"
            padding="spacious"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
            }}
          >
            <header>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--ink-6)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Free
              </div>
              <div
                style={{
                  fontFamily: "var(--font-playfair), Georgia, serif",
                  fontSize: "56px",
                  fontWeight: 600,
                  lineHeight: 1,
                  color: "var(--ink-9)",
                  letterSpacing: "-0.025em",
                }}
              >
                $0
              </div>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--ink-5)",
                  marginTop: "var(--space-2)",
                  marginBottom: 0,
                }}
              >
                Forever, not 14 days.
              </p>
            </header>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                flex: 1,
              }}
            >
              <FreeFeature>3 bookings a month</FreeFeature>
              <FreeFeature>1 Decision Room a month</FreeFeature>
              <FreeFeature>All scenarios — restaurant, hotel, flight, activity, multi-day trip</FreeFeature>
              <FreeFeature>Calendar export · share links · cross-device prefs</FreeFeature>
              <FreeFeature>Same agent quality as Pro — no nerf</FreeFeature>
            </ul>
            <button
              type="button"
              disabled
              style={{
                appearance: "none",
                border: "1px solid var(--ink-3)",
                background: "transparent",
                color: "var(--ink-6)",
                fontFamily: "inherit",
                fontWeight: 500,
                fontSize: "15px",
                padding: "14px 24px",
                borderRadius: "var(--radius-pill)",
                cursor: "default",
                width: "100%",
              }}
            >
              You're on Free
            </button>
          </EditorialCard>

          {/* Pro card */}
          <EditorialCard
            variant="highlight"
            padding="spacious"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "-12px",
                right: "var(--space-6)",
                background: "var(--ink-9)",
                color: "var(--ink-1)",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                padding: "6px 12px",
                borderRadius: "var(--radius-pill)",
              }}
            >
              Recommended
            </span>
            <header>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--gold-text)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Pro
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--space-2)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontSize: "56px",
                    fontWeight: 600,
                    lineHeight: 1,
                    color: "var(--ink-9)",
                    letterSpacing: "-0.025em",
                  }}
                >
                  $9
                </span>
                <span style={{ color: "var(--ink-6)", fontSize: "16px" }}>/month</span>
              </div>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--ink-7)",
                  marginTop: "var(--space-2)",
                  marginBottom: 0,
                }}
              >
                Or <strong style={{ color: "var(--ink-9)" }}>$79/year</strong> — saves you 27%.
              </p>
            </header>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                flex: 1,
              }}
            >
              <ProFeature>Unlimited bookings</ProFeature>
              <ProFeature>Unlimited Decision Rooms</ProFeature>
              <ProFeature>Daily price re-checks + push alerts when fares drop</ProFeature>
              <ProFeature>Priority autopilot queue during peak hours</ProFeature>
              <ProFeature>Email support — reply within one business day</ProFeature>
              <ProFeature>Cancel anytime, keeps working until period end</ProFeature>
            </ul>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
              }}
            >
              <UpgradeButton plan="monthly" variant="primary">
                Upgrade to Pro · $9/month
              </UpgradeButton>
              <UpgradeButton plan="yearly" variant="ghost">
                Or pay yearly · $79
              </UpgradeButton>
            </div>
          </EditorialCard>
        </section>

        {/* ── Comparison ───────────────────────────────────────────────── */}
        <section
          style={{
            maxWidth: "880px",
            margin: "var(--space-20) auto 0",
            padding: "0 var(--space-6)",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              fontSize: "32px",
              fontWeight: 600,
              color: "var(--ink-9)",
              letterSpacing: "-0.02em",
              marginBottom: "var(--space-8)",
              textAlign: "center",
            }}
          >
            What's in each tier
          </h2>
          <div
            role="table"
            style={{
              background: "var(--card)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--ink-3)",
              overflow: "hidden",
            }}
          >
            <div
              role="row"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(200px, 1fr) 1fr 1fr",
                padding: "var(--space-4) var(--space-6)",
                background: "var(--ink-1)",
                borderBottom: "1px solid var(--ink-2)",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-6)",
              }}
            >
              <span>Feature</span>
              <span>Free</span>
              <span>Pro</span>
            </div>
            {FEATURES.map((f, i) => (
              <div
                key={f.label}
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(200px, 1fr) 1fr 1fr",
                  padding: "var(--space-4) var(--space-6)",
                  borderTop: i === 0 ? "none" : "1px solid var(--ink-2)",
                  alignItems: "center",
                  fontSize: "15px",
                  color: "var(--ink-7)",
                }}
              >
                <span style={{ fontWeight: 500, color: "var(--ink-8)" }}>{f.label}</span>
                <span style={{ color: f.free === "—" ? "var(--ink-4)" : "var(--ink-7)" }}>
                  {f.free}
                </span>
                <span style={{ color: f.pro === "—" ? "var(--ink-4)" : "var(--ink-9)", fontWeight: f.pro !== "—" && f.pro !== "✓" ? 500 : 400 }}>
                  {f.pro}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section
          style={{
            maxWidth: "720px",
            margin: "var(--space-20) auto 0",
            padding: "0 var(--space-6)",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              fontSize: "32px",
              fontWeight: 600,
              color: "var(--ink-9)",
              letterSpacing: "-0.02em",
              marginBottom: "var(--space-8)",
              textAlign: "center",
            }}
          >
            Common questions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {FAQ.map((item) => (
              <details
                key={item.q}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--ink-3)",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-5) var(--space-6)",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: "16px",
                    fontWeight: 500,
                    color: "var(--ink-9)",
                    listStyle: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{item.q}</span>
                  <span aria-hidden="true" style={{ color: "var(--ink-5)", marginLeft: "var(--space-4)" }}>
                    +
                  </span>
                </summary>
                <p
                  style={{
                    marginTop: "var(--space-4)",
                    marginBottom: 0,
                    fontSize: "15px",
                    lineHeight: 1.7,
                    color: "var(--ink-7)",
                  }}
                >
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Footer note for developers ───────────────────────────────── */}
        <section
          style={{
            maxWidth: "720px",
            margin: "var(--space-20) auto 0",
            padding: "0 var(--space-6)",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "14px", color: "var(--ink-5)", margin: 0 }}>
            Building an agent and want API access?{" "}
            <a
              href="/developers/pricing"
              style={{
                color: "var(--gold-text)",
                textDecoration: "underline",
                textDecorationColor: "var(--gold)",
                textUnderlineOffset: "3px",
              }}
            >
              See API pricing →
            </a>
          </p>
        </section>
      </main>
    </>
  );
}

function FreeFeature({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        fontSize: "15px",
        lineHeight: 1.55,
        color: "var(--ink-7)",
      }}
    >
      <span aria-hidden="true" style={{ color: "var(--ink-6)", fontSize: "18px", lineHeight: 1, marginTop: "2px" }}>
        ·
      </span>
      <span>{children}</span>
    </li>
  );
}

function ProFeature({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        fontSize: "15px",
        lineHeight: 1.55,
        color: "var(--ink-8)",
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, marginTop: "2px" }}
      >
        <circle cx="9" cy="9" r="9" fill="var(--gold)" />
        <path d="M5 9l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
