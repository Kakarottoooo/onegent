"use client";

import { useState, useEffect, useRef } from "react";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import {
  computeJobSemanticStatus,
  computeStepSemanticStatus,
  isActiveJobStatus,
  JOB_SEMANTIC_DISPLAY,
  STEP_SEMANTIC_DISPLAY,
} from "@/lib/status";
import { taskDetailsHref, taskEvidenceAction } from "@/lib/booking-jobs/workspace";
import { getProviderEventChoiceActionItem } from "@/lib/booking-jobs/provider-choice";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ${diffMin % 60}m ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stepStatusColor(step: BookingJobStep): string {
  if (step.status === "awaiting_confirmation" && !getProviderEventChoiceActionItem(step)) {
    return "rgba(22,163,74,0.85)";
  }
  const sem = computeStepSemanticStatus(step);
  return STEP_SEMANTIC_DISPLAY[sem].color;
}

function stepStatusIcon(step: BookingJobStep): string {
  const sem = computeStepSemanticStatus(step);
  if (sem === "succeeded_first_try") return "✓";
  if (sem === "succeeded_with_adjustment") return "↻";
  if (sem === "running") return "…";
  if (sem === "blocked_needs_input" || sem === "failed_terminal") return "!";
  if (sem === "failed_recoverable") return "✗";
  if (sem === "retrying") return "↺";
  return "○";
}

function stepStatusLabel(step: BookingJobStep): string {
  if (step.status === "done") {
    if (step.timeAdjusted) return "Pre-filled (time adjusted)";
    if (step.usedFallback) return "Pre-filled (alternative venue)";
    return "Pre-filled — ready to pay";
  }
  if (step.retryScheduledFor) return "Retry scheduled";
  if (getProviderEventChoiceActionItem(step)) return "Needs your choice";
  if (step.status === "awaiting_confirmation") return "Ready to review — confirm on site";
  if (step.status === "loading") return "Agent working…";
  if (step.status === "no_availability") return "No availability found";
  if (step.status === "error") {
    // Worker maps both "captcha" and "needs_login" → step.status="error", but
    // those are recoverable via the live view (user solves the challenge,
    // logs in). Surface that distinction so the card doesn't read as a
    // dead-end "Failed" when it's actually "needs you for 30 seconds".
    const err = (step.error ?? "").toLowerCase();
    if (
      err.includes("captcha") ||
      err.includes("verification") ||
      err.includes("bot protection") ||
      err.includes("challenge")
    ) {
      return "Needs verification — open live view";
    }
    if (err.includes("sign in") || err.includes("log in") || err.includes("login")) {
      return "Needs sign-in — open live view";
    }
    return "Failed";
  }
  return "Waiting";
}

const TRAVEL_DOC_KEYWORDS = ["passport", "travel document", "date of birth"];

export function isTravelDocError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return TRAVEL_DOC_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── StepCard ──────────────────────────────────────────────────────────────────

