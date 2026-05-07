/**
 * Expedia retry artifact analyzer.
 *
 * Pure no-live module: consumes already-collected DB/log/screenshot metadata
 * and returns a deterministic post-run classification. It does not read from
 * disk, touch the network, or invoke any provider/runtime code.
 */

import type { JobLikeInput } from "./types";

export type ExpediaRetryState =
  | "card_scan_failed_before_fallback"
  | "fallback_attempted_no_match"
  | "fallback_matched_no_checkout"
  | "checkout_manual_review_reached"
  | "login_or_otp_boundary"
  | "model_or_env_transient"
  | "network_provider_failure"
  | "provider_no_availability"
  | "insufficient_evidence";

type SignalKind =
  | "mixed_or_stale_worker_evidence"
  | "checkout_form_incomplete"
  | "card_scan_failed"
  | "fallback_attempted"
  | "fallback_matched"
  | "no_match"
  | "checkout_reached"
  | "login_or_otp_boundary"
  | "model_or_env_transient"
  | "network_provider_failure"
  | "provider_no_availability";

type TextSourceKind = "job" | "db_row" | "worker_log" | "artifact_path" | "note";

export const EXPEDIA_RETRY_STATE_LABEL: Record<ExpediaRetryState, string> = {
  card_scan_failed_before_fallback: "Card scan failed before fallback",
  fallback_attempted_no_match: "Fallback attempted but no match",
  fallback_matched_no_checkout: "Fallback matched but did not reach checkout",
  checkout_manual_review_reached: "Checkout/manual-review reached",
  login_or_otp_boundary: "Login/OTP/CAPTCHA boundary",
  model_or_env_transient: "Model/env transient",
  network_provider_failure: "Network/provider failure",
  provider_no_availability: "Provider no availability",
  insufficient_evidence: "Insufficient evidence",
};

export interface ExpediaRetryArtifactBundle {
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
   * Bounded excerpt from codex-worker.log collected after the approved retry.
   */
  workerLogExcerpt?: string | null;
  /**
   * Optional filesystem path to the worker log excerpt source.
   */
  workerLogPath?: string | null;
  /**
   * Provider screenshots, typically worker/.debug-screenshots/flight-rpa-*.
   */
  screenshotPaths?: readonly string[];
  /**
   * Live snapshot JSON paths, typically .debug-screenshots/live/<job-id>/*.json.
   */
  liveSnapshotPaths?: readonly string[];
  /**
   * Optional benchmark report path, if the controlled retry also emitted a
   * benchmark/runs JSON artifact.
   */
  benchmarkReportPath?: string | null;
  /**
   * Optional operator-facing taxonomy list copied into a template bundle.
   * The analyzer does not require it, but preserving it in templates keeps the
   * expected post-live decision classes explicit.
   */
  expectedClassificationTaxonomy?: readonly ExpediaRetryState[];
  /**
   * Operator notes copied from the runbook checklist.
   */
  notes?: readonly string[];
}

export interface ExpediaRetryEvidenceSignal {
  kind: SignalKind;
  source: TextSourceKind;
  sourceLabel: string;
  label: string;
  excerpt: string;
}

