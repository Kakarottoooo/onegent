"use client";

/**
 * /dev/profile-gap-demo
 *
 * Preview surface for <ProfileGapCard /> in 7 realistic missing-field combos.
 * Like /dev/timeline-demo this is a temporary developer-only route — delete
 * once the card is wired into the live chat flow.
 *
 * Beyond the bubble preview, this page also acts as a contract reference:
 *   - Schema legend (canonical 13 / legacy / optional / payment)
 *   - Live `missing[] → normalized` debug view
 *   - Live JSON payload preview of what `onSave` would POST to
 *     `/api/v1/travel-tasks/:id/continue`
 *
 * If a refactor of `components/profile-gap/` breaks the contract, this
 * page is the fastest place to spot it visually before tests fail.
 */

import { useMemo, useState } from "react";
import {
  CANONICAL_FIELD_IDS,
  FIELD_DEFINITIONS,
  ProfileGapCard,
  categoryOfField,
  listFieldsByCategory,
  normalizeMissingFields,
  partitionMissing,
} from "@/components/profile-gap";
import {
  FIXTURE_ORDER,
  FIXTURE_SCENARIOS,
} from "@/components/profile-gap/__fixtures";
import type {
  FieldCategory,
  GapFormValues,
  GapSavePayload,
  ProfileFieldId,
} from "@/components/profile-gap";

type ScenarioKey = (typeof FIXTURE_ORDER)[number];

type DemoMode = "idle" | "submitting" | "saved" | "error";

const CATEGORY_TONE: Record<FieldCategory, "good" | "ok" | "warn" | "bad"> = {
  canonical: "good",
  legacy: "warn",
  optional: "ok",
  payment: "bad",
};

const CATEGORY_DESCRIPTION: Record<FieldCategory, string> = {
  canonical:
    "Backend's `missing[]` may include this. Required path; renders inline.",
  legacy:
    "Legacy alias from older Track A code paths. Expanded to canonical fields at render time.",
  optional:
    "UI-only optional. Backend never includes it in `missing[]`; user can fill if they want.",
  payment:
    "Routed to PaymentRedirect, never inline-collected. Cards live in /permissions.",
};

