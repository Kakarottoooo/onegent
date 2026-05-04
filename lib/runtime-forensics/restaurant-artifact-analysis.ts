/**
 * Restaurant artifact analyzer.
 *
 * Pure no-live module: consumes already-collected DB/log/screenshot metadata
 * for Resy and OpenTable restaurant runs and returns a deterministic
 * classification. It does not read from disk, touch the network, call OpenAI,
 * or invoke any provider/runtime code.
 */

import type { JobLikeInput } from "./types";

export type RestaurantArtifactState =
  | "resy_modal_disabled_details_api_failed"
  | "resy_otp_login_boundary"
  | "resy_no_availability"
  | "opentable_phone_otp_handoff"
  | "opentable_form_incomplete"
  | "provider_network_degraded"
  | "safe_manual_review_reached"
  | "insufficient_evidence";

type SignalKind =
  | "resy_modal_disabled_details_api_failed"
  | "resy_otp_login_boundary"
  | "resy_no_availability"
  | "opentable_phone_otp_handoff"
  | "opentable_form_incomplete"
  | "provider_network_degraded"
  | "safe_manual_review_reached";

type TextSourceKind = "job" | "db_row" | "worker_log" | "artifact_path" | "note";

export const RESTAURANT_ARTIFACT_STATE_LABEL: Record<
  RestaurantArtifactState,
  string
> = {
  resy_modal_disabled_details_api_failed:
    "Resy modal disabled / details API failed",
  resy_otp_login_boundary: "Resy OTP/login boundary",
  resy_no_availability: "Resy no availability",
  opentable_phone_otp_handoff: "OpenTable phone/OTP handoff",
  opentable_form_incomplete: "OpenTable form incomplete",
  provider_network_degraded: "Provider/network degraded",
  safe_manual_review_reached: "Safe manual review reached",
  insufficient_evidence: "Insufficient evidence",
};

export interface RestaurantArtifactBundle {
  /**
   * Duck-typed booking job or extracted DB row transformed into JobLikeInput.
   */
  job?: JobLikeInput | null;
  /**
   * Optional raw DB row. Useful when the operator pasted the booking_jobs row
   * before shaping it into JobLikeInput.
   */
  dbRow?: unknown;
  /**
   * Bounded excerpt from codex-worker.log or benchmark runner logs.
   */
  workerLogExcerpt?: string | null;
  /**
   * Optional filesystem path to the worker log excerpt source.
   */
  workerLogPath?: string | null;
  /**
   * Provider screenshots, typically worker/.debug-screenshots/<provider>-*.
   */
  screenshotPaths?: readonly string[];
  /**
   * Live snapshot JSON paths, typically .debug-screenshots/live/<job-id>/*.json.
   */
  liveSnapshotPaths?: readonly string[];
  /**
   * Operator notes copied from the runbook checklist.
   */
  notes?: readonly string[];
}

export interface RestaurantArtifactEvidenceSignal {
  kind: SignalKind;
  source: TextSourceKind;
  sourceLabel: string;
  label: string;
  excerpt: string;
}

export interface RestaurantArtifactAnalysis {
  state: RestaurantArtifactState;
  label: string;
  confidence: "high" | "medium" | "low";
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  signals: RestaurantArtifactEvidenceSignal[];
  artifactPaths: {
    workerLogPath: string | null;
    screenshots: string[];
    liveSnapshots: string[];
  };
  summary: string;
  nextAction: string;
}

interface SignalPattern {
  kind: SignalKind;
  label: string;
  rx: RegExp;
}

interface TextEntry {
  source: TextSourceKind;
  label: string;
  text: string;
}

