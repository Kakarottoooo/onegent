"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { BookingJob, BookingJobStep, DecisionLogEntry, AgentFeedbackStats } from "@/lib/db";
import type { BookingJobListItem } from "@/lib/booking-jobs/read-model";
import {
  buildFlightInventoryDriftManualMessage,
  isFlightInventoryDriftError,
} from "@/lib/booking-errors";
import type { PolicyBias, UserPreferenceProfile } from "@/lib/policy";
import type { BookingMonitor } from "@/lib/monitors";
import type { ScenarioMemory, PatternMemory, RelationshipProfile, RelationshipType } from "@/lib/memory";
import {
  computeJobSemanticStatus,
  computeStepSemanticStatus,
  isActiveJobStatus,
  JOB_SEMANTIC_DISPLAY,
  STEP_SEMANTIC_DISPLAY,
} from "@/lib/status";
import {
  getTaskEvidenceHref,
  getTaskWorkspaceHref,
  taskWorkspaceViewForJob,
  type TaskWorkspaceView,
} from "@/lib/booking-jobs/workspace";
import { fetchTaskCompactList, fetchTaskDetail, invalidateTaskData } from "./task-data-client";
import GlobalNav from "@/components/GlobalNav";
import { ModifyTaskButton } from "@/components/ModifyTaskButton";
import { getBrowserModelForStagehand } from "@/lib/agent-model-config";
import "./tasks.css";

const TripItineraryCalendar = dynamic(() => import("@/components/TripItineraryCalendar"), {
  loading: () => null,
});
const RestaurantStepCard = dynamic(() => import("@/components/booking/RestaurantStepCard"), {
  loading: () => null,
});
const TaskTimelinePanel = dynamic(
  () => import("@/components/task-timeline").then((mod) => mod.TaskTimelinePanel),
  { loading: () => null },
);
const ShareTripModal = dynamic(() => import("@/components/ShareTripModal"), {
  loading: () => null,
});
const AddToTripModal = dynamic(() => import("@/components/AddToTripModal"), {
  loading: () => null,
});


function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("session_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("session_id", id); }
  return id;
}

const TASK_WORKSPACE_TABS: Array<{ id: TaskWorkspaceView; label: string }> = [
  { id: "queue", label: "Queue" },
  { id: "live", label: "Live" },
  { id: "history", label: "History" },
];

function TaskWorkspaceSwitch({
  view,
  setView,
}: {
  view: TaskWorkspaceView;
  setView: (view: TaskWorkspaceView) => void;
}) {
  return (
    <div className="task-tabs">
      {TASK_WORKSPACE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setView(tab.id)}
          className={`task-tabs__btn${view === tab.id ? " task-tabs__btn--active" : ""}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function buildJobsRenderSignature(jobs: BookingJobListItem[]): string {
  return jobs
    .map((job) => {
      return [
        job.id,
        job.trip_label,
        job.status,
        job.created_at,
        job.updated_at,
        job.step_count,
        job.ready_step_count,
        job.action_count,
        job.latest_step_status ?? "",
        job.has_handoff_url ? "handoff" : "",
        job.has_session_url ? "session" : "",
      ].join("|");
    })
    .join(";");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Feedback helper ────────────────────────────────────────────────────────────

async function sendFeedback(payload: {
  job_id: string;
  step_index?: number;
  step_type?: string;
  agent_decision?: string;
  venue_name?: string;
  provider?: string;
  outcome: string;
  metadata?: Record<string, unknown>;
}) {
  const session_id = getSessionId();
  fetch("/api/booking-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, session_id }),
  }).catch(() => {});
}

function inferProvider(step: BookingJobStep): string {
  if (step.type === "flight") return "kayak";
  if (step.type === "hotel") return "booking_com";
  return "opentable";
}

function inferAgentDecision(step: BookingJobStep): string {
  if (step.timeAdjusted) return "time_adjusted";
  if (step.usedFallback) return "venue_switched";
  if (step.status === "done") return "primary";
  return "failed";
}

// ── Visual helpers ─────────────────────────────────────────────────────────────

function stepStatusColor(step: BookingJobStep): string {
  if (step.status === "awaiting_confirmation") return "rgba(22,163,74,0.85)";
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
    if (step.timeAdjusted) return "Booked (agent adjusted time)";
    if (step.usedFallback) return "Booked (alternative venue)";
    return "Pre-filled — ready to pay";
  }
  if (step.retryScheduledFor) return `Retry scheduled for ${formatTime(step.retryScheduledFor)}`;
  if (step.actionItem) return "Needs your choice";
  if (step.status === "awaiting_confirmation") return "Ready to review — confirm on site";
  if (step.status === "loading") return "Agent working…";
  if (step.status === "no_availability") {
    const err = (step.error ?? "").toLowerCase();
    if (err.includes("not on opentable or resy") || err.includes("is not on opentable or resy")) return "Not on OpenTable or Resy";
    if (err.includes("not found on opentable")) return "Not found on OpenTable";
    return "No availability found";
  }
  if (step.status === "error" && isFlightInventoryDriftError(step.error)) return "Fare changed or disappeared";
  if (step.status === "error") return "Failed";
  return "Waiting";
}

function logEntryIcon(type: DecisionLogEntry["type"]): string {
  switch (type) {
    case "succeeded": return "✓";
    case "skipped": return "—";
    case "time_adjusted": return "↻";
    case "venue_switched": return "→";
    case "retry": return "↺";
    case "failed": return "✗";
    case "scene_replan": return "⟳";
    default: return "·";
  }
}

function logEntryColor(type: DecisionLogEntry["type"]): string {
  switch (type) {
    case "succeeded": return "rgba(22,163,74,0.85)";
    case "time_adjusted": return "rgba(234,88,12,0.8)";
    case "venue_switched": return "#6366f1";
    case "retry": return "var(--gold, #D4A34B)";
    case "failed": case "skipped": return "rgba(220,38,38,0.65)";
    case "scene_replan": return "#8b5cf6"; // violet — signals orchestration-level thinking
    default: return "var(--text-secondary, #666)";
  }
}

// ── Satisfaction widget ────────────────────────────────────────────────────────

function SatisfactionWidget({ jobId }: { jobId: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function pick(outcome: "satisfied" | "ok" | "unsatisfied") {
    if (sent) return;
    setChosen(outcome);
    setSent(true);
    sendFeedback({
      job_id: jobId,
      step_index: -1,
      step_type: "job",
      agent_decision: "n/a",
      outcome,
    });
  }

  if (sent) {
    return (
      <p className="sat-widget__sent">
        Thanks — your feedback helps the agent improve ✓
      </p>
    );
  }

  return (
    <div className="sat-widget">
      <p className="sat-widget__prompt">How did this go?</p>
      {[
        { outcome: "satisfied" as const, emoji: "😊", label: "Great" },
        { outcome: "ok" as const, emoji: "👍", label: "OK" },
        { outcome: "unsatisfied" as const, emoji: "😕", label: "Needed fixes" },
      ].map(({ outcome, emoji, label }) => (
        <button
          key={outcome}
          onClick={() => pick(outcome)}
          className={`sat-widget__btn${chosen === outcome ? " sat-widget__btn--chosen" : ""}`}
        >
          <span>{emoji}</span><span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ── What's next ────────────────────────────────────────────────────────────────

function WhatsNext({ job }: { job: BookingJob }) {
  const ready = job.steps.filter((s) => s.status === "done");
  const action = job.steps.filter((s) => s.actionItem);
  const isRunning = isActiveJobStatus(job.status);

  if (isRunning) return (
    <div style={{ padding: "12px 14px", borderTop: "0.5px solid var(--border, #e5e7eb)" }}>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
        ⏳ Agent is working — you&apos;ll be notified when done.
      </p>
    </div>
  );

  if (ready.length === 0 && action.length === 0) return null;

  return (
    <div style={{ padding: "12px 14px", borderTop: "0.5px solid var(--border, #e5e7eb)", display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        What&apos;s next
      </p>
      {ready.length > 0 && (
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
          {ready.length === 1
            ? `Open the ${ready[0].label} booking page and pay.`
            : `Open the ${ready.length} ready booking pages and pay for each.`}
        </p>
      )}
      {action.length > 0 && (
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(220,38,38,0.85)", fontWeight: 500 }}>
          {action.length === 1
            ? "1 step needs your manual decision — agent tried all alternatives."
            : `${action.length} steps need your manual decision.`}
        </p>
      )}
    </div>
  );
}

// ── Step card ──────────────────────────────────────────────────────────────────

// ── NeedsHelpCard ─────────────────────────────────────────────────────────────

function diagnoseFail(step: BookingJobStep): { reason: string; suggestion: string; chatPrompt: string } {
  const err = (step.error ?? "").toLowerCase();
  const lastLog = step.decisionLog?.filter(e => e.type === "failed" || e.type === "skipped").at(-1);
  const logMsg = (lastLog?.message ?? "").toLowerCase();

  if (isFlightInventoryDriftError(step.error) || isFlightInventoryDriftError(lastLog?.message)) {
    return {
      reason: "The agent found a flight earlier, but Expedia no longer showed that exact fare during checkout.",
      suggestion: "Retry to fetch fresh live inventory, or open the current results and choose the closest option manually.",
      chatPrompt: `The exact fare for ${step.label} disappeared or changed on Expedia during checkout. Can you refresh the live options and pick the closest current match?`,
    };
  }
  if (err.includes("captcha") || err.includes("cloudflare") || err.includes("blocked") || logMsg.includes("blocked")) {
    return {
      reason: "The booking site blocked the agent (bot protection).",
      suggestion: "Try booking manually, or ask the agent to try a different booking platform.",
      chatPrompt: `I tried to book ${step.label} but the site blocked the agent. Can you find an alternative way to book this?`,
    };
  }
  if (err.includes("login") || err.includes("sign in") || logMsg.includes("login")) {
    return {
      reason: "The site requires you to log in before booking.",
      suggestion: "Open the booking link, sign in, then ask the agent to continue.",
      chatPrompt: `I need to book ${step.label}. The site requires a login. Can you help me complete this booking after I sign in?`,
    };
  }
  if (err.includes("no availability") || step.status === "no_availability" || logMsg.includes("no availability")) {
    return {
      reason: "No availability found for your requested dates or party size.",
      suggestion: "Try different dates, fewer guests, or ask the agent to find alternatives.",
      chatPrompt: `${step.label} has no availability. Can you suggest alternatives or different dates?`,
    };
  }
  if (err.includes("timeout") || err.includes("timed out")) {
    return {
      reason: "The agent timed out — the booking site was too slow.",
      suggestion: "Retry now, or try booking manually.",
      chatPrompt: `The agent timed out booking ${step.label}. Can you retry or suggest a faster way?`,
    };
  }
  return {
    reason: "The agent couldn't complete the booking automatically.",
    suggestion: "Tell the agent what you'd like to do — it can retry with more context or find alternatives.",
    chatPrompt: `I'm trying to book ${step.label}. The agent failed. What information do you need to complete this booking?`,
  };
}

function shouldUseStaticHelp(step: BookingJobStep): boolean {
  const actionMessage = step.actionItem?.message?.toLowerCase() ?? "";
  const error = step.error?.toLowerCase() ?? "";

  return (
    !!step.actionItem?.options?.length ||
    actionMessage.includes("manually") ||
    actionMessage.includes("sign in") ||
    error.includes("captcha") ||
    error.includes("blocked") ||
    error.includes("manual") ||
    error.includes("stalled before checkout form") ||
    error.includes("site requires login") ||
    error.includes("no availability")
  );
}

function getStaticHelpMessage(step: BookingJobStep): string {
  if (isFlightInventoryDriftError(step.error)) {
    const diagnosis = diagnoseFail(step);
    return `${diagnosis.reason} ${diagnosis.suggestion}`;
  }

  const actionMessage = step.actionItem?.message?.trim();
  if (actionMessage && actionMessage !== "Auto-booking failed. Tap to complete manually:") return actionMessage;
  if (actionMessage === buildFlightInventoryDriftManualMessage()) return actionMessage;

  const diagnosis = diagnoseFail(step);
  return `${diagnosis.reason} ${diagnosis.suggestion}`;
}

function NeedsHelpCard({ step, onManualLink, jobId, stepIndex, onRefresh }: {
  step: BookingJobStep;
  onManualLink: (label: string, url: string, idx: number) => void;
  jobId: string;
  stepIndex: number;
  onRefresh?: () => void;
}) {
  // Agent speaks first — generates a specific question on mount
  const [question, setQuestion] = useState("");
  const [questionLoading, setQuestionLoading] = useState(true);
  const [answer, setAnswer] = useState("");
  const [agentReply, setAgentReply] = useState("");
  const [sendingAnswer, setSendingAnswer] = useState(false);
  const [readyToRetry, setReadyToRetry] = useState(false);
  const [enrichedTask, setEnrichedTask] = useState<string | undefined>();
  const [retrying, setRetrying] = useState(false);
  const staticHelp = shouldUseStaticHelp(step);

  const originalTask = typeof step.body?.task === "string" ? step.body.task : "";

  // Load agent's question automatically
  useEffect(() => {
    if (staticHelp) {
      setQuestion(getStaticHelpMessage(step));
      setQuestionLoading(false);
      return;
    }

    setQuestionLoading(true);
    fetch("/api/agent-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "question",
        stepLabel: step.label,
        originalTask,
        decisionLog: step.decisionLog ?? [],
        error: step.error,
      }),
    })
      .then((r) => r.json())
      .then((d) => setQuestion(d.question ?? "What information do you need to proceed?"))
      .catch(() => setQuestion("What would you like to do next?"))
      .finally(() => setQuestionLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticHelp, step]);

  async function sendAnswer() {
    if (!answer.trim() || sendingAnswer) return;
    setSendingAnswer(true);
    setAgentReply("");
    try {
      const res = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "answer",
          answer: answer.trim(),
          stepLabel: step.label,
          originalTask,
          decisionLog: step.decisionLog ?? [],
          error: step.error,
        }),
      });
      const data = await res.json();
      setAgentReply(data.reply ?? "");
      setReadyToRetry(!!data.retryNow);
      setEnrichedTask(data.enrichedTask);
    } finally {
      setSendingAnswer(false);
    }
  }

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    // Always patch in latest model config + profile from localStorage so retries use current settings
    const agentModel = getBrowserModelForStagehand() ?? undefined;
    const activeProfileId = localStorage.getItem("active_profile_id");
    const patchBody = {
      ...(enrichedTask ? { task: enrichedTask } : {}),
      ...(agentModel ? { agentModel } : {}),
      ...(activeProfileId ? { profileId: parseInt(activeProfileId) } : {}),
    };
    await fetch(`/api/booking-jobs/${jobId}/schedule-retry`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stepIndex,
        retryAfter: null,
        resetStatus: true,
        ...(Object.keys(patchBody).length > 0 ? { patchBody } : {}),
      }),
    }).catch(() => {});
    fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, { method: "POST" }).catch(() => {});
    setTimeout(() => onRefresh?.(), 800);
  }

  return (
    <div className="help-card">
      <div style={{ padding: 0 }}>

        {/* Agent question bubble */}
        <div className="help-card__bubble-row">
          <div className="help-card__avatar">🤖</div>
          <div className={`help-card__bubble${questionLoading ? " help-card__bubble--loading" : ""}`}>
            {questionLoading ? "Analysing what went wrong…" : question}
          </div>
        </div>

        {agentReply && (
          <div className="help-card__bubble-row">
            <div className="help-card__avatar">🤖</div>
            <div className="help-card__bubble">{agentReply}</div>
          </div>
        )}

        {readyToRetry && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="retry-sched__primary"
            style={{ marginBottom: 10 }}
          >
            {retrying ? "Starting…" : "↺ Retry booking"}
          </button>
        )}

        {!staticHelp && !readyToRetry && !questionLoading && (
          <div className="help-card__form">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }}
              placeholder="Type your answer…"
              rows={1}
              className="help-card__input"
              style={{ resize: "none", lineHeight: 1.5 }}
            />
            <button
              onClick={sendAnswer}
              disabled={sendingAnswer || !answer.trim()}
              className="help-card__send"
              style={{ width: 36, padding: 0 }}
            >
              {sendingAnswer ? "…" : "↑"}
            </button>
          </div>
        )}

        {staticHelp && step.error && (
          <p
            style={{
              marginTop: 8,
              fontFamily: "var(--font-dm-sans)",
              fontSize: 11,
              color: "var(--ink-5)",
              lineHeight: 1.5,
            }}
          >
            {step.error}
          </p>
        )}

        {step.actionItem?.options.map((opt, j) => (
          <button
            key={j}
            onClick={() => onManualLink(opt.label, opt.url, j)}
            className="retry-sched__chip"
            style={{
              width: "100%",
              marginTop: 8,
              textAlign: "left",
              fontSize: 11,
              color: "var(--ink-5)",
            }}
          >
            ↗ Book manually instead
          </button>
        ))}
      </div>
    </div>
  );
}

