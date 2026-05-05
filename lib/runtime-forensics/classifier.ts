/**
 * Runtime forensics classifier.
 *
 * Pattern-based weighted scoring across 8 failure classes. The
 * classifier reads multiple input fields (errorMessage,
 * terminalReason, terminalCode, step errors, decision-log entries,
 * raw worker log excerpt) and aggregates per-class weight. The
 * highest-weight class wins; ties are broken by severity ordering.
 *
 * Pure module. Designed to be testable without DB or filesystem.
 */

import {
  auditStepShape,
  errorMentionsLegacyShape,
  extractLegacyShapeQuote,
  truncate,
} from "./step-shape";

import {
  FAILURE_CLASS_SEVERITY,
  type ClassificationResult,
  type ClassifierConfidence,
  type ClassifierSignal,
  type DecisionLogEntryLike,
  type FailureClass,
  type ForensicsSeverity,
  type JobLikeInput,
  type StepShapeAuditResult,
} from "./types";

/* ─── Pattern table ───────────────────────────────────────────────── */

interface PatternRule {
  /** Regex tested against the field text. */
  rx: RegExp;
  /** The class this match votes for. */
  cls: FailureClass;
  /** Weight in [0, 1]. */
  weight: number;
  /** Short label to surface in the signal listing. */
  label: string;
}

const OPENAI_RESPONSES_API_5XX_PATTERNS = [
  /\bOpenAI\s+Responses\s+API\b.{0,80}\b5\d{2}\b/i,
  /\bResponses\s+API\b.{0,80}\b5\d{2}\b.{0,80}\b(OpenAI|computer[-_\s]?use|model|env|environment)\b/i,
] as const;

/**
 * Patterns for terminal reasons / error messages / log lines.
 *
 * Tuned for high precision: phrases here should rarely false-match
 * outside their intended class. Boost weights for phrases that
 * appear ONLY in one specific failure mode.
 */
