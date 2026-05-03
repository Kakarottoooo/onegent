"use client";

/**
 * /dev/path-b-demo — Phase 1 #7 Path B fixture explorer.
 *
 * No-token UI sandbox for the inline ProfileGapCard flow. Exercises the
 * three production states without hitting any real API:
 *
 *   1. **missing**   — backend emits payload.profile_gap, card renders,
 *                       form is empty, Save disabled until user fills.
 *   2. **success**    — same as 1 but on Save the in-memory deps return
 *                       success → "booking resumed" message rendered.
 *   3. **failure**    — same as 1 but on Save the dispatch returns false
 *                       → card stays, no booking resume, error bubble
 *                       inline.
 *
 * Uses the SAME `decideProfileGap` + `makeProfileGapOnSave` helpers
 * production uses. That's the point — if a production bug exists in the
 * decision tree or save-chain wiring, this demo shows it too.
 *
 * Codex's hardening brief (2026-05-03) requested this so a no-token
 * Playwright smoke can flip through fixtures and assert each state
 * renders correctly.
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { ProfileGapCard } from "@/components/profile-gap";
import {
  commitResponseToDecisionInput,
  decideProfileGap,
  type ProfileGapDecision,
} from "@/lib/profile-gap-decision";
import {
  makeProfileGapOnSave,
  type RefetchedBookingProfile,
} from "@/lib/profile-gap-on-save";
import type { CommitResponse } from "@/components/ConfirmCard";
import type { NeedsProfileDataPayload } from "@/lib/core/execution/types";

/* ─── Fixtures ───────────────────────────────────────────────────── */

type DemoState = "missing" | "success" | "failure";

const FIXTURE_BACKEND_GAP: NeedsProfileDataPayload = {
  kind: "needs_profile_data",
  scenario: "restaurant",
  missing: ["first_name", "last_name", "email", "phone"],
  message:
    "Carbone needs your contact details to confirm — they verify guests with the phone you book on.",
};

const FIXTURE_PAYLOAD: CommitResponse = {
  ok: true,
  kind: "direct_booking",
  venue_name: "Carbone",
  scenario: "restaurant",
  profile_gap: FIXTURE_BACKEND_GAP,
};

const FIXTURE_FRESH_PROFILE: RefetchedBookingProfile = {
  id: 999,
  first_name: "Demo",
  last_name: "User",
  email: "demo@onegent.dev",
  phone: "+15555550100",
};

/* ─── In-memory event log (replaces chat for demo) ────────────────── */

interface LogEntry {
  id: number;
  kind: "info" | "patch" | "booking" | "error";
  text: string;
}

/* ─── Page ───────────────────────────────────────────────────────── */

