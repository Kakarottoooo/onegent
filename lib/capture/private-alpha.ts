import type {
  CaptureBenchmarkSourceShape,
  CaptureBenchmarkVertical,
  CaptureBenchmarkOwner,
} from "@/lib/capture/benchmark";

export type PrivateAlphaSubmissionSourceType =
  | "text"
  | "url"
  | "screenshot"
  | "mixed"
  | "raw_text"
  | "screenshot_description"
  | "mixed_url_instruction";

export type PrivateAlphaExpectedTaskType =
  | Extract<CaptureBenchmarkVertical, "restaurant" | "hotel" | "flight" | "activity" | "trip">
  | "ambiguous"
  | "profile"
  | "chitchat";

export type PrivateAlphaReadiness = "green" | "yellow" | "red";

export type PrivateAlphaUserValueSignal = "strong" | "medium" | "weak" | "none";

export type PrivateAlphaSubmission = {
  submissionId?: string;
  id?: string;
  syntheticMarker?: boolean;
  submittedAt: string;
  userId?: string;
  rawInput: string;
  sourceType: PrivateAlphaSubmissionSourceType;
  expectedTaskType?: PrivateAlphaExpectedTaskType;
  userGoal: string;
  expectedHelpfulness?: string;
  actualUserFeedback?: string;
  travelObject?: unknown;
  createdTaskId?: string;
  safeNextAction?: string;
  evidenceLinks?: string[];
  userValueSignal?: PrivateAlphaUserValueSignal | boolean | null;
  blockedReason?: string;
  notes?: string;
  wouldTrustOnegentToContinue?: boolean | null;
  wouldPay?: boolean | null;
};

export type PrivateAlphaQualityFlags =
  | "synthetic_only"
  | "missing_travel_object"
  | "missing_safe_next_action"
  | "missing_user_value_signal"
  | "missing_evidence"
  | "needs_clarification"
  | "sensitive_content"
  | "blocked";

export type PrivateAlphaScore = {
  understood: boolean;
  travelObjectCreated: boolean;
  taskReady: boolean;
  safeNextAction: boolean;
  evidenceComplete: boolean;
  userValue: boolean;
  total: number;
  max: 6;
  percentage: number;
};

export type PrivateAlphaFixtureSeed = {
  id: string;
  sourceShape: CaptureBenchmarkSourceShape;
  vertical: PrivateAlphaExpectedTaskType;
  rawInput: string;
  dogfoodId: string;
  note: string;
};

export type PrivateAlphaSubmissionAssessment = {
  submissionId: string;
  readiness: PrivateAlphaReadiness;
  verdict: "ready_for_fixture" | "needs_clarification" | "reject_sensitive";
  score: PrivateAlphaScore;
  scoreTotal: number;
  qualityFlags: PrivateAlphaQualityFlags[];
  missingEvidence: string[];
  missingFields: string[];
  forbiddenSignals: string[];
  sensitiveContentFindings: string[];
  recommendedOwner: CaptureBenchmarkOwner;
  suggestedOwner: CaptureBenchmarkOwner;
  canBecomeBenchmarkFixture: boolean;
  fixtureSeed: PrivateAlphaFixtureSeed | null;
  suggestedFollowUpQuestion?: string;
};

export type PrivateAlphaIntakeSummary = {
  total: number;
  green: number;
  yellow: number;
  red: number;
  fixtureSeedCount: number;
  sensitiveCount: number;
  averageScore: number;
  byOwner: Record<CaptureBenchmarkOwner, number>;
  readiness: PrivateAlphaReadiness;
  gatePass: boolean;
  gateErrors: string[];
};

export type PrivateAlphaIntakeReport = {
  generatedAt: string;
  summary: PrivateAlphaIntakeSummary;
  assessments: PrivateAlphaSubmissionAssessment[];
  notes: string[];
};

export type PrivateAlphaGateOptions = {
  minAverageScore?: number;
  minFixtureSeedCount?: number;
  maxSensitiveCount?: number;
};

