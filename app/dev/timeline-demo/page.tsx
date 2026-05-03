"use client";

/**
 * Temporary developer-facing route for previewing
 * <TaskTimelinePanel /> in all 5 demo states + the empty fallback.
 *
 * URL: /dev/timeline-demo
 *
 * This file is intended to be deleted after Track A's ExecutorV2 SSE
 * lands and the production cutover (Stage 5) is complete. Until then it
 * gives the team a way to iterate on the panel's visuals without
 * needing a real booking job.
 *
 * Not gated behind any flag — the path is `/dev/*` to make intent clear.
 * If we ever ship publicly with this route still in place, wrap with a
 * NODE_ENV check OR move under a feature flag.
 */

import { useState } from "react";
import "../../tasks/tasks.css";
import { TaskTimelinePanel } from "@/components/task-timeline";

const DEMO_STATES = [
  { id: "running", label: "Running" },
  { id: "needs_otp", label: "Needs OTP" },
  { id: "ready_for_confirmation", label: "Ready" },
  { id: "no_availability", label: "No availability" },
  { id: "failed", label: "Failed" },
  { id: "empty", label: "Empty" },
] as const;

type DemoId = (typeof DEMO_STATES)[number]["id"];

export default function TimelineDemoPage() {
  const [demo, setDemo] = useState<DemoId>("running");

  return (
    <div className="timeline-demo-page">
      {/* ── Top toolbar (state switcher) ─────────────────────────────── */}
      <nav className="timeline-demo-toolbar">
        <span className="timeline-demo-toolbar__label">Demo state</span>
        <div className="timeline-demo-toolbar__buttons">
          {DEMO_STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDemo(s.id)}
              className={[
                "timeline-demo-toolbar__btn",
                demo === s.id ? "timeline-demo-toolbar__btn--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="timeline-demo-toolbar__hint">
          Adjust visuals by editing <code>components/task-timeline/**</code>
        </span>
      </nav>

      {/* ── Panel host: replicates production slide-over geometry ────── */}
      <div className="timeline-demo-stage">
        <div className="timeline-demo-stage__panel">
          {/* `key` forces a clean unmount when the demo state flips so any
              stateful animations / scroll positions reset. */}
          <TaskTimelinePanel
            key={demo}
            jobId={null}
            demo={demo}
            onClose={() => {
              // No-op in demo mode. We log instead of alerting so it doesn't
              // interrupt visual iteration.
              if (typeof console !== "undefined") {
                console.log(`[timeline-demo] Close clicked (state=${demo})`);
              }
            }}
          />
        </div>
      </div>

      {/* ── Inline page-only styles (avoid polluting tasks.css) ──────── */}
      <style>{`
        .timeline-demo-page {
          min-height: 100vh;
          background: #050505;
          color: rgba(255, 255, 255, 0.92);
          font-family: var(--font-dm-sans);
        }

        .timeline-demo-toolbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 12px 24px;
          background: rgba(10, 10, 10, 0.92);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
        }

        .timeline-demo-toolbar__label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.5);
        }

        .timeline-demo-toolbar__buttons {
          display: flex;
          gap: 6px;
        }

        .timeline-demo-toolbar__btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: none;
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.85);
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }

        .timeline-demo-toolbar__btn:hover {
          background: rgba(255, 255, 255, 0.14);
        }

        .timeline-demo-toolbar__btn--active {
          background: #fff;
          color: #050505;
        }

        .timeline-demo-toolbar__btn--active:hover {
          background: #f5f5f5;
        }

        .timeline-demo-toolbar__hint {
          margin-left: auto;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.32);
        }

        .timeline-demo-toolbar__hint code {
          color: rgba(255, 255, 255, 0.55);
          font-family: ui-monospace, monospace;
          font-size: 10.5px;
          padding: 1px 4px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 3px;
        }

        .timeline-demo-stage {
          position: fixed;
          top: 56px;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          justify-content: flex-end;
          background:
            radial-gradient(
              circle at 30% 50%,
              rgba(96, 165, 250, 0.05) 0%,
              transparent 50%
            ),
            #050505;
        }

        .timeline-demo-stage__panel {
          width: min(960px, 80vw);
          height: 100%;
          box-shadow: -6px 0 32px rgba(0, 0, 0, 0.6);
          border-left: 0.5px solid rgba(255, 255, 255, 0.08);
        }

        @media (max-width: 800px) {
          .timeline-demo-stage__panel {
            width: 100%;
          }
          .timeline-demo-toolbar__hint {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