// ── RestaurantTimePicker ───────────────────────────────────────────────────────
// Shown when a restaurant booking has no_availability/error but the executor
// captured available time slots from the page. The user picks one and we retry.

function RestaurantTimePicker({
  step, stepIndex, jobId, onBooked,
}: {
  step: BookingJobStep; stepIndex: number; jobId: string; onBooked: () => void;
}) {
  const slots = ((step.body as Record<string, unknown>).availableSlots as string[]) ?? [];
  const [booking, setBooking] = useState<string | null>(null);

  async function bookSlot(slot: string) {
    if (booking) return;
    setBooking(slot);
    try {
      // Convert "7:30 PM" → "19:30"
      const to24 = (s: string): string => {
        const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!m) return s;
        let h = parseInt(m[1], 10);
        const min = m[2];
        if (m[3].toUpperCase() === "PM" && h < 12) h += 12;
        if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
        return `${String(h).padStart(2, "0")}:${min}`;
      };
      const newTime = to24(slot);
      const sessionId = localStorage.getItem("session_id") ?? crypto.randomUUID();
      const newBody = { ...(step.body as Record<string, unknown>), time: newTime, availableSlots: undefined };
      const newStep = { ...step, status: "pending", body: newBody, error: undefined, decisionLog: undefined };
      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, trip_label: step.label, steps: [newStep] }),
      });
      if (createRes.ok) {
        const { jobId: newJobId } = await createRes.json();
        fetch(`/api/booking-jobs/${newJobId}/start?executor=inline`, { method: "POST" }).catch(() => {});
        onBooked();
      }
    } finally {
      setBooking(null);
    }
  }

  return (
    <div className="time-picker">
      <p className="time-picker__title">
        🕐 7:00 PM wasn&apos;t available — pick another time:
      </p>
      <div className="time-picker__slots">
        {slots.map(slot => (
          <button
            key={slot}
            onClick={() => bookSlot(slot)}
            disabled={!!booking}
            className={`time-picker__slot${booking === slot ? " time-picker__slot--booking" : ""}`}
          >
            {booking === slot ? "Booking…" : slot}
          </button>
        ))}
      </div>
      <p className="time-picker__hint">
        Tap a time → agent will book it automatically
      </p>
    </div>
  );
}

// ── RetryScheduler ─────────────────────────────────────────────────────────────

function RetryScheduler({ step, stepIndex, jobId, onScheduled }: {
  step: BookingJobStep; stepIndex: number; jobId: string; onScheduled: () => void;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function retryNow() {
    setRetrying(true);
    const agentModel = getBrowserModelForStagehand() ?? undefined;
    const activeProfileId = localStorage.getItem("active_profile_id");
    const patchBody = {
      ...(agentModel ? { agentModel } : {}),
      ...(activeProfileId ? { profileId: parseInt(activeProfileId) } : {}),
    };
    await fetch(`/api/booking-jobs/${jobId}/schedule-retry`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stepIndex, retryAfter: null, resetStatus: true,
        ...(Object.keys(patchBody).length > 0 ? { patchBody } : {}),
      }),
    }).catch(() => {});
    fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, { method: "POST" }).catch(() => {});
    setTimeout(() => { setRetrying(false); onScheduled(); }, 800);
  }

  async function scheduleRetry(hoursFromNow: number | null) {
    setScheduling(true);
    const retryAfter = hoursFromNow === null ? null
      : new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
    await fetch(`/api/booking-jobs/${jobId}/schedule-retry`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepIndex, retryAfter }),
    }).catch(() => {});
    setScheduling(false);
    onScheduled();
  }

  if (step.retryScheduledFor) {
    const retryDate = new Date(step.retryScheduledFor);
    return (
      <div className="retry-sched--scheduled">
        <p>↺ Retry scheduled for {retryDate.toLocaleString()}</p>
        <button onClick={() => scheduleRetry(null)} disabled={scheduling} className="retry-sched__cancel">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="retry-sched">
      <button onClick={retryNow} disabled={retrying} className="retry-sched__primary">
        {retrying ? "Starting agent…" : "↺ Retry now"}
      </button>
      <p className="retry-sched__hint">Or retry automatically:</p>
      <div className="retry-sched__chips">
        {[
          { label: "In 2 hours", hours: 2 },
          { label: "In 6 hours", hours: 6 },
          { label: "Tomorrow", hours: 24 },
        ].map(({ label, hours }) => (
          <button
            key={hours}
            onClick={() => scheduleRetry(hours)}
            disabled={scheduling}
            className="retry-sched__chip"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Live log panel (streams trace lines while agent is running) ───────────────
function LiveLogPanel({ jobId }: { jobId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const afterRef = useRef(0);
  const epochRef = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let closedAt = 0; // timestamp when we first saw closed=true

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/booking-jobs/${jobId}/logs?after=${afterRef.current}`);
        if (!res.ok) { if (!cancelled) setTimeout(poll, 1200); return; }
        const data: { lines: string[]; total: number; closed: boolean; epoch: number } = await res.json();

        // New run started (retry) — reset counters and resume streaming
        if (data.epoch > epochRef.current && epochRef.current > 0) {
          afterRef.current = 0;
          epochRef.current = data.epoch;
          closedAt = 0;
          setClosed(false);
          setLines([]);
          if (!cancelled) setTimeout(poll, 400);
          return;
        }
        epochRef.current = data.epoch;

        if (data.lines.length > 0) {
          afterRef.current = data.total;
          setLines(prev => {
            const next = [...prev, ...data.lines];
            return next.slice(-500); // keep last 500 lines
          });
          // Auto-scroll to bottom
          requestAnimationFrame(() => {
            if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
          });
        }

        if (data.closed) {
          if (!closedAt) closedAt = Date.now();
          // Keep polling for 15 s after close in case a retry resets the epoch
          if (Date.now() - closedAt > 15_000) { setClosed(true); return; }
        } else {
          closedAt = 0; // reset if a new run resumed
        }
      } catch { /* ignore network errors */ }
      if (!cancelled) setTimeout(poll, 1200);
    }

    poll();
    return () => { cancelled = true; };
  }, [jobId]);

  if (lines.length === 0 && !closed) return (
    <div className="live-log__waiting">Waiting for agent logs…</div>
  );

  return (
    <div className="live-log">
      <p className="live-log__eyebrow">
        {closed ? "Live agent log (finished)" : (
          <>
            <span className="live-log__streaming-dot" />
            Live agent log
          </>
        )}
      </p>
      <div ref={boxRef} className="live-log__lines">
        {lines.map((line, i) => {
          const isFail = line.includes("FAIL") || line.includes("failed") || line.includes("ERROR");
          const isOk = line.includes("✓") || line.includes("filled") || line.includes("clicked");
          const cls = `live-log__line${isFail ? " live-log__line--fail" : isOk ? " live-log__line--ok" : ""}`;
          return <span key={i} className={cls}>{line}</span>;
        })}
      </div>
    </div>
  );
}

function StepCard({ step, stepIndex, jobId, onRefresh, onOpenLive }: {
  step: BookingJobStep; stepIndex: number; jobId: string; onRefresh?: () => void; onOpenLive?: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const feedbackSent = useRef(false);
  const hasLog = (step.decisionLog?.length ?? 0) > 0;
  const color = stepStatusColor(step);

  function handleOpenAgentLink() {
    if (!feedbackSent.current && step.status === "done") {
      feedbackSent.current = true;
      sendFeedback({
        job_id: jobId,
        step_index: stepIndex,
        step_type: step.type,
        agent_decision: inferAgentDecision(step),
        venue_name: step.label,
        provider: inferProvider(step),
        outcome: "accepted",
        metadata: {
          timeAdjusted: step.timeAdjusted,
          usedFallback: step.usedFallback,
          selected_time: step.selected_time,
        },
      });
    }
    window.open(step.handoff_url!, "_blank");
  }

  function handleManualLink(optionLabel: string, url: string, optionIndex: number) {
    sendFeedback({
      job_id: jobId,
      step_index: stepIndex,
      step_type: step.type,
      agent_decision: "failed",
      venue_name: optionLabel,
      provider: inferProvider(step),
      outcome: "manual_override",
      metadata: { optionIndex, originalLabel: step.label },
    });
    window.open(url, "_blank");
  }

  const stepCardClass = `step-card${
    step.actionItem ? " step-card--needs-action" : step.status === "done" ? " step-card--done" : ""
  }`;

  return (
    <div className={stepCardClass}>
      <div className="step-card__row">
        <div
          className="step-card__status"
          style={{
            backgroundColor: color,
            animation: step.status === "loading" ? "jobpulse 1.2s ease-in-out infinite" : "none",
          }}
        >
          {stepStatusIcon(step)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="step-card__title-row">
            <span className="step-card__emoji">{step.emoji}</span>
            <p className="step-card__title">{step.label}</p>
            {(step.timeAdjusted || step.usedFallback) && (
              <span className="step-card__pill step-card__pill--adjusted">
                {step.timeAdjusted ? "⏰ time adjusted" : "🔄 alternative"}
              </span>
            )}
            {step.replanAdjusted && (
              <span className="step-card__pill step-card__pill--replan">
                ⟳ scene-replanned
              </span>
            )}
            {step.replanFlagged && !step.replanAdjusted && (
              <span className="step-card__pill step-card__pill--review">
                ⚠ review schedule
              </span>
            )}
          </div>
          <p className="step-card__sub" style={{ color }}>
            {stepStatusLabel(step)}
            {step.selected_time && ` · ${step.type === "flight" ? "Price:" : "Time:"} ${step.selected_time}`}
          </p>
          {step.status === "loading" && hasLog && (() => {
            const last = step.decisionLog!.at(-1);
            return last ? (
              <p
                className="step-card__sub"
                style={{
                  marginTop: 3,
                  color:
                    last.type === "failed" ? "rgba(220,38,38,0.75)" :
                    last.type === "succeeded" ? "rgba(22,163,74,0.85)" :
                    "var(--ink-6)",
                  maxWidth: 280,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={last.message}
              >
                {last.message}
              </p>
            ) : null;
          })()}
          {step.status === "error" && step.error && (
            <p className="step-card__error" title={step.error}>
              {step.error}
            </p>
          )}
          {hasLog && (
            <button onClick={() => setLogOpen((o) => !o)} className="step-card__log-toggle">
              {logOpen ? "Hide agent log ▲" : `View agent log (${step.decisionLog!.length} steps) ▼`}
            </button>
          )}
        </div>

        {step.status === "done" && step.handoff_url && (
          <button onClick={handleOpenAgentLink} className="step-card__open-cta">
            Open →
          </button>
        )}
      </div>

      {/* Live log — shown while agent is running */}
      {step.status === "loading" && <LiveLogPanel jobId={jobId} />}

      {/* Decision log */}
      {logOpen && step.decisionLog && (
        <div className="step-card__log">
          <p className="step-card__log-eyebrow">Agent decision log</p>
          {step.decisionLog.map((entry, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, alignItems: "flex-start",
              padding: entry.type === "scene_replan" ? "4px 6px" : "0",
              borderRadius: entry.type === "scene_replan" ? 6 : 0,
              background: entry.type === "scene_replan" ? "rgba(139,92,246,0.06)" : "transparent",
              marginLeft: entry.type === "scene_replan" ? -6 : 0,
            }}>
              <span style={{ flexShrink: 0, width: 16, fontFamily: "var(--font-dm-sans)", fontSize: 11, color: logEntryColor(entry.type), fontWeight: 700, textAlign: "center" }}>
                {logEntryIcon(entry.type)}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: entry.type === "scene_replan" ? "#7c3aed" : "var(--text-primary, #111)" }}>{entry.message}</p>
                {entry.outcome && <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: logEntryColor(entry.type) }}>{entry.outcome}</p>}
              </div>
              <span style={{ flexShrink: 0, fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>
                {formatTime(entry.ts)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action item — needs help card */}
      {step.actionItem && (
        <NeedsHelpCard
          step={step}
          onManualLink={handleManualLink}
          jobId={jobId}
          stepIndex={stepIndex}
          onRefresh={onRefresh}
        />
      )}

      {/* Human intervention banner — awaiting_confirmation or needs_login */}
      {(step.status === "awaiting_confirmation" || (step.status === "error" && step.handoff_url && step.handoff_url !== step.fallbackUrl)) && (
        <InterventionBanner step={step} jobId={jobId} onOpenLive={onOpenLive} />
      )}

      {/* Restaurant not on any platform — show official website or fallback */}
      {step.type === "restaurant" &&
        step.status === "no_availability" &&
        ((step.error ?? "").toLowerCase().includes("not found on opentable") ||
         (step.error ?? "").toLowerCase().includes("not on opentable or resy") ||
         (step.error ?? "").toLowerCase().includes("is not on opentable or resy")) && (() => {
          const hasOfficialSite = step.handoff_url && !step.handoff_url.includes("opentable.com") && !step.handoff_url.includes("resy.com") && step.handoff_url.startsWith("http");
          const hasOfficialWebsite = hasOfficialSite;
          return (
            <div style={{
              borderTop: "0.5px solid rgba(220,38,38,0.2)", padding: "12px 14px",
              background: "rgba(220,38,38,0.04)", display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ fontSize: 16 }}>{hasOfficialWebsite ? "🌐" : "🔍"}</span>
                <div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "rgba(220,38,38,0.85)", margin: 0 }}>
                    {hasOfficialWebsite ? "Not on OpenTable or Resy" : "Not found on OpenTable or Resy"}
                  </p>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", margin: "4px 0 0" }}>
                    {hasOfficialWebsite
                      ? `Found their official website — tap to book directly.`
                      : `${step.label} may be walk-in only or use a different booking system.`}
                  </p>
                </div>
              </div>
              {hasOfficialWebsite ? (
                <a href={step.handoff_url} target="_blank" rel="noopener noreferrer" style={{
                  display: "block", width: "100%", padding: "9px 0", borderRadius: 10,
                  background: "rgba(220,38,38,0.75)", color: "#fff", textAlign: "center",
                  fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                }}>
                  Book on official website →
                </a>
              ) : (
                <a href={`https://www.google.com/search?q=${encodeURIComponent(step.label + " reservation")}`} target="_blank" rel="noopener noreferrer" style={{
                  display: "block", width: "100%", padding: "9px 0", borderRadius: 10,
                  background: "rgba(220,38,38,0.75)", color: "#fff", textAlign: "center",
                  fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700,
                  textDecoration: "none",
                }}>
                  Search for reservation options →
                </a>
              )}
            </div>
          );
        })()
      }

      {/* Restaurant time-slot picker — shown when there are alternative slots */}
      {step.type === "restaurant" &&
        (step.status === "error" || step.status === "no_availability") &&
        !(step.error ?? "").toLowerCase().includes("not found on opentable") &&
        Array.isArray((step.body as Record<string, unknown>).availableSlots) &&
        ((step.body as Record<string, unknown>).availableSlots as string[]).length > 0 && (
        <RestaurantTimePicker step={step} stepIndex={stepIndex} jobId={jobId} onBooked={onRefresh ?? (() => {})} />
      )}

      {/* Retry scheduling — shown for failed steps without an action item */}
      {(step.status === "error" || step.status === "no_availability") &&
        !(step.error ?? "").toLowerCase().includes("not found on opentable") &&
        !(step.type === "restaurant" && Array.isArray((step.body as Record<string, unknown>).availableSlots) && ((step.body as Record<string, unknown>).availableSlots as string[]).length > 0) && (
        <RetryScheduler
          step={step}
          stepIndex={stepIndex}
          jobId={jobId}
          onScheduled={onRefresh ?? (() => {})}
        />
      )}
    </div>
  );
}

