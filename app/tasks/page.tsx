"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { BookingJob, BookingJobStep, DecisionLogEntry, AgentFeedbackStats } from "@/lib/db";
import type { PolicyBias, UserPreferenceProfile } from "@/lib/policy";
import type { BookingMonitor } from "@/lib/monitors";
import type { ScenarioMemory, PatternMemory, RelationshipProfile, RelationshipType } from "@/lib/memory";
import {
  computeJobSemanticStatus,
  computeStepSemanticStatus,
  JOB_SEMANTIC_DISPLAY,
  STEP_SEMANTIC_DISPLAY,
} from "@/lib/status";
import GlobalNav from "@/components/GlobalNav";
import BrowserLiveView from "@/components/BrowserLiveView";


function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("session_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("session_id", id); }
  return id;
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
  if (step.status === "awaiting_confirmation") return "Ready for payment — enter CVC";
  if (step.status === "loading") return "Agent working…";
  if (step.status === "no_availability") return "No availability found";
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
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", textAlign: "center", padding: "10px 0" }}>
        Thanks — your feedback helps the agent improve ✓
      </p>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "0.5px solid var(--border, #e5e7eb)", justifyContent: "center" }}>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)", whiteSpace: "nowrap" }}>
        How did this go?
      </p>
      {[
        { outcome: "satisfied" as const, emoji: "😊", label: "Great" },
        { outcome: "ok" as const, emoji: "👍", label: "OK" },
        { outcome: "unsatisfied" as const, emoji: "😕", label: "Needed fixes" },
      ].map(({ outcome, emoji, label }) => (
        <button
          key={outcome}
          onClick={() => pick(outcome)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 8,
            border: chosen === outcome ? "0.5px solid var(--gold, #D4A34B)" : "0.5px solid var(--border, #e5e7eb)",
            background: chosen === outcome ? "rgba(212,163,75,0.08)" : "transparent",
            fontFamily: "var(--font-dm-sans)", fontSize: 12,
            color: "var(--text-secondary, #666)", cursor: "pointer",
          }}
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
  const isRunning = job.status === "running" || job.status === "pending";

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
  const actionMessage = step.actionItem?.message?.trim();
  if (actionMessage) return actionMessage;

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
    const savedModel = JSON.parse(localStorage.getItem("agent_model_config") ?? "{}");
    const agentModel = savedModel.model && savedModel.apiKey ? savedModel : undefined;
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
    fetch(`/api/booking-jobs/${jobId}/start`, { method: "POST" }).catch(() => {});
    setTimeout(() => onRefresh?.(), 800);
  }

  return (
    <div style={{ borderTop: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--bg, #fafaf9)" }}>
      <div style={{ padding: "14px" }}>

        {/* Agent question bubble */}
        <div style={{
          display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            backgroundColor: "var(--gold, #C9A84C)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14,
          }}>
            🤖
          </div>
          <div style={{
            flex: 1, backgroundColor: "var(--card, #fff)", borderRadius: "4px 12px 12px 12px",
            border: "0.5px solid var(--border, #e5e7eb)",
            padding: "10px 13px",
            fontFamily: "var(--font-dm-sans)", fontSize: 13,
            color: "var(--text-primary, #111)", lineHeight: 1.6,
            minHeight: 40,
          }}>
            {questionLoading
              ? <span style={{ color: "var(--text-muted, #aaa)" }}>Analysing what went wrong…</span>
              : question}
          </div>
        </div>

        {/* Agent's follow-up after user answers */}
        {agentReply && (
          <div style={{
            display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              backgroundColor: "var(--gold, #C9A84C)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14,
            }}>
              🤖
            </div>
            <div style={{
              flex: 1, backgroundColor: "var(--card, #fff)", borderRadius: "4px 12px 12px 12px",
              border: "0.5px solid var(--border, #e5e7eb)",
              padding: "10px 13px",
              fontFamily: "var(--font-dm-sans)", fontSize: 13,
              color: "var(--text-primary, #111)", lineHeight: 1.6,
            }}>
              {agentReply}
            </div>
          </div>
        )}

        {/* Retry CTA */}
        {readyToRetry && (
          <button onClick={handleRetry} disabled={retrying} style={{
            width: "100%", padding: "11px 0", borderRadius: 12, marginBottom: 10,
            border: "none",
            backgroundColor: retrying ? "var(--border, #e5e7eb)" : "var(--gold, #C9A84C)",
            color: retrying ? "var(--text-muted, #aaa)" : "#fff",
            fontFamily: "var(--font-dm-sans)", fontSize: 14,
            fontWeight: 700, cursor: retrying ? "default" : "pointer",
            transition: "background 0.2s",
          }}>
            {retrying ? "Starting…" : "↺ Retry booking"}
          </button>
        )}

        {/* Answer input — shown until agent has enough to retry */}
        {!staticHelp && !readyToRetry && !questionLoading && (
          <div style={{
            display: "flex", gap: 8, alignItems: "flex-end",
            backgroundColor: "var(--card, #fff)", borderRadius: 14,
            border: "0.5px solid var(--border, #e5e7eb)",
            padding: "8px 10px",
          }}>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }}
              placeholder="Type your answer…"
              rows={1}
              style={{
                flex: 1, border: "none", outline: "none", resize: "none",
                fontFamily: "var(--font-dm-sans)", fontSize: 13,
                color: "var(--text-primary, #111)", backgroundColor: "transparent",
                lineHeight: 1.5,
              }}
            />
            <button onClick={sendAnswer} disabled={sendingAnswer || !answer.trim()} style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: "none",
              backgroundColor: sendingAnswer || !answer.trim() ? "var(--border)" : "var(--gold, #C9A84C)",
              color: "#fff", cursor: sendingAnswer || !answer.trim() ? "default" : "pointer",
              fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s",
            }}>
              {sendingAnswer ? "…" : "↑"}
            </button>
          </div>
        )}

        {staticHelp && step.error && (
          <p style={{
            marginTop: 8,
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            color: "var(--text-muted, #aaa)",
            lineHeight: 1.5,
          }}>
            {step.error}
          </p>
        )}

        {/* Manual fallback — subtle */}
        {step.actionItem?.options.map((opt, j) => (
          <button key={j} onClick={() => onManualLink(opt.label, opt.url, j)} style={{
            width: "100%", marginTop: 8, padding: "6px 12px", borderRadius: 10,
            border: "0.5px solid var(--border, #e5e7eb)", background: "transparent",
            color: "var(--text-muted, #aaa)", fontFamily: "var(--font-dm-sans)",
            fontSize: 11, cursor: "pointer", textAlign: "left",
          }}>
            ↗ Book manually instead
          </button>
        ))}
      </div>
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
    const savedModel = JSON.parse(localStorage.getItem("agent_model_config") ?? "{}");
    const agentModel = savedModel.model && savedModel.apiKey ? savedModel : undefined;
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
    fetch(`/api/booking-jobs/${jobId}/start`, { method: "POST" }).catch(() => {});
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
      <div style={{ borderTop: "0.5px solid rgba(212,163,75,0.25)", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: "rgba(212,163,75,0.05)" }}>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--gold, #D4A34B)" }}>
          ↺ Retry scheduled for {retryDate.toLocaleString()}
        </p>
        <button onClick={() => scheduleRetry(null)} disabled={scheduling} style={{
          background: "none", border: "0.5px solid var(--border, #e5e7eb)",
          borderRadius: 6, padding: "2px 8px", fontFamily: "var(--font-dm-sans)",
          fontSize: 10, color: "var(--text-muted, #aaa)", cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={{ borderTop: "0.5px solid var(--border, #e5e7eb)", padding: "8px 12px", backgroundColor: "var(--card-2, #f9f9f9)" }}>
      {/* Retry now */}
      <button onClick={retryNow} disabled={retrying} style={{
        width: "100%", padding: "9px 0", borderRadius: 10, marginBottom: 10,
        border: "none", backgroundColor: retrying ? "var(--border)" : "var(--gold, #D4A34B)",
        color: "#fff", fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600,
        cursor: retrying ? "default" : "pointer", transition: "background 0.2s",
      }}>
        {retrying ? "Starting agent…" : "↺ Retry now"}
      </button>
      {/* Schedule retry */}
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginBottom: 6 }}>
        Or retry automatically:
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { label: "In 2 hours", hours: 2 },
          { label: "In 6 hours", hours: 6 },
          { label: "Tomorrow", hours: 24 },
        ].map(({ label, hours }) => (
          <button key={hours} onClick={() => scheduleRetry(hours)} disabled={scheduling} style={{
            padding: "4px 10px", borderRadius: 8,
            border: "0.5px solid var(--border, #e5e7eb)",
            background: "var(--card, #fff)",
            fontFamily: "var(--font-dm-sans)", fontSize: 11,
            color: "var(--text-secondary, #666)", cursor: "pointer",
          }}>
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
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (closed) return;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/booking-jobs/${jobId}/logs?after=${afterRef.current}`);
        if (!res.ok) return;
        const data: { lines: string[]; total: number; closed: boolean } = await res.json();
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
        if (data.closed) { setClosed(true); return; }
      } catch { /* ignore */ }
      if (!cancelled) setTimeout(poll, 1200);
    }

    poll();
    return () => { cancelled = true; };
  }, [jobId, closed]);

  if (lines.length === 0 && !closed) return (
    <div style={{ padding: "6px 12px 6px 44px", fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted,#aaa)" }}>
      Waiting for agent logs…
    </div>
  );

  return (
    <div style={{ borderTop: "0.5px solid var(--border,#e5e7eb)", padding: "8px 12px 8px 44px" }}>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700, color: "var(--text-muted,#aaa)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
        Live agent log {closed ? "(finished)" : "● streaming"}
      </p>
      <div ref={boxRef} style={{
        maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1,
        fontFamily: "monospace", fontSize: 10, lineHeight: 1.5,
      }}>
        {lines.map((line, i) => (
          <span key={i} style={{ color: line.includes("FAIL") || line.includes("failed") || line.includes("ERROR") ? "rgba(220,38,38,0.8)" : line.includes("✓") || line.includes("filled") || line.includes("clicked") ? "rgba(22,163,74,0.85)" : "var(--text-secondary,#555)" }}>
            {line}
          </span>
        ))}
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

  return (
    <div style={{
      borderRadius: 12,
      border: `0.5px solid ${step.actionItem ? "rgba(220,38,38,0.3)" : step.status === "done" ? "rgba(22,163,74,0.2)" : "var(--border, #e5e7eb)"}`,
      backgroundColor: step.actionItem ? "rgba(220,38,38,0.03)" : step.status === "done" ? "rgba(22,163,74,0.03)" : "var(--card-2, #f9f9f9)",
      overflow: "hidden",
    }}>
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
        {/* Status badge */}
        <div style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
          backgroundColor: color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, marginTop: 1,
          animation: step.status === "loading" ? "jobpulse 1.2s ease-in-out infinite" : "none",
        }}>
          {stepStatusIcon(step)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15 }}>{step.emoji}</span>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600 }}>
              {step.label}
            </p>
            {(step.timeAdjusted || step.usedFallback) && (
              <span style={{
                fontSize: 10, fontFamily: "var(--font-dm-sans)",
                color: "rgba(234,88,12,0.9)", backgroundColor: "rgba(234,88,12,0.08)",
                border: "0.5px solid rgba(234,88,12,0.25)",
                borderRadius: 4, padding: "1px 5px", fontWeight: 500,
              }}>
                {step.timeAdjusted ? "⏰ time adjusted" : "🔄 alternative"}
              </span>
            )}
            {step.replanAdjusted && (
              <span style={{
                fontSize: 10, fontFamily: "var(--font-dm-sans)",
                color: "#8b5cf6", backgroundColor: "rgba(139,92,246,0.08)",
                border: "0.5px solid rgba(139,92,246,0.25)",
                borderRadius: 4, padding: "1px 5px", fontWeight: 500,
              }}>
                ⟳ scene-replanned
              </span>
            )}
            {step.replanFlagged && !step.replanAdjusted && (
              <span style={{
                fontSize: 10, fontFamily: "var(--font-dm-sans)",
                color: "rgba(234,88,12,0.85)", backgroundColor: "rgba(234,88,12,0.07)",
                border: "0.5px solid rgba(234,88,12,0.2)",
                borderRadius: 4, padding: "1px 5px", fontWeight: 500,
              }}>
                ⚠ review schedule
              </span>
            )}
          </div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color, marginTop: 2 }}>
            {stepStatusLabel(step)}
            {step.selected_time && ` · ${step.type === "flight" ? "Price:" : "Time:"} ${step.selected_time}`}
          </p>
          {/* Show last log entry inline when step is still loading — surfaces agent result
              even if the Vercel function was killed before writing the final step status */}
          {step.status === "loading" && hasLog && (() => {
            const last = step.decisionLog!.at(-1);
            return last ? (
              <p style={{
                fontFamily: "var(--font-dm-sans)", fontSize: 11, marginTop: 3,
                color: last.type === "failed" ? "rgba(220,38,38,0.75)" :
                       last.type === "succeeded" ? "rgba(22,163,74,0.85)" :
                       "var(--text-secondary, #666)",
                maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={last.message}>
                {last.message}
              </p>
            ) : null;
          })()}
          {step.status === "error" && step.error && (
            <p style={{
              fontFamily: "var(--font-dm-sans)", fontSize: 11, marginTop: 3,
              color: "rgba(220,38,38,0.75)",
              maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={step.error}>
              {step.error}
            </p>
          )}
          {hasLog && (
            <button onClick={() => setLogOpen((o) => !o)} style={{
              marginTop: 4, background: "none", border: "none", padding: 0,
              fontFamily: "var(--font-dm-sans)", fontSize: 11,
              color: "var(--text-muted, #aaa)", cursor: "pointer",
              textDecoration: "underline", textUnderlineOffset: 2,
            }}>
              {logOpen ? "Hide agent log ▲" : `View agent log (${step.decisionLog!.length} steps) ▼`}
            </button>
          )}
        </div>

        {step.status === "done" && step.handoff_url && (
          <button onClick={handleOpenAgentLink} style={{
            flexShrink: 0, padding: "5px 12px", borderRadius: 8,
            border: "none", background: "rgba(22,163,74,0.12)",
            color: "rgba(22,163,74,0.9)", fontFamily: "var(--font-dm-sans)",
            fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>
            Open →
          </button>
        )}
      </div>

      {/* Live log — shown while agent is running */}
      {step.status === "loading" && <LiveLogPanel jobId={jobId} />}

      {/* Decision log */}
      {logOpen && step.decisionLog && (
        <div style={{
          borderTop: "0.5px solid var(--border, #e5e7eb)",
          padding: "10px 12px 10px 44px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 2 }}>
            Agent decision log
          </p>
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

      {/* Retry scheduling — shown for failed steps without an action item */}
      {(step.status === "error" || step.status === "no_availability") && (
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
  const emoji = isPaymentWait ? "💳" : "🔑";
  const title = isPaymentWait ? "Agent paused — ready for payment" : "Agent needs your help";
  const subtitle = isPaymentWait
    ? hasCloudSession
      ? "The agent filled everything in. Tap below to open the payment page and enter your CVC."
      : "The agent filled everything in. Open the link to enter payment and confirm."
    : "The site requires your login. Open the link, sign in, then the agent can continue.";

  return (
    <>
      {/* Inline banner */}
      <div style={{ borderTop: `0.5px solid ${border}`, padding: "10px 14px", backgroundColor: bg }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 700, color, marginBottom: 2 }}>
              {emoji} {title}
            </p>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)" }}>
              {subtitle}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {isPaymentWait && hasCloudSession && (
              <a href={step.session_url} target="_blank" rel="noopener noreferrer" style={{
                padding: "7px 14px", borderRadius: 8, border: `1px solid ${color}`,
                backgroundColor: color, color: "#fff",
                fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                textDecoration: "none", display: "inline-block",
              }}>
                💳 Enter CVC →
              </a>
            )}
            {isPaymentWait && !hasCloudSession && (
              <button onClick={() => onOpenLive?.()} style={{
                padding: "7px 14px", borderRadius: 8, border: `1px solid ${color}`,
                backgroundColor: "transparent", color,
                fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
                🖥️ Watch live
              </button>
            )}
            <button onClick={() => setOpen(true)} style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              backgroundColor: color, color: "#fff",
              fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              Details →
            </button>
          </div>
        </div>
      </div>

      {/* Modal */}
      {open && step.handoff_url && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }} onClick={() => setOpen(false)}>
          <div style={{
            backgroundColor: "var(--card, #fff)", borderRadius: 20,
            padding: "28px 24px", maxWidth: 440, width: "100%",
            boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          }} onClick={(e) => e.stopPropagation()}>

            {/* Icon */}
            <div style={{ fontSize: 40, textAlign: "center", marginBottom: 16 }}>{emoji}</div>

            {/* Title */}
            <p style={{
              fontFamily: "var(--font-playfair, serif)", fontSize: 20, fontWeight: 700,
              color: "var(--text-primary, #111)", textAlign: "center", marginBottom: 8,
            }}>
              {title}
            </p>
            <p style={{
              fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)",
              textAlign: "center", lineHeight: 1.6, marginBottom: 24,
            }}>
              {subtitle}
            </p>

            {/* What the agent did */}
            <div style={{
              backgroundColor: "var(--bg, #fafaf9)", borderRadius: 12,
              padding: "12px 14px", marginBottom: 20,
              border: "0.5px solid var(--border, #e5e7eb)",
            }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                What the agent did
              </p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
                {step.decisionLog?.filter(e => e.type === "succeeded").at(-1)?.message
                  ?? "Navigated the booking site and filled in all available details."}
              </p>
            </div>

            {/* CTA — three cases:
                1. Browserbase cloud session: show direct interactive link (works on mobile)
                2. Session-bound local URL (basket_id / secure.booking.com): show instructions
                3. Regular URL: show open link button */}
            {hasCloudSession ? (
              <>
                <a href={step.session_url} target="_blank" rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  style={{
                    display: "block", width: "100%", padding: "13px 0", borderRadius: 12,
                    backgroundColor: color, color: "#fff", textAlign: "center",
                    fontFamily: "var(--font-dm-sans)", fontSize: 14, fontWeight: 700,
                    textDecoration: "none", boxSizing: "border-box",
                  }}>
                  💳 Open payment page →
                </a>
                <p style={{
                  fontFamily: "var(--font-dm-sans)", fontSize: 11,
                  color: "var(--text-muted, #aaa)", textAlign: "center",
                  marginTop: 8, lineHeight: 1.5,
                }}>
                  Opens in a cloud browser — card details are already filled in.<br />
                  Just enter your CVC and confirm.
                </p>
              </>
            ) : step.handoff_url && (step.handoff_url.includes("basket_id=") || step.handoff_url.includes("secure.booking.com/book")) ? (
              <div style={{
                padding: "12px 14px", borderRadius: 12, border: `1px solid ${color}`,
                backgroundColor: isPaymentWait ? "rgba(22,163,74,0.06)" : "rgba(220,38,38,0.05)",
                fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-primary, #111)",
                lineHeight: 1.5, textAlign: "center",
              }}>
                <span style={{ fontSize: 20 }}>🖥️</span><br />
                <strong>Use OneAgent live browser or the local browser window</strong><br />
                <span style={{ fontSize: 12, color: "var(--text-secondary, #666)" }}>
                  The booking session is open in the Playwright browser on your screen.<br />
                  Find that window, enter the CVV, and click 完成预订.
                </span>
              </div>
            ) : (
              <a href={step.handoff_url ?? "#"} target="_blank" rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                style={{
                  display: "block", width: "100%", padding: "13px 0", borderRadius: 12,
                  backgroundColor: color, color: "#fff", textAlign: "center",
                  fontFamily: "var(--font-dm-sans)", fontSize: 14, fontWeight: 700,
                  textDecoration: "none", boxSizing: "border-box",
                }}>
                {isPaymentWait ? "Complete payment →" : "Sign in to continue →"}
              </a>
            )}

            <button onClick={() => setOpen(false)} style={{
              display: "block", width: "100%", marginTop: 10, padding: "9px 0",
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-muted, #aaa)",
            }}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Job card ───────────────────────────────────────────────────────────────────

function JobCard({ job, onRefresh, sessionId, onOpenLive }: { job: BookingJob; onRefresh?: () => void; sessionId: string; onOpenLive?: (jobId: string) => void }) {
  const [expanded, setExpanded] = useState(job.status !== "pending");
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const prevStatusRef = useRef(job.status);

  // Auto-open live panel when job transitions to "running" or "done".
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (
      (job.status === "running" && prev !== "running") ||
      (job.status === "done" && prev === "running")
    ) {
      onOpenLive?.(job.id);
    }
    prevStatusRef.current = job.status;
  }, [job.status, onOpenLive]);

  const doneCount = job.steps.filter((s) => s.status === "done").length;
  const actionCount = job.steps.filter((s) => s.actionItem).length;
  const adjustedCount = job.steps.filter((s) => s.timeAdjusted || s.usedFallback).length;
  const replanCount = job.steps.filter((s) => s.replanAdjusted || s.replanFlagged).length;
  const isRunning = job.status === "running" || job.status === "pending";
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
      await fetch(`/api/booking-jobs/${job.id}/start`, { method: "POST" });
      onRefresh?.();
    } finally {
      setResetting(false);
    }
  }

  const semanticStatus = computeJobSemanticStatus(job);
  const statusDisplay = JOB_SEMANTIC_DISPLAY[semanticStatus];

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
      const force = job.status === "running" || job.status === "pending";
      await fetch(`/api/booking-jobs/${job.id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      onRefresh?.();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{
      borderRadius: 16,
      border: `0.5px solid ${
        semanticStatus === "blocked_needs_user_input" || semanticStatus === "partially_completed"
          ? "rgba(220,38,38,0.3)"
          : semanticStatus.startsWith("succeeded")
          ? "rgba(22,163,74,0.25)"
          : "var(--border, #e5e7eb)"
      }`,
      backgroundColor: "var(--card, #fff)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div onClick={() => setExpanded((e) => !e)} style={{ padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", backgroundColor: statusDisplay.color, animation: statusDisplay.animate ? "jobpulse 1.4s ease-in-out infinite" : "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {job.trip_label}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px", marginTop: 2 }}>
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: statusDisplay.color, fontWeight: 500 }}>
              {statusDisplay.label}
            </span>
            {isComplete && (
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)" }}>
                {doneCount}/{job.steps.length} ready
              </span>
            )}
            {adjustedCount > 0 && (
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(234,88,12,0.85)" }}>
                {adjustedCount} agent adjustment{adjustedCount > 1 ? "s" : ""}
              </span>
            )}
            {replanCount > 0 && (
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "#8b5cf6" }}>
                ⟳ {replanCount} scene replan{replanCount > 1 ? "s" : ""}
              </span>
            )}
            {actionCount > 0 && (
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(220,38,38,0.85)", fontWeight: 600 }}>
                {actionCount} need{actionCount > 1 ? "" : "s"} decision
              </span>
            )}
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
              {formatDate(job.created_at)}
            </span>
          </div>
        </div>
        {(job.status === "running" || (isComplete && Date.now() - new Date(job.updated_at).getTime() < 90_000)) && (
          <button onClick={(e) => { e.stopPropagation(); onOpenLive?.(job.id); }} style={{
            flexShrink: 0, padding: "7px 12px", borderRadius: 10,
            border: "1px solid var(--gold, #D4A34B)", backgroundColor: "transparent",
            color: job.status === "running" ? "var(--gold, #D4A34B)" : "rgba(212,163,75,0.5)",
            fontFamily: "var(--font-dm-sans)", fontSize: 12,
            fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>
            {job.status === "running" ? "🖥️ Watch live" : "🖥️ Replay"}
          </button>
        )}
        {job.status === "done" && doneCount > 0 && (
          <button onClick={(e) => { e.stopPropagation(); openAll(); }} style={{
            flexShrink: 0, padding: "7px 14px", borderRadius: 10,
            border: "none", backgroundColor: "var(--gold, #D4A34B)",
            color: "#fff", fontFamily: "var(--font-dm-sans)", fontSize: 12,
            fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>
            Open all →
          </button>
        )}
        {isStuck && (
          <button
            onClick={handleResetStuck}
            disabled={resetting}
            title="Job appears stuck — click to reset and retry"
            style={{
              flexShrink: 0, padding: "6px 12px", borderRadius: 10,
              border: "none", backgroundColor: resetting ? "var(--border)" : "rgba(234,88,12,0.85)",
              color: "#fff", fontFamily: "var(--font-dm-sans)", fontSize: 12,
              fontWeight: 600, cursor: resetting ? "default" : "pointer", whiteSpace: "nowrap",
            }}
          >
            {resetting ? "Starting…" : "↺ Reset & Retry"}
          </button>
        )}
        <span style={{ color: "var(--text-muted, #aaa)", fontSize: 12, flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          title={isRunning ? "Force remove this running trip" : "Delete trip record"}
          style={{
            flexShrink: 0,
            background: "none",
            border: "0.5px solid var(--border, #e5e7eb)",
            borderRadius: 8,
            padding: "5px 10px",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: isRunning ? "rgba(234,88,12,0.8)" : "rgba(220,38,38,0.65)",
            cursor: deleting ? "default" : "pointer",
            opacity: deleting ? 0.4 : 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          🗑
        </button>
      </div>

      {expanded && (
        <>
          <div style={{ borderTop: "0.5px solid var(--border, #e5e7eb)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Tier: needs decision (floated to top) */}
            {actionCount > 0 && (
              <>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700, color: "rgba(220,38,38,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
    <div style={{ borderRadius: 12, border: "0.5px solid var(--border, #e5e7eb)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", background: "var(--card-2, #f9f9f9)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13 }}>📡</span>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 700 }}>
          Agent monitoring
        </p>
        {active.length > 0 && (
          <span style={{
            fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700,
            color: "var(--gold, #D4A34B)", background: "rgba(212,163,75,0.12)",
            borderRadius: 10, padding: "1px 6px",
          }}>
            {active.length} active
          </span>
        )}
        {triggered.length > 0 && (
          <span style={{
            fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700,
            color: "#fff", background: "rgba(220,38,38,0.8)",
            borderRadius: 10, padding: "1px 6px",
          }}>
            {triggered.length} alert{triggered.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Monitor list */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {monitors.map((monitor) => (
          <div key={monitor.id} style={{
            borderTop: "0.5px solid var(--border, #e5e7eb)",
            padding: "10px 14px",
            background: monitor.status === "triggered" ? "rgba(220,38,38,0.03)" : "transparent",
            opacity: monitor.status === "cancelled" ? 0.5 : 1,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              {/* Pulse dot */}
              <div style={{
                flexShrink: 0, marginTop: 3,
                width: 7, height: 7, borderRadius: "50%",
                backgroundColor: MONITOR_STATUS_COLOR[monitor.status] ?? "var(--text-muted, #aaa)",
                animation: monitor.status === "active" ? "jobpulse 2s ease-in-out infinite" : "none",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13 }}>{monitor.step_emoji}</span>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600 }}>
                    {monitor.step_label}
                  </p>
                  <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>
                    {MONITOR_TYPE_EMOJI[monitor.type]} {MONITOR_TYPE_LABEL[monitor.type] ?? monitor.type}
                  </span>
                  {monitor.status === "cancelled" && (
                    <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>· stopped</span>
                  )}
                </div>

                {/* Alert message */}
                {monitor.status === "triggered" && monitor.trigger_message && (
                  <div style={{ marginTop: 5, padding: "6px 8px", borderRadius: 6, background: "rgba(220,38,38,0.06)", border: "0.5px solid rgba(220,38,38,0.2)" }}>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(185,28,28,0.9)", lineHeight: 1.45 }}>
                      ⚠ {monitor.trigger_message}
                    </p>
                    {monitor.trigger_data && typeof (monitor.trigger_data as Record<string, unknown>).handoff_url === "string" && (
                      <a
                        href={(monitor.trigger_data as Record<string, string>).handoff_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-block", marginTop: 5,
                          fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600,
                          color: "rgba(185,28,28,0.9)",
                        }}
                      >
                        Book now →
                      </a>
                    )}
                  </div>
                )}

                {/* Last checked */}
                {monitor.last_checked_at && monitor.status === "active" && (
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)", marginTop: 3 }}>
                    Last checked {formatTime(monitor.last_checked_at)}
                    {" · "} Next check {formatTime(monitor.next_check_at)}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {/* Stop button — active or triggered monitors */}
                {(monitor.status === "active" || monitor.status === "triggered") && (
                  <button
                    onClick={() => cancelMonitor(monitor.id)}
                    style={{
                      background: "none",
                      border: "0.5px solid var(--border, #e5e7eb)",
                      borderRadius: 6, padding: "2px 7px",
                      fontFamily: "var(--font-dm-sans)", fontSize: 10,
                      color: "var(--text-muted, #aaa)", cursor: "pointer",
                    }}
                  >
                    Stop
                  </button>
                )}
                {/* Delete button — all monitors */}
                <button
                  onClick={() => deleteMonitor(monitor.id)}
                  title="Delete monitor"
                  style={{
                    background: "none",
                    border: "0.5px solid var(--border, #e5e7eb)",
                    borderRadius: 6, padding: "2px 6px",
                    fontSize: 11, color: "var(--text-muted, #aaa)",
                    cursor: "pointer", lineHeight: 1,
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
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
    <div style={{ height: 4, borderRadius: 2, backgroundColor: "var(--border, #e5e7eb)", overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, backgroundColor: color, borderRadius: 2, transition: "width 0.4s ease" }} />
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
      <button onClick={() => setOpen(true)} style={{
        width: "100%", padding: "10px", borderRadius: 12,
        border: "0.5px dashed var(--border, #e5e7eb)", background: "transparent",
        fontFamily: "var(--font-dm-sans)", fontSize: 12,
        color: "var(--text-muted, #aaa)", cursor: "pointer",
      }}>
        📊 View Agent Insights
      </button>
    );
  }

  return (
    <div style={{ borderRadius: 16, border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)", overflow: "hidden" }}>
      {/* Header */}
      <button onClick={() => setOpen((o) => !o)} style={{
        width: "100%", padding: "14px 16px", background: "none", border: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 13 }}>Agent Insights</p>
          {stats && (
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
              {stats.totalEvents} events
            </span>
          )}
        </div>
        <span style={{ color: "var(--text-muted, #aaa)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Tab bar */}
      {open && (
        <div style={{ borderTop: "0.5px solid var(--border, #e5e7eb)", display: "flex", gap: 0, overflowX: "auto" }}>
          {INSIGHTS_TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex: 1, padding: "8px 4px", background: "none", border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--gold, #D4A34B)" : "2px solid transparent",
              fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? "var(--gold, #D4A34B)" : "var(--text-muted, #aaa)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div style={{ padding: "14px 16px" }}>
          {loading && <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-muted, #aaa)", textAlign: "center" }}>Loading…</p>}

          {/* ── Task memory tab ── */}
          {!loading && activeTab === "task" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)", fontStyle: "italic" }}>
                How your preferences differ by booking context.
              </p>
              {taskMemory.length === 0 && (
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-muted, #aaa)" }}>
                  Complete a few trips with feedback to build scenario memory.
                </p>
              )}
              {taskMemory.map((mem) => (
                <div key={`${mem.scenario}-${mem.stepType}`} style={{
                  padding: "10px 12px", borderRadius: 10,
                  border: "0.5px solid var(--border, #e5e7eb)",
                  background: "var(--card-2, #f9f9f9)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{
                        fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700,
                        color: "#8b5cf6", background: "rgba(139,92,246,0.08)",
                        borderRadius: 4, padding: "1px 5px",
                      }}>
                        {mem.scenarioLabel}
                      </span>
                      <span style={{
                        fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 600,
                        color: "var(--text-secondary, #666)", background: "var(--border, #e5e7eb)",
                        borderRadius: 4, padding: "1px 5px", textTransform: "capitalize",
                      }}>
                        {mem.stepType}
                      </span>
                    </div>
                    <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>
                      {mem.totalEvents} events
                    </span>
                  </div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-primary, #111)", marginBottom: 8, lineHeight: 1.4 }}>
                    {mem.keyInsight}
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    {mem.timeAdjustAcceptance !== null && (
                      <div style={{ flex: 1 }}>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)", marginBottom: 3 }}>Time adjust</p>
                        <ProgressBar value={mem.timeAdjustAcceptance} color="rgba(234,88,12,0.7)" />
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "rgba(234,88,12,0.8)", marginTop: 2 }}>
                          {Math.round(mem.timeAdjustAcceptance * 100)}% accepted
                        </p>
                      </div>
                    )}
                    {mem.venueSwitchAcceptance !== null && (
                      <div style={{ flex: 1 }}>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)", marginBottom: 3 }}>Venue switch</p>
                        <ProgressBar value={mem.venueSwitchAcceptance} color="#6366f1" />
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "#6366f1", marginTop: 2 }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {!patternMemory && (
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-muted, #aaa)" }}>
                  Complete a few trips with feedback to build behavioral patterns.
                </p>
              )}

              {patternMemory && (
                <>
                  {/* Stated vs actual */}
                  <div>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Stated vs actual tolerance
                    </p>
                    <div style={{
                      padding: "10px 12px", borderRadius: 10, lineHeight: 1.5,
                      background: patternMemory.statedVsActual.conclusion === "more_strict"
                        ? "rgba(220,38,38,0.04)" : patternMemory.statedVsActual.conclusion === "more_liberal"
                        ? "rgba(22,163,74,0.04)" : "var(--card-2, #f9f9f9)",
                      border: `0.5px solid ${patternMemory.statedVsActual.conclusion === "more_strict"
                        ? "rgba(220,38,38,0.15)" : patternMemory.statedVsActual.conclusion === "more_liberal"
                        ? "rgba(22,163,74,0.15)" : "var(--border, #e5e7eb)"}`,
                    }}>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-primary, #111)" }}>
                        {patternMemory.statedVsActual.insight}
                      </p>
                      {patternMemory.statedVsActual.actualAcceptanceRate !== null && (
                        <div style={{ marginTop: 8 }}>
                          <ProgressBar
                            value={patternMemory.statedVsActual.actualAcceptanceRate}
                            color={patternMemory.statedVsActual.conclusion === "more_strict"
                              ? "rgba(220,38,38,0.6)" : "rgba(22,163,74,0.7)"}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Satisfaction predictors */}
                  {patternMemory.satisfactionPredictors.length > 0 && (
                    <div>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                        What drives your satisfaction
                      </p>
                      {patternMemory.satisfactionPredictors.map((pred) => (
                        <div key={pred.agentDecision} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)" }}>{pred.insight}</p>
                          </div>
                          {pred.avgScore !== null && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <div style={{ width: 60 }}>
                                <ProgressBar
                                  value={pred.avgScore}
                                  color={pred.avgScore >= 0.7 ? "rgba(22,163,74,0.7)" : pred.avgScore >= 0.4 ? "var(--gold, #D4A34B)" : "rgba(220,38,38,0.6)"}
                                />
                              </div>
                              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #666)" }}>
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
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                        When you take control
                      </p>
                      {patternMemory.overrideTriggers.map((t, i) => (
                        <div key={i} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "5px 0", borderBottom: "0.5px solid var(--border, #e5e7eb)",
                        }}>
                          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)" }}>{t.description}</p>
                          <span style={{
                            fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700,
                            color: "rgba(220,38,38,0.8)", flexShrink: 0, marginLeft: 8,
                          }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)", fontStyle: "italic" }}>
                Who are you booking for? The agent remembers your group&apos;s preferences and history.
              </p>

              {!relEditMode && relationship && (
                <>
                  <div style={{ padding: "12px 14px", borderRadius: 12, border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card-2, #f9f9f9)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 14 }}>{relationship.name}</p>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", textTransform: "capitalize" }}>{relationship.type}</p>
                      </div>
                      <button onClick={() => setRelEditMode(true)} style={{
                        background: "none", border: "0.5px solid var(--border, #e5e7eb)",
                        borderRadius: 6, padding: "3px 8px", fontFamily: "var(--font-dm-sans)",
                        fontSize: 11, color: "var(--text-secondary, #666)", cursor: "pointer",
                      }}>Edit</button>
                    </div>
                    {relationship.constraints.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 600, color: "var(--text-muted, #aaa)", marginBottom: 4 }}>NEEDS</p>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {relationship.constraints.map((c) => (
                            <span key={c} style={{
                              fontFamily: "var(--font-dm-sans)", fontSize: 11,
                              color: "rgba(22,163,74,0.85)", background: "rgba(22,163,74,0.08)",
                              borderRadius: 6, padding: "2px 7px",
                            }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {relationship.avoid_types.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 600, color: "var(--text-muted, #aaa)", marginBottom: 4 }}>AVOIDS</p>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {relationship.avoid_types.map((a) => (
                            <span key={a} style={{
                              fontFamily: "var(--font-dm-sans)", fontSize: 11,
                              color: "rgba(220,38,38,0.75)", background: "rgba(220,38,38,0.06)",
                              borderRadius: 6, padding: "2px 7px",
                            }}>{a}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {relationship.notes && (
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary, #666)", lineHeight: 1.5, fontStyle: "italic" }}>
                        {relationship.notes}
                      </p>
                    )}
                  </div>
                </>
              )}

              {(!relationship || relEditMode) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    value={relForm.name}
                    onChange={(e) => setRelForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={relEditMode ? "Profile name" : "Give this profile a name (e.g. 'Alex & Jordan')"}
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card, #fff)",
                      fontFamily: "var(--font-dm-sans)", fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["solo", "couple", "friends", "family"] as RelationshipType[]).map((t) => (
                      <button key={t} onClick={() => setRelForm((f) => ({ ...f, type: t }))} style={{
                        flex: 1, padding: "5px 2px", borderRadius: 8, cursor: "pointer",
                        border: `0.5px solid ${relForm.type === t ? "var(--gold, #D4A34B)" : "var(--border, #e5e7eb)"}`,
                        background: relForm.type === t ? "rgba(212,163,75,0.1)" : "transparent",
                        fontFamily: "var(--font-dm-sans)", fontSize: 11,
                        color: relForm.type === t ? "var(--gold, #D4A34B)" : "var(--text-secondary, #666)",
                        fontWeight: relForm.type === t ? 700 : 400, textTransform: "capitalize",
                      }}>
                        {t}
                      </button>
                    ))}
                  </div>
                  <input
                    value={relForm.constraints}
                    onChange={(e) => setRelForm((f) => ({ ...f, constraints: e.target.value }))}
                    placeholder="Must-haves (comma separated): quiet venue, needs parking, vegetarian"
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card, #fff)",
                      fontFamily: "var(--font-dm-sans)", fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />
                  <input
                    value={relForm.avoid_types}
                    onChange={(e) => setRelForm((f) => ({ ...f, avoid_types: e.target.value }))}
                    placeholder="Things to avoid: chain hotels, loud restaurants, outdoor in rain"
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card, #fff)",
                      fontFamily: "var(--font-dm-sans)", fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />
                  <textarea
                    value={relForm.notes}
                    onChange={(e) => setRelForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Free notes: 'She doesn't like spicy food. He hates jazz bars.'"
                    rows={2}
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: "0.5px solid var(--border, #e5e7eb)", background: "var(--card, #fff)",
                      fontFamily: "var(--font-dm-sans)", fontSize: 12, resize: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveRelationship} disabled={!relForm.name.trim()} style={{
                      flex: 1, padding: "8px", borderRadius: 8, border: "none",
                      background: "var(--gold, #D4A34B)", color: "#fff",
                      fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 700,
                      cursor: relForm.name.trim() ? "pointer" : "not-allowed", opacity: relForm.name.trim() ? 1 : 0.5,
                    }}>
                      {relEditMode ? "Save changes" : "Create profile"}
                    </button>
                    {relEditMode && (
                      <button onClick={() => setRelEditMode(false)} style={{
                        padding: "8px 12px", borderRadius: 8,
                        border: "0.5px solid var(--border, #e5e7eb)", background: "transparent",
                        fontFamily: "var(--font-dm-sans)", fontSize: 12, cursor: "pointer",
                      }}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === "overview" && stats && stats.totalEvents === 0 && (
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", textAlign: "center" }}>
              No data yet — insights appear after you complete trips and give feedback.
            </p>
          )}

          {activeTab === "overview" && stats && stats.totalEvents > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Acceptance rate */}
              <div>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                  Did you accept the agent&apos;s decisions?
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ProgressBar value={stats.adjustmentAcceptanceRate} color="rgba(22,163,74,0.7)" />
                  <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "rgba(22,163,74,0.85)", flexShrink: 0 }}>
                    {Math.round(stats.adjustmentAcceptanceRate * 100)}%
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                  <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(22,163,74,0.8)" }}>
                    ✓ {stats.outcomeBreakdown.accepted} accepted
                  </span>
                  <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(220,38,38,0.75)" }}>
                    ↗ {stats.outcomeBreakdown.manual_override} manual override
                  </span>
                </div>
              </div>

              {/* Satisfaction */}
              {(stats.outcomeBreakdown.satisfied + stats.outcomeBreakdown.ok + stats.outcomeBreakdown.unsatisfied) > 0 && (
                <div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                    Satisfaction
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    {[
                      { emoji: "😊", label: "Great", count: stats.outcomeBreakdown.satisfied },
                      { emoji: "👍", label: "OK", count: stats.outcomeBreakdown.ok },
                      { emoji: "😕", label: "Needed fixes", count: stats.outcomeBreakdown.unsatisfied },
                    ].map(({ emoji, label, count }) => (
                      <div key={label} style={{ textAlign: "center", flex: 1 }}>
                        <p style={{ fontSize: 20, marginBottom: 2 }}>{emoji}</p>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700 }}>{count}</p>
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)" }}>{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Provider success rates */}
              {stats.providerStats.length > 0 && (
                <div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                    Provider acceptance rates
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {stats.providerStats.map((p) => (
                      <div key={p.provider} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", width: 100, flexShrink: 0 }}>
                          {PROVIDER_NAMES[p.provider] ?? p.provider}
                        </span>
                        <ProgressBar value={p.rate} color={p.rate > 0.7 ? "rgba(22,163,74,0.7)" : p.rate > 0.4 ? "var(--gold, #D4A34B)" : "rgba(220,38,38,0.65)"} />
                        <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 36 }}>
                          {Math.round(p.rate * 100)}%
                        </span>
                        <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)", flexShrink: 0 }}>
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
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                    Which tasks need most manual help?
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {stats.manualByType.map((t) => {
                      const manualRate = t.total > 0 ? t.manual / t.total : 0;
                      return (
                        <div key={t.step_type} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", width: 80, flexShrink: 0, textTransform: "capitalize" }}>
                            {t.step_type}
                          </span>
                          <ProgressBar value={manualRate} color="rgba(220,38,38,0.5)" />
                          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, flexShrink: 0 }}>
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
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                    How the agent solved bookings
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {stats.decisionTypeUsage.map((d) => (
                      <div key={d.agent_decision} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
                          {DECISION_LABELS[d.agent_decision] ?? d.agent_decision}
                        </span>
                        <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600 }}>{d.count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top overridden venues */}
              {stats.topOverriddenVenues.length > 0 && (
                <div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                    Venues you most often booked differently
                  </p>
                  {stats.topOverriddenVenues.map((v) => (
                    <div key={v.venue_name} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>{v.venue_name}</span>
                      <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "rgba(220,38,38,0.75)", fontWeight: 600 }}>{v.overrides}× overridden</span>
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

export default function TripsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<BookingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setClockTick] = useState(0);
  const [clearingAll, setClearingAll] = useState(false);

  // ── Live panel state ──────────────────────────────────────────────────────────
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [splitPct, setSplitPct] = useState(50);
  const [liveViewKey, setLiveViewKey] = useState(0);
  // Refs for zero-latency drag — bypass React re-render during mousemove
  const splitPctRef = useRef(50);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const livePanelRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  // Track current liveJobId in a ref so openLive can read it without closure staleness
  const liveJobIdRef = useRef<string | null>(null);

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

  const loadJobs = useCallback(async () => {
    const sid = getSessionId();
    try {
      const res = await fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  async function handleClearAll() {
    const sid = getSessionId();
    if (!sid || clearingAll) return;
    if (!confirm(`Delete all ${jobs.length} tasks and their monitors?`)) return;
    setClearingAll(true);
    try {
      await fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`, { method: "DELETE" });
      setJobs([]);
    } finally {
      setClearingAll(false);
    }
  }

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running" || j.status === "pending");
    if (!hasRunning) return;
    const timer = setInterval(loadJobs, 5000);
    return () => clearInterval(timer);
  }, [jobs, loadJobs]);

  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running" || j.status === "pending");
    if (!hasRunning) return;
    const timer = setInterval(() => setClockTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [jobs]);

  const actionTotal = jobs.reduce((n, j) => n + j.steps.filter((s) => s.actionItem).length, 0);

  const liveJob = jobs.find((j) => j.id === liveJobId);
  const rightPct = liveJobId ? (100 - splitPct) : 0;

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
        <div style={{ padding: "20px 20px 4px", maxWidth: 620, margin: "0 auto" }}>
          <button
            onClick={() => router.back()}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "none", border: "none", padding: "0 0 10px",
              fontFamily: "var(--font-dm-sans)", fontSize: 13,
              color: "var(--text-secondary, #666)", cursor: "pointer",
            }}
          >
            ← Back to results
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 17 }}>Tasks</p>
            {actionTotal > 0 && (
              <span style={{
                fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
                color: "#fff", backgroundColor: "rgba(220,38,38,0.85)",
                borderRadius: 20, padding: "2px 7px",
              }}>
                {actionTotal} action{actionTotal > 1 ? "s" : ""} needed
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
              {loading ? "Loading…" : jobs.length === 0 ? "No tasks yet" : `${jobs.length} task${jobs.length === 1 ? "" : "s"}`}
            </p>
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
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 620, margin: "0 auto" }}>
          {!loading && jobs.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", borderRadius: 16, border: "0.5px dashed var(--border, #e5e7eb)" }}>
              <p style={{ fontSize: 32, marginBottom: 12 }}>📋</p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>No tasks yet</p>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)" }}>
                When you ask the agent to do something in the background, your tasks appear here.
              </p>
            </div>
          )}

          {jobs.map((job) => <JobCard key={job.id} job={job} onRefresh={loadJobs} sessionId={sessionId} onOpenLive={openLive} />)}

          {/* Agent Insights — always show at the bottom */}
          {!loading && sessionId && (
            <InsightsPanel sessionId={sessionId} />
          )}
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

          {/* Live panel */}
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
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", flexShrink: 0,
              borderBottom: "0.5px solid rgba(255,255,255,0.1)",
            }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 14, fontWeight: 700, color: "#fff", margin: 0 }}>
                  🖥️ Agent browser
                </p>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(255,255,255,0.45)", margin: 0, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {liveJob?.trip_label ?? ""}
                </p>
              </div>
              <button onClick={() => { liveJobIdRef.current = null; setLiveJobId(null); }} style={{
                flexShrink: 0, marginLeft: 12,
                background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8,
                color: "#fff", padding: "8px 16px", cursor: "pointer",
                fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600,
              }}>
                Close ✕
              </button>
            </div>

            {/* Browser view */}
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              <BrowserLiveView key={liveViewKey} jobId={liveJobId} fullscreen />
            </div>

            {/* Footer */}
            <div style={{ flexShrink: 0, padding: "8px 16px", textAlign: "center", borderTop: "0.5px solid rgba(255,255,255,0.1)" }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                Live view — read only · Drag handle to resize
              </p>
            </div>
          </div>
        </>
      )}
    </div>
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