export interface ExpediaRetryAnalysis {
  state: ExpediaRetryState;
  label: string;
  confidence: "high" | "medium" | "low";
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  signals: ExpediaRetryEvidenceSignal[];
  artifactPaths: {
    workerLogPath: string | null;
    benchmarkReportPath: string | null;
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
    kind: "checkout_reached",
    label: "checkout reached",
    rx: /\bCheckout reached\b/i,
  },
  {
    kind: "checkout_reached",
    label: "checkout_reached marker",
    rx: /\bcheckout[-_\s]?reached\b/i,
  },
  {
    kind: "checkout_reached",
    label: "ready for confirmation",
    rx: /\bready[-_\s]?for[-_\s]?confirmation\b/i,
  },
  {
    kind: "checkout_reached",
    label: "awaiting manual confirmation",
    rx: /\bawaiting[-_\s]?(confirmation|human|founder|manual)[-_\s]?(confirm|review|tap)?\b/i,
  },
  {
    kind: "checkout_reached",
    label: "manual review",
    rx: /\bmanual[-_\s]?review\b/i,
  },
  {
    kind: "checkout_reached",
    label: "safe handoff",
    rx: /\bsafe[-_\s]?handoff\b/i,
  },
  {
    kind: "checkout_reached",
    label: "paused payment",
    rx: /\bpaused[-_\s]?payment\b/i,
  },
  {
    kind: "checkout_reached",
    label: "payment wall / CVV gate",
    rx: /\b(payment[-_\s]?wall|cvv[-_\s]?gate|stop[-_\s]?at[-_\s]?cvv)\b/i,
  },
  {
    kind: "checkout_form_incomplete",
    label: "traveler form missing required fields",
    rx: /\bTraveler form state:\b.*\bmissing=(?!none\b)[^\r\n]+/i,
  },
  {
    kind: "checkout_form_incomplete",
    label: "traveler details need manual review",
    rx: /\btraveler details need manual review\b/i,
  },
  {
    kind: "checkout_form_incomplete",
    label: "checkout reached but traveler form incomplete",
    rx: /\bcheckout reached\b.*\btraveler form (?:is )?incomplete\b/i,
  },
  {
    kind: "checkout_form_incomplete",
    label: "required allowed fields missing",
    rx: /\brequired allowed fields\b.*\bmissing\b/i,
  },
  {
    kind: "login_or_otp_boundary",
    label: "login boundary",
    rx: /\b(sign[-_\s]?in|log[-_\s]?in|login|authentication)\b.{0,80}\b(continue|required|boundary|manual intervention)\b/i,
  },
  {
    kind: "login_or_otp_boundary",
    label: "OTP boundary",
    rx: /\b(otp|one[-_\s]?time passcode|verification code|verify it'?s you|two[-_\s]?factor|2fa)\b/i,
  },
  {
    kind: "login_or_otp_boundary",
    label: "CAPTCHA boundary",
    rx: /\b(captcha|robot check|are you a robot|unusual traffic)\b/i,
  },
  {
    kind: "model_or_env_transient",
    label: "OpenAI Responses API 5xx",
    rx: /\bOpenAI\b.*\bResponses?\s+API\b.*\b5\d{2}\b/i,
  },
  {
    kind: "model_or_env_transient",
    label: "OpenAI Responses API 5xx",
    rx: /\bResponses?\s+API\b.*\b5\d{2}\b.*\bOpenAI\b/i,
  },
  {
    kind: "model_or_env_transient",
    label: "OpenAI model/env blocked",
    rx: /\b(openai|model|computer[-_\s]?use)\b.*\b(rate[-_\s]?limit|quota|billing|unavailable|disabled|required|missing|500)\b/i,
  },
  {
    kind: "model_or_env_transient",
    label: "OpenAI project/model mismatch",
    rx: /\b(model_not_found|model[-_\s]?not[-_\s]?found|does not have access to model|403\b.*\bmodel)\b/i,
  },
  {
    kind: "model_or_env_transient",
    label: "missing OpenAI env",
    rx: /\bOPENAI_API_KEY\b.*\b(required|missing|not set)\b/i,
  },
  {
    kind: "network_provider_failure",
    label: "5xx provider/server status",
    rx: /\b5\d{2}\b\s*(error|response|status|server)?/i,
  },
  {
    kind: "network_provider_failure",
    label: "TCP-level network error",
    rx: /\b(econnreset|econnrefused|enotfound|etimedout)\b/i,
  },
  {
    kind: "network_provider_failure",
    label: "Chromium network error",
    rx: /\bnet::ERR_[A-Z_]+\b/,
  },
  {
    kind: "network_provider_failure",
    label: "gateway timeout/error",
    rx: /\bgateway\s+(timeout|error)\b/i,
  },
  {
    kind: "network_provider_failure",
    label: "provider unavailable",
    rx: /\b(provider|expedia)\s+(unreachable|down|unavailable|timed out)\b/i,
  },
  {
    kind: "provider_no_availability",
    label: "provider no availability",
    rx: /\b(no availability|no available flights?|no matching (?:flight|fare)|provider inventory changed)\b/i,
  },
  {
    kind: "provider_no_availability",
    label: "target card not visible",
    rx: /\b(target|southwest|flight)\s+card\s+(is\s+)?not\s+visible\b/i,
  },
  {
    kind: "provider_no_availability",
    label: "fare sold out",
    rx: /\bfare\s+(may\s+have\s+)?sold\s+out\b/i,
  },
  {
    kind: "card_scan_failed",
    label: "flight-card DOM scan failed",
    rx: /Flight-card DOM scan failed/i,
  },
  {
    kind: "fallback_attempted",
    label: "locator fallback attempted",
    rx: /Trying locator fallback for flight-card scan/i,
  },
  {
    kind: "fallback_matched",
    label: "locator fallback matched",
    rx: /Locator fallback matched flight card/i,
  },
  {
    kind: "no_match",
    label: "no matching flight button",
    rx: /no matching flight button found/i,
  },
  {
    kind: "no_match",
    label: "no matching flight candidate",
    rx: /no matching flight|no candidate selected|could not find matching flight/i,
  },
  {
    kind: "no_match",
    label: "checkout not reached",
    rx: /flight checkout was not reached|not reaching checkout|did not reach checkout/i,
  },
];

export function analyzeExpediaRetryArtifactBundle(
  bundle: ExpediaRetryArtifactBundle,
): ExpediaRetryAnalysis {
  const entries = buildTextEntries(bundle);
  const job = bundle.job ?? null;
  const dbRow = bundle.dbRow;
  const jobId = firstString(job?.id, readString(dbRow, "id"));
  const taskId = firstString(job?.taskId, readString(dbRow, "task_id"), readString(dbRow, "taskId"));
  const provider = firstString(job?.provider, readString(dbRow, "provider")) ?? "unknown";
  const scenario = firstString(job?.scenario, readString(dbRow, "scenario")) ?? "unknown";
  const status = firstString(job?.status, readString(dbRow, "status")) ?? "unknown";
  const signals = collectSignals(entries, jobId);
  const has = (kind: SignalKind) => signals.some((s) => s.kind === kind);

  const hasMixedOrStaleEvidence = has("mixed_or_stale_worker_evidence");
  const hasCheckoutFormIncomplete = has("checkout_form_incomplete");
  const hasCheckout = has("checkout_reached");
  const hasLoginOrOtpBoundary = has("login_or_otp_boundary");
  const hasModelOrEnv = has("model_or_env_transient");
  const hasNetwork = has("network_provider_failure");
  const hasCardScanFailed = has("card_scan_failed");
  const hasFallbackAttempted = has("fallback_attempted");
  const hasFallbackMatched = has("fallback_matched");
  const hasNoMatch = has("no_match");
  const hasNoAvailability = has("provider_no_availability");

  let state: ExpediaRetryState;
  if (hasMixedOrStaleEvidence) {
    state = "insufficient_evidence";
  } else if (hasLoginOrOtpBoundary) {
    state = "login_or_otp_boundary";
  } else if (hasModelOrEnv) {
    state = "model_or_env_transient";
  } else if (hasNetwork) {
    state = "network_provider_failure";
  } else if (hasCheckoutFormIncomplete) {
    state = "insufficient_evidence";
  } else if (hasCheckout) {
    state = "checkout_manual_review_reached";
  } else if (hasFallbackMatched) {
    state = "fallback_matched_no_checkout";
  } else if (hasFallbackAttempted) {
    state = "fallback_attempted_no_match";
  } else if (hasCardScanFailed) {
    state = "card_scan_failed_before_fallback";
  } else if (hasNoAvailability) {
    state = "provider_no_availability";
  } else {
    state = "insufficient_evidence";
  }

  const artifactPaths = {
    workerLogPath: firstString(bundle.workerLogPath) ?? null,
    benchmarkReportPath: firstString(bundle.benchmarkReportPath) ?? null,
    screenshots: cleanStringList(bundle.screenshotPaths),
    liveSnapshots: cleanStringList(bundle.liveSnapshotPaths),
  };

  const confidence = classifyConfidence(state, {
    hasCardScanFailed,
    hasFallbackAttempted,
    hasFallbackMatched,
    hasNoMatch,
  });

  return {
    state,
    label: EXPEDIA_RETRY_STATE_LABEL[state],
    confidence,
    jobId,
    taskId,
    provider,
    scenario,
    status,
    signals,
    artifactPaths,
    summary: buildSummary(state, confidence, signals),
    nextAction: nextActionForState(state),
  };
}

export function formatExpediaRetryAnalysisMarkdown(
  analysis: ExpediaRetryAnalysis,
): string {
  const lines: string[] = [];

  lines.push("## Expedia Retry Artifact Analysis");
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
    lines.push("_No known Expedia retry signals were found in the artifact bundle._");
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
  if (analysis.artifactPaths.benchmarkReportPath) {
    lines.push(`- Benchmark report: \`${analysis.artifactPaths.benchmarkReportPath}\``);
  }
  if (analysis.artifactPaths.screenshots.length > 0) {
    for (const screenshotPath of analysis.artifactPaths.screenshots) {
      lines.push(`- Screenshot: \`${screenshotPath}\``);
    }
  }
  if (analysis.artifactPaths.liveSnapshots.length > 0) {
    for (const liveSnapshotPath of analysis.artifactPaths.liveSnapshots) {
      lines.push(`- Live snapshot: \`${liveSnapshotPath}\``);
    }
  }
  if (
    !analysis.artifactPaths.workerLogPath &&
    !analysis.artifactPaths.benchmarkReportPath &&
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

export function formatExpediaRetryArtifactBundleMarkdown(
  bundle: ExpediaRetryArtifactBundle,
): string {
  return formatExpediaRetryAnalysisMarkdown(
    analyzeExpediaRetryArtifactBundle(bundle),
  );
}

function buildTextEntries(bundle: ExpediaRetryArtifactBundle): TextEntry[] {
  const entries: TextEntry[] = [];
  const job = bundle.job ?? null;

  addText(entries, "worker_log", "workerLogExcerpt", bundle.workerLogExcerpt);
  addText(entries, "worker_log", "job.rawWorkerLogExcerpt", job?.rawWorkerLogExcerpt);
  addText(entries, "job", "job.errorMessage", job?.errorMessage);
  addText(entries, "job", "job.terminalReason", job?.terminalReason);
  addText(entries, "job", "job.terminalCode", job?.terminalCode);
  addText(entries, "job", "job.steps", stringify(job?.steps));
  addText(entries, "job", "job.decisionLog", stringify(job?.decisionLog));
  addText(entries, "job", "job.params", stringify(job?.params));
  addText(entries, "db_row", "dbRow", stringify(bundle.dbRow));
  addText(entries, "artifact_path", "workerLogPath", bundle.workerLogPath);
  addText(entries, "artifact_path", "benchmarkReportPath", bundle.benchmarkReportPath);
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

function collectSignals(
  entries: TextEntry[],
  expectedJobId: string | null,
): ExpediaRetryEvidenceSignal[] {
  const signals: ExpediaRetryEvidenceSignal[] = [];
  const seen = new Set<string>();

  for (const signal of collectMixedOrStaleWorkerSignals(entries, expectedJobId)) {
    const key = `${signal.kind}|${signal.sourceLabel}|${signal.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(signal);
  }

  for (const entry of entries) {
    for (const pattern of SIGNAL_PATTERNS) {
      const match = pattern.rx.exec(entry.text);
      if (!match) continue;
      const excerpt = excerptAround(entry.text, match.index, match[0].length);
      if (
        pattern.kind === "checkout_reached" &&
        isNegatedCheckoutExcerpt(excerpt)
      ) {
        continue;
      }
      if (isHardStopChecklistBoundaryMention(pattern, entry)) {
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

function collectMixedOrStaleWorkerSignals(
  entries: TextEntry[],
  expectedJobId: string | null,
): ExpediaRetryEvidenceSignal[] {
  const signals: ExpediaRetryEvidenceSignal[] = [];
  const expected = expectedJobId?.trim().toLowerCase() ?? "";

  for (const entry of entries) {
    if (entry.source !== "worker_log") continue;
    const workerInstances = new Set(
      Array.from(entry.text.matchAll(/\[([^\]\r\n]*expedia-flight[^\]\r\n]*)\]/gi))
        .map((match) => (match[1] ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
    const claimedJobIds = new Set(
      Array.from(entry.text.matchAll(/\bclaimed job\s+([0-9a-f][0-9a-f-]{7,})\b/gi))
        .map((match) => (match[1] ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
    const hasUnexpectedJob =
      Boolean(expected) &&
      claimedJobIds.size > 0 &&
      Array.from(claimedJobIds).some((id) => id !== expected);

    if (workerInstances.size <= 1 && claimedJobIds.size <= 1 && !hasUnexpectedJob) {
      continue;
    }

    const detail = [
      workerInstances.size > 1 ? `workerInstances=${workerInstances.size}` : null,
      claimedJobIds.size > 1 ? `claimedJobs=${claimedJobIds.size}` : null,
      hasUnexpectedJob ? "claimedJobMismatch=true" : null,
    ].filter(Boolean).join(" ");
    signals.push({
      kind: "mixed_or_stale_worker_evidence",
      source: entry.source,
      sourceLabel: entry.label,
      label: "mixed or stale worker evidence",
      excerpt: `${detail}: ${excerptAround(entry.text, 0, Math.min(entry.text.length, 160))}`,
    });
  }

  return signals;
}

function isHardStopChecklistBoundaryMention(
  pattern: SignalPattern,
  entry: TextEntry,
): boolean {
  if (pattern.kind !== "login_or_otp_boundary" || entry.source !== "note") {
    return false;
  }
  const text = entry.text.toLowerCase();
  return (
    /\b(no|without|do not|stop before|hard stops?|bypass)\b/.test(text) &&
    /\b(login|otp|captcha|verification|payment|cvv|final purchase|final confirmation)\b/.test(text)
  );
}

function classifyConfidence(
  state: ExpediaRetryState,
  flags: {
    hasCardScanFailed: boolean;
    hasFallbackAttempted: boolean;
    hasFallbackMatched: boolean;
    hasNoMatch: boolean;
  },
): "high" | "medium" | "low" {
  switch (state) {
    case "checkout_manual_review_reached":
    case "login_or_otp_boundary":
    case "model_or_env_transient":
    case "network_provider_failure":
    case "provider_no_availability":
      return "high";
    case "fallback_matched_no_checkout":
      return flags.hasNoMatch ? "high" : "medium";
    case "fallback_attempted_no_match":
      return flags.hasNoMatch ? "high" : "medium";
    case "card_scan_failed_before_fallback":
      return flags.hasCardScanFailed && !flags.hasFallbackAttempted
        ? "high"
        : "medium";
    case "insufficient_evidence":
      return "low";
  }
}

function buildSummary(
  state: ExpediaRetryState,
  confidence: "high" | "medium" | "low",
  signals: ExpediaRetryEvidenceSignal[],
): string {
  const signalText =
    signals.length === 0
      ? "no known signals"
      : signals
          .slice(0, 3)
          .map((s) => s.label)
          .join(", ");
  return `${EXPEDIA_RETRY_STATE_LABEL[state]} with ${confidence} confidence (${signalText}).`;
}

function nextActionForState(state: ExpediaRetryState): string {
  switch (state) {
    case "card_scan_failed_before_fallback":
      return "Treat as selector/card-scan fallback not reached. Compare the visible card screenshot with the DOM scan entry point before patching.";
    case "fallback_attempted_no_match":
      return "Treat as locator fallback too narrow only if the screenshot still shows the target card. Patch selector/card matching, not routing/job shape.";
    case "fallback_matched_no_checkout":
      return "Inspect the fare modal and checkout transition evidence. Patch fare-modal or checkout-boundary detection only after screenshot confirmation.";
    case "checkout_manual_review_reached":
      return "Count as demo-useful safe progress. Preserve the hard stop before payment, CVV, OTP, CAPTCHA, login bypass, or final confirmation.";
    case "login_or_otp_boundary":
      return "Treat as a safety boundary. Stop for manual intervention; do not bypass login, OTP, CAPTCHA, or authentication prompts.";
    case "model_or_env_transient":
      return "Treat as model/env transient. Preserve provider selector evidence, but do not patch Expedia selectors from a model/API outage alone.";
    case "network_provider_failure":
      return "Treat as provider/network instability. Do not patch selectors from this state unless a separate screenshot/log signal proves card matching failed.";
    case "provider_no_availability":
      return "Treat as provider inventory/no-availability only when screenshots confirm the target card is absent. Do not patch selector logic from availability copy alone.";
    case "insufficient_evidence":
      return "Collect one clean DB row, codex-worker.log excerpt, provider screenshots, and live snapshot paths before making a patch decision. If mixed/stale worker evidence is present, stop and clean worker topology first. If incomplete traveler fields are present, do not mark the flight lane closed.";
  }
}

function signalRank(kind: SignalKind): number {
  switch (kind) {
    case "mixed_or_stale_worker_evidence":
      return -1;
    case "checkout_form_incomplete":
      return 0;
    case "checkout_reached":
      return 1;
    case "login_or_otp_boundary":
      return 2;
    case "model_or_env_transient":
      return 3;
    case "network_provider_failure":
      return 4;
    case "fallback_matched":
      return 5;
    case "fallback_attempted":
      return 6;
    case "card_scan_failed":
      return 7;
    case "no_match":
      return 8;
    case "provider_no_availability":
      return 9;
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

function isNegatedCheckoutExcerpt(excerpt: string): boolean {
  return /\b(no|not|never|without)\s+(checkout[-_\s]?reached|reached[-_\s]?checkout)\b/i.test(
    excerpt,
  );
}

function escapeMarkdownLine(text: string): string {
  return text.replace(/`/g, "\\`");
}
