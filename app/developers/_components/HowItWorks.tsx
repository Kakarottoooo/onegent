/**
 * How-it-works flow — 4 nodes from agent → API → engine → booking site,
 * with a continuously-traveling gold token along the connecting line.
 * Pure server component; gold token motion is a CSS @keyframes loop.
 */

import { Fragment } from "react";

interface FlowNode {
  glyph: React.ReactNode;
  meta: string;
  label: string;
  desc: string;
}

const NODES: FlowNode[] = [
  {
    glyph: <AgentGlyph />,
    meta: "01",
    label: "Your AI agent",
    desc: "Claude, ChatGPT, your own LLM. Calls one of six tools.",
  },
  {
    glyph: <ApiGlyph />,
    meta: "02",
    label: "Onegent /api/v1",
    desc: "REST + Streamable HTTP MCP. Bearer auth, scoped keys.",
  },
  {
    glyph: <EngineGlyph />,
    meta: "03",
    label: "Execution engine",
    desc: "Provider chain, retries, audit, payment-stop invariant.",
  },
  {
    glyph: <SiteGlyph />,
    meta: "04",
    label: "Real booking site",
    desc: "OpenTable, Booking.com, Expedia — agent drives the page.",
  },
];

export function HowItWorks() {
  return (
    <section className="dev-section">
      <div className="dev-container">
        <header className="dev-section-header">
          <span className="dev-eyebrow dev-section-header__eyebrow">
            How it works
          </span>
          <h2 className="dev-h1">Four hops. No hallucinated APIs.</h2>
          <p className="dev-lead">
            Most "AI agent" demos break the moment the LLM has to interact
            with a real website. Onegent doesn't ask the LLM to drive
            Playwright — we drive Playwright, and the LLM hands us the
            booking intent through a typed REST or MCP call.
          </p>
        </header>

        <div className="dev-flow">
          <div className="dev-flow-row">
            {/* Horizontal connector */}
            <div className="dev-flow-track" aria-hidden="true" />

            {NODES.map((n, idx) => (
              <Fragment key={n.label}>
                <div className="dev-flow-node">
                  <div className="dev-flow-node-glyph">{n.glyph}</div>
                  <span className="dev-flow-node-meta">{n.meta}</span>
                  <span className="dev-flow-node-label">{n.label}</span>
                  <span className="dev-flow-node-desc">{n.desc}</span>
                </div>
                {/* Vertical connector — only shown on mobile (CSS gates this) */}
                {idx < NODES.length - 1 && (
                  <div className="dev-flow-track-vertical" aria-hidden="true" />
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Node glyphs ──────────────────────────────────────────────────────── */

function AgentGlyph() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 6h18v12H14l-5 4v-4H5V6z" />
      <circle cx="11" cy="12" r="0.8" fill="currentColor" />
      <circle cx="14" cy="12" r="0.8" fill="currentColor" />
      <circle cx="17" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

function ApiGlyph() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* curly braces */}
      <path d="M11 6c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3" />
      <path d="M17 6c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3" />
      <path d="M14 11v6" strokeOpacity="0.5" />
    </svg>
  );
}

function EngineGlyph() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* hexagonal core + branching connectors = engine / orchestrator */}
      <path d="M14 5l6 3.5v7L14 19l-6-3.5v-7L14 5z" />
      <circle cx="14" cy="12" r="2.5" />
      <path d="M14 5V2M14 19v3M20 8.5l3-1.5M5 7l3 1.5M20 15.5l3 1.5M5 17l3-1.5" strokeOpacity="0.5" />
    </svg>
  );
}

function SiteGlyph() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r="9" />
      <path d="M5 14h18M14 5c3 3 3 15 0 18M14 5c-3 3-3 15 0 18" />
    </svg>
  );
}