const SIGNAL_PATTERNS: SignalPattern[] = [
  {
    kind: "safe_manual_review_reached",
    label: "ready for confirmation",
    rx: /\bready[-_\s]?for[-_\s]?confirmation\b/i,
  },
  {
    kind: "safe_manual_review_reached",
    label: "ready to review",
    rx: /\bready[-_\s]?to[-_\s]?review\b/i,
  },
  {
    kind: "safe_manual_review_reached",
    label: "safe handoff",
    rx: /\bsafe[-_\s]?handoff\b/i,
  },
  {
    kind: "safe_manual_review_reached",
    label: "manual review reached",
    rx: /\bmanual[-_\s]?review\s+(reached|ready|visible)\b/i,
  },
  {
    kind: "safe_manual_review_reached",
    label: "final confirmation boundary visible",
    rx: /\b(final|complete|confirm)\s+(reservation|booking)\s+(button|boundary|review)\s+(visible|reached|ready)\b/i,
  },
  {
    kind: "resy_otp_login_boundary",
    label: "Resy OTP boundary",
    rx: /\bresy\b.*\b(otp|one[-\s]?time code|verification code|email code|sms code|phone verification)\b|\b(otp|one[-\s]?time code|verification code|email code|sms code|phone verification)\b.*\bresy\b/i,
  },
  {
    kind: "resy_otp_login_boundary",
    label: "Resy login wall",
    rx: /\bresy\b.*\b(login|log in|sign[-\s]?in)\s+(wall|required|prompt|modal)\b|\b(login|log in|sign[-\s]?in)\s+(wall|required|prompt|modal)\b.*\bresy\b/i,
  },
  {
    kind: "opentable_phone_otp_handoff",
    label: "OpenTable phone verification",
    rx: /\bopentable\b.*\b(phone verification|verify phone|phone[-\s]?only|otp|sms code|verification code)\b|\b(phone verification|verify phone|phone[-\s]?only|otp|sms code|verification code)\b.*\bopentable\b/i,
  },
  {
    kind: "opentable_phone_otp_handoff",
    label: "OpenTable phone input gate",
    rx: /\b(phoneNumber|phone number)\b.*\b(complete reservation|verification|handoff|gate)\b|\b(complete reservation|verification|handoff|gate)\b.*\b(phoneNumber|phone number)\b/i,
  },
  {
    kind: "resy_no_availability",
    label: "Resy no availability",
    rx: /\bresy\b.*\b(no availability|no slots|no times|sold out|fully booked)\b|\b(no availability|no slots|no times|sold out|fully booked)\b.*\bresy\b/i,
  },
  {
    kind: "resy_no_availability",
    label: "Resy availability terminal code",
    rx: /\b(F-AVAIL-NONE|PROVIDER_NO_SLOT|no_availability_correct)\b/i,
  },
  {
    kind: "resy_modal_disabled_details_api_failed",
    label: "Resy modal disabled",
    rx: /\bresy\b.*\b(modal|reservation modal|book button|reserve button)\b.*\b(disabled|greyed|grayed|not enabled)\b|\b(modal|reservation modal|book button|reserve button)\b.*\b(disabled|greyed|grayed|not enabled)\b.*\bresy\b/i,
  },
  {
    kind: "resy_modal_disabled_details_api_failed",
    label: "Resy details API failed",
    rx: /\bresy\b.*\b(details api|venue details|experience details|details endpoint)\b.*\b(failed|error|5\d{2}|timeout)\b|\b(details api|venue details|experience details|details endpoint)\b.*\b(failed|error|5\d{2}|timeout)\b.*\bresy\b/i,
  },
  {
    kind: "opentable_form_incomplete",
    label: "OpenTable form incomplete",
    rx: /\bopentable\b.*\b(form incomplete|guest form incomplete|required field missing|field remains empty|auditAndRefill gave up)\b|\b(form incomplete|guest form incomplete|required field missing|field remains empty|auditAndRefill gave up)\b.*\bopentable\b/i,
  },
  {
    kind: "opentable_form_incomplete",
    label: "OpenTable missing contact field",
    rx: /\bopentable\b.*\b(missing|empty|required)\s+(phone|email|first name|last name)\b|\b(missing|empty|required)\s+(phone|email|first name|last name)\b.*\bopentable\b/i,
  },
  {
    kind: "provider_network_degraded",
    label: "5xx provider/server status",
    rx: /\b5\d{2}\b\s*(error|response|status|server)?/i,
  },
  {
    kind: "provider_network_degraded",
    label: "TCP-level network error",
    rx: /\b(econnreset|econnrefused|enotfound|etimedout)\b/i,
  },
  {
    kind: "provider_network_degraded",
    label: "Chromium network error",
    rx: /\bnet::ERR_[A-Z_]+\b/,
  },
  {
    kind: "provider_network_degraded",
    label: "gateway timeout/error",
    rx: /\bgateway\s+(timeout|error)\b/i,
  },
  {
    kind: "provider_network_degraded",
    label: "provider unavailable",
    rx: /\b(provider|resy|opentable)\s+(unreachable|down|unavailable|timed out|degraded)\b/i,
  },
  {
    kind: "provider_network_degraded",
    label: "rate limited or blocked",
    rx: /\b(rate[-\s]?limit|429|too many requests|temporarily blocked)\b/i,
  },
];