const GENERATED_AT = "2026-05-07T12:00:00.000Z";

const OWNER_ZERO: Record<CaptureBenchmarkOwner, number> = {
  capture: 0,
  nlu: 0,
  planner: 0,
  "task-readiness": 0,
  "task-workspace": 0,
  "provider-runtime": 0,
  "product/manual-boundary": 0,
  "alpha-ops": 0,
};

const REQUIRED_FIELDS: Array<keyof PrivateAlphaSubmission> = [
  "submittedAt",
  "sourceType",
  "rawInput",
  "userGoal",
];

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "password", pattern: /\b(password|passcode|pwd)\b\s*[:=]?\s*\S+/i },
  { label: "cvv_or_security_code", pattern: /\b(cvv|cvc|security code|card code)\b\s*[:=]?\s*\d{3,4}\b/i },
  { label: "verification_code", pattern: /\b(otp|2fa|verification code|sms code|email code)\b\s*(?:is|:|=)?\s*\d{4,8}\b/i },
  { label: "card_number", pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  { label: "provider_cookie", pattern: /\b(cookie dump|provider cookie|storage-state|bearer token|session token)\b/i },
  { label: "private_token", pattern: /\b(api[_-]?key|secret[_-]?key|access token|refresh token)\b\s*[:=]\s*\S+/i },
];

export function assessPrivateAlphaSubmission(
  submission: PrivateAlphaSubmission,
  scoreOverrides: Partial<Omit<PrivateAlphaScore, "total" | "max" | "percentage">> = {},
): PrivateAlphaSubmissionAssessment {
  const submissionId = submission.submissionId ?? submission.id ?? "missing-submission-id";
  const missingFields = [
    ...(submission.submissionId || submission.id ? [] : ["submissionId"]),
    ...REQUIRED_FIELDS.filter((field) => !hasValue(submission[field])).map(String),
  ];
  const sensitiveContentFindings = findForbiddenSignals(sensitiveText(submission));
  const missingEvidence = evidenceGaps(submission);
  const qualityFlags = qualityFlagsFor(submission, missingFields, missingEvidence, sensitiveContentFindings);
  const score = buildScore(submission, missingFields, missingEvidence, sensitiveContentFindings, scoreOverrides);
  const readiness = readinessFor(submission, score, qualityFlags, sensitiveContentFindings);
  const recommendedOwner = suggestedOwnerFor(submission, score, qualityFlags, sensitiveContentFindings);
  const canBecomeBenchmarkFixture =
    sensitiveContentFindings.length === 0 &&
    hasValue(submission.rawInput) &&
    hasValue(submission.userGoal) &&
    Boolean(submission.expectedTaskType) &&
    score.understood;

  const fixtureSeed = canBecomeBenchmarkFixture
    ? {
        id: `alpha-${slug(submissionId)}`,
        sourceShape: sourceShapeFor(submission.sourceType),
        vertical: submission.expectedTaskType ?? "ambiguous",
        rawInput: submission.rawInput,
        dogfoodId: submissionId,
        note: `Private alpha seed from ${submissionId}; verify deterministic capture before using as provider evidence.`,
      }
    : null;

  return {
    submissionId,
    readiness,
    verdict: sensitiveContentFindings.length > 0
      ? "reject_sensitive"
      : canBecomeBenchmarkFixture
        ? "ready_for_fixture"
        : "needs_clarification",
    score,
    scoreTotal: score.total,
    qualityFlags,
    missingEvidence,
    missingFields,
    forbiddenSignals: sensitiveContentFindings,
    sensitiveContentFindings,
    recommendedOwner,
    suggestedOwner: recommendedOwner,
    canBecomeBenchmarkFixture,
    fixtureSeed,
    suggestedFollowUpQuestion: suggestedFollowUpQuestion(submission, missingFields, missingEvidence, qualityFlags),
  };
}

