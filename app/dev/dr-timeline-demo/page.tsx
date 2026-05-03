"use client";

/**
 * /dev/dr-timeline-demo
 *
 * Preview surface for <DRTimelineList />. Shows the same component over
 * 6 fixture snapshots representing a full DR lifecycle: just-created →
 * collecting → voting → accepted → completed → empty.
 *
 * Like /dev/timeline-demo, this is a temporary developer route. Delete
 * once the timeline is wired into app/rooms/[id]/page.tsx.
 */

import { useMemo, useState } from "react";
import { DRTimelineList, deriveDREventsFromSnapshot } from "@/components/dr-timeline";
import {
  FIXTURE_INPUTS,
  FIXTURE_ORDER,
} from "@/components/dr-timeline/__fixtures";

type FixtureKey = (typeof FIXTURE_ORDER)[number];

export default function DRTimelineDemoPage() {
  const [scenario, setScenario] = useState<FixtureKey>(FIXTURE_ORDER[0]);
  const [forceLoading, setForceLoading] = useState(false);

  const fixture = FIXTURE_INPUTS[scenario];
  const events = useMemo(
    () => deriveDREventsFromSnapshot(fixture.input),
    [fixture],
  );

  return (
    <div className="dr-demo-page">
      <nav className="dr-demo-toolbar">
        <span className="dr-demo-toolbar__label">Lifecycle stage</span>
        <div className="dr-demo-toolbar__buttons">
          {FIXTURE_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setScenario(key);
                setForceLoading(false);
              }}
              className={[
                "dr-demo-toolbar__btn",
                scenario === key ? "dr-demo-toolbar__btn--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {FIXTURE_INPUTS[key].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setForceLoading((v) => !v)}
          className={[
            "dr-demo-toolbar__btn",
            "dr-demo-toolbar__btn--secondary",
            forceLoading ? "dr-demo-toolbar__btn--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {forceLoading ? "Loading on" : "Force loading"}
        </button>
      </nav>

      <main className="dr-demo-stage">
        <div className="dr-demo-room-shell">
          {/* Mimics the existing room detail layout — gives the timeline
              real-world context (header, members strip, etc.) so we can
              eyeball whether it visually fits. */}
          <header className="dr-demo-room-shell__header">
            <p className="dr-demo-room-shell__eyebrow">Decision Room · demo</p>
            <h1 className="dr-demo-room-shell__title">
              {fixture.input.room.title ?? "Untitled room"}
            </h1>
            <div className="dr-demo-room-shell__meta">
              <span>{fixture.input.members.length} members</span>
              <span aria-hidden>·</span>
              <span>Status: {fixture.input.room.status}</span>
            </div>
          </header>

          <DRTimelineList
            events={forceLoading ? [] : events}
            loading={forceLoading}
            subtitle={`${events.length} ${events.length === 1 ? "event" : "events"}`}
          />
        </div>
      </main>

      <style>{`
        .dr-demo-page {
          min-height: 100vh;
          background: var(--bg);
          font-family: var(--font-dm-sans);
          padding-bottom: 80px;
        }

        .dr-demo-toolbar {
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
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }

        .dr-demo-toolbar__label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .dr-demo-toolbar__buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .dr-demo-toolbar__btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text-primary);
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }

        .dr-demo-toolbar__btn:hover {
          border-color: var(--gold, var(--text-secondary));
          background: var(--card-2);
        }

        .dr-demo-toolbar__btn--active {
          background: var(--text-primary);
          color: var(--bg);
          border-color: var(--text-primary);
        }

        .dr-demo-toolbar__btn--secondary {
          margin-left: auto;
        }

        .dr-demo-stage {
          display: flex;
          justify-content: center;
          padding: 32px 24px 0;
        }

        .dr-demo-room-shell {
          width: min(680px, 100%);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .dr-demo-room-shell__header {
          padding: 18px 20px;
          border-radius: 16px;
          background: var(--card);
          border: 1px solid var(--border);
        }

        .dr-demo-room-shell__eyebrow {
          margin: 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .dr-demo-room-shell__title {
          margin: 6px 0 0 0;
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.005em;
          line-height: 1.3;
        }

        .dr-demo-room-shell__meta {
          margin-top: 6px;
          display: flex;
          gap: 8px;
          align-items: center;
          font-size: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