function InlineStepCard({
  step,
  choiceSubmitting,
  onProviderEventChoiceOption,
}: {
  step: BookingJobStep;
  choiceSubmitting?: string | null;
  onProviderEventChoiceOption?: (label: string) => void;
}) {
  const color = stepStatusColor(step);
  const actionItem = getProviderEventChoiceActionItem(step);

  return (
    <div style={{
      borderRadius: 10,
      border: `0.5px solid ${step.status === "done" ? "rgba(22,163,74,0.2)" : step.status === "error" ? "rgba(220,38,38,0.2)" : "var(--border,#e5e7eb)"}`,
      backgroundColor: step.status === "done" ? "rgba(22,163,74,0.03)" : "var(--card-2,#f9f9f9)",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
        <div style={{
          flexShrink: 0, width: 20, height: 20, borderRadius: "50%",
          backgroundColor: color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, marginTop: 1,
          animation: step.status === "loading" ? "jobpulse 1.2s ease-in-out infinite" : "none",
        }}>
          {stepStatusIcon(step)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14 }}>{step.emoji}</span>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600, margin: 0 }}>
              {step.label}
            </p>
          </div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color, margin: "2px 0 0" }}>
            {stepStatusLabel(step)}
          </p>
          {step.status === "error" && step.error && (
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, marginTop: 3, color: "rgba(220,38,38,0.75)", lineHeight: 1.4 }}>
              {step.error.length > 120 ? step.error.slice(0, 120) + "…" : step.error}
            </p>
          )}
          {actionItem?.message && (
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, marginTop: 4, color: "rgba(234,88,12,0.9)", lineHeight: 1.4 }}>
              {actionItem.message.length > 140 ? actionItem.message.slice(0, 140) + "…" : actionItem.message}
            </p>
          )}
          {actionItem?.options && actionItem.options.length > 0 && (
            <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
              {actionItem.options.slice(0, 4).map((option, index) => (
                <button
                  type="button"
                  key={`${option.label}-${index}`}
                  aria-label={option.label}
                  disabled={choiceSubmitting !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    onProviderEventChoiceOption?.(option.label);
                  }}
                  style={{
                    appearance: "none",
                    textAlign: "left",
                    border: "0.5px solid rgba(234,88,12,0.22)",
                    borderRadius: 7,
                    padding: "5px 7px",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 10.5,
                    color: "var(--text-secondary,#666)",
                    lineHeight: 1.35,
                    backgroundColor: choiceSubmitting === option.label ? "rgba(234,88,12,0.12)" : "rgba(234,88,12,0.045)",
                    cursor: choiceSubmitting === null ? "pointer" : "default",
                    opacity: choiceSubmitting !== null && choiceSubmitting !== option.label ? 0.62 : 1,
                  }}
                >
                  {choiceSubmitting === option.label
                    ? "Starting..."
                    : option.label.length > 120 ? `${option.label.slice(0, 120)}...` : option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {step.status === "done" && step.handoff_url && (
          <a href={step.handoff_url} target="_blank" rel="noopener noreferrer" style={{
            flexShrink: 0, padding: "6px 12px", borderRadius: 8, border: "none",
            backgroundColor: "rgba(22,163,74,0.85)", color: "#fff",
            fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600,
            whiteSpace: "nowrap", textDecoration: "none", display: "inline-block",
          }}>Open →</a>
        )}
        {step.status === "awaiting_confirmation" && step.handoff_url && !actionItem && (
          <a href={step.handoff_url} target="_blank" rel="noopener noreferrer" style={{
            flexShrink: 0, padding: "6px 12px", borderRadius: 8, border: "none",
            backgroundColor: "rgba(22,163,74,0.85)", color: "#fff",
            fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600,
            whiteSpace: "nowrap", textDecoration: "none", display: "inline-block",
          }}>Pay →</a>
        )}
        {step.status === "error" && !isTravelDocError(step.error) && step.fallbackUrl && (
          <a href={step.fallbackUrl} target="_blank" rel="noopener noreferrer" style={{
            flexShrink: 0, padding: "6px 10px", borderRadius: 8,
            border: "0.5px solid var(--border,#e5e7eb)", color: "var(--text-secondary,#666)",
            fontFamily: "var(--font-dm-sans)", fontSize: 11,
            whiteSpace: "nowrap", textDecoration: "none", display: "inline-block",
          }}>Search →</a>
        )}
      </div>
    </div>
  );
}

// ── InlineJobCard ─────────────────────────────────────────────────────────────

export interface TravelDocRequest {
  jobId: string;
  profileId: number;
}

export interface ProviderEventChoiceRequest {
  jobId: string;
  tripLabel: string;
  message: string;
}

interface InlineJobCardProps {
  jobId: string;
  sourceSessionId?: string | null;
  /** Called once when a travel-doc error is detected, so page can ask in chat */
  onNeedsTravelDocs?: (req: TravelDocRequest) => void;
  /** Called when a provider-start activity task needs date/city/showtime in chat */
  onNeedsProviderEventChoice?: (req: ProviderEventChoiceRequest) => void;
  /** Called when the user clicks a visible provider candidate in the task card */
  onProviderEventChoiceOption?: (req: ProviderEventChoiceRequest) => void | Promise<void>;
  /** Called when the job is deleted (manually or 404) so the parent can remove it */
  onDeleted?: (jobId: string) => void;
  /** Opens the in-page task observer without navigating away from chat/results */
  onWatch?: (jobId: string, title: string) => void;
}

export default function InlineJobCard({
  jobId,
  sourceSessionId,
  onNeedsTravelDocs,
  onNeedsProviderEventChoice,
  onDeleted,
  onWatch,
  onProviderEventChoiceOption,
}: InlineJobCardProps) {
  const [job, setJob] = useState<BookingJob | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [providerChoiceSubmitting, setProviderChoiceSubmitting] = useState<string | null>(null);
  const travelDocNotifiedRef = useRef(false);
  const providerChoiceNotifiedRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function schedulePoll(delay: number) {
    pollRef.current = setTimeout(doFetch, delay);
  }

  async function doFetch() {
    try {
      const res = await fetch(withSessionParam(`/api/booking-jobs/${jobId}`, sourceSessionId));
      if (res.status === 404) { onDeleted?.(jobId); return; }
      if (!res.ok) { schedulePoll(4000); return; }
      const data: { job: BookingJob } = await res.json();
      setJob(data.job);

      // Notify parent once when a travel-doc error is found
      if (!travelDocNotifiedRef.current && onNeedsTravelDocs) {
        const errorStep = data.job.steps.find(
          (s) => s.status === "error" && isTravelDocError(s.error)
        );
        if (errorStep) {
          const profileId = typeof errorStep.body?.profileId === "number"
            ? errorStep.body.profileId
            : null;
          if (profileId !== null) {
            travelDocNotifiedRef.current = true;
            onNeedsTravelDocs({ jobId, profileId });
          }
        }
      }

      const choiceStep = data.job.steps.find((s) => getProviderEventChoiceActionItem(s));
      const choiceAction = choiceStep ? getProviderEventChoiceActionItem(choiceStep) : undefined;
      if (choiceAction?.message && onNeedsProviderEventChoice) {
        const notifyKey = `${data.job.plan_version}:${choiceAction.message}`;
        if (providerChoiceNotifiedRef.current !== notifyKey) {
          providerChoiceNotifiedRef.current = notifyKey;
          onNeedsProviderEventChoice({
            jobId,
            tripLabel: data.job.trip_label,
            message: choiceAction.message,
          });
        }
      } else {
        providerChoiceNotifiedRef.current = null;
      }

      const terminal = data.job.status === "done" || data.job.status === "failed";
      if (!terminal) schedulePoll(3000);
    } catch {
      schedulePoll(6000);
    }
  }

  useEffect(() => {
    doFetch();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /** Called externally when the job has been restarted after travel docs were provided */
  function handleJobRestarted() {
    travelDocNotifiedRef.current = false; // allow re-notification if it fails again
    setJob((j) => j ? { ...j, status: "running", steps: j.steps.map((s) => s.status === "error" ? { ...s, status: "loading" as const } : s) } : j);
    schedulePoll(2000);
  }

  // Expose restart handler so parent can call it
  // (we do this via ref trick below)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (deleting || !job) return;
    setDeleting(true);
    try {
      const force = isActiveJobStatus(job.status);
      await fetch(
        withSessionParam(`/api/booking-jobs/${job.id}${force ? "?force=true" : ""}`, sourceSessionId),
        { method: "DELETE" },
      );
      onDeleted?.(jobId);
    } finally {
      setDeleting(false);
    }
  }

  async function handleResetStuck(e: React.MouseEvent) {
    e.stopPropagation();
    if (resetting || !job) return;
    setResetting(true);
    try {
      await fetch(`/api/booking-jobs/${job.id}/start?executor=inline`, { method: "POST" });
      handleJobRestarted();
    } finally {
      setResetting(false);
    }
  }

  async function handleProviderChoiceOption(label: string) {
    if (!job || providerChoiceSubmitting !== null) return;
    setProviderChoiceSubmitting(label);
    try {
      if (onProviderEventChoiceOption) {
        await onProviderEventChoiceOption({
          jobId: job.id,
          tripLabel: job.trip_label,
          message: label,
        });
      } else {
        const choiceRes = await fetch(`/api/booking-jobs/${job.id}/continue-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: label }),
        });
        if (choiceRes.ok) {
          await fetch(`/api/booking-jobs/${job.id}/start?executor=inline`, { method: "POST" });
        }
      }
      setJob((current) => current
        ? {
            ...current,
            status: "running",
            completed_at: null,
            steps: current.steps.map((step) =>
              getProviderEventChoiceActionItem(step)
                ? { ...step, status: "loading" as const, actionItem: undefined }
                : step,
            ),
          }
        : current);
      schedulePoll(1200);
    } finally {
      setProviderChoiceSubmitting(null);
    }
  }

  if (job === null && deleting) return null;

  if (!job) {
    return (
      <div style={{ borderRadius: 16, border: "0.5px solid var(--border,#e5e7eb)", backgroundColor: "var(--card,#fff)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: "var(--gold,#D4A34B)", animation: "jobpulse 1.4s ease-in-out infinite" }} />
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary,#666)", margin: 0 }}>
          Starting booking task…
        </p>
      </div>
    );
  }

  const semanticStatus = computeJobSemanticStatus(job);
  const statusDisplay = semanticStatus === "awaiting_payment"
    ? { ...JOB_SEMANTIC_DISPLAY[semanticStatus], label: "Ready to review — confirm on site" }
    : JOB_SEMANTIC_DISPLAY[semanticStatus];
  const doneCount = job.steps.filter((s) => s.status === "done").length;
  const isRunning = isActiveJobStatus(job.status);
  const isComplete = job.status === "done" || job.status === "failed";
  const evidenceAction = taskEvidenceAction(job);
  const detailsHref = taskDetailsHref(job);
  const isStuck = job.status === "running" &&
    Date.now() - new Date(job.updated_at).getTime() > 7 * 60 * 1000;

  const borderColor =
    semanticStatus === "blocked_needs_user_input" || semanticStatus === "partially_completed"
      ? "rgba(220,38,38,0.3)"
      : semanticStatus.startsWith("succeeded") ? "rgba(22,163,74,0.25)"
      : "var(--border,#e5e7eb)";

  return (
    <div style={{ borderRadius: 16, border: `0.5px solid ${borderColor}`, backgroundColor: "var(--card,#fff)", overflow: "hidden" }}>
      {/* Header */}
      <div onClick={() => setExpanded((e) => !e)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", backgroundColor: statusDisplay.color, animation: statusDisplay.animate ? "jobpulse 1.4s ease-in-out infinite" : "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
            {job.trip_label}
          </p>
          <div style={{ display: "flex", gap: "3px 8px", flexWrap: "wrap", marginTop: 2 }}>
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: statusDisplay.color, fontWeight: 500 }}>
              {statusDisplay.label}
            </span>
            {isComplete && doneCount > 0 && (
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary,#666)" }}>{doneCount}/{job.steps.length} ready</span>
            )}
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted,#aaa)" }}>{formatDate(job.created_at)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onWatch) {
              onWatch(job.id, job.trip_label);
              return;
            }
            window.open(evidenceAction.href, "_blank", "noopener,noreferrer");
          }}
          style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--gold,#D4A34B)", backgroundColor: "transparent", color: isRunning ? "var(--gold,#D4A34B)" : "rgba(212,163,75,0.72)", fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
        >
          {evidenceAction.label}
        </button>

        <a
          href={detailsHref}
          onClick={(e) => e.stopPropagation()}
          style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 8, border: "0.5px solid var(--border,#e5e7eb)", backgroundColor: "transparent", color: "var(--text-secondary,#666)", fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", textDecoration: "none", display: "inline-block" }}
        >
          Details
        </a>

        {job.status === "done" && doneCount > 0 && (
          <button onClick={(e) => { e.stopPropagation(); job.steps.filter((s) => s.status === "done" && s.handoff_url).forEach((s) => window.open(s.handoff_url!, "_blank")); }} style={{ flexShrink: 0, padding: "5px 12px", borderRadius: 8, border: "none", backgroundColor: "var(--gold,#D4A34B)", color: "#fff", fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            Open all →
          </button>
        )}

        {isStuck && (
          <button onClick={handleResetStuck} disabled={resetting} style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 8, border: "none", backgroundColor: resetting ? "var(--border)" : "rgba(234,88,12,0.85)", color: "#fff", fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, cursor: resetting ? "default" : "pointer", whiteSpace: "nowrap" }}>
            {resetting ? "Starting…" : "↺ Retry"}
          </button>
        )}

        <span style={{ color: "var(--text-muted,#aaa)", fontSize: 11, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>

        <button onClick={handleDelete} disabled={deleting} style={{ flexShrink: 0, background: "none", border: "0.5px solid var(--border,#e5e7eb)", borderRadius: 7, padding: "4px 8px", fontFamily: "var(--font-dm-sans)", fontSize: 11, color: isRunning ? "rgba(234,88,12,0.8)" : "rgba(220,38,38,0.65)", cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.4 : 1 }}>
          🗑
        </button>
      </div>

      {/* Steps */}
      {expanded && (
        <div style={{ borderTop: "0.5px solid var(--border,#e5e7eb)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {job.steps.map((step, i) => (
            <InlineStepCard
              key={i}
              step={step}
              choiceSubmitting={providerChoiceSubmitting}
              onProviderEventChoiceOption={handleProviderChoiceOption}
            />
          ))}
          <div style={{ textAlign: "right", paddingTop: 4 }}>
            <a
              href={detailsHref}
              style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted,#aaa)", textDecoration: "none" }}
            >
              View full details in Tasks →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function withSessionParam(path: string, sessionId?: string | null): string {
  const trimmed = sessionId?.trim();
  if (!trimmed) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}session_id=${encodeURIComponent(trimmed)}`;
}