const PATTERN_RULES: ReadonlyArray<PatternRule> = [
  // legacy_shape_missing_source - top priority, P0
  {
    rx: /Worker received legacy[-\s]shape step/i,
    cls: "legacy_shape_missing_source",
    weight: 1.0,
    label: "Worker received legacy-shape step",
  },
  {
    rx: /missing\s+__source\s+marker/i,
    cls: "legacy_shape_missing_source",
    weight: 1.0,
    label: "missing __source marker",
  },
  {
    rx: /step\s+lacks\s+__source/i,
    cls: "legacy_shape_missing_source",
    weight: 0.9,
    label: "step lacks __source",
  },
  {
    rx: /unstamped\s+step/i,
    cls: "legacy_shape_missing_source",
    weight: 0.85,
    label: "unstamped step",
  },
  {
    rx: /executor[-_\s]?marker[-_\s]?missing/i,
    cls: "legacy_shape_missing_source",
    weight: 0.8,
    label: "executor marker missing",
  },
  // provider_no_availability
  {
    rx: /no\s+(target[-_\s]+)?(window\s+)?(slots?|availability|times|reservations?)/i,
    cls: "provider_no_availability",
    weight: 0.85,
    label: "no slot / availability / times",
  },
  {
    rx: /provider[-_\s]?no[-_\s]?slot/i,
    cls: "provider_no_availability",
    weight: 0.95,
    label: "PROVIDER_NO_SLOT code",
  },
  {
    rx: /no_availability_correct/i,
    cls: "provider_no_availability",
    weight: 0.9,
    label: "no_availability_correct verdict",
  },
  {
    rx: /\b(zero|0)\s+matching\s+slots?/i,
    cls: "provider_no_availability",
    weight: 0.85,
    label: "0 matching slots",
  },
  {
    rx: /\bsold[-\s]?out\b/i,
    cls: "provider_no_availability",
    weight: 0.6,
    label: "sold out",
  },
  // provider_form_incomplete
  {
    rx: /(guest[-_\s]?)?form\s+(incomplete|partially\s+filled|not\s+fully\s+filled)/i,
    cls: "provider_form_incomplete",
    weight: 0.9,
    label: "form incomplete / partially filled",
  },
  {
    rx: /required\s+field\s+(missing|empty|not\s+filled)/i,
    cls: "provider_form_incomplete",
    weight: 0.8,
    label: "required field missing/empty",
  },
  {
    rx: /audit[-_\s]?refill\s+(failed|gave\s+up)/i,
    cls: "provider_form_incomplete",
    weight: 0.85,
    label: "auditAndRefill gave up",
  },
  {
    rx: /phone\s+(field|input)\s+(unfilled|empty|not\s+set)/i,
    cls: "provider_form_incomplete",
    weight: 0.8,
    label: "phone field unfilled",
  },
  {
    rx: /first[-_\s]?name|last[-_\s]?name.*?(empty|missing|unfilled)/i,
    cls: "provider_form_incomplete",
    weight: 0.7,
    label: "name field empty/missing",
  },
  // otp_or_login_required
  {
    rx: /\botp\b|\bone[-\s]?time\s?(password|code)\b/i,
    cls: "otp_or_login_required",
    weight: 0.8,
    label: "OTP / one-time password",
  },
  {
    rx: /awaiting[-_\s]?(otp|verification|sms[-_\s]?code)/i,
    cls: "otp_or_login_required",
    weight: 0.9,
    label: "awaiting OTP / SMS code",
  },
  {
    rx: /verify[-_\s]?phone|phone[-_\s]?verification/i,
    cls: "otp_or_login_required",
    weight: 0.75,
    label: "phone verification",
  },
  {
    rx: /login[-_\s]?(required|wall|page)/i,
    cls: "otp_or_login_required",
    weight: 0.7,
    label: "login required",
  },
  {
    rx: /sign[-_\s]?in\s+(required|page)/i,
    cls: "otp_or_login_required",
    weight: 0.65,
    label: "sign-in required",
  },
  {
    rx: /F-PROVIDER-OTP/,
    cls: "otp_or_login_required",
    weight: 0.95,
    label: "F-PROVIDER-OTP code",
  },
  // checkout_reached_manual_review
  {
    rx: /ready[-_\s]?for[-_\s]?confirmation/i,
    cls: "checkout_reached_manual_review",
    weight: 0.95,
    label: "ready_for_confirmation",
  },
  {
    rx: /awaiting[-_\s]?(human|founder|manual)[-_\s]?(confirm|review|tap)/i,
    cls: "checkout_reached_manual_review",
    weight: 0.85,
    label: "awaiting human confirm",
  },
  {
    rx: /reached[-_\s]?(checkout|payment[-_\s]?wall|cvv\s+gate)/i,
    cls: "checkout_reached_manual_review",
    weight: 0.85,
    label: "reached checkout / payment wall",
  },
  {
    rx: /checkout[-_\s]?reached/i,
    cls: "checkout_reached_manual_review",
    weight: 0.85,
    label: "checkout reached",
  },
  {
    rx: /safe[-_\s]?handoff/i,
    cls: "checkout_reached_manual_review",
    weight: 0.8,
    label: "safe handoff",
  },
  {
    rx: /stop[-_\s]?at[-_\s]?cvv|cvv[-_\s]?stop[-_\s]?point/i,
    cls: "checkout_reached_manual_review",
    weight: 0.8,
    label: "stop at CVV",
  },
  // model_or_env_blocked
  {
    rx: /openai[-_\s]?(rate[-_\s]?limit|429|quota|billing)/i,
    cls: "model_or_env_blocked",
    weight: 0.95,
    label: "OpenAI rate-limit / quota",
  },
  {
    rx: OPENAI_RESPONSES_API_5XX_PATTERNS[0],
    cls: "model_or_env_blocked",
    weight: 1.0,
    label: "OpenAI Responses API 5xx",
  },
  {
    rx: OPENAI_RESPONSES_API_5XX_PATTERNS[1],
    cls: "model_or_env_blocked",
    weight: 0.95,
    label: "Responses API model/env transient",
  },
  {
    rx: /computer[-_\s]?use[-_\s]?(unavailable|disabled|not[-_\s]?ready)/i,
    cls: "model_or_env_blocked",
    weight: 0.85,
    label: "Computer Use unavailable",
  },
  {
    rx: /missing\s+(env|environment)\s+(var|variable)/i,
    cls: "model_or_env_blocked",
    weight: 0.85,
    label: "missing env variable",
  },
  {
    rx: /chromium\s+(not\s+installed|missing)/i,
    cls: "model_or_env_blocked",
    weight: 0.8,
    label: "chromium missing",
  },
  {
    rx: /token\s+guard|--confirm-suite\s+(required|missing)/i,
    cls: "model_or_env_blocked",
    weight: 0.8,
    label: "token guard / confirm-suite gate",
  },
  // network_or_provider_5xx
  {
    rx: /\b5\d{2}\b\s*(error|response|status)/i,
    cls: "network_or_provider_5xx",
    weight: 0.85,
    label: "5xx server error",
  },
  {
    rx: /\b50[0-4]\b/,
    cls: "network_or_provider_5xx",
    weight: 0.6,
    label: "5xx status code",
  },
  {
    rx: /(econnreset|econnrefused|enotfound|etimedout)/i,
    cls: "network_or_provider_5xx",
    weight: 0.85,
    label: "TCP-level error",
  },
  {
    rx: /gateway\s+(timeout|error)/i,
    cls: "network_or_provider_5xx",
    weight: 0.8,
    label: "gateway timeout / error",
  },
  {
    rx: /provider\s+(unreachable|down|unavailable)/i,
    cls: "network_or_provider_5xx",
    weight: 0.75,
    label: "provider unreachable",
  },
  {
    rx: /net::ERR_/,
    cls: "network_or_provider_5xx",
    weight: 0.8,
    label: "net::ERR_ (chromium)",
  },
  // Expedia flight card-scan diagnostics. These are not a terminal success
  // class by themselves; they make the otherwise-unknown provider-selector
  // failure legible in the forensics workbench.
  {
    rx: /Flight-card DOM scan failed/i,
    cls: "unknown",
    weight: 0.6,
    label: "Expedia flight-card DOM scan failed",
  },
  {
    rx: /Trying locator fallback for flight-card scan/i,
    cls: "unknown",
    weight: 0.1,
    label: "Expedia locator fallback attempted",
  },
  {
    rx: /Locator fallback matched flight card/i,
    cls: "unknown",
    weight: 0.1,
    label: "Expedia locator fallback matched",
  },
];