export function analyzeRestaurantArtifactBundle(
  bundle: RestaurantArtifactBundle,
): RestaurantArtifactAnalysis {
  const entries = buildTextEntries(bundle);
  const signals = collectSignals(entries);
  const has = (kind: SignalKind) => signals.some((s) => s.kind === kind);

  const hasSafeManualReview = has("safe_manual_review_reached");
  const hasResyOtpLogin = has("resy_otp_login_boundary");
  const hasOpenTablePhoneOtp = has("opentable_phone_otp_handoff");
  const hasResyNoAvailability = has("resy_no_availability");
  const hasResyModalDetails = has("resy_modal_disabled_details_api_failed");
  const hasOpenTableFormIncomplete = has("opentable_form_incomplete");
  const hasNetwork = has("provider_network_degraded");

  let state: RestaurantArtifactState;
  if (hasResyOtpLogin) {
    state = "resy_otp_login_boundary";
  } else if (hasOpenTablePhoneOtp) {
    state = "opentable_phone_otp_handoff";
  } else if (hasSafeManualReview) {
    state = "safe_manual_review_reached";
  } else if (hasResyNoAvailability) {
    state = "resy_no_availability";
  } else if (hasResyModalDetails) {
    state = "resy_modal_disabled_details_api_failed";
  } else if (hasOpenTableFormIncomplete) {
    state = "opentable_form_incomplete";
  } else if (hasNetwork) {
    state = "provider_network_degraded";
  } else {
    state = "insufficient_evidence";
  }

  const job = bundle.job ?? null;
  const dbRow = bundle.dbRow;
  const jobId = firstString(job?.id, readString(dbRow, "id"));
  const taskId = firstString(job?.taskId, readString(dbRow, "task_id"), readString(dbRow, "taskId"));
  const provider = firstString(job?.provider, readString(dbRow, "provider")) ?? "unknown";
  const scenario = firstString(job?.scenario, readString(dbRow, "scenario")) ?? "unknown";
  const status = firstString(job?.status, readString(dbRow, "status")) ?? "unknown";
  const artifactPaths = {
    workerLogPath: firstString(bundle.workerLogPath) ?? null,
    screenshots: cleanStringList(bundle.screenshotPaths),
    liveSnapshots: cleanStringList(bundle.liveSnapshotPaths),
  };

  return {
    state,
    label: RESTAURANT_ARTIFACT_STATE_LABEL[state],
    confidence: classifyConfidence(state, signals),
    jobId,
    taskId,
    provider,
    scenario,
    status,
    signals,
    artifactPaths,
    summary: buildSummary(state, signals),
    nextAction: nextActionForState(state),
  };
}

