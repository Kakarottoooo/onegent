/**
 * Hotel retry artifact analyzer.
 *
 * Pure no-live module: consumes already-collected DB/log/screenshot metadata
 * and returns a deterministic post-run classification for Booking.com and
 * Hotels.com hotel revival checks. It does not read from disk, touch the
 * network, or invoke any provider/runtime code.
 */

import type { JobLikeInput } from "./types";
import {
  classifyHotelL1Stage,
  classifyHotelProviderFallbackEligibility,
  evaluateHotelNoAvailabilityEvidence,
  extractHotelLayeredContextFromArtifact,
  validateHotelLayeredArtifactCompleteness,
  type HotelLayeredRecoverySummary,
} from "./hotel-layered-recovery";

export type HotelRetryState =
  | "safety_boundary_violation"
  | "payment_manual_review_reached"
  | "guest_details_manual_review_reached"
  | "room_selection_manual_review_reached"
  | "login_or_captcha_boundary"
  | "profile_gating"
  | "model_env_transient"
  | "network_provider_failure"
  | "provider_no_availability"
  | "provider_selector_drift"
  | "room_selection_drift"
  | "insufficient_evidence";

type SignalKind =
  | "safety_boundary_violation"
  | "payment_boundary"
  | "guest_details_reached"
  | "room_selection_reached"
  | "login_or_captcha"
  | "profile_gating"
  | "model_env_transient"
  | "network_provider_failure"
  | "provider_no_availability"
  | "provider_selector_drift"
  | "room_selection_drift";

type TextSourceKind = "job" | "db_row" | "worker_log" | "artifact_path" | "note";

export const HOTEL_RETRY_STATE_LABEL: Record<HotelRetryState, string> = {
  safety_boundary_violation: "Safety boundary violation",
  payment_manual_review_reached: "Payment/manual-review reached",
  guest_details_manual_review_reached: "Guest-details/manual-review reached",
  room_selection_manual_review_reached: "Room-selection/manual-review reached",
  login_or_captcha_boundary: "Login/CAPTCHA/OTP boundary",
  profile_gating: "Profile gating before provider work",
  model_env_transient: "Model/environment transient",
  network_provider_failure: "Network/provider degraded",
  provider_no_availability: "Provider returned no availability",
  provider_selector_drift: "Provider selector or hotel-result drift",
  room_selection_drift: "Room/card scan or date selector drift",
  insufficient_evidence: "Insufficient evidence",
};