/* ─── Classifier ──────────────────────────────────────────────────── */

/**
 * Run the full classifier on a job-like input. Returns the
 * primary class + supporting signals + per-class weights.
 *
 * Algorithm:
 *  1. Run the step-shape audit. If `hasLegacyShapeBug`, that's
 *     immediately a strong signal (weight 1.0) for
 *     `legacy_shape_missing_source` regardless of whether the
 *     phrase was anywhere else.
 *  2. Match every PATTERN_RULES regex against:
 *     - errorMessage
 *     - terminalReason
 *     - terminalCode
 *     - each step.error
 *     - each decisionLog entry's event / message / data (string-coerced)
 *     - rawWorkerLogExcerpt
 *     Each match adds a `ClassifierSignal`.
 *  3. Aggregate weights per class.
 *  4. Pick the highest-weight class. Tie-break: P0 > P1 > P2 > info > P3.
 *  5. Confidence is high if winning weight ≥ 1.0; medium if ≥ 0.6;
 *     low otherwise.
 *  6. If NO patterns match AND step shape is fine → "unknown".
 *  7. If status === "succeeded" or contains "success" / "completed",
 *     suppress the failure classifications and use
 *     `checkout_reached_manual_review` if signals support it,
 *     else "unknown".
 */
export function classifyJob(job: JobLikeInput): ClassificationResult {
  const signals: ClassifierSignal[] = [];
  const stepShape = auditStepShape(job);

  // 1. Step-shape promotes legacy-shape bug to a strong signal.
  if (stepShape.hasLegacyShapeBug) {
    signals.push({
      source: "step_shape_audit",
      label: "step shape audit detected legacy-shape bug",
      excerpt: stepShape.legacyShapeQuotes[0]?.slice(0, 200),
      supportsClass: "legacy_shape_missing_source",
      weight: 1.0,
    });
  }

  // 2. Pattern matches.
  pushFieldSignals(signals, "error_message", job.errorMessage);
  pushFieldSignals(signals, "terminal_reason", job.terminalReason);
  pushFieldSignals(signals, "terminal_code", job.terminalCode);
  pushFieldSignals(signals, "raw_worker_log", job.rawWorkerLogExcerpt);

  if (Array.isArray(job.steps)) {
    for (const step of job.steps) {
      if (!step || typeof step !== "object") continue;
      const t = typeof step.error === "string" ? step.error : null;
      if (t) pushFieldSignals(signals, "step_error", t);
    }
  }
  if (Array.isArray(job.decisionLog)) {
    for (const entry of job.decisionLog) {
      const text = decisionLogTextOf(entry);
      if (text) pushFieldSignals(signals, "decision_log", text);
    }
  }

  // 3. Aggregate per-class weights.
  const perClassWeights: Partial<Record<FailureClass, number>> = {};
  for (const s of signals) {
    perClassWeights[s.supportsClass] =
      (perClassWeights[s.supportsClass] ?? 0) + s.weight;
  }

  // 4 + 5. Pick winner. Sort by weight desc, then by severity asc
  // (P0 > P1 > P2 > info > P3), then by failure-class label asc
  // for stable order.
  const sortedClasses = (Object.keys(perClassWeights) as FailureClass[])
    .map((c) => ({ class: c, weight: perClassWeights[c] ?? 0 }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      const sa = severityOrder(FAILURE_CLASS_SEVERITY[a.class]);
      const sb = severityOrder(FAILURE_CLASS_SEVERITY[b.class]);
      if (sa !== sb) return sa - sb;
      return a.class.localeCompare(b.class);
    });

  let primaryClass: FailureClass;
  if (sortedClasses.length === 0) {
    primaryClass = "unknown";
  } else {
    primaryClass = sortedClasses[0].class;
  }

  // 7. Status overrides.
  const lowerStatus = (job.status ?? "").toLowerCase();
  if (
    lowerStatus.includes("success") ||
    lowerStatus.includes("succeeded") ||
    lowerStatus === "completed"
  ) {
    // Successful jobs shouldn't classify as a failure unless
    // legacy-shape was hit (still a P0). Otherwise prefer
    // checkout_reached_manual_review if any matches it; else unknown.
    if (primaryClass !== "legacy_shape_missing_source") {
      const hasCheckoutSignal =
        (perClassWeights.checkout_reached_manual_review ?? 0) > 0;
      primaryClass = hasCheckoutSignal
        ? "checkout_reached_manual_review"
        : "unknown";
    }
  }

  // Compute confidence.
  const winningWeight = perClassWeights[primaryClass] ?? 0;
  const confidence: ClassifierConfidence =
    winningWeight >= 1.0 ? "high" : winningWeight >= 0.6 ? "medium" : "low";

  // Severity from fixed mapping.
  const severity: ForensicsSeverity = FAILURE_CLASS_SEVERITY[primaryClass];

  // Sort signals by weight desc, stable by source+label.
  const sortedSignals = [...signals].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.label.localeCompare(b.label);
  });

  // Alternatives: classes with weight > 0, excluding primary.
  const alternatives = sortedClasses
    .filter((x) => x.class !== primaryClass)
    .map((x) => ({ class: x.class, weight: x.weight }));

  return {
    primaryClass,
    severity,
    confidence,
    signals: sortedSignals,
    perClassWeights,
    alternatives,
  };
}

