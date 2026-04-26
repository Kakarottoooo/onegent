import Link from "next/link";

import "../_styles/pricing.css";

export const metadata = {
  title: "Pricing",
  description:
    "Free during private beta. Production pricing arrives with v0.3 — usage-based, infrastructure-priced.",
};

export default function PricingPage() {
  return (
    <section className="dev-section dev-pricing">
      <div className="dev-container-narrow">
        <span
          className="dev-eyebrow dev-pricing-eyebrow"
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)" }}
        >
          <span
            style={{
              width: "24px",
              height: "1px",
              background: "var(--accent)",
            }}
          />
          Pricing
        </span>

        <h1 className="dev-mega dev-pricing-statement">
          Free during private beta.
        </h1>

        <p className="dev-lead dev-pricing-sub">
          Production pricing arrives with v0.3 — usage-based,
          infrastructure-priced. No per-seat tax, no minimum commit. You
          pay for the bookings the engine actually executes; you don't
          pay for the rate-limited polling Claude does between them.
        </p>

        <div className="dev-pricing-grid">
          <PricingCard
            label="Beta access"
            value="Free"
            note="Up to 100 bookings/month while we shake out edge cases. Email beta@onegent.one to request a key."
          />
          <PricingCard
            label="Production · planned"
            value="$0.40 / booking"
            note="Per successful booking (status='done'). Failed jobs and exploratory polling cost nothing."
            dim
          />
          <PricingCard
            label="High-volume · planned"
            value="Custom"
            note="Above 10k bookings/mo, priority queue and dedicated provider profiles. Get in touch."
            dim
          />
        </div>

        <div className="dev-pricing-cta">
          <Link href="mailto:beta@onegent.one?subject=Onegent%20beta%20access" className="dev-cta-pill">
            Request beta access
          </Link>
          <Link href="/developers/docs" className="dev-cta-ghost">
            Read the docs
          </Link>
        </div>

        <div className="dev-pricing-fineprint">
          <p>
            <strong>What "infrastructure-priced" means.</strong> The cost
            of a booking is dominated by the headless browser session
            and the LLM tokens that drive the agent — both of which are
            metered upstream. Onegent prices to those costs plus a
            transparent margin, not to a value-extraction theory of the
            customer's willingness to pay.
          </p>
          <p>
            <strong>What you don't pay for.</strong> No charge for jobs
            that fail before reaching the booking site. No charge for
            <code className="dev-mono-sm" style={{ padding: "0 4px" }}>
              get_job_status
            </code>{" "}
            polling. No charge for the audit trail. The only metered
            event is "agent submitted a confirmed booking on your
            behalf."
          </p>
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  label,
  value,
  note,
  dim,
}: {
  label: string;
  value: string;
  note: string;
  dim?: boolean;
}) {
  return (
    <article
      className="dev-pricing-card"
      data-dim={dim ? "true" : undefined}
    >
      <span className="dev-eyebrow">{label}</span>
      <div className="dev-pricing-card-value">{value}</div>
      <p className="dev-pricing-card-note">{note}</p>
    </article>
  );
}
