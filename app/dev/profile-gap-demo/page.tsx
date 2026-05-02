"use client";

/**
 * /dev/profile-gap-demo
 *
 * Preview surface for <ProfileGapCard /> in 6 realistic missing-field combos.
 * Like /dev/timeline-demo this is a temporary developer-only route — delete
 * once the card is wired into the live chat flow (Track A's profile-gap
 * status response will be the wiring trigger).
 */

import { useState } from "react";
import { ProfileGapCard } from "@/components/profile-gap";
import {
  FIXTURE_ORDER,
  FIXTURE_SCENARIOS,
} from "@/components/profile-gap/__fixtures";
import type { GapSavePayload } from "@/components/profile-gap";

type ScenarioKey = (typeof FIXTURE_ORDER)[number];

type DemoMode = "idle" | "submitting" | "saved" | "error";

export default function ProfileGapDemoPage() {
  const [scenario, setScenario] = useState<ScenarioKey>(FIXTURE_ORDER[0]);
  const [mode, setMode] = useState<DemoMode>("idle");

  const fixture = FIXTURE_SCENARIOS[scenario];

  // Simulated save handler. Pretends to hit an API: 700ms delay, 90% success.
  async function handleSave(payload: GapSavePayload) {
    await new Promise((r) => setTimeout(r, 700));
    if (Math.random() < 0.1) {
      throw new Error("Simulated network error — try again");
    }
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[profile-gap-demo] saved:", payload);
    }
  }

  return (
    <div className="profile-gap-demo-page">
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
        <div className="profile-gap-demo-bubble">
          <p className="profile-gap-demo-bubble__assistant">
            Onegent · just now
          </p>
          <p className="profile-gap-demo-bubble__msg">
            Got it — I'll start booking, but first I need a couple of details:
          </p>
          {/* `key` forces clean unmount when scenario / mode flips */}
          <ProfileGapCard
            key={`${scenario}-${mode}`}
            state={fixture.state}
            onSave={handleSave}
            onDismiss={() => {
              if (typeof console !== "undefined") {
                // eslint-disable-next-line no-console
                console.log("[profile-gap-demo] dismissed");
              }
            }}
            demo={mode === "idle" ? undefined : mode}
          />
        </div>
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

        .profile-gap-demo-stage {
          display: flex;
          justify-content: center;
          padding: 40px 24px 0;
        }

        .profile-gap-demo-bubble {
          width: min(560px, 100%);
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
      `}</style>
    </div>
  );
}
