"use client";

/**
 * CaseDetailDrawer — slide-in panel showing the full record for one
 * benchmark case.
 *
 * Per `PHASE0_REPORT_CONTRACT.md`, links out to:
 *   - `timelineUrl` (codex pre-computes; falls back to /api/v1/travel-tasks/:id/timeline-events)
 *   - `snapshotsUrl` (same)
 *   - `/tasks/:taskId` so we can inspect the live timeline UI
 */

import { useEffect } from "react";
import {
  BUCKET_LABEL,
  BUCKET_TONE,
  TAXONOMY_LABEL,
  formatDuration,
  isSevereTaxonomy,
  type Phase0BenchmarkCaseResult,
} from "./types";

interface Props {
  caseResult: Phase0BenchmarkCaseResult | null;
  onClose: () => void;
}

export default function CaseDetailDrawer({ caseResult, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!caseResult) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [caseResult, onClose]);

  if (!caseResult) return null;

  const c = caseResult;
  const severe =
    c.taxonomyCode !== undefined && isSevereTaxonomy(c.taxonomyCode);

  return (
    <>
      <div className="benchmark-drawer__scrim" onClick={onClose} aria-hidden />
      <aside
        className={[
          "benchmark-drawer",
          severe ? "benchmark-drawer--severe" : "",
        ].join(" ")}
        aria-label={`Case ${c.caseId} detail`}
        role="dialog"
      >
        <header className="benchmark-drawer__head">
          <div>
            <p className="benchmark-drawer__eyebrow">
              {c.caseId}
              {c.state ? <> · {c.state}</> : null}
            </p>
            <h2 className="benchmark-drawer__title">{c.prompt}</h2>
          </div>
          <button
            type="button"
            className="benchmark-drawer__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="benchmark-drawer__body">
          {/* Outcome */}
          <section className="benchmark-drawer__section">
            <h3 className="benchmark-drawer__section-title">Outcome</h3>
            <div className="benchmark-drawer__outcome">
              <span
                className={[
                  "benchmark-drawer__bucket",
                  `benchmark-drawer__bucket--${BUCKET_TONE[c.outcome]}`,
                ].join(" ")}
              >
                {BUCKET_LABEL[c.outcome]}
              </span>
              {c.taxonomyCode && (
                <span
                  className={[
                    "benchmark-drawer__tag",
                    severe ? "benchmark-drawer__tag--severe" : "",
                  ].join(" ")}
                  title={TAXONOMY_LABEL[c.taxonomyCode] ?? c.taxonomyCode}
                >
                  {c.taxonomyCode}
                </span>
              )}
            </div>
            {c.terminalReason && (
              <p className="benchmark-drawer__reason">{c.terminalReason}</p>
            )}
            {severe && (
              <p className="benchmark-drawer__severe-warn">
                ⚠ Severe taxonomy code — counts toward Phase 0 disqualifying threshold.
              </p>
            )}
          </section>

          {/* Expectations */}
          <section className="benchmark-drawer__section">
            <h3 className="benchmark-drawer__section-title">
              Match against expectations
            </h3>
            <dl className="benchmark-drawer__dl">
              <dt>Expected outcomes</dt>
              <dd>
                {c.expectedOutcomes.length === 0
                  ? "—"
                  : c.expectedOutcomes.map((o) => (
                      <span key={o} className="benchmark-drawer__chip">
                        {BUCKET_LABEL[o]}
                      </span>
                    ))}
              </dd>
              <dt>Outcome matched?</dt>
              <dd>{c.expectedOutcomeMatched ? "Yes" : "No"}</dd>
              <dt>Acceptable taxonomy</dt>
              <dd>
                {c.acceptableFailureTaxonomy.length === 0
                  ? "—"
                  : c.acceptableFailureTaxonomy.map((code) => (
                      <span key={code} className="benchmark-drawer__chip">
                        {code}
                      </span>
                    ))}
              </dd>
              <dt>Taxonomy accepted?</dt>
              <dd>{c.taxonomyAccepted ? "Yes" : "No"}</dd>
            </dl>
          </section>

          {/* Bucket flags */}
          <section className="benchmark-drawer__section">
            <h3 className="benchmark-drawer__section-title">Bucket flags</h3>
            <dl className="benchmark-drawer__dl">
              <dt>Booking ready</dt>
              <dd>{c.bookingReady ? "Yes" : "No"}</dd>
              <dt>Safe</dt>
              <dd>{c.safe ? "Yes" : "No"}</dd>
              <dt>Severe</dt>
              <dd>{c.severe ? "Yes" : "No"}</dd>
            </dl>
          </section>

          {/* Run timing + ids */}
          <section className="benchmark-drawer__section">
            <h3 className="benchmark-drawer__section-title">Run + identity</h3>
            <dl className="benchmark-drawer__dl">
              <dt>Duration</dt>
              <dd>{formatDuration(c.durationMs)}</dd>
              {c.terminalCode && (
                <>
                  <dt>Terminal code</dt>
                  <dd>
                    <code>{c.terminalCode}</code>
                  </dd>
                </>
              )}
              {c.taskId && (
                <>
                  <dt>Task ID</dt>
                  <dd>
                    <code>{c.taskId}</code>
                  </dd>
                </>
              )}
              {c.currentJobId && (
                <>
                  <dt>Current job ID</dt>
                  <dd>
                    <code>{c.currentJobId}</code>
                  </dd>
                </>
              )}
            </dl>
          </section>

          {c.error && (
            <section className="benchmark-drawer__section">
              <h3 className="benchmark-drawer__section-title">Error</h3>
              <pre className="benchmark-drawer__error">{c.error}</pre>
            </section>
          )}

          {/* Drill-down links */}
          <section className="benchmark-drawer__section benchmark-drawer__links">
            {c.taskId && (
              <a
                className="benchmark-drawer__task-link"
                href={`/tasks/${c.taskId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open /tasks/{c.taskId} ↗
              </a>
            )}
            {c.timelineUrl && (
              <a
                className="benchmark-drawer__task-link"
                href={c.timelineUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Timeline events JSON ↗
              </a>
            )}
            {c.snapshotsUrl && (
              <a
                className="benchmark-drawer__task-link"
                href={c.snapshotsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Snapshots JSON ↗
              </a>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