// ── Intervention banner + modal ────────────────────────────────────────────────

function InterventionBanner({ step, jobId, onOpenLive }: { step: BookingJobStep; jobId: string; onOpenLive?: () => void }) {
  const [open, setOpen] = useState(true); // auto-open when first rendered

  const isPaymentWait = step.status === "awaiting_confirmation";
  const hasCloudSession = !!step.session_url; // Browserbase mode
  const color = isPaymentWait ? "rgba(22,163,74,0.85)" : "rgba(220,38,38,0.8)";
  const bg = isPaymentWait ? "rgba(22,163,74,0.06)" : "rgba(220,38,38,0.05)";
  const border = isPaymentWait ? "rgba(22,163,74,0.25)" : "rgba(220,38,38,0.2)";
  const emoji = isPaymentWait ? "🖥️" : "🔑";
  const title = isPaymentWait ? "Agent paused — ready for your review" : "Agent needs your help";
  const subtitle = isPaymentWait
    ? hasCloudSession
      ? "The agent filled what it can. Open the page, review the details, and complete the final site step yourself."
      : "The agent filled what it can. Watch the live browser, review the details, and complete the final site step yourself."
    : "The site requires your login. Open the link, sign in, then the agent can continue.";

  return (
    <>
      {/* Inline banner — uses .intervention BEM with semantic accent (gold for
          payment-pending, red for sign-in-needed). border/bg/color stay
          inline so each variant uses its own semantic color stack. */}
      <div className="intervention" style={{ borderTopColor: border, background: bg }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <p className="intervention__title" style={{ color }}>
              {emoji} {title}
            </p>
            <p className="intervention__msg">{subtitle}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {isPaymentWait && hasCloudSession && (
              <a
                href={step.session_url}
                target="_blank"
                rel="noopener noreferrer"
                className="intervention__btn"
                style={{ background: color }}
              >
                🖥️ Open page →
              </a>
            )}
            {isPaymentWait && !hasCloudSession && (
              <button
                onClick={() => onOpenLive?.()}
                className="intervention__btn"
                style={{ background: "transparent", color, border: `1px solid ${color}` }}
              >
                🖥️ Watch live
              </button>
            )}
            <button
              onClick={() => setOpen(true)}
              className="intervention__btn"
              style={{ background: color }}
            >
              Details →
            </button>
          </div>
        </div>
      </div>
      {/* Modal */}
      {open && step.handoff_url && (
        <div className="intervention-modal__backdrop" onClick={() => setOpen(false)}>
          <div className="intervention-modal__content" onClick={(e) => e.stopPropagation()}>
            <div className="intervention-modal__icon">{emoji}</div>
            <p className="intervention-modal__title">{title}</p>
            <p className="intervention-modal__subtitle">{subtitle}</p>

            <div className="intervention-modal__what">
              <p className="intervention-modal__what-label">What the agent did</p>
              <p className="intervention-modal__what-text">
                {step.decisionLog?.filter(e => e.type === "succeeded").at(-1)?.message
                  ?? "Navigated the booking site and filled in all available details."}
              </p>
            </div>

            {/* CTA — three cases (cloud session / local browser / generic link). color
                stays inline because each variant uses its semantic stack. */}
            {hasCloudSession ? (
              <>
                <a
                  href={step.session_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="intervention-modal__cta"
                  style={{ background: color, color: "#fff" }}
                >
                  🖥️ Open page →
                </a>
                <p className="intervention-modal__caption">
                  Opens in a cloud browser. Review the details and complete the final site step yourself.
                </p>
              </>
            ) : step.handoff_url && (step.handoff_url.includes("basket_id=") || step.handoff_url.includes("secure.booking.com/book")) ? (
              <div
                className="intervention-modal__instructions"
                style={{
                  border: `1px solid ${color}`,
                  background: isPaymentWait ? "rgba(22,163,74,0.06)" : "rgba(220,38,38,0.05)",
                }}
              >
                <span style={{ fontSize: 20 }}>🖥️</span><br />
                <strong>Use OneAgent live browser or the local browser window</strong><br />
                <span style={{ fontSize: 12, color: "var(--ink-6)" }}>
                  The booking session is open in the Playwright browser on your screen.<br />
                  Find that window, enter the CVV, and click 完成预订.
                </span>
              </div>
            ) : (
              <a
                href={step.handoff_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="intervention-modal__cta"
                style={{ background: color, color: "#fff" }}
              >
                {isPaymentWait ? "Complete payment →" : "Sign in to continue →"}
              </a>
            )}

            <button onClick={() => setOpen(false)} className="intervention-modal__dismiss">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Job card ───────────────────────────────────────────────────────────────────

function CompactJobCard({
  job,
  loading,
  onLoadDetail,
  onDelete,
  onOpenLive,
}: {
  job: BookingJobListItem;
  loading: boolean;
  onLoadDetail: (jobId: string) => void;
  onDelete: (jobId: string, force?: boolean) => Promise<void>;
  onOpenLive: (jobId: string) => void;
}) {
  const isRunning = job.status === "running";
  const isComplete = job.status === "done" || job.status === "failed";
  const isQueued = job.status === "pending" || job.status === "pending_local";
  const evidence = getTaskEvidenceHref(job);
  const details = getTaskWorkspaceHref(job);
  const dotColor = isRunning
    ? "var(--gold, #D4A34B)"
    : isQueued
      ? "var(--text-muted, #aaa)"
      : job.status === "done"
        ? "rgba(22,163,74,0.85)"
        : "rgba(220,38,38,0.75)";

  return (
    <div className={`job-card${isComplete && job.status === "done" ? " job-card--succeeded" : ""}`}>
      <div onClick={() => onLoadDetail(job.id)} className="job-card__header">
        <div
          className="job-card__status-dot"
          style={{
            backgroundColor: dotColor,
            animation: isRunning ? "jobpulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        <div className="job-card__summary">
          <p className="job-card__title">{job.trip_label}</p>
          <div className="job-card__meta-row">
            <span
              className="job-card__meta-item job-card__meta-item--strong"
              style={{ color: dotColor }}
            >
              {job.latest_status_label}
            </span>
            <span className="job-card__meta-item">
              {job.ready_step_count}/{job.step_count} ready
            </span>
            {job.action_count > 0 && (
              <span className="job-card__meta-item job-card__meta-item--alert">
                {job.action_count} need{job.action_count > 1 ? "" : "s"} decision
              </span>
            )}
            <span className="job-card__meta-item job-card__meta-item--muted">
              {formatDate(job.created_at)}
            </span>
          </div>
        </div>
        <div className="job-card__actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenLive(job.id);
            }}
            className={`job-card__cta ${isRunning ? "job-card__cta--watch" : "job-card__cta--watch-replay"}`}
            title={isRunning ? "Watch current evidence" : "Open saved evidence"}
          >
            {isRunning ? "Watch" : "Evidence"}
          </button>
          <a
            href={details}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onLoadDetail(job.id);
            }}
            className="job-card__cta job-card__cta--open-all"
          >
            {loading ? "Loading..." : "Details"}
          </a>
          <a
            href={evidence}
            onClick={(event) => event.stopPropagation()}
            className="sr-only"
          >
            Open task evidence
          </a>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete(job.id, isRunning);
            }}
            title={isRunning ? "Force remove this running task" : "Delete task record"}
            className={`job-card__delete${isRunning ? " job-card__delete--running" : ""}`}
          >
            🗑
          </button>
        </div>
      </div>
      <div className="job-card__body" style={{ padding: "10px 16px 16px" }}>
        <p className="job-card__section-label job-card__section-label--muted">
          {loading
            ? "Loading task detail..."
            : "Compact task row loaded. Open Details to load logs and step evidence."}
        </p>
      </div>
    </div>
  );
}

function JobCard({ job, onRefresh, sessionId, onOpenLive }: { job: BookingJob; onRefresh?: () => void; sessionId: string; onOpenLive?: (jobId: string) => void }) {
  const [expanded, setExpanded] = useState(job.status !== "pending");
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [addToTripOpen, setAddToTripOpen] = useState(false);
  const prevStatusRef = useRef(job.status);

  // Auto-open live panel when job transitions to "running" or "done".
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (
      (isActiveJobStatus(job.status) && !isActiveJobStatus(prev)) ||
      (job.status === "done" && isActiveJobStatus(prev))
    ) {
      onOpenLive?.(job.id);
    }
    prevStatusRef.current = job.status;
  }, [job.status, onOpenLive]);

  const doneCount = job.steps.filter((s) => s.status === "done").length;
  const actionCount = job.steps.filter((s) => s.actionItem).length;
  const adjustedCount = job.steps.filter((s) => s.timeAdjusted || s.usedFallback).length;
  const replanCount = job.steps.filter((s) => s.replanAdjusted || s.replanFlagged).length;
  const isRunning = isActiveJobStatus(job.status);
  const isComplete = job.status === "done" || job.status === "failed";

  // Detect stuck "running" jobs: Vercel function timeout kills the process before
  // updateBookingJobStatus() runs, leaving the job permanently in "running" state.
  const isStuck = job.status === "running" &&
    Date.now() - new Date(job.updated_at).getTime() > 7 * 60 * 1000;

  async function handleResetStuck(e: React.MouseEvent) {
    e.stopPropagation();
    if (resetting) return;
    setResetting(true);
    try {
      // POST to start again — start/route.ts detects stuck jobs and auto-resets them
      await fetch(`/api/booking-jobs/${job.id}/start?executor=inline`, { method: "POST" });
      invalidateTaskData(job.id);
      onRefresh?.();
    } finally {
      setResetting(false);
    }
  }

  const semanticStatus = computeJobSemanticStatus(job);
  const statusDisplay = semanticStatus === "awaiting_payment"
    ? { ...JOB_SEMANTIC_DISPLAY[semanticStatus], label: "Ready to review — confirm on site" }
    : JOB_SEMANTIC_DISPLAY[semanticStatus];

  function openAll() {
    for (const s of job.steps.filter((s) => s.status === "done" && s.handoff_url)) {
      window.open(s.handoff_url!, "_blank");
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      const force = isActiveJobStatus(job.status);
      await fetch(`/api/booking-jobs/${job.id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      invalidateTaskData(job.id);
      onRefresh?.();
    } finally {
      setDeleting(false);
    }
  }

  const jobCardClass = `job-card${
    semanticStatus === "blocked_needs_user_input" || semanticStatus === "partially_completed"
      ? " job-card--needs-action"
      : semanticStatus.startsWith("succeeded")
      ? " job-card--succeeded"
      : ""
  }`;

  return (
    <div className={jobCardClass}>
      {/* Header */}
      <div onClick={() => setExpanded((e) => !e)} className="job-card__header">
        <div
          className="job-card__status-dot"
          style={{
            backgroundColor: statusDisplay.color,
            animation: statusDisplay.animate ? "jobpulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        <div className="job-card__summary">
          <p className="job-card__title">{job.trip_label}</p>
          <div className="job-card__meta-row">
            <span
              className="job-card__meta-item job-card__meta-item--strong"
              style={{ color: statusDisplay.color }}
            >
              {statusDisplay.label}
            </span>
            {isComplete && (
              <span className="job-card__meta-item">
                {doneCount}/{job.steps.length} ready
              </span>
            )}
            {adjustedCount > 0 && (
              <span className="job-card__meta-item job-card__meta-item--warn">
                {adjustedCount} agent adjustment{adjustedCount > 1 ? "s" : ""}
              </span>
            )}
            {replanCount > 0 && (
              <span className="job-card__meta-item job-card__meta-item--purple">
                ⟳ {replanCount} scene replan{replanCount > 1 ? "s" : ""}
              </span>
            )}
            {actionCount > 0 && (
              <span className="job-card__meta-item job-card__meta-item--alert">
                {actionCount} need{actionCount > 1 ? "" : "s"} decision
              </span>
            )}
            <span className="job-card__meta-item job-card__meta-item--muted">
              {formatDate(job.created_at)}
            </span>
          </div>
        </div>
        <div className="job-card__actions">
          {(isRunning || (isComplete && Date.now() - new Date(job.updated_at).getTime() < 90_000)) && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenLive?.(job.id); }}
              className={`job-card__cta ${isRunning ? "job-card__cta--watch" : "job-card__cta--watch-replay"}`}
            >
              {isRunning ? "🖥️ Watch live" : "🖥️ Replay"}
            </button>
          )}
          {job.status === "done" && doneCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); openAll(); }}
              className="job-card__cta job-card__cta--open-all"
            >
              Open all →
            </button>
          )}
          {job.status === "done" && (() => {
            // own_share is attached server-side in /api/booking-jobs when the
            // signed-in user owns this job. Type isn't on BookingJob since
            // the shape comes from the API layer; pull it via a local cast.
            const ownShare = (job as BookingJob & {
              own_share?: { slug: string; view_count: number; visibility: string } | null;
            }).own_share;
            if (ownShare) {
              return (
                <a
                  href={`/s/${ownShare.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="job-card__cta job-card__cta--open-all"
                  title="Open public share page"
                  style={{ color: "var(--gold-text, #5A4416)" }}
                >
                  ↗ Shared · {ownShare.view_count}{" "}
                  {ownShare.view_count === 1 ? "view" : "views"}
                </a>
              );
            }
            return (
              <button
                onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                className="job-card__cta job-card__cta--open-all"
                title="Share this trip"
              >
                ↗ Share
              </button>
            );
          })()}
          {job.status === "done" && (
            <button
              onClick={(e) => { e.stopPropagation(); setAddToTripOpen(true); }}
              className="job-card__cta job-card__cta--open-all"
              title="Group this booking into a trip"
            >
              🧳 Add to trip
            </button>
          )}
          {isStuck && (
            <button
              onClick={handleResetStuck}
              disabled={resetting}
              title="Job appears stuck — click to reset and retry"
              className="job-card__cta job-card__cta--reset"
            >
              {resetting ? "Starting…" : "↺ Reset & Retry"}
            </button>
          )}
          <span style={{ position: "relative" }}>
            <ModifyTaskButton job={job} onRefresh={onRefresh} />
          </span>
          <span className="job-card__expand">{expanded ? "▲" : "▼"}</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title={isRunning ? "Force remove this running trip" : "Delete trip record"}
            className={`job-card__delete${isRunning ? " job-card__delete--running" : ""}`}
            style={{ opacity: deleting ? 0.4 : 1 }}
          >
            🗑
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="job-card__body">
            {/* Tier: needs decision (floated to top) */}
            {actionCount > 0 && (
              <>
                <p className="job-card__section-label job-card__section-label--alert">
                  Needs your decision
                </p>
                {job.steps.filter((s) => s.actionItem).map((step, i) => (
                  <StepCard key={`a-${i}`} step={step} stepIndex={job.steps.indexOf(step)} jobId={job.id} onRefresh={onRefresh} onOpenLive={() => onOpenLive?.(job.id)} />
                ))}
                <div style={{ height: 2 }} />
              </>
            )}
            {/* Other steps */}
            {actionCount > 0 && (
              <p className="job-card__section-label job-card__section-label--muted">
                Other steps
              </p>
            )}
            {job.steps.filter((s) => !s.actionItem).map((step, i) => (
              <StepCard key={`s-${i}`} step={step} stepIndex={job.steps.indexOf(step)} jobId={job.id} onRefresh={onRefresh} onOpenLive={() => onOpenLive?.(job.id)} />
            ))}
          </div>

          <WhatsNext job={job} />

          {/* Active monitors — show after job completes */}
          {isComplete && (
            <MonitorPanel jobId={job.id} sessionId={sessionId} />
          )}

          {/* Satisfaction widget for completed jobs */}
          {isComplete && <SatisfactionWidget jobId={job.id} />}

        </>
      )}

      {/* Share modal — mounted at JobCard level so the open state lives next
          to the trigger button up in the action row. */}
      <ShareTripModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        kind="booking"
        refId={job.id}
      />
      <AddToTripModal
        isOpen={addToTripOpen}
        onClose={() => setAddToTripOpen(false)}
        itemKind="booking_job"
        itemId={job.id}
        fallbackNewTitle={job.trip_label}
      />
    </div>
  );
}