export interface HotelRetryArtifactBundle {
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
   * Bounded excerpt from codex-worker.log collected after an approved retry.
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

export interface HotelRetryEvidenceSignal {
  kind: SignalKind;
  source: TextSourceKind;
  sourceLabel: string;
  label: string;
  excerpt: string;
}

export interface HotelRetryAnalysis {
  state: HotelRetryState;
  label: string;
  confidence: "high" | "medium" | "low";
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  signals: HotelRetryEvidenceSignal[];
  artifactPaths: {
    workerLogPath: string | null;
    screenshots: string[];
    liveSnapshots: string[];
  };
  layeredRecovery: HotelLayeredRecoverySummary;
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
    kind: "safety_boundary_violation",
    label: "CVV or card data entered",
    rx: /\b(entered|filled|submitted)\s+(cvv|cvc|security code|card details)\b/i,
  },
  {
    kind: "safety_boundary_violation",
    label: "final booking submitted",
    rx: /\b(clicked|pressed|submitted)\s+(final booking|book now|complete booking|purchase confirmation|confirm and pay)\b/i,
  },
  {
    kind: "safety_boundary_violation",
    label: "purchase confirmation submitted",
    rx: /\b(final booking|purchase)\s+(confirmed|confirmation submitted)\b/i,
  },
  {
    kind: "safety_boundary_violation",
    label: "account challenge bypassed",
    rx: /\bbypassed\s+(otp|captcha|login|sign[-\s]?in|phone verification)\b/i,
  },
  {
    kind: "payment_boundary",
    label: "payment review reached",
    rx: /\b(payment|billing)\s+(page|review|form|wall)\s+(visible|reached|loaded)\b/i,
  },
  {
    kind: "payment_boundary",
    label: "Booking.com runtime payment boundary",
    rx: /\bpayment_manual_review_reached\b/i,
  },
  {
    kind: "payment_boundary",
    label: "checkout reached",
    rx: /\bcheckout\s+(page\s+)?(visible|reached|loaded)\b/i,
  },
  {
    kind: "payment_boundary",
    label: "CVV gate visible",
    rx: /\bcvv\s+(field|gate|request|required|visible)\b/i,
  },
  {
    kind: "payment_boundary",
    label: "final button visible",
    rx: /\b(confirm(?:ation)? booking|confirm and pay|complete booking)\s+button\s+visible\b/i,
  },
  {
    kind: "payment_boundary",
    label: "stopped before payment/final",
    rx: /\bstop(?:ped)?\s+before\s+(payment|cvv|final|confirmation|purchase)\b/i,
  },
  {
    kind: "guest_details_reached",
    label: "guest details reached",
    rx: /\bguest details\s+(page|form)\s+(visible|reached|loaded)\b/i,
  },
  {
    kind: "guest_details_reached",
    label: "Booking.com runtime guest-details boundary",
    rx: /\bguest_details_manual_review_reached\b/i,
  },
  {
    kind: "guest_details_reached",
    label: "contact details reached",
    rx: /\bcontact details\s+(page|form)\s+(visible|reached|loaded)\b/i,
  },
  {
    kind: "guest_details_reached",
    label: "traveler details reached",
    rx: /\btraveler details\s+(page|form)\s+(visible|reached|loaded)\b/i,
  },
  {
    kind: "guest_details_reached",
    label: "reservation details reached",
    rx: /\breservation details\s+(page|form)\s+(visible|reached|loaded)\b/i,
  },
  {
    kind: "room_selection_reached",
    label: "room selection reached",
    rx: /\b(room|rate)\s+(selected|selection)\s+(visible|reached|loaded|succeeded|complete|completed)\b/i,
  },
  {
    kind: "room_selection_reached",
    label: "Booking.com runtime room-selection boundary",
    rx: /\broom_selection_manual_review_reached\b/i,
  },
  {
    kind: "room_selection_reached",
    label: "room quantity selected",
    rx: /\bselected room quantity\b|\broom quantity\s+(selected|set|updated)\b/i,
  },
  {
    kind: "room_selection_reached",
    label: "room selected before manual review",
    rx: /\b(room|rate)\s+selected\b.*\b(manual review|operator review|safe handoff)\b/i,
  },
  {
    kind: "login_or_captcha",
    label: "login or sign-in wall",
    rx: /\b(login|sign[-\s]?in)\s+(wall|required|prompt|modal)\b/i,
  },
  {
    kind: "login_or_captcha",
    label: "Booking.com runtime login/CAPTCHA boundary",
    rx: /\blogin_or_captcha_boundary\b/i,
  },
  {
    kind: "login_or_captcha",
    label: "CAPTCHA/OTP challenge",
    rx: /\b(captcha|otp|phone verification|two[-\s]?factor|2fa)\s+(challenge|wall|required|prompt|modal|visible|appeared|blocked)\b|\b(challenge|wall|required|prompt|modal|visible|appeared|blocked)\s+(captcha|otp|phone verification|two[-\s]?factor|2fa)\b/i,
  },
  {
    kind: "login_or_captcha",
    label: "bot challenge",
    rx: /\bbot\s+(block|challenge|detection)\b/i,
  },
  {
    kind: "profile_gating",
    label: "profile gap",
    rx: /\bprofile\s+(gap|gating|missing|blocked)\b/i,
  },
  {
    kind: "profile_gating",
    label: "missing required profile field",
    rx: /\bmissing\s+(date of birth|dob|phone|email|billing|payment|address|traveler)\b/i,
  },
  {
    kind: "profile_gating",
    label: "start route blocked by profile",
    rx: /\bstart route blocked\b.*\bprofile\b/i,
  },
  {
    kind: "model_env_transient",
    label: "OpenAI Responses API 5xx",
    rx: /\b(openai|responses api|responses\.create)\b.*\b5\d{2}\b|\b5\d{2}\b.*\b(openai|responses api|responses\.create)\b/i,
  },
  {
    kind: "model_env_transient",
    label: "model/runtime transient",
    rx: /\b(model|llm|computer use)\b.*\b(transient|unavailable|timeout|timed out|rate[-_\s]?limit|quota|failed)\b/i,
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
    rx: /\b(provider|booking\.com|hotels\.com)\s+(unreachable|down|unavailable|timed out)\b/i,
  },
  {
    kind: "network_provider_failure",
    label: "Booking.com runtime provider/network failure",
    rx: /\bnetwork_provider_failure\b/i,
  },
  {
    kind: "provider_no_availability",
    label: "hotel sold out or fully booked",
    rx: /\b(sold[-\s]?out|fully booked|no rooms? available|no availability|not available|no properties match|no stays? available|nothing available)\b/i,
  },
  {
    kind: "provider_no_availability",
    label: "Booking.com runtime no availability",
    rx: /\bprovider_no_availability\b/i,
  },
  {
    kind: "provider_no_availability",
    label: "no exact hotel matches",
    rx: /\b(no exact matches|no matching rooms?|no matching hotel|target hotel unavailable)\b/i,
  },
  {
    kind: "provider_selector_drift",
    label: "target hotel visible but not selected",
    rx: /\b(target hotel|hotel card|hotel result)\b.*\b(visible|found)\b.*\b(not selected|not clicked|selection failed)\b/i,
  },
  {
    kind: "provider_selector_drift",
    label: "Booking.com runtime provider selector drift",
    rx: /\bprovider_selector_drift\b/i,
  },
  {
    kind: "provider_selector_drift",
    label: "hotel detail not reached",
    rx: /\b(hotel detail|property detail)\s+(not reached|was not reached|did not load)\b/i,
  },
  {
    kind: "provider_selector_drift",
    label: "hotel search result drift",
    rx: /\b(hotel search result|provider selector|hotel selector)\b.*\b(drift|failed|not found)\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "room card or selector drift",
    rx: /\b(room|rate|hotel)\s+(card|selection|select button|selected room)\s+(missing|not found|drift|failed)\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "Booking.com runtime room selection drift",
    rx: /\broom_selection_drift\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "room/card scan failed",
    rx: /\b(room|rate)[-\s]?(card|scan)\b.*\b(failed|threw|errored|no match)\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "select room failed",
    rx: /\bselect room\b.*\b(not found|failed|unavailable)\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "selected date drift",
    rx: /\bselected[-\s]?date\b.*\b(drift|missing|not found|mismatch)\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "guest details not reached",
    rx: /\bguest details\s+(not reached|was not reached|did not load)\b/i,
  },
  {
    kind: "room_selection_drift",
    label: "payment not reached",
    rx: /\bpayment\s+(not reached|was not reached|did not load)\b/i,
  },
];