export default function PathBDemoPage() {
  const [state, setState] = useState<DemoState>("missing");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logSeq, setLogSeq] = useState(0);

  const append = useCallback(
    (kind: LogEntry["kind"], text: string) => {
      setLog((prev) => [...prev, { id: logSeq + 1, kind, text }]);
      setLogSeq((n) => n + 1);
    },
    [logSeq],
  );

  const reset = useCallback(() => {
    setLog([]);
    setLogSeq(0);
  }, []);

  // The decision is stable across the 3 states — backend gap is always
  // present in the fixture. What changes is the dispatcher's behavior
  // (success vs failure) for the save chain.
  const decision: ProfileGapDecision = decideProfileGap(
    commitResponseToDecisionInput({
      payload: FIXTURE_PAYLOAD,
      legacyMissing: [],
      profileExists: true,
      useInlineGate: true,
      cardIdFactory: () => `demo-card-${state}`,
    }),
  );

  // Build a fake dispatcher per state. In production this is path A's
  // dispatchProfilePatch which hits PATCH /api/v1/users/me/profile.
  const fakeDispatch = useCallback(
    async (patch: unknown): Promise<boolean> => {
      append("patch", `PATCH /api/v1/users/me/profile { profile: ${JSON.stringify(patch)} }`);
      if (state === "failure") {
        append(
          "error",
          "Hmm, email: Enter a valid email. Try again? (simulated 400)",
        );
        return false;
      }
      append("info", "PATCH 200 OK (simulated)");
      return true;
    },
    [append, state],
  );

  const fakeRefetch = useCallback(
    async (): Promise<RefetchedBookingProfile | null> => {
      append("info", "GET /api/user/booking-profiles?default=true (simulated)");
      return FIXTURE_FRESH_PROFILE;
    },
    [append],
  );

  const fakeStartBooking = useCallback(
    async (payload: CommitResponse): Promise<void> => {
      append(
        "booking",
        `▶ startDirectBookingWithProfile(${payload.venue_name}, freshProfile id=${FIXTURE_FRESH_PROFILE.id})`,
      );
    },
    [append],
  );

  const onSave =
    decision.kind === "inline"
      ? makeProfileGapOnSave({
          dispatchProfilePatch: fakeDispatch,
          refetchProfile: fakeRefetch,
          startBooking: fakeStartBooking,
          notify: (msg: string) => append("info", msg),
          pendingPayload: FIXTURE_PAYLOAD,
        })
      : undefined;

  const setStateAndReset = (next: DemoState) => {
    setState(next);
    reset();
  };

  return (
    <main className="path-b-demo">
      <header className="path-b-demo__top">
        <p className="path-b-demo__crumb">
          <Link href="/dev">← /dev</Link>
        </p>
        <h1 className="path-b-demo__title">Path B fixture explorer</h1>
        <p className="path-b-demo__sub">
          No-token sandbox for{" "}
          <code>decideProfileGap</code> + <code>makeProfileGapOnSave</code>.
          Toggle the 3 states; the form on the left uses the same helpers
          production uses.
        </p>
      </header>

      <section className="path-b-demo__states">
        <button
          type="button"
          onClick={() => setStateAndReset("missing")}
          className={
            state === "missing"
              ? "path-b-demo__chip path-b-demo__chip--active"
              : "path-b-demo__chip"
          }
        >
          1. Missing fields
        </button>
        <button
          type="button"
          onClick={() => setStateAndReset("success")}
          className={
            state === "success"
              ? "path-b-demo__chip path-b-demo__chip--active"
              : "path-b-demo__chip"
          }
        >
          2. Save succeeds → booking resumed
        </button>
        <button
          type="button"
          onClick={() => setStateAndReset("failure")}
          className={
            state === "failure"
              ? "path-b-demo__chip path-b-demo__chip--active"
              : "path-b-demo__chip"
          }
        >
          3. Save fails → no booking resume
        </button>
      </section>

      <section className="path-b-demo__panes">
        <div className="path-b-demo__pane">
          <h2 className="path-b-demo__pane-title">ProfileGapCard render</h2>
          {decision.kind === "inline" && onSave && (
            <ProfileGapCard
              state={decision.gapState}
              onSave={onSave}
            />
          )}
          {decision.kind !== "inline" && (
            <p className="path-b-demo__placeholder">
              decision.kind = <code>{decision.kind}</code> — fixture should
              always produce inline; check fixture wiring.
            </p>
          )}
        </div>

        <div className="path-b-demo__pane">
          <h2 className="path-b-demo__pane-title">Event log</h2>
          {log.length === 0 && (
            <p className="path-b-demo__placeholder">
              No events yet. Fill the form on the left and click Save.
            </p>
          )}
          <ol className="path-b-demo__log">
            {log.map((entry) => (
              <li
                key={entry.id}
                className={`path-b-demo__log-item path-b-demo__log-item--${entry.kind}`}
              >
                <span className="path-b-demo__log-kind">[{entry.kind}]</span>
                <span className="path-b-demo__log-text">{entry.text}</span>
              </li>
            ))}
          </ol>
          {log.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="path-b-demo__reset"
            >
              Clear log
            </button>
          )}
        </div>
      </section>

      <section className="path-b-demo__expectations">
        <h2 className="path-b-demo__pane-title">Expected behavior</h2>
        <ul className="path-b-demo__bullets">
          <li>
            <strong>1. Missing fields</strong>: card renders; Save button
            disabled until at least one field has a value.
          </li>
          <li>
            <strong>2. Save succeeds</strong>: PATCH (simulated 200) →
            refetch → <code>startDirectBookingWithProfile</code> fires.
            Log shows <code>[patch]</code> → <code>[info]</code> →{" "}
            <code>[booking]</code>.
          </li>
          <li>
            <strong>3. Save fails</strong>: PATCH (simulated 400) → onSave
            throws → ProfileGapCard shows save-failed state →{" "}
            <em>booking is NOT resumed</em>. Log shows <code>[patch]</code>{" "}
            → <code>[error]</code> only.
          </li>
        </ul>
      </section>

      <PathBDemoStyles />
    </main>
  );
}