// ── Monitor panel ─────────────────────────────────────────────────────────────

const MONITOR_TYPE_LABEL: Record<string, string> = {
  availability_watch: "Watching for availability",
  reservation_check:  "Checking reservation",
  weather_alert:      "Monitoring weather",
};

const MONITOR_TYPE_EMOJI: Record<string, string> = {
  availability_watch: "🔔",
  reservation_check:  "📋",
  weather_alert:      "⛅",
};

const MONITOR_STATUS_COLOR: Record<string, string> = {
  active:    "var(--gold, #D4A34B)",
  triggered: "rgba(220,38,38,0.8)",
  paused:    "var(--text-muted, #aaa)",
  cancelled: "var(--text-muted, #aaa)",
  resolved:  "rgba(22,163,74,0.7)",
};

function MonitorPanel({ jobId, sessionId }: { jobId: string; sessionId: string }) {
  const [monitors, setMonitors] = useState<BookingMonitor[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    fetch(`/api/monitors?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((d) => {
        const jobMonitors = (d.monitors ?? []).filter((m: BookingMonitor) => m.job_id === jobId);
        setMonitors(jobMonitors);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [jobId, sessionId, loaded]);

  async function cancelMonitor(id: string) {
    await fetch(`/api/monitors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    }).catch(() => {});
    setMonitors((prev) => prev.map((m) => m.id === id ? { ...m, status: "cancelled" } : m));
  }

  async function deleteMonitor(id: string) {
    await fetch(`/api/monitors/${id}`, { method: "DELETE" }).catch(() => {});
    setMonitors((prev) => prev.filter((m) => m.id !== id));
  }

  const active = monitors.filter((m) => m.status === "active");
  const triggered = monitors.filter((m) => m.status === "triggered");

  if (!loaded || monitors.length === 0) return null;

  return (
    <div className="monitor-panel" style={{ padding: 0 }}>
      <div
        className="monitor-panel__header"
        style={{ padding: "10px 14px", background: "var(--card-2)", margin: 0 }}
      >
        <span style={{ fontSize: 13 }}>📡</span>
        <p
          className="monitor-panel__title"
          style={{ fontSize: 12, marginTop: 0, flex: 1 }}
        >
          Agent monitoring
        </p>
        {active.length > 0 && (
          <span className="insights__chip insights__chip--gold" style={{ fontSize: 10, fontWeight: 700 }}>
            {active.length} active
          </span>
        )}
        {triggered.length > 0 && (
          <span
            className="insights__chip"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              background: "rgba(220,38,38,0.85)",
              borderColor: "rgba(220,38,38,0.85)",
            }}
          >
            {triggered.length} alert{triggered.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="monitor-panel__list" style={{ gap: 0 }}>
        {monitors.map((monitor) => (
          <div
            key={monitor.id}
            className="monitor-panel__item"
            style={{
              borderRadius: 0,
              borderTop: "1px solid var(--ink-2)",
              border: "none",
              padding: "10px 14px",
              background: monitor.status === "triggered" ? "rgba(220,38,38,0.03)" : "transparent",
              opacity: monitor.status === "cancelled" ? 0.5 : 1,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                marginTop: 6,
                width: 7,
                height: 7,
                borderRadius: "var(--radius-pill)",
                backgroundColor: MONITOR_STATUS_COLOR[monitor.status] ?? "var(--ink-4)",
                animation: monitor.status === "active" ? "jobpulse 2s ease-in-out infinite" : "none",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>{monitor.step_emoji}</span>
                <p className="monitor-panel__item-text" style={{ fontWeight: 600 }}>
                  {monitor.step_label}
                </p>
                <span className="monitor-panel__item-meta" style={{ marginTop: 0 }}>
                  {MONITOR_TYPE_EMOJI[monitor.type]} {MONITOR_TYPE_LABEL[monitor.type] ?? monitor.type}
                </span>
                {monitor.status === "cancelled" && (
                  <span className="monitor-panel__item-meta" style={{ marginTop: 0 }}>· stopped</span>
                )}
              </div>

              {monitor.status === "triggered" && monitor.trigger_message && (
                <div
                  style={{
                    marginTop: 5,
                    padding: "6px 8px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(220,38,38,0.06)",
                    border: "1px solid rgba(220,38,38,0.2)",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      color: "rgba(185,28,28,0.9)",
                      lineHeight: 1.45,
                    }}
                  >
                    ⚠ {monitor.trigger_message}
                  </p>
                  {monitor.trigger_data && typeof (monitor.trigger_data as Record<string, unknown>).handoff_url === "string" && (
                    <a
                      href={(monitor.trigger_data as Record<string, string>).handoff_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 5,
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "rgba(185,28,28,0.95)",
                      }}
                    >
                      Book now →
                    </a>
                  )}
                </div>
              )}

              {monitor.last_checked_at && monitor.status === "active" && (
                <p className="monitor-panel__item-meta">
                  Last checked {formatTime(monitor.last_checked_at)}
                  {" · "} Next check {formatTime(monitor.next_check_at)}
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {(monitor.status === "active" || monitor.status === "triggered") && (
                <button onClick={() => cancelMonitor(monitor.id)} className="monitor-panel__item-action">
                  Stop
                </button>
              )}
              <button
                onClick={() => deleteMonitor(monitor.id)}
                title="Delete monitor"
                className="monitor-panel__item-action"
                style={{ padding: "2px 6px", lineHeight: 1, fontSize: 11 }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MonitoringWorkspaceGroup {
  jobId: string;
  tripLabel: string;
  monitors: BookingMonitor[];
}

function MonitoringWorkspacePanel({
  sessionId,
  jobs,
  onOpenJob,
  onDeleteJob,
}: {
  sessionId: string;
  jobs: Array<Pick<BookingJobListItem, "id" | "trip_label">>;
  onOpenJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => Promise<boolean>;
}) {
  const [groups, setGroups] = useState<MonitoringWorkspaceGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!sessionId) {
      setGroups([]);
      setLoaded(true);
      return;
    }

    try {
      const res = await fetch(`/api/monitors?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json().catch(() => ({ monitors: [] }));
      let monitors: BookingMonitor[] = data.monitors ?? [];

      // Live monitors group by job_id; if the underlying job was nuked but the
      // monitor rows survived (legacy clear-all before cascade), the card would
      // otherwise linger forever. Fire-and-forget cleanup + re-fetch once.
      const jobIds = new Set(jobs.map((j) => j.id));
      const hasOrphan = monitors.some((m) => !jobIds.has(m.job_id));
      if (hasOrphan) {
        const cleanupRes = await fetch("/api/monitors/cleanup-orphans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const cleanupBody = await cleanupRes.json().catch(() => ({ removed: 0 }));
        if ((cleanupBody.removed ?? 0) > 0) {
          const re = await fetch(`/api/monitors?session_id=${encodeURIComponent(sessionId)}`);
          const reData = await re.json().catch(() => ({ monitors: [] }));
          monitors = reData.monitors ?? [];
        }
      }
      const next = new Map<string, MonitoringWorkspaceGroup>();

      for (const monitor of monitors) {
        if (!next.has(monitor.job_id)) {
          const job = jobs.find((candidate) => candidate.id === monitor.job_id);
          next.set(monitor.job_id, {
            jobId: monitor.job_id,
            tripLabel: job?.trip_label ?? monitor.step_label ?? "Task",
            monitors: [],
          });
        }
        next.get(monitor.job_id)!.monitors.push(monitor);
      }

      setGroups([...next.values()]);
    } finally {
      setLoaded(true);
    }
  }, [jobs, sessionId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const timer = setInterval(loadGroups, 60000);
    return () => clearInterval(timer);
  }, [loadGroups]);

  const total = groups.reduce((count, group) => count + group.monitors.length, 0);
  const active = groups.reduce((count, group) => count + group.monitors.filter((monitor) => monitor.status === "active").length, 0);
  const alerts = groups.reduce((count, group) => count + group.monitors.filter((monitor) => monitor.status === "triggered").length, 0);

  if (!loaded) {
    return (
      <div className="monitor-panel">
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--ink-6)" }}>
          Loading live monitors...
        </p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div
        className="monitor-panel"
        style={{ textAlign: "center", padding: "var(--space-10) var(--space-6)", borderStyle: "dashed" }}
      >
        <p
          style={{
            fontSize: 24,
            fontWeight: 700,
            marginBottom: 10,
            color: "var(--ink-8)",
            fontFamily: "var(--font-dm-sans)",
          }}
        >
          Live
        </p>
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontWeight: 600,
            fontSize: 14,
            marginBottom: 6,
            color: "var(--ink-7)",
          }}
        >
          No live monitors
        </p>
        <p className="monitor-panel__empty" style={{ padding: 0, fontStyle: "normal" }}>
          Availability watches and reservation checks will appear here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "stretch", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "Monitors", value: total },
          { label: "Active", value: active },
          { label: "Alerts", value: alerts },
        ].map((item) => (
          <div key={item.label} className="insights__metric" style={{ minWidth: 120 }}>
            <div className="insights__metric-label">{item.label}</div>
            <div className="insights__metric-value">{item.value}</div>
          </div>
        ))}
      </div>

      {groups.map((group) => {
        const latest = [...group.monitors].sort((a, b) => +new Date(b.last_checked_at ?? b.created_at) - +new Date(a.last_checked_at ?? a.created_at))[0];
        return (
          <div key={group.jobId} className="monitor-panel">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontWeight: 700,
                    fontSize: 15,
                    color: "var(--ink-8)",
                    letterSpacing: "var(--tracking-tight)",
                  }}
                >
                  {group.tripLabel}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 12,
                    color: "var(--ink-6)",
                    marginTop: 4,
                  }}
                >
                  {group.monitors.length} live monitor{group.monitors.length === 1 ? "" : "s"} · Updated {timeAgo(latest?.last_checked_at ?? latest?.created_at)}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => onOpenJob(group.jobId)}
                  className="monitor-panel__item-action"
                  style={{ padding: "8px 12px", fontWeight: 600 }}
                >
                  Open task
                </button>
                <button
                  type="button"
                  disabled={deletingId === group.jobId}
                  onClick={async () => {
                    if (deletingId) return;
                    if (!confirm(`Delete task "${group.tripLabel}"?`)) return;
                    setDeletingId(group.jobId);
                    const ok = await onDeleteJob(group.jobId);
                    if (ok) {
                      setGroups((prev) => prev.filter((g) => g.jobId !== group.jobId));
                    }
                    setDeletingId(null);
                  }}
                  className="monitor-panel__item-action"
                  style={{
                    padding: "8px 12px",
                    fontWeight: 600,
                    color: deletingId === group.jobId ? "var(--ink-4)" : "rgba(220,38,38,0.75)",
                  }}
                >
                  {deletingId === group.jobId ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>

            <div className="monitor-panel__list" style={{ marginTop: 14 }}>
              {group.monitors.map((monitor) => (
                <div key={monitor.id} className="monitor-panel__item">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="monitor-panel__item-text" style={{ fontWeight: 600 }}>
                      {monitor.step_emoji} {monitor.step_label}
                    </p>
                    <p className="monitor-panel__item-meta">
                      {monitor.type.replace(/_/g, " ")} · {monitor.status} · next check {timeAgo(monitor.next_check_at)}
                    </p>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      fontWeight: 700,
                      color: monitor.status === "triggered" ? "rgba(220,38,38,0.9)" : "var(--gold)",
                      textTransform: "uppercase",
                      letterSpacing: "var(--tracking-eyebrow)",
                    }}
                  >
                    {monitor.status === "triggered" ? "Alert" : "Watching"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agent Insights panel ───────────────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  opentable: "OpenTable",
  booking_com: "Booking.com",
  kayak: "Kayak",
  expedia: "Expedia",
};

const DECISION_LABELS: Record<string, string> = {
  primary: "First-try success",
  time_adjusted: "Time slot adjusted",
  venue_switched: "Venue switched",
  failed: "Fully failed",
};

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="insights__progress-track" style={{ flex: 1 }}>
      <div
        className="insights__progress-fill"
        style={{
          width: `${Math.round(value * 100)}%`,
          background: color,
        }}
      />
    </div>
  );
}

type InsightsTab = "overview" | "task" | "patterns" | "relationship";

const INSIGHTS_TABS: Array<{ id: InsightsTab; label: string }> = [
  { id: "overview",     label: "Overview"   },
  { id: "task",         label: "Scenarios"  },
  { id: "patterns",     label: "Patterns"   },
  { id: "relationship", label: "Profile"    },
];

function InsightsPanel({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InsightsTab>("overview");
  const [stats, setStats] = useState<AgentFeedbackStats | null>(null);
  const [policy, setPolicy] = useState<PolicyBias | null>(null);
  const [profile, setProfile] = useState<UserPreferenceProfile | null>(null);
  const [taskMemory, setTaskMemory] = useState<ScenarioMemory[]>([]);
  const [patternMemory, setPatternMemory] = useState<PatternMemory | null>(null);
  const [relationship, setRelationship] = useState<RelationshipProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [relEditMode, setRelEditMode] = useState(false);
  const [relForm, setRelForm] = useState({ name: "", type: "solo" as RelationshipType, constraints: "", avoid_types: "", notes: "" });

  useEffect(() => {
    if (!open || stats) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/booking-feedback?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json()),
      fetch(`/api/memory?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json()),
    ])
      .then(([feedbackData, memoryData]) => {
        setStats(feedbackData.stats ?? null);
        setPolicy(memoryData.bias ?? null);
        setProfile(memoryData.profile ?? null);
        setTaskMemory(memoryData.taskMemory ?? []);
        setPatternMemory(memoryData.patternMemory ?? null);
        setRelationship(memoryData.relationship ?? null);
        if (memoryData.relationship) {
          const rel = memoryData.relationship as RelationshipProfile;
          setRelForm({
            name: rel.name,
            type: rel.type,
            constraints: rel.constraints.join(", "),
            avoid_types: rel.avoid_types.join(", "),
            notes: rel.notes,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, sessionId, stats]);

  async function saveRelationship() {
    const id = relationship?.id ?? crypto.randomUUID();
    const payload: RelationshipProfile = {
      id,
      name: relForm.name,
      type: relForm.type,
      session_ids: [sessionId],
      constraints: relForm.constraints.split(",").map((s) => s.trim()).filter(Boolean),
      avoid_types: relForm.avoid_types.split(",").map((s) => s.trim()).filter(Boolean),
      notes: relForm.notes,
      created_at: relationship?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (relationship) {
      await fetch(`/api/relationships/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } else {
      await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
    setRelationship(payload);
    setRelEditMode(false);
  }

  if (!stats && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="monitor-panel__empty"
        style={{
          width: "100%",
          padding: 10,
          borderRadius: "var(--radius)",
          border: "1px dashed var(--ink-3)",
          background: "transparent",
          cursor: "pointer",
          fontStyle: "normal",
          color: "var(--ink-5)",
          fontSize: 12,
        }}
      >
        📊 View Agent Insights
      </button>
    );
  }

  return (
    <div className="insights__section" style={{ padding: 0 }}>
      {/* Header (collapse button) */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: "none",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <p
            className="insights__title"
            style={{ fontSize: 13, marginTop: 0 }}
          >
            Agent Insights
          </p>
          {stats && (
            <span
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                color: "var(--ink-5)",
                letterSpacing: "var(--tracking-tight)",
              }}
            >
              {stats.totalEvents} events
            </span>
          )}
        </div>
        <span style={{ color: "var(--ink-4)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Tab bar — Linear-style underline */}
      {open && (
        <div
          style={{
            borderTop: "1px solid var(--ink-2)",
            display: "flex",
            gap: 0,
            overflowX: "auto",
            background: "var(--card-2)",
          }}
        >
          {INSIGHTS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "10px 8px",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab.id
                  ? "2px solid var(--gold)"
                  : "2px solid transparent",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                fontWeight: activeTab === tab.id ? 700 : 500,
                color: activeTab === tab.id ? "var(--gold-text)" : "var(--ink-5)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                letterSpacing: "var(--tracking-eyebrow)",
                textTransform: "uppercase",
                transition: "all var(--motion-fast) var(--ease-out-expo)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div style={{ padding: "14px 16px" }}>
          {loading && (
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                color: "var(--ink-5)",
                textAlign: "center",
              }}
            >
              Loading…
            </p>
          )}

          {/* ── Task memory tab ── */}
          {!loading && activeTab === "task" && (
            <div className="insights">
              <p className="insights__subtitle" style={{ fontStyle: "italic", marginTop: 0 }}>
                How your preferences differ by booking context.
              </p>
              {taskMemory.length === 0 && (
                <p className="insights__empty" style={{ padding: 0, fontSize: 12 }}>
                  Complete a few trips with feedback to build scenario memory.
                </p>
              )}
              {taskMemory.map((mem) => (
                <div
                  key={`${mem.scenario}-${mem.stepType}`}
                  className="insights__list-item"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span
                        className="insights__chip"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#8b5cf6",
                          background: "rgba(139,92,246,0.08)",
                          borderColor: "rgba(139,92,246,0.25)",
                        }}
                      >
                        {mem.scenarioLabel}
                      </span>
                      <span
                        className="insights__chip"
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      >
                        {mem.stepType}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 10,
                        color: "var(--ink-5)",
                        letterSpacing: "var(--tracking-tight)",
                      }}
                    >
                      {mem.totalEvents} events
                    </span>
                  </div>
                  <p
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 12,
                      color: "var(--ink-8)",
                      lineHeight: 1.4,
                    }}
                  >
                    {mem.keyInsight}
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    {mem.timeAdjustAcceptance !== null && (
                      <div style={{ flex: 1 }}>
                        <p className="insights__metric-label" style={{ marginBottom: 3 }}>Time adjust</p>
                        <ProgressBar value={mem.timeAdjustAcceptance} color="rgba(234,88,12,0.7)" />
                        <p
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 10,
                            color: "rgba(234,88,12,0.85)",
                            marginTop: 2,
                            fontWeight: 600,
                          }}
                        >
                          {Math.round(mem.timeAdjustAcceptance * 100)}% accepted
                        </p>
                      </div>
                    )}
                    {mem.venueSwitchAcceptance !== null && (
                      <div style={{ flex: 1 }}>
                        <p className="insights__metric-label" style={{ marginBottom: 3 }}>Venue switch</p>
                        <ProgressBar value={mem.venueSwitchAcceptance} color="#6366f1" />
                        <p
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 10,
                            color: "#6366f1",
                            marginTop: 2,
                            fontWeight: 600,
                          }}
                        >
                          {Math.round(mem.venueSwitchAcceptance * 100)}% accepted
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Patterns tab ── */}
          {!loading && activeTab === "patterns" && (
            <div className="insights" style={{ gap: 16 }}>
              {!patternMemory && (
                <p className="insights__empty" style={{ padding: 0, fontSize: 12 }}>
                  Complete a few trips with feedback to build behavioral patterns.
                </p>
              )}

              {patternMemory && (
                <>
                  {/* Stated vs actual */}
                  <div>
                    <p className="insights__eyebrow" style={{ marginBottom: 8 }}>
                      Stated vs actual tolerance
                    </p>
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: "var(--radius)",
                        lineHeight: 1.5,
                        background:
                          patternMemory.statedVsActual.conclusion === "more_strict"
                            ? "rgba(220,38,38,0.04)"
                            : patternMemory.statedVsActual.conclusion === "more_liberal"
                            ? "rgba(22,163,74,0.04)"
                            : "var(--card-2)",
                        border: `1px solid ${
                          patternMemory.statedVsActual.conclusion === "more_strict"
                            ? "rgba(220,38,38,0.15)"
                            : patternMemory.statedVsActual.conclusion === "more_liberal"
                            ? "rgba(22,163,74,0.15)"
                            : "var(--ink-2)"
                        }`,
                      }}
                    >
                      <p
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                          color: "var(--ink-8)",
                          lineHeight: "var(--lh-normal)",
                        }}
                      >
                        {patternMemory.statedVsActual.insight}
                      </p>
                      {patternMemory.statedVsActual.actualAcceptanceRate !== null && (
                        <div style={{ marginTop: 8 }}>
                          <ProgressBar
                            value={patternMemory.statedVsActual.actualAcceptanceRate}
                            color={
                              patternMemory.statedVsActual.conclusion === "more_strict"
                                ? "rgba(220,38,38,0.65)"
                                : "rgba(22,163,74,0.75)"
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Satisfaction predictors */}
                  {patternMemory.satisfactionPredictors.length > 0 && (
                    <div>
                      <p className="insights__eyebrow" style={{ marginBottom: 8 }}>
                        What drives your satisfaction
                      </p>
                      {patternMemory.satisfactionPredictors.map((pred) => (
                        <div
                          key={pred.agentDecision}
                          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}
                        >
                          <div style={{ flex: 1 }}>
                            <p
                              style={{
                                fontFamily: "var(--font-dm-sans)",
                                fontSize: 11,
                                color: "var(--ink-6)",
                                lineHeight: "var(--lh-normal)",
                              }}
                            >
                              {pred.insight}
                            </p>
                          </div>
                          {pred.avgScore !== null && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <div style={{ width: 60 }}>
                                <ProgressBar
                                  value={pred.avgScore}
                                  color={
                                    pred.avgScore >= 0.7
                                      ? "rgba(22,163,74,0.75)"
                                      : pred.avgScore >= 0.4
                                      ? "var(--gold)"
                                      : "rgba(220,38,38,0.65)"
                                  }
                                />
                              </div>
                              <span
                                style={{
                                  fontFamily: "var(--font-dm-sans)",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: "var(--ink-7)",
                                  letterSpacing: "var(--tracking-tight)",
                                }}
                              >
                                {Math.round(pred.avgScore * 100)}%
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Override triggers */}
                  {patternMemory.overrideTriggers.length > 0 && (
                    <div>
                      <p className="insights__eyebrow" style={{ marginBottom: 8 }}>
                        When you take control
                      </p>
                      {patternMemory.overrideTriggers.map((t, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "5px 0",
                            borderBottom: "1px solid var(--ink-2)",
                          }}
                        >
                          <p
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 11,
                              color: "var(--ink-6)",
                            }}
                          >
                            {t.description}
                          </p>
                          <span
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 10,
                              fontWeight: 700,
                              color: "rgba(220,38,38,0.85)",
                              flexShrink: 0,
                              marginLeft: 8,
                              letterSpacing: "var(--tracking-tight)",
                            }}
                          >
                            {Math.round(t.overrideRate * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Relationship / Profile tab ── */}
          {!loading && activeTab === "relationship" && (
            <div className="insights" style={{ gap: 14 }}>
              <p className="insights__subtitle" style={{ fontStyle: "italic", marginTop: 0 }}>
                Who are you booking for? The agent remembers your group&apos;s preferences and history.
              </p>

              {!relEditMode && relationship && (
                <div className="insights__list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <p
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontWeight: 700,
                          fontSize: 14,
                          color: "var(--ink-8)",
                          letterSpacing: "var(--tracking-tight)",
                        }}
                      >
                        {relationship.name}
                      </p>
                      <p
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 11,
                          color: "var(--ink-5)",
                          textTransform: "capitalize",
                          letterSpacing: "var(--tracking-eyebrow)",
                          marginTop: 2,
                        }}
                      >
                        {relationship.type}
                      </p>
                    </div>
                    <button onClick={() => setRelEditMode(true)} className="monitor-panel__item-action">
                      Edit
                    </button>
                  </div>
                  {relationship.constraints.length > 0 && (
                    <div>
                      <p className="insights__metric-label" style={{ marginBottom: 4 }}>Needs</p>
                      <div className="insights__row">
                        {relationship.constraints.map((c) => (
                          <span key={c} className="insights__chip insights__chip--success">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {relationship.avoid_types.length > 0 && (
                    <div>
                      <p className="insights__metric-label" style={{ marginBottom: 4 }}>Avoids</p>
                      <div className="insights__row">
                        {relationship.avoid_types.map((a) => (
                          <span
                            key={a}
                            className="insights__chip"
                            style={{
                              color: "rgba(220,38,38,0.8)",
                              background: "rgba(220,38,38,0.06)",
                              borderColor: "rgba(220,38,38,0.25)",
                            }}
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {relationship.notes && (
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 11,
                        color: "var(--ink-6)",
                        lineHeight: "var(--lh-normal)",
                        fontStyle: "italic",
                      }}
                    >
                      {relationship.notes}
                    </p>
                  )}
                </div>
              )}

              {(!relationship || relEditMode) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    value={relForm.name}
                    onChange={(e) => setRelForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={relEditMode ? "Profile name" : "Give this profile a name (e.g. 'Alex & Jordan')"}
                    className="help-card__input"
                    style={{ fontSize: 12, padding: "8px 10px" }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["solo", "couple", "friends", "family"] as RelationshipType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setRelForm((f) => ({ ...f, type: t }))}
                        className={`hotel-card__site${relForm.type === t ? " hotel-card__site--active" : ""}`}
                        style={
                          relForm.type === t
                            ? {
                                borderColor: "var(--gold)",
                                color: "var(--gold-text)",
                                background: "var(--gold-soft)",
                                textTransform: "capitalize",
                              }
                            : { textTransform: "capitalize" }
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <input
                    value={relForm.constraints}
                    onChange={(e) => setRelForm((f) => ({ ...f, constraints: e.target.value }))}
                    placeholder="Must-haves (comma separated): quiet venue, needs parking, vegetarian"
                    className="help-card__input"
                    style={{ fontSize: 12, padding: "8px 10px" }}
                  />
                  <input
                    value={relForm.avoid_types}
                    onChange={(e) => setRelForm((f) => ({ ...f, avoid_types: e.target.value }))}
                    placeholder="Things to avoid: chain hotels, loud restaurants, outdoor in rain"
                    className="help-card__input"
                    style={{ fontSize: 12, padding: "8px 10px" }}
                  />
                  <textarea
                    value={relForm.notes}
                    onChange={(e) => setRelForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Free notes: 'She doesn't like spicy food. He hates jazz bars.'"
                    rows={2}
                    className="help-card__input"
                    style={{ fontSize: 12, padding: "8px 10px", resize: "none" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={saveRelationship}
                      disabled={!relForm.name.trim()}
                      className="help-card__send"
                      style={{ flex: 1, fontWeight: 700 }}
                    >
                      {relEditMode ? "Save changes" : "Create profile"}
                    </button>
                    {relEditMode && (
                      <button
                        onClick={() => setRelEditMode(false)}
                        className="monitor-panel__item-action"
                        style={{ padding: "8px 12px" }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === "overview" && stats && stats.totalEvents === 0 && (
            <p
              className="insights__empty"
              style={{ padding: 0, fontSize: 12 }}
            >
              No data yet — insights appear after you complete trips and give feedback.
            </p>
          )}

          {activeTab === "overview" && stats && stats.totalEvents > 0 && (
            <div className="insights" style={{ gap: 20 }}>

              {/* Acceptance rate */}
              <div>
                <p className="insights__eyebrow" style={{ marginBottom: 10 }}>
                  Did you accept the agent&apos;s decisions?
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ProgressBar value={stats.adjustmentAcceptanceRate} color="rgba(22,163,74,0.75)" />
                  <span
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "rgba(22,163,74,0.9)",
                      flexShrink: 0,
                      letterSpacing: "var(--tracking-tight)",
                    }}
                  >
                    {Math.round(stats.adjustmentAcceptanceRate * 100)}%
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      color: "rgba(22,163,74,0.85)",
                    }}
                  >
                    ✓ {stats.outcomeBreakdown.accepted} accepted
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      color: "rgba(220,38,38,0.8)",
                    }}
                  >
                    ↗ {stats.outcomeBreakdown.manual_override} manual override
                  </span>
                </div>
              </div>

              {/* Satisfaction */}
              {(stats.outcomeBreakdown.satisfied + stats.outcomeBreakdown.ok + stats.outcomeBreakdown.unsatisfied) > 0 && (
                <div>
                  <p className="insights__eyebrow" style={{ marginBottom: 8 }}>
                    Satisfaction
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    {[
                      { emoji: "😊", label: "Great", count: stats.outcomeBreakdown.satisfied },
                      { emoji: "👍", label: "OK", count: stats.outcomeBreakdown.ok },
                      { emoji: "😕", label: "Needed fixes", count: stats.outcomeBreakdown.unsatisfied },
                    ].map(({ emoji, label, count }) => (
                      <div
                        key={label}
                        className="insights__metric"
                        style={{ flex: 1, alignItems: "center", textAlign: "center" }}
                      >
                        <p style={{ fontSize: 20, marginBottom: 2 }}>{emoji}</p>
                        <p className="insights__metric-value" style={{ fontSize: 16 }}>
                          {count}
                        </p>
                        <p className="insights__metric-label">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Provider success rates */}
              {stats.providerStats.length > 0 && (
                <div>
                  <p className="insights__eyebrow" style={{ marginBottom: 10 }}>
                    Provider acceptance rates
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {stats.providerStats.map((p) => (
                      <div key={p.provider} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 12,
                            color: "var(--ink-7)",
                            width: 100,
                            flexShrink: 0,
                            letterSpacing: "var(--tracking-tight)",
                          }}
                        >
                          {PROVIDER_NAMES[p.provider] ?? p.provider}
                        </span>
                        <ProgressBar
                          value={p.rate}
                          color={
                            p.rate > 0.7
                              ? "rgba(22,163,74,0.75)"
                              : p.rate > 0.4
                              ? "var(--gold)"
                              : "rgba(220,38,38,0.65)"
                          }
                        />
                        <span
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                            minWidth: 36,
                            color: "var(--ink-8)",
                            letterSpacing: "var(--tracking-tight)",
                          }}
                        >
                          {Math.round(p.rate * 100)}%
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 10,
                            color: "var(--ink-4)",
                            flexShrink: 0,
                          }}
                        >
                          ({p.total})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step type manual rate */}
              {stats.manualByType.length > 0 && (
                <div>
                  <p className="insights__eyebrow" style={{ marginBottom: 10 }}>
                    Which tasks need most manual help?
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {stats.manualByType.map((t) => {
                      const manualRate = t.total > 0 ? t.manual / t.total : 0;
                      return (
                        <div key={t.step_type} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 12,
                              color: "var(--ink-7)",
                              width: 80,
                              flexShrink: 0,
                              textTransform: "capitalize",
                              letterSpacing: "var(--tracking-tight)",
                            }}
                          >
                            {t.step_type}
                          </span>
                          <ProgressBar value={manualRate} color="rgba(220,38,38,0.55)" />
                          <span
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 12,
                              flexShrink: 0,
                              color: "var(--ink-7)",
                            }}
                          >
                            {t.manual}/{t.total} manual
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Agent decision type usage */}
              {stats.decisionTypeUsage.length > 0 && (
                <div>
                  <p className="insights__eyebrow" style={{ marginBottom: 8 }}>
                    How the agent solved bookings
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {stats.decisionTypeUsage.map((d) => (
                      <div
                        key={d.agent_decision}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "4px 0",
                          borderBottom: "1px solid var(--ink-2)",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 12,
                            color: "var(--ink-7)",
                          }}
                        >
                          {DECISION_LABELS[d.agent_decision] ?? d.agent_decision}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--ink-8)",
                            letterSpacing: "var(--tracking-tight)",
                          }}
                        >
                          {d.count}×
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top overridden venues */}
              {stats.topOverriddenVenues.length > 0 && (
                <div>
                  <p className="insights__eyebrow" style={{ marginBottom: 8 }}>
                    Venues you most often booked differently
                  </p>
                  {stats.topOverriddenVenues.map((v) => (
                    <div
                      key={v.venue_name}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "4px 0",
                        borderBottom: "1px solid var(--ink-2)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                          color: "var(--ink-7)",
                        }}
                      >
                        {v.venue_name}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                          color: "rgba(220,38,38,0.8)",
                          fontWeight: 700,
                          letterSpacing: "var(--tracking-tight)",
                        }}
                      >
                        {v.overrides}× overridden
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── What the agent has learned (policy) ── */}
              {policy && policy.hasEnoughData && (
                <div style={{ borderTop: "0.5px solid var(--border, #e5e7eb)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--gold, #D4A34B)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    What the agent has learned
                  </p>

                  {/* Personal tolerance */}
                  {policy.personalTolerance && (
                    <div>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: 6 }}>Your behavior profile</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {[
                          {
                            label: "Time adjustment tolerance",
                            tolerance: policy.personalTolerance.timeAdjust,
                            rate: policy.personalTolerance.timeAdjustRate,
                            count: policy.personalTolerance.timeAdjustCount,
                          },
                          {
                            label: "Venue switch tolerance",
                            tolerance: policy.personalTolerance.venueSwitch,
                            rate: policy.personalTolerance.venueSwitchRate,
                            count: policy.personalTolerance.venueSwitchCount,
                          },
                        ].map(({ label, tolerance, rate, count }) => (
                          <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>{label}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>{count > 0 ? `${Math.round(rate * 100)}%` : ""}</span>
                              <span style={{
                                fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600,
                                color: tolerance === "liberal" ? "rgba(22,163,74,0.85)" : tolerance === "strict" ? "rgba(220,38,38,0.75)" : "var(--gold, #D4A34B)",
                                background: tolerance === "liberal" ? "rgba(22,163,74,0.08)" : tolerance === "strict" ? "rgba(220,38,38,0.08)" : "rgba(212,163,75,0.1)",
                                borderRadius: 6, padding: "2px 6px",
                              }}>
                                {tolerance}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Provider preference order */}
                  {policy.providerRanking.length > 0 && (
                    <div>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: 6 }}>Provider preference order</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {policy.providerRanking.map((p) => (
                          <div key={p.provider} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", width: 16, textAlign: "right", flexShrink: 0 }}>
                              #{p.preferenceRank}
                            </span>
                            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", flex: 1 }}>
                              {PROVIDER_NAMES[p.provider] ?? p.provider}
                            </span>
                            <span style={{
                              fontFamily: "var(--font-dm-sans)", fontSize: 11,
                              color: p.score > 0 ? "rgba(22,163,74,0.85)" : p.score < 0 ? "rgba(220,38,38,0.75)" : "var(--text-muted, #aaa)",
                              fontWeight: 600,
                            }}>
                              {p.score > 0 ? "+" : ""}{p.score.toFixed(1)}
                            </span>
                            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>
                              ({p.eventCount})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Trusted venues */}
                  {policy.topVenues.length > 0 && (
                    <div>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: 6 }}>Venues agent tries first</p>
                      {policy.topVenues.map((v) => (
                        <div key={v.venueName} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>{v.venueName}</span>
                          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(22,163,74,0.85)", fontWeight: 600 }}>
                            +{v.score.toFixed(1)} trusted
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Flagged venues */}
                  {policy.flaggedVenues.length > 0 && (
                    <div>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: 6 }}>Venues deprioritized by agent</p>
                      {policy.flaggedVenues.map((v) => (
                        <div key={v.venueName} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>{v.venueName}</span>
                          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(220,38,38,0.75)", fontWeight: 600 }}>
                            {v.score.toFixed(1)} often overridden
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Negative memory / preference profile ── */}
              {profile && profile.totalInteractions >= 5 && (
                <div style={{ borderTop: "0.5px solid var(--border, #e5e7eb)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "rgba(220,38,38,0.75)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Negative memory
                    </p>
                    <span style={{
                      fontFamily: "var(--font-dm-sans)", fontSize: 10,
                      color: profile.confidenceLevel === "high" ? "rgba(22,163,74,0.85)" : profile.confidenceLevel === "medium" ? "var(--gold, #D4A34B)" : "var(--text-muted, #aaa)",
                      background: profile.confidenceLevel === "high" ? "rgba(22,163,74,0.08)" : profile.confidenceLevel === "medium" ? "rgba(212,163,75,0.1)" : "rgba(0,0,0,0.04)",
                      borderRadius: 4, padding: "1px 5px",
                    }}>
                      {profile.confidenceLevel} confidence
                    </span>
                  </div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)", fontStyle: "italic" }}>
                    Things the agent now avoids based on your overrides:
                  </p>

                  {profile.negatives.length === 0 && (
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
                      No strong negative patterns detected yet.
                    </p>
                  )}

                  {profile.negatives.map((neg) => (
                    <div key={neg.entity} style={{
                      padding: "8px 10px", borderRadius: 8,
                      background: "rgba(220,38,38,0.04)",
                      border: "0.5px solid rgba(220,38,38,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <div>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600, color: "rgba(185,28,28,0.85)" }}>
                          {neg.entity}
                        </p>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)", marginTop: 1 }}>
                          {neg.entityType} · overridden {neg.overrideCount}/{neg.totalSeen}×
                        </p>
                      </div>
                      <span style={{
                        fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700,
                        color: neg.severity === "strong" ? "rgba(220,38,38,0.85)" : "rgba(234,88,12,0.85)",
                        background: neg.severity === "strong" ? "rgba(220,38,38,0.08)" : "rgba(234,88,12,0.08)",
                        borderRadius: 4, padding: "2px 6px",
                      }}>
                        {neg.severity === "strong" ? "avoid" : "deprioritize"}
                      </span>
                    </div>
                  ))}

                  {profile.avoidedProviders.length > 0 && (
                    <div>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: 4 }}>
                        Providers you tend to override
                      </p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {profile.avoidedProviders.map((p) => (
                          <span key={p} style={{
                            fontFamily: "var(--font-dm-sans)", fontSize: 11,
                            color: "rgba(220,38,38,0.75)", background: "rgba(220,38,38,0.06)",
                            borderRadius: 6, padding: "2px 7px",
                          }}>
                            {PROVIDER_NAMES[p] ?? p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TripsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<BookingJobListItem[]>([]);
  const [jobDetails, setJobDetails] = useState<Record<string, BookingJob>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [clearingAll, setClearingAll] = useState(false);
  const [showRestaurantForm, setShowRestaurantForm] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<TaskWorkspaceView>("queue");
  const [visibleLimit, setVisibleLimit] = useState(24);

  // ── Live panel state ──────────────────────────────────────────────────────────
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [splitPct, setSplitPct] = useState(50);
  const [liveViewKey, setLiveViewKey] = useState(0);
  // Refs for zero-latency drag — bypass React re-render during mousemove
  const splitPctRef = useRef(50);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const livePanelRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const jobRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const jobsRequestRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef<Record<string, AbortController>>({});
  const jobsSignatureRef = useRef("");
  // Track current liveJobId in a ref so openLive can read it without closure staleness
  const liveJobIdRef = useRef<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const openLive = useCallback((jobId: string) => {
    if (liveJobIdRef.current !== jobId) {
      setLiveViewKey((k) => k + 1);
    }
    liveJobIdRef.current = jobId;
    setLiveJobId(jobId);
  }, []);

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // Kill transition during drag so updates are instant
    if (mainContentRef.current) mainContentRef.current.style.transition = "none";

    function onMove(ev: MouseEvent) {
      const pct = Math.max(25, Math.min(75, (ev.clientX / window.innerWidth) * 100));
      splitPctRef.current = pct;
      const rightVw = `${100 - pct}vw`;
      // Direct DOM mutation — no React setState, no re-render
      if (mainContentRef.current)  mainContentRef.current.style.paddingRight = rightVw;
      if (livePanelRef.current)    livePanelRef.current.style.width = rightVw;
      if (dragHandleRef.current)   dragHandleRef.current.style.left = `${(ev.clientX - 3)}px`;
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Restore transition, then sync React state once
      if (mainContentRef.current) mainContentRef.current.style.transition = "";
      setSplitPct(splitPctRef.current);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const sessionId = typeof window !== "undefined" ? getSessionId() : "";

  const loadJobDetail = useCallback(async (jobId: string) => {
    if (!jobId || jobDetails[jobId] || detailLoading[jobId]) return;
    const controller = new AbortController();
    detailRequestRef.current[jobId]?.abort();
    detailRequestRef.current[jobId] = controller;
    setDetailLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      const job = await fetchTaskDetail(jobId, controller.signal);
      setJobDetails((prev) => ({ ...prev, [jobId]: job }));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        /* ignore detail polling failures */
      }
    } finally {
      if (detailRequestRef.current[jobId] === controller) {
        delete detailRequestRef.current[jobId];
      }
      setDetailLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  }, [detailLoading, jobDetails]);

  const loadJobs = useCallback(async () => {
    const sid = getSessionId();
    jobsRequestRef.current?.abort();
    const controller = new AbortController();
    jobsRequestRef.current = controller;
    try {
      const { jobs: nextJobs } = await fetchTaskCompactList(sid, controller.signal);
      const nextSignature = buildJobsRenderSignature(nextJobs);
      if (jobsSignatureRef.current !== nextSignature) {
        jobsSignatureRef.current = nextSignature;
        setJobs(nextJobs);
        setJobDetails((prev) => {
          const ids = new Set(nextJobs.map((job) => job.id));
          const next: Record<string, BookingJob> = {};
          for (const [id, job] of Object.entries(prev)) {
            if (ids.has(id)) next[id] = job;
          }
          return next;
        });
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        /* ignore transient polling failures */
      }
    } finally {
      if (jobsRequestRef.current === controller) {
        jobsRequestRef.current = null;
      }
      setLoading(false);
    }
  }, []);

  async function handleClearAll() {
    const sid = getSessionId();
    if (!sid || clearingAll) return;
    if (!confirm(`Delete all ${jobs.length} tasks and their monitors?`)) return;
    setClearingAll(true);
    try {
      await fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`, { method: "DELETE" });
      invalidateTaskData();
      jobsSignatureRef.current = "";
      setJobs([]);
      setJobDetails({});
    } finally {
      setClearingAll(false);
    }
  }

  useEffect(() => {
    loadJobs();
    return () => {
      jobsRequestRef.current?.abort();
      Object.values(detailRequestRef.current).forEach((controller) => controller.abort());
    };
  }, [loadJobs]);

  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running");
    if (!hasRunning) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        loadJobs();
      }
    };
    const timer = setInterval(refreshWhenVisible, 7000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [jobs, loadJobs]);

  useEffect(() => {
    if (selectedJobId && jobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(jobs[0]?.id ?? null);
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) return;
    loadJobDetail(selectedJobId);
  }, [loadJobDetail, selectedJobId]);

  useEffect(() => {
    const view = searchParams.get("view");
    const focusId = searchParams.get("focus");
    const panel = searchParams.get("panel");
    const nextView: TaskWorkspaceView =
      view === "live" || view === "history" ? view : "queue";
    setWorkspaceView(nextView);

    if (focusId) {
      setSelectedJobId(focusId);
      loadJobDetail(focusId);
      if (nextView === "live" || panel === "evidence") {
        openLive(focusId);
      } else {
        liveJobIdRef.current = null;
        setLiveJobId(null);
        requestAnimationFrame(() => {
          jobRefs.current[focusId]?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } else if (nextView !== "live") {
      liveJobIdRef.current = null;
      setLiveJobId(null);
    }
  }, [loadJobDetail, searchParams, openLive]);

  useEffect(() => {
    const explicitView = searchParams.get("view");
    const focusId = searchParams.get("focus");
    if (explicitView || !focusId) return;
    const focusedJob = jobs.find((job) => job.id === focusId);
    if (!focusedJob) return;
    const view = taskWorkspaceViewForJob(focusedJob);
    setWorkspaceView(view);
    router.replace(getTaskWorkspaceHref(focusedJob), { scroll: false });
  }, [jobs, router, searchParams]);

  const setWorkspaceViewAndUrl = useCallback((next: TaskWorkspaceView) => {
    setWorkspaceView(next);
    const href = next === "queue" ? "/tasks" : `/tasks?view=${next}`;
    router.replace(href, { scroll: false });
  }, [router]);

  const {
    queueJobs,
    liveJobs,
    historyJobs,
    visibleJobs,
    visibleActionTotal,
    actionTotal,
  } = useMemo(() => {
    const nextQueueJobs = jobs.filter((job) => taskWorkspaceViewForJob(job) === "queue");
    const nextLiveJobs = jobs.filter((job) => taskWorkspaceViewForJob(job) === "live");
    const nextHistoryJobs = jobs.filter((job) => taskWorkspaceViewForJob(job) === "history");
    const nextVisibleJobs =
      workspaceView === "live"
        ? nextLiveJobs
        : workspaceView === "history"
          ? nextHistoryJobs
          : nextQueueJobs;
    return {
      queueJobs: nextQueueJobs,
      liveJobs: nextLiveJobs,
      historyJobs: nextHistoryJobs,
      visibleJobs: nextVisibleJobs,
      visibleActionTotal: nextVisibleJobs.reduce((n, j) => n + j.action_count, 0),
      actionTotal: jobs.reduce((n, j) => n + j.action_count, 0),
    };
  }, [jobs, workspaceView]);
  const renderedJobs = workspaceView === "live" ? visibleJobs : visibleJobs.slice(0, visibleLimit);
  const jumpJobs = visibleJobs.slice(0, 60);
  const hasMoreVisibleJobs = renderedJobs.length < visibleJobs.length;
  const workspaceCopy =
    workspaceView === "live"
      ? {
          title: "Live operations",
          subtitle: "Active watches, retries, and background checks.",
          countLabel: "Live runs",
          countValue: liveJobs.length,
          summary: loading
            ? "Loading..."
            : liveJobs.length === 0
              ? "No live runs."
              : `${liveJobs.length} live run${liveJobs.length === 1 ? "" : "s"} in progress.`,
        }
      : workspaceView === "history"
        ? {
            title: "Task history",
            subtitle: "Completed, failed, and archived execution records.",
            countLabel: "History",
            countValue: historyJobs.length,
            summary: loading
              ? "Loading..."
              : historyJobs.length === 0
                ? "No history yet."
                : `${historyJobs.length} historical task${historyJobs.length === 1 ? "" : "s"} in view.`,
          }
        : {
            title: "Queue",
            subtitle: "Background jobs and manual follow-ups live here.",
            countLabel: "Queue",
            countValue: queueJobs.length,
            summary: loading
              ? "Loading..."
              : queueJobs.length === 0
                ? "No tasks yet."
                : `${queueJobs.length} task${queueJobs.length === 1 ? "" : "s"} in queue.`,
          };

  const liveJob = useMemo(() => jobs.find((j) => j.id === liveJobId), [jobs, liveJobId]);
  const rightPct = liveJobId ? (100 - splitPct) : 0;

  useEffect(() => {
    setVisibleLimit(24);
  }, [workspaceView]);

  useEffect(() => {
    if (!selectedJobId || workspaceView === "live") return;
    const selectedIndex = visibleJobs.findIndex((job) => job.id === selectedJobId);
    if (selectedIndex >= visibleLimit) {
      setVisibleLimit(Math.ceil((selectedIndex + 1) / 24) * 24);
    }
  }, [selectedJobId, visibleJobs, visibleLimit, workspaceView]);

  useEffect(() => {
    const explicitView = searchParams.get("view");
    const focusId = searchParams.get("focus");
    if (loading || explicitView || focusId || workspaceView !== "queue") return;
    if (queueJobs.length === 0 && liveJobs.length === 0 && historyJobs.length > 0) {
      setWorkspaceView("history");
      router.replace("/tasks?view=history", { scroll: false });
    }
  }, [
    loading,
    searchParams,
    workspaceView,
    queueJobs.length,
    liveJobs.length,
    historyJobs.length,
    router,
  ]);

  function focusJob(jobId: string) {
    setSelectedJobId(jobId);
    jobRefs.current[jobId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)", padding: "0 0 80px" }}>
      <style>{`
        @keyframes jobpulse {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>

      <GlobalNav active="tasks" />

      {/* Main content — shrinks left when live panel is open */}
      <div
        ref={mainContentRef}
        style={{
          paddingRight: liveJobId ? `${rightPct}vw` : 0,
          transition: "padding-right 0.25s ease",
        }}
      >
        {/* Page title */}
        <div className="mx-auto w-full max-w-[1440px] px-4 md:px-6 py-5">
          <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0)),radial-gradient(circle_at_top_left,rgba(212,163,75,0.08),transparent_26%)] shadow-[0_24px_80px_rgba(0,0,0,0.08)]">
          <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-20 px-7 py-7">
                <span
                  className="inline-flex items-center text-[11px] font-semibold uppercase mb-4 tracking-[0.18em]"
                  style={{
                    color: "var(--gold-text)",
                    background: "var(--gold-soft)",
                    padding: "5px 12px",
                    borderRadius: "var(--radius-pill)",
                  }}
                >
                  Tasks
                </span>
                <h1
                  className="leading-tight"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontSize: "clamp(28px, 3vw, 36px)",
                    fontWeight: 600,
                    color: "var(--ink-9)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                    margin: 0,
                  }}
                >
                  Tasks workspace.
                </h1>
                <p
                  className="mt-3 leading-6"
                  style={{
                    fontSize: "15px",
                    color: "var(--ink-6)",
                    maxWidth: "32ch",
                  }}
                >
                  Background jobs, live monitoring, and follow-ups live here.
                </p>
                <div className="mt-5 flex flex-col gap-2">
                    <TaskWorkspaceSwitch view={workspaceView} setView={setWorkspaceViewAndUrl} />
                    <button
                      onClick={() => setShowRestaurantForm((v) => !v)}
                      disabled={workspaceView !== "queue"}
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 14,
                        border: "none",
                        background: workspaceView === "queue" ? "var(--gold, #D4A34B)" : "var(--border, #e5e7eb)",
                        color: "#fff",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: workspaceView === "queue" ? "pointer" : "default",
                        opacity: workspaceView === "queue" ? 1 : 0.55,
                      }}
                    >
                      {showRestaurantForm ? "Cancel new task" : "+ Restaurant"}
                    </button>
                    {!loading && jobs.length > 0 && (
                      <button
                        onClick={handleClearAll}
                        disabled={clearingAll}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          borderRadius: 14,
                          border: "0.5px solid var(--border, #e5e7eb)",
                          background: "transparent",
                          color: clearingAll ? "var(--text-muted, #aaa)" : "rgba(220,38,38,0.7)",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        {clearingAll ? "Clearing..." : "Clear all"}
                      </button>
                    )}
                </div>

                <div className="mt-6 pt-6 border-t border-[var(--border)] space-y-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Visible now</p>
                    <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{loading ? "…" : workspaceCopy.countValue}</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between text-[var(--text-secondary)]">
                      <span>Mode</span>
                      <span className="text-[var(--text-primary)] font-medium">{workspaceCopy.title}</span>
                    </div>
                    <div className="flex items-center justify-between text-[var(--text-secondary)]">
                      <span>Surface</span>
                      <span className="text-[var(--text-primary)] font-medium">Workspace</span>
                    </div>
                  </div>
                </div>

                {!loading && visibleJobs.length > 0 && (
                  <div style={{ marginTop: 24, paddingTop: 20, borderTop: "0.5px solid var(--border, #e5e7eb)" }}>
                    <p style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--text-muted,#999)",
                      marginBottom: 12,
                    }}>Jump to task</p>
                    <div className="flex flex-col gap-1 max-h-[52vh] overflow-y-auto pr-1">
                      {jumpJobs.map((job) => {
                        const isSelected = selectedJobId === job.id;
                        const blockedCount = job.action_count;
                        return (
                          <button
                            key={job.id}
                            onClick={() => focusJob(job.id)}
                            className="text-left"
                            style={{
                              padding: "10px 12px",
                              borderRadius: 14,
                              border: isSelected ? "1px solid rgba(212,163,75,0.45)" : "1px solid transparent",
                              background: isSelected ? "rgba(212,163,75,0.08)" : "transparent",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-primary,#111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {job.trip_label}
                              </span>
                              {blockedCount > 0 && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(220,38,38,0.85)", borderRadius: 999, padding: "1px 6px" }}>
                                  {blockedCount}
                                </span>
                              )}
                            </div>
                            <div style={{ marginTop: 2, fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary,#666)" }}>
                              {job.latest_status_label}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <main className="min-w-0 border-t border-[var(--border)] lg:border-t-0 lg:border-l px-5 py-6 md:px-7 md:py-7">
        <div style={{ padding: "0 0 4px", maxWidth: "100%", margin: 0 }}>
          <button
            onClick={() => {
              // router.back() is a no-op when the history stack is empty
              // (direct URL access / refresh / external link). Fall back to
              // pushing "/" so the button always goes somewhere sensible;
              // sessionStorage keeps the search results cached on the home
              // page, keyed by query, so they rehydrate either way.
              const startUrl = window.location.href;
              router.back();
              setTimeout(() => {
                if (window.location.href === startUrl) {
                  router.push("/");
                }
              }, 300);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "none", border: "none", padding: "0 0 10px",
              fontFamily: "var(--font-dm-sans)", fontSize: 13,
              color: "var(--text-secondary, #666)", cursor: "pointer",
            }}
          >
            ← Back to results
          </button>
          <div className="lg:flex lg:items-end lg:justify-between" style={{ gap: 16 }}>
            <div>
              <p className="task-page__eyebrow">Workspace</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <p className="task-page__title">Tasks</p>
                {actionTotal > 0 && (
                  <span className="task-page__action-badge">
                    {actionTotal} action{actionTotal > 1 ? "s" : ""} needed
                  </span>
                )}
              </div>
              <p className="task-page__subtitle">{workspaceCopy.summary}</p>
            </div>

            <div className="hidden lg:flex" style={{ alignItems: "center", gap: 10 }}>
              <div className="task-meta-card">
                <span className="task-meta-card__label">{workspaceCopy.countLabel}</span>
                <span className="task-meta-card__value">{workspaceCopy.countValue}</span>
              </div>
              <div className="task-meta-card">
                <span className="task-meta-card__label">Actions</span>
                <span className="task-meta-card__value">{visibleActionTotal}</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
            <div />
            <div className="lg:hidden" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setShowRestaurantForm((v) => !v)}
                disabled={workspaceView !== "queue"}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "none", border: "none", cursor: "pointer",
                  fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600,
                  color: workspaceView !== "queue"
                    ? "var(--text-muted, #aaa)"
                    : showRestaurantForm
                      ? "var(--gold, #D4A34B)"
                      : "var(--text-secondary, #666)",
                  padding: "2px 0",
                }}
              >
                {showRestaurantForm ? "✕ Cancel" : "🍽️ + Restaurant"}
              </button>
              {!loading && jobs.length > 0 && (
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontFamily: "var(--font-dm-sans)", fontSize: 12,
                    color: clearingAll ? "var(--text-muted, #aaa)" : "rgba(220,38,38,0.7)",
                    padding: "2px 0",
                  }}
                >
                  {clearingAll ? "Clearing…" : "Clear all"}
                </button>
              )}
            </div>
          </div>
          <div className="lg:hidden" style={{ marginTop: 12 }}>
            <TaskWorkspaceSwitch view={workspaceView} setView={setWorkspaceViewAndUrl} />
          </div>
        </div>
        <div style={{ padding: "16px 0 0", display: "flex", flexDirection: "column", gap: 12, maxWidth: "100%", margin: 0 }}>
          {/* Restaurant booking form — shown when user clicks "+ Restaurant" */}
          {workspaceView === "queue" && showRestaurantForm && (
            <RestaurantStepCard
              onCreated={() => {
                setShowRestaurantForm(false);
                loadJobs();
              }}
            />
          )}

          {!loading && workspaceView === "queue" && visibleJobs.length === 0 && !showRestaurantForm && (
            <div style={{ textAlign: "center", padding: "60px 20px", borderRadius: 16, border: "0.5px dashed var(--border, #e5e7eb)" }}>
              <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>No tasks yet</p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
                When you ask the agent to do something in the background, your tasks appear here.
              </p>
            </div>
          )}

          {workspaceView === "live" && (
            <MonitoringWorkspacePanel
              sessionId={sessionId}
              jobs={jobs}
              onOpenJob={(jobId) => {
                const job = jobs.find((candidate) => candidate.id === jobId);
                setWorkspaceViewAndUrl(job ? taskWorkspaceViewForJob(job) : "queue");
                requestAnimationFrame(() => focusJob(jobId));
              }}
              onDeleteJob={async (jobId) => {
                try {
                  const res = await fetch(`/api/booking-jobs/${jobId}`, { method: "DELETE" });
                  if (res.ok) {
                    invalidateTaskData(jobId);
                    setJobs((prev) => prev.filter((j) => j.id !== jobId));
                    setJobDetails((prev) => {
                      const next = { ...prev };
                      delete next[jobId];
                      return next;
                    });
                    return true;
                  }
                  const body = await res.json().catch(() => ({} as { error?: string }));
                  alert(body.error ?? "Failed to delete task");
                  return false;
                } catch {
                  alert("Network error — couldn't delete task");
                  return false;
                }
              }}
            />
          )}

          {!loading && workspaceView === "history" && visibleJobs.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", borderRadius: 16, border: "0.5px dashed var(--border, #e5e7eb)" }}>
              <p style={{ fontSize: 24, marginBottom: 12, fontWeight: 700, color: "var(--text-primary, #111)" }}>History</p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>No history yet</p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
                Completed and failed runs will collect here once tasks finish.
              </p>
            </div>
          )}

          {renderedJobs.map((job) => {
            const detailJob = jobDetails[job.id];
            return (
            <div
              key={job.id}
              className="task-job-shell"
              ref={(node) => {
                jobRefs.current[job.id] = node;
              }}
              onClickCapture={() => setSelectedJobId(job.id)}
              style={{
                borderRadius: 18,
                boxShadow: selectedJobId === job.id ? "0 0 0 2px rgba(212,163,75,0.22)" : "none",
                transition: "box-shadow 0.18s ease",
              }}
            >
              {/* D1 Itinerary calendar — only for multi-step jobs. Gives the user
                  a "what's happening when" view while the parallel pipelines run. */}
              {detailJob?.steps.length >= 2 && <TripItineraryCalendar job={detailJob} />}
              {detailJob ? (
                <JobCard job={detailJob} onRefresh={loadJobs} sessionId={sessionId} onOpenLive={openLive} />
              ) : (
                <CompactJobCard
                  job={job}
                  loading={Boolean(detailLoading[job.id])}
                  onLoadDetail={(jobId) => {
                    setSelectedJobId(jobId);
                    loadJobDetail(jobId);
                  }}
                  onOpenLive={openLive}
                  onDelete={async (jobId, force) => {
                    await fetch(`/api/booking-jobs/${jobId}${force ? "?force=true" : ""}`, { method: "DELETE" });
                    invalidateTaskData(jobId);
                    setJobs((prev) => prev.filter((candidate) => candidate.id !== jobId));
                    setJobDetails((prev) => {
                      const next = { ...prev };
                      delete next[jobId];
                      return next;
                    });
                  }}
                />
              )}
            </div>
            );
          })}

          {hasMoreVisibleJobs && (
            <button
              type="button"
              className="task-show-more"
              onClick={() => setVisibleLimit((limit) => limit + 24)}
            >
              Show {Math.min(24, visibleJobs.length - renderedJobs.length)} more tasks
            </button>
          )}

          {/* Agent Insights — always show at the bottom */}
          {!loading && sessionId && workspaceView === "queue" && (
            <InsightsPanel sessionId={sessionId} />
          )}
        </div>
            </main>
          </div>
          </div>
        </div>
      </div>

      {/* ── Drag handle + Live panel ──────────────────────────────────────────── */}
      {liveJobId && (
        <>
          {/* Drag handle */}
          <div
            ref={dragHandleRef}
            onMouseDown={handleDragStart}
            style={{
              position: "fixed",
              left: `calc(${splitPct}vw - 3px)`,
              top: 0, bottom: 0,
              width: 6,
              zIndex: 10001,
              cursor: "col-resize",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <div style={{
              width: 4, height: 48, borderRadius: 4,
              backgroundColor: "rgba(255,255,255,0.25)",
            }} />
          </div>

          {/* Live panel — Track B Stage 5 cutover (codex 8a2da14 contracts)
              Replaces the legacy <BrowserLiveView /> canvas with the
              high-level <TaskTimelinePanel />: left column = events derived
              from /api/booking-jobs/:id/timeline-events SSE, right column =
              vertical snapshot rail from /api/booking-jobs/:id/snapshots
              with a click-to-zoom lightbox. The slide-over container keeps
              its position/width/drag-resize chrome; the panel renders its
              own header (with close), banner, footer. */}
          <div
            ref={livePanelRef}
            style={{
              position: "fixed",
              right: 0, top: 0, bottom: 0,
              width: `${rightPct}vw`,
              zIndex: 9999,
              background: "#111",
              display: "flex", flexDirection: "column",
              boxShadow: "-6px 0 32px rgba(0,0,0,0.45)",
              borderLeft: "0.5px solid rgba(255,255,255,0.08)",
            }}
          >
            <TaskTimelinePanel
              key={liveViewKey}
              jobId={liveJobId}
              title={liveJob?.trip_label ? `Agent — ${liveJob.trip_label}` : "Agent"}
              subtitle={liveJob?.trip_label ? undefined : "Live run"}
              onClose={() => { liveJobIdRef.current = null; setLiveJobId(null); }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function TripsPage() {
  return (
    <Suspense fallback={null}>
      <TripsPageInner />
    </Suspense>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s ago`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ${diffMin % 60}m ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}