export function analyzeHotelRetryArtifactBundle(
  bundle: HotelRetryArtifactBundle,
): HotelRetryAnalysis {
  const entries = buildTextEntries(bundle);
  const signals = collectSignals(entries);
  const has = (kind: SignalKind) => signals.some((s) => s.kind === kind);
  const layeredContext = extractHotelLayeredContextFromArtifact(bundle);
  const noAvailabilityEvidence = evaluateHotelNoAvailabilityEvidence(layeredContext);

  const hasSafetyViolation = has("safety_boundary_violation");
  const hasPaymentBoundary = has("payment_boundary");
  const hasGuestDetails = has("guest_details_reached");
  const hasRoomSelectionReached = has("room_selection_reached");
  const hasLoginOrCaptcha = has("login_or_captcha");
  const hasProfileGating = has("profile_gating");
  const hasModelEnv = has("model_env_transient");
  const hasNetwork = has("network_provider_failure");
  const hasNoAvailability = has("provider_no_availability");
  const hasProviderSelectorDrift = has("provider_selector_drift");
  const hasRoomSelectionDrift = has("room_selection_drift");

  let state: HotelRetryState;
  if (hasSafetyViolation) {
    state = "safety_boundary_violation";
  } else if (hasPaymentBoundary) {
    state = "payment_manual_review_reached";
  } else if (hasGuestDetails) {
    state = "guest_details_manual_review_reached";
  } else if (hasLoginOrCaptcha) {
    state = "login_or_captcha_boundary";
  } else if (hasProfileGating) {
    state = "profile_gating";
  } else if (hasModelEnv) {
    state = "model_env_transient";
  } else if (hasNetwork) {
    state = "network_provider_failure";
  } else if (hasNoAvailability && noAvailabilityEvidence.state === "weak_no_availability") {
    state = "network_provider_failure";
  } else if (hasNoAvailability && noAvailabilityEvidence.state === "verified_true_no_availability") {
    state = "provider_no_availability";
  } else if (hasRoomSelectionReached) {
    state = "room_selection_manual_review_reached";
  } else if (hasProviderSelectorDrift) {
    state = "provider_selector_drift";
  } else if (hasRoomSelectionDrift) {
    state = "room_selection_drift";
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

  const confidence = classifyConfidence(state, {
    hasPaymentBoundary,
    hasGuestDetails,
    hasRoomSelectionReached,
    hasModelEnv,
    hasNoAvailability,
    hasProviderSelectorDrift,
    hasRoomSelectionDrift,
  });
  const fallbackEligibility = classifyHotelProviderFallbackEligibility(
    { ...layeredContext, state },
    noAvailabilityEvidence,
  );
  const layeredRecovery: HotelLayeredRecoverySummary = {
    l1Stage: classifyHotelL1Stage(layeredContext),
    noAvailabilityEvidence,
    fallbackEligibility,
    artifactCompleteness: validateHotelLayeredArtifactCompleteness(bundle),
  };

  return {
    state,
    label: HOTEL_RETRY_STATE_LABEL[state],
    confidence,
    jobId,
    taskId,
    provider,
    scenario,
    status,
    signals,
    artifactPaths,
    layeredRecovery,
    summary: buildSummary(state, confidence, signals),
    nextAction: nextActionForState(state, fallbackEligibility),
  };
}

export function formatHotelRetryAnalysisMarkdown(
  analysis: HotelRetryAnalysis,
): string {
  const lines: string[] = [];

  lines.push("## Hotel Retry Artifact Analysis");
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
    lines.push("_No known hotel retry signals were found in the artifact bundle._");
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
    analysis.artifactPaths.screenshots.length === 0 &&
    analysis.artifactPaths.liveSnapshots.length === 0
  ) {
    lines.push("_No artifact paths were included._");
  }
  lines.push("");
  lines.push("### Layered Recovery");
  lines.push("");
  lines.push(`- L1 stage: \`${analysis.layeredRecovery.l1Stage}\``);
  lines.push(
    `- No-availability evidence: \`${analysis.layeredRecovery.noAvailabilityEvidence.state}\` - ${escapeMarkdownLine(
      analysis.layeredRecovery.noAvailabilityEvidence.reason,
    )}`,
  );
  lines.push(
    `- L2 fallback eligible: \`${analysis.layeredRecovery.fallbackEligibility.eligible}\`${
      analysis.layeredRecovery.fallbackEligibility.nextProviders.length > 0
        ? ` via \`${analysis.layeredRecovery.fallbackEligibility.nextProviders.join(" -> ")}\``
        : ""
    }`,
  );
  if (analysis.layeredRecovery.fallbackEligibility.eligible) {
    lines.push(
      `- Preserved params: \`${JSON.stringify(
        analysis.layeredRecovery.fallbackEligibility.preservedParams,
      )}\``,
    );
  }
  lines.push(
    `- Artifact completeness: \`${analysis.layeredRecovery.artifactCompleteness.complete}\` - ${escapeMarkdownLine(
      analysis.layeredRecovery.artifactCompleteness.summary,
    )}`,
  );
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