export function buildPrivateAlphaIntakeReport(
  submissions: PrivateAlphaSubmission[],
  gateOptions: PrivateAlphaGateOptions = {},
): PrivateAlphaIntakeReport {
  const assessments = submissions.map((submission) => assessPrivateAlphaSubmission(submission));
  const summary = summarizeAssessments(assessments, gateOptions);
  return {
    generatedAt: GENERATED_AT,
    summary,
    assessments,
    notes: [
      "Private alpha intake is no-live: it evaluates submitted text/metadata only and never starts provider work.",
      "Synthetic samples can exercise the gate, but they cannot make private alpha green.",
      "Sensitive values are rejected; ask users to remove secrets and describe the travel goal instead.",
      "Benchmark fixture seeds prove repeatable capture contracts, not provider execution or live booking success.",
    ],
  };
}

export function findForbiddenSignals(value: string): string[] {
  return Array.from(new Set(
    FORBIDDEN_PATTERNS
      .filter((entry) => entry.pattern.test(value))
      .map((entry) => entry.label),
  ));
}

export function parsePrivateAlphaJson(input: string): PrivateAlphaSubmission[] {
  const parsed = JSON.parse(input) as unknown;
  if (Array.isArray(parsed)) return parsed.map(normalizeSubmission);
  if (isRecord(parsed) && Array.isArray(parsed.submissions)) return parsed.submissions.map(normalizeSubmission);
  throw new Error("Expected a JSON array of private-alpha submissions or an object with submissions[].");
}