export function formatRestaurantArtifactAnalysisMarkdown(
  analysis: RestaurantArtifactAnalysis,
): string {
  const lines: string[] = [];

  lines.push("## Restaurant Artifact Analysis");
  lines.push("");
  lines.push(`- **State**: \`${analysis.state}\` (${analysis.label})`);
  lines.push(`- **Confidence**: \`${analysis.confidence}\``);
  lines.push(`- **Job id**: \`${analysis.jobId ?? "(unknown)"}\``);
  if (analysis.taskId) lines.push(`- **Task id**: \`${analysis.taskId}\``);
  lines.push(`- **Provider**: \`${analysis.provider}\``);
  lines.push(`- **Scenario**: \`${analysis.scenario}\``);
  lines.push(`- **Status**: \`${analysis.status}\``);
  lines.push("");
  lines.push("### Evidence Signals");
  lines.push("");
  if (analysis.signals.length === 0) {
    lines.push("_No known restaurant artifact signals were found in the bundle._");
  } else {
    for (const signal of analysis.signals.slice(0, 12)) {
      lines.push(
        `- **${signal.label}** from \`${signal.sourceLabel}\`: ${escapeMarkdownLine(
          signal.excerpt,
        )}`,
      );
    }
  }
  lines.push("");
  lines.push("### Artifact Paths");
  lines.push("");
  if (analysis.artifactPaths.workerLogPath) {
    lines.push(`- Worker log: \`${analysis.artifactPaths.workerLogPath}\``);
  }
  for (const screenshotPath of analysis.artifactPaths.screenshots) {
    lines.push(`- Screenshot: \`${screenshotPath}\``);
  }
  for (const liveSnapshotPath of analysis.artifactPaths.liveSnapshots) {
    lines.push(`- Live snapshot: \`${liveSnapshotPath}\``);
  }
  if (
    !analysis.artifactPaths.workerLogPath &&
    analysis.artifactPaths.screenshots.length === 0 &&
    analysis.artifactPaths.liveSnapshots.length === 0
  ) {
    lines.push("_No artifact paths were included._");
  }
  lines.push("");
  lines.push("### Verdict");
  lines.push("");
  lines.push(analysis.summary);
  lines.push("");
  lines.push("### Next Action");
  lines.push("");
  lines.push(analysis.nextAction);

  return lines.join("\n");
}

export function formatRestaurantArtifactBundleMarkdown(
  bundle: RestaurantArtifactBundle,
): string {
  return formatRestaurantArtifactAnalysisMarkdown(
    analyzeRestaurantArtifactBundle(bundle),
  );
}

function buildTextEntries(bundle: RestaurantArtifactBundle): TextEntry[] {
  const entries: TextEntry[] = [];
  const job = bundle.job ?? null;

  addText(entries, "worker_log", "workerLogExcerpt", bundle.workerLogExcerpt);
  addText(entries, "worker_log", "job.rawWorkerLogExcerpt", job?.rawWorkerLogExcerpt);
  addText(entries, "job", "job.provider", job?.provider);
  addText(entries, "job", "job.scenario", job?.scenario);
  addText(entries, "job", "job.status", job?.status);
  addText(entries, "job", "job.errorMessage", job?.errorMessage);
  addText(entries, "job", "job.terminalReason", job?.terminalReason);
  addText(entries, "job", "job.terminalCode", job?.terminalCode);
  addText(entries, "job", "job.steps", stringify(job?.steps));
  addText(entries, "job", "job.decisionLog", stringify(job?.decisionLog));
  addText(entries, "job", "job.params", stringify(job?.params));
  addText(entries, "db_row", "dbRow", stringify(bundle.dbRow));
  addText(entries, "artifact_path", "workerLogPath", bundle.workerLogPath);
  addText(
    entries,
    "artifact_path",
    "screenshotPaths",
    cleanStringList(bundle.screenshotPaths).join("\n"),
  );
  addText(
    entries,
    "artifact_path",
    "liveSnapshotPaths",
    cleanStringList(bundle.liveSnapshotPaths).join("\n"),
  );
  for (const [i, note] of cleanStringList(bundle.notes).entries()) {
    addText(entries, "note", `notes[${i}]`, note);
  }

  return entries;
}

