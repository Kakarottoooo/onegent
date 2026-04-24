import Link from "next/link";

import { CodePreview } from "./CodePreview";

/**
 * Landing hero. The signature moment: massive serif headline with a
 * gold underline drawn under "end-to-end". Right column is the live
 * 3-tab CodePreview from US-W4-014.
 */
export function Hero() {
  return (
    <section className="dev-hero">
      <div className="dev-container">
        <div className="dev-hero-grid">
          <div className="dev-hero-text">
            <span className="dev-eyebrow dev-hero-eyebrow dev-fade-up">
              Private beta · Travel Execution Layer
            </span>

            <h1 className="dev-display dev-fade-up dev-fade-up--delay-1">
              Your AI books{" "}
              <span style={{ whiteSpace: "nowrap" }}>your trip</span>{" "}
              <span className="dev-token-underline">end-to-end.</span>
            </h1>

            <p
              className="dev-lead dev-hero-lead dev-fade-up dev-fade-up--delay-2"
            >
              The Travel Execution Layer for AI agents — book restaurants,
              hotels, flights, and activities through a single API. The agent
              navigates real booking sites on your behalf and stops before
              the card is charged.
            </p>

            <div className="dev-hero-cta dev-fade-up dev-fade-up--delay-3">
              <Link href="/developers/keys" className="dev-cta-pill">
                Get API key
              </Link>
              <Link href="/developers/docs" className="dev-cta-ghost">
                Read the docs
              </Link>
            </div>

            <div className="dev-hero-meta dev-fade-up dev-fade-up--delay-4">
              <div className="dev-hero-meta-row">
                <CheckIcon />
                <span>OpenTable, Resy, Booking.com, Expedia, Hotels.com, Viator</span>
              </div>
              <div className="dev-hero-meta-row">
                <CheckIcon />
                <span>Stops before CVV — user always confirms the charge</span>
              </div>
              <div className="dev-hero-meta-row">
                <CheckIcon />
                <span>Available as REST, MCP server, ChatGPT App</span>
              </div>
            </div>
          </div>

          <div className="dev-hero-code dev-fade-up dev-fade-up--delay-2">
            <CodePreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}
