import type {
  CaptureBenchmarkSourceShape,
  CaptureBenchmarkVertical,
  CaptureBenchmarkOwner,
} from "@/lib/capture/benchmark";

export type PrivateAlphaSubmissionSourceType =
  | "raw_text"
  | "url"
  | "screenshot_description"
  | "mixed_url_instruction";

export type PrivateAlphaExpectedTaskType =
  | Extract<CaptureBenchmarkVertical, "restaurant" | "hotel" | "flight" | "activity" | "trip">
  | "ambiguous"
  | "profile"
  | "chitchat";

export type PrivateAlphaSubmission = {
  id: string;
  syntheticMarker: true;
  submittedAt: string;
  sourceType: PrivateAlphaSubmissionSourceType;
  rawInput: string;
  expectedTaskType: PrivateAlphaExpectedTaskType;
  userGoal: string;
  wouldTrustOnegentToContinue: boolean | null;
  wouldPay: boolean | null;
  expectedOutcome?: string;
  notes?: string;
};

export type PrivateAlphaScore = {
  understood: boolean;
  travelObjectCreated: boolean;
  taskReady: boolean;
  safeNextAction: boolean;
  evidenceComplete: boolean;
  userValue: boolean;
};

export type PrivateAlphaSubmissionVerdict = "ready_for_fixture" | "needs_clarification" | "reject_sensitive";

export type PrivateAlphaSubmissionAssessment = {
  submissionId: string;
  verdict: PrivateAlphaSubmissionVerdict;
  score: PrivateAlphaScore;
  scoreTotal: number;
  missingFields: string[];
  forbiddenSignals: string[];
  suggestedOwner: CaptureBenchmarkOwner;
  fixtureSeed: {
    id: string;
    sourceShape: CaptureBenchmarkSourceShape;
    vertical: PrivateAlphaExpectedTaskType;
    rawInput: string;
    dogfoodId: string;
  } | null;
};

const REQUIRED_FIELDS: Array<keyof PrivateAlphaSubmission> = [
  "id",
  "submittedAt",
  "sourceType",
  "rawInput",
  "expectedTaskType",
  "userGoal",
];

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "password", pattern: /\b(password|passcode|pwd)\b/i },
  { label: "cvv_or_security_code", pattern: /\b(cvv|cvc|security code|card code)\b/i },
  { label: "verification_code", pattern: /\b(otp|2fa|verification code|sms code|email code)\b/i },
  { label: "card_number", pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  { label: "provider_cookie", pattern: /\b(cookie|session token|storage-state|bearer token)\b/i },
];

export function assessPrivateAlphaSubmission(
  submission: PrivateAlphaSubmission,
  score: Partial<PrivateAlphaScore> = {},
): PrivateAlphaSubmissionAssessment {
  const missingFields = REQUIRED_FIELDS.filter((field) => !hasValue(submission[field]));
  const forbiddenSignals = findForbiddenSignals(`${submission.rawInput}\n${submission.userGoal}\n${submission.notes ?? ""}`);
  const fullScore: PrivateAlphaScore = {
    understood: score.understood ?? missingFields.length === 0,
    travelObjectCreated: score.travelObjectCreated ?? false,
    taskReady: score.taskReady ?? false,
    safeNextAction: score.safeNextAction ?? false,
    evidenceComplete: score.evidenceComplete ?? false,
    userValue: score.userValue ?? Boolean(submission.wouldTrustOnegentToContinue || submission.wouldPay),
  };
  const scoreTotal = Object.values(fullScore).filter(Boolean).length;
  const verdict: PrivateAlphaSubmissionVerdict =
    forbiddenSignals.length > 0
      ? "reject_sensitive"
      : missingFields.length > 0 || !fullScore.understood
        ? "needs_clarification"
        : "ready_for_fixture";

  return {
    submissionId: submission.id,
    verdict,
    score: fullScore,
    scoreTotal,
    missingFields: missingFields.map(String),
    forbiddenSignals,
    suggestedOwner: suggestedOwnerFor(submission, fullScore, forbiddenSignals),
    fixtureSeed: verdict === "ready_for_fixture"
      ? {
          id: `alpha-${submission.id}`,
          sourceShape: sourceShapeFor(submission.sourceType),
          vertical: submission.expectedTaskType,
          rawInput: submission.rawInput,
          dogfoodId: submission.id,
        }
      : null,
  };
}

export function findForbiddenSignals(value: string): string[] {
  return FORBIDDEN_PATTERNS
    .filter((entry) => entry.pattern.test(value))
    .map((entry) => entry.label);
}

function suggestedOwnerFor(
  submission: PrivateAlphaSubmission,
  score: PrivateAlphaScore,
  forbiddenSignals: string[],
): CaptureBenchmarkOwner {
  if (forbiddenSignals.length > 0) return "product/manual-boundary";
  if (!score.understood || !score.travelObjectCreated) return "capture";
  if (!score.taskReady) return "task-readiness";
  if (!score.evidenceComplete) return "task-workspace";
  if (submission.expectedTaskType === "ambiguous" || submission.expectedTaskType === "chitchat") return "alpha-ops";
  return "nlu";
}

function sourceShapeFor(sourceType: PrivateAlphaSubmissionSourceType): CaptureBenchmarkSourceShape {
  switch (sourceType) {
    case "url":
      return "pasted_url";
    case "screenshot_description":
      return "screenshot_description";
    case "mixed_url_instruction":
      return "mixed_url_instruction";
    case "raw_text":
    default:
      return "plain_natural_language";
  }
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined;
}