function collectSignals(entries: TextEntry[]): RestaurantArtifactEvidenceSignal[] {
  const signals: RestaurantArtifactEvidenceSignal[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    for (const pattern of SIGNAL_PATTERNS) {
      const match = pattern.rx.exec(entry.text);
      if (!match) continue;
      const excerpt = excerptAround(entry.text, match.index, match[0].length);
      if (
        pattern.kind === "safe_manual_review_reached" &&
        isNegatedManualReviewExcerpt(excerpt)
      ) {
        continue;
      }
      const key = `${pattern.kind}|${entry.label}|${pattern.label}|${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push({
        kind: pattern.kind,
        source: entry.source,
        sourceLabel: entry.label,
        label: pattern.label,
        excerpt,
      });
    }
  }

  return signals.sort((a, b) => signalRank(a.kind) - signalRank(b.kind));
}

function classifyConfidence(
  state: RestaurantArtifactState,
  signals: RestaurantArtifactEvidenceSignal[],
): "high" | "medium" | "low" {
  if (state === "insufficient_evidence") return "low";
  const matchingSignals = signals.filter((signal) => signal.kind === state);
  if (matchingSignals.length >= 2) return "high";
  if (matchingSignals.some((signal) => signal.source === "worker_log")) {
    return "high";
  }
  return "medium";
}

function buildSummary(
  state: RestaurantArtifactState,
  signals: RestaurantArtifactEvidenceSignal[],
): string {
  const confidence = classifyConfidence(state, signals);
  const signalText =
    signals.length === 0
      ? "no known signals"
      : signals
          .slice(0, 3)
          .map((s) => s.label)
          .join(", ");
  return `${RESTAURANT_ARTIFACT_STATE_LABEL[state]} with ${confidence} confidence (${signalText}).`;
}

function nextActionForState(state: RestaurantArtifactState): string {
  switch (state) {
    case "resy_modal_disabled_details_api_failed":
      return "Treat as a Resy provider artifact issue. Do not rerun live; inspect DB/log/screenshot evidence for details API or disabled modal drift before any provider patch.";
    case "resy_otp_login_boundary":
      return "Treat as an expected Resy safe boundary. Do not bypass login, OTP, CAPTCHA, phone verification, or account-sensitive prompts.";
    case "resy_no_availability":
      return "Treat as correct only when probe/artifact evidence confirms no target-window slot. Pick a probe-positive case before any future live fill attempt.";
    case "opentable_phone_otp_handoff":
      return "Treat as an OpenTable phone/OTP safe handoff. Keep the browser available for human review and do not click final confirmation.";
    case "opentable_form_incomplete":
      return "Treat as OpenTable form-fill evidence. Patch only after screenshots show the expected fields were visible and unfilled.";
    case "provider_network_degraded":
      return "Treat as provider/network degradation. Do not patch selectors from this class unless separate screenshots prove visible provider controls were missed.";
    case "safe_manual_review_reached":
      return "Count as safe Phase 0 progress. Preserve the hard stop before final confirmation, payment, OTP/CAPTCHA/login bypass, or account-sensitive action.";
    case "insufficient_evidence":
      return "Collect the DB row, bounded worker log excerpt, provider screenshots, and live snapshot paths before making a patch decision.";
  }
}

function signalRank(kind: SignalKind): number {
  switch (kind) {
    case "resy_otp_login_boundary":
      return 0;
    case "opentable_phone_otp_handoff":
      return 1;
    case "safe_manual_review_reached":
      return 2;
    case "resy_no_availability":
      return 3;
    case "resy_modal_disabled_details_api_failed":
      return 4;
    case "opentable_form_incomplete":
      return 5;
    case "provider_network_degraded":
      return 6;
  }
}

function addText(
  entries: TextEntry[],
  source: TextSourceKind,
  label: string,
  value: string | null | undefined,
): void {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return;
  entries.push({ source, label, text });
}

function cleanStringList(value: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + length + 120);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function isNegatedManualReviewExcerpt(excerpt: string): boolean {
  return /\b(no|not|never|without)\s+(manual review|ready[-_\s]?for[-_\s]?confirmation|ready[-_\s]?to[-_\s]?review|safe[-_\s]?handoff)\b/i.test(
    excerpt,
  );
}

function escapeMarkdownLine(text: string): string {
  return text.replace(/`/g, "\\`");
}