export function parsePrivateAlphaMarkdown(input: string): PrivateAlphaSubmission[] {
  const sections = input.split(/^##\s+/m).map((section) => section.trim()).filter(Boolean);
  const submissions: PrivateAlphaSubmission[] = [];
  for (const [index, section] of sections.entries()) {
    const lines = section.split(/\r?\n/);
    const heading = lines.shift()?.trim() || `alpha-${index + 1}`;
    const fields = new Map<string, string>();
    for (const line of lines) {
      const match = line.match(/^\s*[-*]\s*([^:]+):\s*(.*?)\s*$/);
      if (!match) continue;
      fields.set(normalizeKey(match[1]), match[2]);
    }
    if (fields.size === 0) continue;
    submissions.push(normalizeSubmission({
      submissionId: fields.get("submissionid") ?? fields.get("id") ?? heading,
      submittedAt: fields.get("submittedat") ?? GENERATED_AT,
      userId: fields.get("userid"),
      rawInput: fields.get("rawinput") ?? "",
      sourceType: fields.get("sourcetype") ?? "text",
      expectedTaskType: fields.get("expectedtasktype"),
      userGoal: fields.get("usergoal") ?? "",
      expectedHelpfulness: fields.get("expectedhelpfulness"),
      actualUserFeedback: fields.get("actualuserfeedback"),
      safeNextAction: fields.get("safenextaction"),
      evidenceLinks: parseList(fields.get("evidencelinks")),
      userValueSignal: fields.get("uservaluesignal"),
      blockedReason: fields.get("blockedreason"),
      notes: fields.get("notes"),
      syntheticMarker: parseBoolean(fields.get("syntheticmarker")),
    }));
  }
  return submissions;
}

export function parsePrivateAlphaInput(input: string, filename = ""): PrivateAlphaSubmission[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (filename.endsWith(".md") || filename.endsWith(".markdown") || trimmed.startsWith("#")) {
    return parsePrivateAlphaMarkdown(trimmed);
  }
  return parsePrivateAlphaJson(trimmed);
}

export function renderPrivateAlphaMarkdown(report: PrivateAlphaIntakeReport): string {
  const lines = [
    "# Private Alpha Intake Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Readiness: ${report.summary.readiness}`,
    `Gate: ${report.summary.gatePass ? "PASS" : "FAIL"}`,
    `Submissions: ${report.summary.total}`,
    `Green: ${report.summary.green}`,
    `Yellow: ${report.summary.yellow}`,
    `Red: ${report.summary.red}`,
    `Fixture seeds: ${report.summary.fixtureSeedCount}`,
    `Sensitive findings: ${report.summary.sensitiveCount}`,
    `Average score: ${report.summary.averageScore}`,
    "",
    "## Assessments",
    "",
    "| Submission | Readiness | Score | Owner | Fixture seed | Flags | Missing evidence |",
    "| --- | --- | ---: | --- | --- | --- | --- |",
  ];

  for (const assessment of report.assessments) {
    lines.push(
      `| \`${assessment.submissionId}\` | \`${assessment.readiness}\` | ${assessment.score.total}/${assessment.score.max} | \`${assessment.recommendedOwner}\` | ${assessment.canBecomeBenchmarkFixture ? "yes" : "no"} | ${assessment.qualityFlags.join(", ") || "-"} | ${assessment.missingEvidence.join(", ") || "-"} |`,
    );
  }

  if (report.summary.gateErrors.length > 0) {
    lines.push("", "## Gate Errors", "");
    for (const error of report.summary.gateErrors) lines.push(`- ${error}`);
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}

function summarizeAssessments(
  assessments: PrivateAlphaSubmissionAssessment[],
  gateOptions: PrivateAlphaGateOptions,
): PrivateAlphaIntakeSummary {
  const byOwner = { ...OWNER_ZERO };
  for (const assessment of assessments) byOwner[assessment.recommendedOwner] += 1;

  const total = assessments.length;
  const green = assessments.filter((item) => item.readiness === "green").length;
  const yellow = assessments.filter((item) => item.readiness === "yellow").length;
  const red = assessments.filter((item) => item.readiness === "red").length;
  const sensitiveCount = assessments.filter((item) => item.sensitiveContentFindings.length > 0).length;
  const fixtureSeedCount = assessments.filter((item) => item.canBecomeBenchmarkFixture).length;
  const averageScore = total === 0
    ? 0
    : Math.round((assessments.reduce((sum, item) => sum + item.score.percentage, 0) / total) * 1000) / 1000;
  const readiness: PrivateAlphaReadiness =
    red > 0 || total === 0
      ? "red"
      : green > 0 && green === total
        ? "green"
        : "yellow";

  const errors: string[] = [];
  const minAverageScore = gateOptions.minAverageScore ?? 0.6;
  const minFixtureSeedCount = gateOptions.minFixtureSeedCount ?? 1;
  const maxSensitiveCount = gateOptions.maxSensitiveCount ?? 0;
  if (averageScore < minAverageScore) errors.push(`average score ${averageScore} below ${minAverageScore}`);
  if (fixtureSeedCount < minFixtureSeedCount) errors.push(`fixture seeds ${fixtureSeedCount} below ${minFixtureSeedCount}`);
  if (sensitiveCount > maxSensitiveCount) errors.push(`sensitive submissions ${sensitiveCount} above ${maxSensitiveCount}`);

  return {
    total,
    green,
    yellow,
    red,
    fixtureSeedCount,
    sensitiveCount,
    averageScore,
    byOwner,
    readiness,
    gatePass: errors.length === 0,
    gateErrors: errors,
  };
}

function buildScore(
  submission: PrivateAlphaSubmission,
  missingFields: string[],
  missingEvidence: string[],
  sensitiveContentFindings: string[],
  scoreOverrides: Partial<Omit<PrivateAlphaScore, "total" | "max" | "percentage">>,
): PrivateAlphaScore {
  const travelObjectCreated = scoreOverrides.travelObjectCreated ?? Boolean(submission.travelObject);
  const safeNextAction = scoreOverrides.safeNextAction ?? hasValue(submission.safeNextAction);
  const userValue = scoreOverrides.userValue ?? hasUserValue(submission);
  const score = {
    understood: scoreOverrides.understood ?? (missingFields.length === 0 && sensitiveContentFindings.length === 0),
    travelObjectCreated,
    taskReady: scoreOverrides.taskReady ?? (travelObjectCreated && safeNextAction && !submission.blockedReason),
    safeNextAction,
    evidenceComplete: scoreOverrides.evidenceComplete ?? missingEvidence.length === 0,
    userValue,
  };
  const total = Object.values(score).filter(Boolean).length;
  return {
    ...score,
    total,
    max: 6,
    percentage: Math.round((total / 6) * 1000) / 1000,
  };
}

function readinessFor(
  submission: PrivateAlphaSubmission,
  score: PrivateAlphaScore,
  qualityFlags: PrivateAlphaQualityFlags[],
  sensitiveContentFindings: string[],
): PrivateAlphaReadiness {
  if (sensitiveContentFindings.length > 0 || !score.understood || score.total <= 2) return "red";
  if (submission.syntheticMarker || qualityFlags.length > 0 || score.total < 6) return "yellow";
  return "green";
}

function qualityFlagsFor(
  submission: PrivateAlphaSubmission,
  missingFields: string[],
  missingEvidence: string[],
  sensitiveContentFindings: string[],
): PrivateAlphaQualityFlags[] {
  const flags: PrivateAlphaQualityFlags[] = [];
  if (submission.syntheticMarker) flags.push("synthetic_only");
  if (!submission.travelObject) flags.push("missing_travel_object");
  if (!hasValue(submission.safeNextAction)) flags.push("missing_safe_next_action");
  if (!hasUserValue(submission)) flags.push("missing_user_value_signal");
  if (missingEvidence.length > 0) flags.push("missing_evidence");
  if (missingFields.length > 0) flags.push("needs_clarification");
  if (sensitiveContentFindings.length > 0) flags.push("sensitive_content");
  if (hasValue(submission.blockedReason)) flags.push("blocked");
  return flags;
}

function evidenceGaps(submission: PrivateAlphaSubmission): string[] {
  const gaps: string[] = [];
  if (!submission.evidenceLinks || submission.evidenceLinks.length === 0) gaps.push("evidenceLinks");
  if (!hasValue(submission.safeNextAction)) gaps.push("safeNextAction");
  if (!submission.travelObject) gaps.push("travelObject");
  if (!hasUserValue(submission)) gaps.push("userValueSignal");
  return gaps;
}

function suggestedOwnerFor(
  submission: PrivateAlphaSubmission,
  score: PrivateAlphaScore,
  qualityFlags: PrivateAlphaQualityFlags[],
  sensitiveContentFindings: string[],
): CaptureBenchmarkOwner {
  if (sensitiveContentFindings.length > 0) return "product/manual-boundary";
  if (!score.understood || qualityFlags.includes("needs_clarification")) return "capture";
  if (!score.travelObjectCreated) return "capture";
  if (!score.taskReady || qualityFlags.includes("missing_safe_next_action")) return "task-readiness";
  if (!score.evidenceComplete || qualityFlags.includes("missing_evidence")) return "task-workspace";
  if (submission.expectedTaskType === "ambiguous" || submission.expectedTaskType === "chitchat") return "alpha-ops";
  return "nlu";
}

function suggestedFollowUpQuestion(
  submission: PrivateAlphaSubmission,
  missingFields: string[],
  missingEvidence: string[],
  qualityFlags: PrivateAlphaQualityFlags[],
): string | undefined {
  if (qualityFlags.includes("sensitive_content")) {
    return "Remove sensitive values and describe only the travel goal, constraints, and safe next action.";
  }
  if (missingFields.includes("userGoal")) return "What would you want Onegent to do next with this input?";
  if (missingEvidence.includes("travelObject")) return "What Travel Object did Capture create, and which constraints did it preserve?";
  if (missingEvidence.includes("safeNextAction")) return "What is the safe next action: task-ready, clarify, save-only, compare-only, or group decision?";
  if (!hasUserValue(submission)) return "Would this result make you trust Onegent to continue, and would you pay for this workflow?";
  return undefined;
}

function hasUserValue(submission: PrivateAlphaSubmission): boolean {
  if (submission.userValueSignal && submission.userValueSignal !== "none") return true;
  return Boolean(submission.wouldTrustOnegentToContinue || submission.wouldPay || submission.actualUserFeedback);
}

function sourceShapeFor(sourceType: PrivateAlphaSubmissionSourceType): CaptureBenchmarkSourceShape {
  switch (sourceType) {
    case "url":
      return "pasted_url";
    case "screenshot":
    case "screenshot_description":
      return "screenshot_description";
    case "mixed":
    case "mixed_url_instruction":
      return "mixed_url_instruction";
    case "text":
    case "raw_text":
    default:
      return "plain_natural_language";
  }
}

function normalizeSubmission(raw: unknown): PrivateAlphaSubmission {
  if (!isRecord(raw)) throw new Error("Private alpha submission must be an object.");
  return {
    submissionId: stringOrUndefined(raw.submissionId) ?? stringOrUndefined(raw.id),
    id: stringOrUndefined(raw.id),
    syntheticMarker: booleanOrUndefined(raw.syntheticMarker),
    submittedAt: stringOrDefault(raw.submittedAt, GENERATED_AT),
    userId: stringOrUndefined(raw.userId),
    rawInput: stringOrDefault(raw.rawInput, ""),
    sourceType: normalizeSourceType(raw.sourceType),
    expectedTaskType: normalizeExpectedTaskType(raw.expectedTaskType),
    userGoal: stringOrDefault(raw.userGoal, ""),
    expectedHelpfulness: stringOrUndefined(raw.expectedHelpfulness),
    actualUserFeedback: stringOrUndefined(raw.actualUserFeedback),
    travelObject: raw.travelObject,
    createdTaskId: stringOrUndefined(raw.createdTaskId),
    safeNextAction: stringOrUndefined(raw.safeNextAction),
    evidenceLinks: stringArray(raw.evidenceLinks),
    userValueSignal: normalizeUserValueSignal(raw.userValueSignal),
    blockedReason: stringOrUndefined(raw.blockedReason),
    notes: stringOrUndefined(raw.notes),
    wouldTrustOnegentToContinue: booleanOrNull(raw.wouldTrustOnegentToContinue),
    wouldPay: booleanOrNull(raw.wouldPay),
  };
}

function sensitiveText(submission: PrivateAlphaSubmission): string {
  return [
    submission.rawInput,
    submission.userGoal,
    submission.expectedHelpfulness,
    submission.actualUserFeedback,
    submission.safeNextAction,
    submission.blockedReason,
    submission.notes,
    ...(submission.evidenceLinks ?? []),
  ].filter(Boolean).join("\n");
}

function normalizeSourceType(value: unknown): PrivateAlphaSubmissionSourceType {
  if (
    value === "text" ||
    value === "url" ||
    value === "screenshot" ||
    value === "mixed" ||
    value === "raw_text" ||
    value === "screenshot_description" ||
    value === "mixed_url_instruction"
  ) {
    return value;
  }
  return "text";
}

function normalizeExpectedTaskType(value: unknown): PrivateAlphaExpectedTaskType | undefined {
  if (
    value === "restaurant" ||
    value === "hotel" ||
    value === "flight" ||
    value === "activity" ||
    value === "trip" ||
    value === "ambiguous" ||
    value === "profile" ||
    value === "chitchat"
  ) {
    return value;
  }
  return undefined;
}

function normalizeUserValueSignal(value: unknown): PrivateAlphaSubmission["userValueSignal"] {
  if (value === true || value === false || value === null) return value;
  if (value === "strong" || value === "medium" || value === "weak" || value === "none") return value;
  return undefined;
}

function parseList(value: string | undefined): string[] {
  if (!value || value.trim().toLowerCase() === "none") return [];
  return value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return parseList(value);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function booleanOrNull(value: unknown): boolean | null | undefined {
  return value === null || typeof value === "boolean" ? value : undefined;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "submission";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