export default function ProfileGapDemoPage() {
  const [scenario, setScenario] = useState<ScenarioKey>(FIXTURE_ORDER[0]);
  const [mode, setMode] = useState<DemoMode>("idle");
  const [lastPayload, setLastPayload] = useState<GapSavePayload | null>(null);

  const fixture = FIXTURE_SCENARIOS[scenario];
  const grouped = useMemo(() => listFieldsByCategory(), []);

  const normalized = useMemo(
    () => normalizeMissingFields(fixture.state.missing),
    [fixture.state.missing],
  );
  const partitioned = useMemo(() => partitionMissing(normalized), [normalized]);
  const expandedFromLegacy =
    fixture.state.missing.includes("full_name") &&
    !normalized.includes("full_name");

  // Simulated save handler. Pretends to hit an API: 700ms delay, 90% success.
  async function handleSave(payload: GapSavePayload) {
    await new Promise((r) => setTimeout(r, 700));
    if (Math.random() < 0.1) {
      throw new Error("Simulated network error — try again");
    }
    setLastPayload(payload);
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[profile-gap-demo] saved:", payload);
    }
  }

  const previewBody = useMemo(() => {
    // Show what the parent would POST to /api/v1/travel-tasks/:id/continue
    if (!lastPayload) return null;
    const body = { profile: stripBlankValues(lastPayload.values) };
    return JSON.stringify(body, null, 2);
  }, [lastPayload]);

  return (
    <div className="profile-gap-demo-page">
      {/* ─── Toolbars ───────────────────────────────────────── */}
      <nav className="profile-gap-demo-toolbar">
        <span className="profile-gap-demo-toolbar__label">Scenario</span>
        <div className="profile-gap-demo-toolbar__buttons">
          {FIXTURE_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setScenario(key);
                setMode("idle");
                setLastPayload(null);
              }}
              className={[
                "profile-gap-demo-toolbar__btn",
                scenario === key ? "profile-gap-demo-toolbar__btn--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {FIXTURE_SCENARIOS[key].label}
            </button>
          ))}
        </div>
      </nav>

      <nav className="profile-gap-demo-toolbar profile-gap-demo-toolbar--secondary">
        <span className="profile-gap-demo-toolbar__label">Force state</span>
        <div className="profile-gap-demo-toolbar__buttons">
          {(["idle", "submitting", "saved", "error"] as DemoMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "profile-gap-demo-toolbar__btn",
                "profile-gap-demo-toolbar__btn--small",
                mode === m ? "profile-gap-demo-toolbar__btn--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="profile-gap-demo-toolbar__hint">
          <code>idle</code> uses real local form state ·{" "}
          <code>submitting / saved / error</code> force UI variants
        </span>
      </nav>

      <main className="profile-gap-demo-stage">
        {/* ─── Bubble preview ─────────────────────────────── */}
        <div className="profile-gap-demo-col profile-gap-demo-col--bubble">
          <div className="profile-gap-demo-bubble">
            <p className="profile-gap-demo-bubble__assistant">Onegent · just now</p>
            <p className="profile-gap-demo-bubble__msg">
              Got it — I&apos;ll start booking, but first I need a couple of details:
            </p>
            <ProfileGapCard
              key={`${scenario}-${mode}`}
              state={fixture.state}
              onSave={handleSave}
              onDismiss={() => {
                setLastPayload(null);
                if (typeof console !== "undefined") {
                  // eslint-disable-next-line no-console
                  console.log("[profile-gap-demo] dismissed");
                }
              }}
              demo={mode === "idle" ? undefined : mode}
            />
          </div>
        </div>

        {/* ─── Contract sidebar ───────────────────────────── */}
        <aside className="profile-gap-demo-col profile-gap-demo-col--inspect">
          {/* Wire trace */}
          <section className="profile-gap-demo-section">
            <h3 className="profile-gap-demo-section__title">
              Wire trace · <code>missing[]</code> normalization
            </h3>
            <dl className="profile-gap-demo-trace">
              <dt>Backend sends</dt>
              <dd>
                <FieldArray ids={fixture.state.missing} />
              </dd>
              <dt>After normalize</dt>
              <dd>
                <FieldArray ids={normalized} />
                {expandedFromLegacy && (
                  <span className="profile-gap-demo-pill profile-gap-demo-pill--warn">
                    full_name expanded → first_name + last_name
                  </span>
                )}
              </dd>
              <dt>Inline render</dt>
              <dd>
                <FieldArray ids={partitioned.inline} />
              </dd>
              <dt>Payment redirect</dt>
              <dd>
                {partitioned.payment.length === 0 ? (
                  <span className="profile-gap-demo-muted">none</span>
                ) : (
                  <FieldArray ids={partitioned.payment} />
                )}
              </dd>
            </dl>
          </section>

          {/* JSON payload preview */}
          <section className="profile-gap-demo-section">
            <h3 className="profile-gap-demo-section__title">
              POST /api/v1/travel-tasks/:id/continue
            </h3>
            <p className="profile-gap-demo-section__sub">
              Body the parent would send after <code>onSave</code> resolves.
            </p>
            {previewBody ? (
              <pre className="profile-gap-demo-pre">
                <code>{previewBody}</code>
              </pre>
            ) : (
              <p className="profile-gap-demo-muted">
                Submit the form to see the live payload here.
              </p>
            )}
          </section>

          {/* Schema legend */}
          <section className="profile-gap-demo-section">
            <h3 className="profile-gap-demo-section__title">
              Field schema · 13 canonical + 1 legacy + 2 UI-only + 3 payment
            </h3>
            <p className="profile-gap-demo-section__sub">
              Source of truth: <code>CANONICAL_FIELD_IDS</code> mirrors codex&apos;s
              backend. Hover a chip to read the category contract.
            </p>
            {(["canonical", "legacy", "optional", "payment"] as FieldCategory[]).map(
              (cat) => (
                <div key={cat} className="profile-gap-demo-cat">
                  <header className="profile-gap-demo-cat__head">
                    <span
                      className={[
                        "profile-gap-demo-pill",
                        `profile-gap-demo-pill--${CATEGORY_TONE[cat]}`,
                      ].join(" ")}
                    >
                      {cat}
                    </span>
                    <span className="profile-gap-demo-cat__count">
                      {grouped[cat].length}{" "}
                      {grouped[cat].length === 1 ? "field" : "fields"}
                    </span>
                    <span className="profile-gap-demo-cat__desc">
                      {CATEGORY_DESCRIPTION[cat]}
                    </span>
                  </header>
                  <ul className="profile-gap-demo-cat__list">
                    {grouped[cat].map((id) => (
                      <li key={id}>
                        <code title={FIELD_DEFINITIONS[id].label}>{id}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </section>
        </aside>
      </main>

      <style jsx>{`
        .profile-gap-demo-page {
          min-height: 100vh;
          background: var(--bg);
          font-family: var(--font-dm-sans);
          padding-bottom: 80px;
        }

        .profile-gap-demo-toolbar {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 24px;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--ink-3);
          flex-wrap: wrap;
        }

        .profile-gap-demo-toolbar--secondary {
          top: 60px;
          z-index: 9;
          padding-top: 10px;
          padding-bottom: 10px;
          background: rgba(255, 255, 255, 0.85);
        }

        .profile-gap-demo-toolbar__label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-5);
        }

        .profile-gap-demo-toolbar__buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .profile-gap-demo-toolbar__btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid var(--ink-3);
          background: var(--card);
          color: var(--ink-7, var(--ink-6));
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease,
            border-color 120ms ease;
        }

        .profile-gap-demo-toolbar__btn--small {
          padding: 4px 10px;
          font-size: 11px;
        }

        .profile-gap-demo-toolbar__btn:hover {
          border-color: var(--ink-4, var(--ink-3));
          background: var(--card-2);
        }

        .profile-gap-demo-toolbar__btn--active {
          background: var(--ink-8);
          color: var(--bg);
          border-color: var(--ink-8);
        }

        .profile-gap-demo-toolbar__hint {
          margin-left: auto;
          font-size: 11px;
          color: var(--ink-5);
        }

        .profile-gap-demo-toolbar__hint code {
          color: var(--ink-7, var(--ink-6));
          font-family: ui-monospace, monospace;
          font-size: 10.5px;
          padding: 1px 4px;
          background: var(--card-2);
          border-radius: 3px;
        }

        /* ─── Two-column stage ─────────────────────────── */
        .profile-gap-demo-stage {
          display: grid;
          grid-template-columns: minmax(0, 560px) minmax(0, 480px);
          gap: 32px;
          padding: 32px 24px 0;
          max-width: 1200px;
          margin: 0 auto;
          align-items: start;
        }

        @media (max-width: 1080px) {
          .profile-gap-demo-stage {
            grid-template-columns: 1fr;
          }
        }

        .profile-gap-demo-col {
          min-width: 0;
        }

        .profile-gap-demo-bubble {
          padding: 18px 20px 20px;
          border-radius: 16px;
          background: var(--card);
          border: 1px solid var(--ink-3);
          box-shadow: var(--shadow-1);
        }

        .profile-gap-demo-bubble__assistant {
          margin: 0;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-5);
        }

        .profile-gap-demo-bubble__msg {
          margin: 6px 0 0 0;
          font-size: 14px;
          color: var(--ink-8);
          line-height: 1.5;
        }

        /* ─── Sidebar sections ─────────────────────────── */
        .profile-gap-demo-section {
          background: var(--card);
          border: 1px solid var(--ink-3);
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .profile-gap-demo-section__title {
          margin: 0;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--ink-8);
        }

        .profile-gap-demo-section__title code {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          background: var(--card-2);
          padding: 1px 5px;
          border-radius: 4px;
          color: var(--ink-7, var(--ink-6));
        }

        .profile-gap-demo-section__sub {
          margin: 0;
          font-size: 11.5px;
          color: var(--ink-6);
          line-height: 1.45;
        }

        .profile-gap-demo-section__sub code {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          background: var(--card-2);
          padding: 1px 5px;
          border-radius: 4px;
          color: var(--ink-7, var(--ink-6));
        }

        /* Wire trace */
        .profile-gap-demo-trace {
          margin: 0;
          display: grid;
          grid-template-columns: minmax(110px, max-content) 1fr;
          row-gap: 6px;
          column-gap: 12px;
          font-size: 12px;
        }

        .profile-gap-demo-trace dt {
          color: var(--ink-5);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
        }

        .profile-gap-demo-trace dd {
          margin: 0;
          color: var(--ink-8);
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
        }

        .profile-gap-demo-muted {
          color: var(--ink-5);
          font-style: italic;
          font-size: 11.5px;
        }

        /* Pre / payload */
        .profile-gap-demo-pre {
          margin: 0;
          padding: 10px 12px;
          background: var(--card-2);
          border: 1px solid var(--ink-3);
          border-radius: 6px;
          font-family: ui-monospace, monospace;
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--ink-8);
          overflow: auto;
          max-height: 240px;
        }

        /* Field-array chips */
        :global(.profile-gap-demo-field-chip) {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          border-radius: 4px;
          font-family: ui-monospace, monospace;
          font-size: 11px;
          font-weight: 500;
          background: var(--card-2);
          color: var(--ink-8);
          border: 1px solid var(--ink-3);
          cursor: help;
        }

        :global(.profile-gap-demo-field-chip--canonical) {
          border-color: rgba(22, 163, 74, 0.35);
          background: rgba(22, 163, 74, 0.08);
          color: #16a34a;
        }
        :global(.profile-gap-demo-field-chip--legacy) {
          border-color: rgba(245, 158, 11, 0.40);
          background: rgba(245, 158, 11, 0.10);
          color: #d97706;
        }
        :global(.profile-gap-demo-field-chip--optional) {
          border-color: rgba(14, 165, 233, 0.35);
          background: rgba(14, 165, 233, 0.08);
          color: #0284c7;
        }
        :global(.profile-gap-demo-field-chip--payment) {
          border-color: rgba(239, 68, 68, 0.35);
          background: rgba(239, 68, 68, 0.08);
          color: #dc2626;
        }

        /* Pills */
        .profile-gap-demo-pill {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          border: 1px solid;
        }

        .profile-gap-demo-pill--good {
          color: #16a34a;
          background: rgba(22, 163, 74, 0.10);
          border-color: rgba(22, 163, 74, 0.30);
        }
        .profile-gap-demo-pill--ok {
          color: #0284c7;
          background: rgba(14, 165, 233, 0.10);
          border-color: rgba(14, 165, 233, 0.30);
        }
        .profile-gap-demo-pill--warn {
          color: #d97706;
          background: rgba(245, 158, 11, 0.10);
          border-color: rgba(245, 158, 11, 0.40);
        }
        .profile-gap-demo-pill--bad {
          color: #dc2626;
          background: rgba(239, 68, 68, 0.10);
          border-color: rgba(239, 68, 68, 0.30);
        }

        /* Schema legend categories */
        .profile-gap-demo-cat {
          padding: 10px 12px;
          background: var(--card-2);
          border-radius: 8px;
          border: 1px solid var(--ink-3);
        }

        .profile-gap-demo-cat__head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }

        .profile-gap-demo-cat__count {
          font-size: 11px;
          color: var(--ink-6);
          font-weight: 600;
        }

        .profile-gap-demo-cat__desc {
          font-size: 11px;
          color: var(--ink-6);
          flex-basis: 100%;
          line-height: 1.4;
        }

        .profile-gap-demo-cat__list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .profile-gap-demo-cat__list code {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          padding: 2px 6px;
          background: var(--card);
          border: 1px solid var(--ink-3);
          border-radius: 4px;
          color: var(--ink-8);
          cursor: help;
        }
      `}</style>
    </div>
  );
}

/* ─── Field-array chip strip ────────────────────────────────────── */

function FieldArray({ ids }: { ids: ProfileFieldId[] }) {
  if (ids.length === 0) {
    return <span className="profile-gap-demo-muted">[]</span>;
  }
  return (
    <>
      {ids.map((id) => {
        const cat = categoryOfField(id);
        return (
          <span
            key={id}
            className={[
              "profile-gap-demo-field-chip",
              `profile-gap-demo-field-chip--${cat}`,
            ].join(" ")}
            title={`${cat} · ${FIELD_DEFINITIONS[id].label}`}
          >
            {id}
          </span>
        );
      })}
    </>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function stripBlankValues(values: GapFormValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(values) as ProfileFieldId[]) {
    const v = values[k];
    if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

// Imported but kept as a static reference so editors highlight the contract:
void CANONICAL_FIELD_IDS;