function PathBDemoStyles() {
  return (
    <style jsx global>{`
      .path-b-demo {
        max-width: 1100px;
        margin: 0 auto;
        padding: 32px 24px 64px;
        font-family: var(--font-dm-sans, system-ui);
        color: var(--text-primary, #f5f1e8);
      }
      .path-b-demo__top {
        margin-bottom: 24px;
      }
      .path-b-demo__crumb a {
        color: var(--text-secondary, #a89c8a);
        text-decoration: none;
        font-size: 13px;
      }
      .path-b-demo__crumb a:hover {
        color: var(--text-primary, #f5f1e8);
      }
      .path-b-demo__title {
        font-size: 28px;
        font-weight: 700;
        margin: 8px 0 4px;
      }
      .path-b-demo__sub {
        color: var(--text-secondary, #a89c8a);
        font-size: 14px;
        margin: 0;
        max-width: 720px;
      }
      .path-b-demo__states {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 24px 0;
      }
      .path-b-demo__chip {
        background: var(--card, #1f1d1a);
        border: 0.5px solid var(--border, #3a332a);
        color: var(--text-primary, #f5f1e8);
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
      }
      .path-b-demo__chip:hover {
        background: var(--card-hover, #2a2622);
      }
      .path-b-demo__chip--active {
        background: var(--accent, #d97757);
        border-color: var(--accent, #d97757);
        color: #fff;
      }
      .path-b-demo__panes {
        display: grid;
        grid-template-columns: minmax(300px, 1fr) minmax(300px, 1fr);
        gap: 24px;
        margin-bottom: 32px;
      }
      @media (max-width: 800px) {
        .path-b-demo__panes {
          grid-template-columns: 1fr;
        }
      }
      .path-b-demo__pane {
        background: var(--card, #1f1d1a);
        border: 0.5px solid var(--border, #3a332a);
        border-radius: 12px;
        padding: 20px;
      }
      .path-b-demo__pane-title {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 12px;
        color: var(--text-secondary, #a89c8a);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .path-b-demo__placeholder {
        color: var(--text-secondary, #a89c8a);
        font-size: 13px;
        font-style: italic;
        margin: 0;
      }
      .path-b-demo__log {
        list-style: none;
        padding: 0;
        margin: 0;
        font-family: var(--font-mono, ui-monospace, "SF Mono", Menlo, monospace);
        font-size: 12px;
        line-height: 1.5;
      }
      .path-b-demo__log-item {
        display: flex;
        gap: 8px;
        padding: 6px 0;
        border-top: 0.5px solid rgba(255, 255, 255, 0.05);
      }
      .path-b-demo__log-item:first-child {
        border-top: none;
      }
      .path-b-demo__log-kind {
        font-weight: 600;
        flex-shrink: 0;
        min-width: 60px;
      }
      .path-b-demo__log-item--info .path-b-demo__log-kind {
        color: #6ea8fe;
      }
      .path-b-demo__log-item--patch .path-b-demo__log-kind {
        color: #d97757;
      }
      .path-b-demo__log-item--booking .path-b-demo__log-kind {
        color: #6cd07f;
      }
      .path-b-demo__log-item--error .path-b-demo__log-kind {
        color: #f86d6d;
      }
      .path-b-demo__log-text {
        word-break: break-word;
      }
      .path-b-demo__reset {
        margin-top: 12px;
        background: none;
        border: 0.5px solid var(--border, #3a332a);
        color: var(--text-secondary, #a89c8a);
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .path-b-demo__reset:hover {
        color: var(--text-primary, #f5f1e8);
      }
      .path-b-demo__expectations {
        background: var(--card, #1f1d1a);
        border: 0.5px solid var(--border, #3a332a);
        border-radius: 12px;
        padding: 20px;
      }
      .path-b-demo__bullets {
        margin: 0;
        padding-left: 20px;
        font-size: 14px;
        line-height: 1.6;
      }
      .path-b-demo__bullets li {
        margin-bottom: 8px;
      }
      .path-b-demo__bullets code {
        background: rgba(255, 255, 255, 0.05);
        padding: 2px 5px;
        border-radius: 4px;
        font-size: 12px;
      }
    `}</style>
  );
}