/* ─── Helpers (also exported for tests) ───────────────────────────── */

/** Match one text field against PATTERN_RULES, push signals. */
export function pushFieldSignals(
  signals: ClassifierSignal[],
  source: ClassifierSignal["source"],
  text: string | null | undefined,
): void {
  if (!text || typeof text !== "string") return;
  for (const rule of PATTERN_RULES) {
    if (shouldSuppressGenericProvider5xx(rule, text)) continue;
    const m = text.match(rule.rx);
    if (m) {
      signals.push({
        source,
        label: rule.label,
        excerpt: makeExcerpt(text, m.index ?? 0, m[0].length),
        supportsClass: rule.cls,
        weight: rule.weight,
      });
    }
  }
}

function shouldSuppressGenericProvider5xx(rule: PatternRule, text: string): boolean {
  if (rule.cls !== "network_or_provider_5xx") return false;
  if (rule.label !== "5xx server error" && rule.label !== "5xx status code") {
    return false;
  }
  return OPENAI_RESPONSES_API_5XX_PATTERNS.some((rx) => rx.test(text));
}

/** Extract a stable text representation from a decision-log entry. */
export function decisionLogTextOf(entry: DecisionLogEntryLike | null | undefined): string {
  if (!entry || typeof entry !== "object") return "";
  const parts: string[] = [];
  if (typeof entry.event === "string") parts.push(entry.event);
  if (typeof entry.message === "string") parts.push(entry.message);
  if (entry.data !== undefined && entry.data !== null) {
    try {
      parts.push(typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data));
    } catch {
      /* ignore - circular or unserializable */
    }
  }
  return parts.join(" | ");
}

/** Severity ordering: P0 < P1 < P2 < info < P3 (lower wins ties). */
function severityOrder(s: ForensicsSeverity): number {
  switch (s) {
    case "p0":
      return 0;
    case "p1":
      return 1;
    case "p2":
      return 2;
    case "info":
      return 3;
    case "p3":
      return 4;
    default:
      return 5;
  }
}

function makeExcerpt(text: string, idx: number, len: number, max = 200): string {
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + len + 60);
  let out = text.slice(start, end);
  if (start > 0) out = "..." + out;
  if (end < text.length) out = out + "...";
  return truncate(out, max);
}

/** Re-export selected helpers for ergonomic test imports. */
export { auditStepShape, errorMentionsLegacyShape, extractLegacyShapeQuote };

/** Exposed for tests to verify pattern coverage. */
export const __PATTERN_RULES_FOR_TEST = PATTERN_RULES;