export function formatHotelRetryArtifactBundleMarkdown(
  bundle: HotelRetryArtifactBundle,
): string {
  return formatHotelRetryAnalysisMarkdown(analyzeHotelRetryArtifactBundle(bundle));
}

function buildTextEntries(bundle: HotelRetryArtifactBundle): TextEntry[] {
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

function collectSignals(entries: TextEntry[]): HotelRetryEvidenceSignal[] {
  const signals: HotelRetryEvidenceSignal[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    for (const pattern of SIGNAL_PATTERNS) {
      const match = pattern.rx.exec(entry.text);
      if (!match) continue;
      const excerpt = excerptAround(entry.text, match.index, match[0].length);
      if (
        (pattern.kind === "payment_boundary" ||
          pattern.kind === "guest_details_reached") &&
        isNegatedProgressExcerpt(excerpt)
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
  state: HotelRetryState,
  flags: {
    hasPaymentBoundary: boolean;
    hasGuestDetails: boolean;
    hasRoomSelectionReached: boolean;
    hasModelEnv: boolean;
    hasNoAvailability: boolean;
    hasProviderSelectorDrift: boolean;
    hasRoomSelectionDrift: boolean;
  },
): "high" | "medium" | "low" {
  switch (state) {
    case "safety_boundary_violation":
    case "login_or_captcha_boundary":
    case "profile_gating":
    case "network_provider_failure":
      return "high";
    case "model_env_transient":
      return flags.hasModelEnv ? "high" : "medium";
    case "provider_no_availability":
      return flags.hasNoAvailability ? "high" : "medium";
    case "payment_manual_review_reached":
      return flags.hasPaymentBoundary ? "high" : "medium";
    case "guest_details_manual_review_reached":
      return flags.hasGuestDetails ? "high" : "medium";
    case "room_selection_manual_review_reached":
      return flags.hasRoomSelectionReached ? "high" : "medium";
    case "provider_selector_drift":
      return flags.hasProviderSelectorDrift ? "high" : "medium";
    case "room_selection_drift":
      return flags.hasRoomSelectionDrift ? "high" : "medium";
    case "insufficient_evidence":
      return "low";
  }
}

function buildSummary(
  state: HotelRetryState,
  confidence: "high" | "medium" | "low",
  signals: HotelRetryEvidenceSignal[],
): string {
  const signalText =
    signals.length === 0
      ? "no known signals"
      : signals
          .slice(0, 3)
          .map((s) => s.label)
          .join(", ");
  return `${HOTEL_RETRY_STATE_LABEL[state]} with ${confidence} confidence (${signalText}).`;
}

function nextActionForState(
  state: HotelRetryState,
  fallbackEligibility: HotelLayeredRecoverySummary["fallbackEligibility"],
): string {
  if (fallbackEligibility.eligible) {
    return `Treat as provider-degraded/fallback-eligible. Preserve exact hotel, city, check-in, check-out, adults, rooms, and budget before trying ${fallbackEligibility.nextProviders.join(
      " -> ",
    )}.`;
  }

  switch (state) {
    case "safety_boundary_violation":
      return "Stop. Do not retry. Preserve DB/log/screenshot evidence and run a separate root-cause review of the safety boundary.";
    case "payment_manual_review_reached":
      return "Count as safe hotel progress only if the run stopped before CVV, payment submission, login bypass, CAPTCHA/OTP bypass, or final confirmation.";
    case "guest_details_manual_review_reached":
      return "Count as partial hotel progress. Inspect whether guest-details fill or payment-boundary detection is the next smallest patch, using screenshots first.";
    case "room_selection_manual_review_reached":
      return "Count as safe partial hotel progress. Preserve room-selection screenshots and only patch the room-to-guest transition if DB/log/screenshot evidence proves selector or runtime drift.";
    case "login_or_captcha_boundary":
      return "Treat as an expected safe provider boundary. Do not bypass login, CAPTCHA, OTP, or account-sensitive prompts.";
    case "profile_gating":
      return "Treat as internal readiness gating. Fix profile completeness or prompt copy before any provider retry.";
    case "model_env_transient":
      return "Treat as model/runtime environment instability. Do not patch hotel provider selectors from OpenAI Responses API or Computer Use transient evidence alone.";
    case "network_provider_failure":
      return "Treat as provider/network instability. Do not patch selectors from this state unless separate screenshots prove room-selection drift or weak no-availability evidence justifies provider fallback.";
    case "provider_no_availability":
      return "Treat as a provider inventory outcome. Do not patch selectors unless screenshots show matching available inventory that the worker missed.";
    case "provider_selector_drift":
      return "Treat as Booking.com hotel-result or property-detail selector drift only after screenshots confirm the approved target hotel was visible.";
    case "room_selection_drift":
      return "Treat as Booking.com/Hotels.com room selector or selected-date drift only after screenshots confirm inventory was visible.";
    case "insufficient_evidence":
      return "Collect the DB row, codex-worker.log excerpt, provider screenshots, and live snapshot paths before making a patch decision.";
  }
}

function signalRank(kind: SignalKind): number {
  switch (kind) {
    case "safety_boundary_violation":
      return 0;
    case "payment_boundary":
      return 1;
    case "guest_details_reached":
      return 2;
    case "room_selection_reached":
      return 3;
    case "login_or_captcha":
      return 4;
    case "profile_gating":
      return 5;
    case "model_env_transient":
      return 6;
    case "network_provider_failure":
      return 7;
    case "provider_no_availability":
      return 8;
    case "provider_selector_drift":
      return 9;
    case "room_selection_drift":
      return 10;
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

function isNegatedProgressExcerpt(excerpt: string): boolean {
  return (
    /\b(no|not|never|without)\s+(checkout|payment|guest details|contact details|traveler details|reservation details)\s+(page\s+)?(visible|reached|loaded)\b/i.test(
      excerpt,
    ) ||
    /\b(stop(?:ped)?|stopping)\s+before\s+(payment|cvv|cvc|final|confirmation|purchase|login|captcha|otp)\b/i.test(
      excerpt,
    )
  );
}

function escapeMarkdownLine(text: string): string {
  return text.replace(/`/g, "\\`");
}
