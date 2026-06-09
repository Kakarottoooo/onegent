import type {
  ActionIntent,
  ActionType,
  RiskAssessment,
  RiskLevel,
} from "@/lib/action-gateway/types";

export const APPROVED_DEMO_VENDORS = new Set([
  "Acme Industrial Supply",
  "Northwind Parts",
  "Contoso Operations",
  "Approved Vendor Co",
]);

export function assessActionRisk(input: {
  id: string;
  action: ActionIntent;
  triggeredPolicies: string[];
  createdAt: string;
}): RiskAssessment {
  const reasons: string[] = [];
  let score = baseRiskScore(input.action.actionType);

  if (input.action.actionType === "PAY") {
    reasons.push("PAY actions are high risk by default.");
    score = Math.max(score, 75);
  }

  if (typeof input.action.amount === "number" && input.action.amount > 1000) {
    reasons.push("Amount is over $1,000.");
    score += input.action.amount > 10000 ? 20 : 12;
  }

  if (input.action.environment === "production") {
    reasons.push("Action targets a production environment.");
    score += 18;
  }

  if (input.action.actionType === "PAY" && !isKnownVendor(input.action.vendorName)) {
    reasons.push("Payment vendor is unknown.");
    score = Math.max(score, 92);
  }

  if (input.action.actionType === "SEND" && isExternalRecipient(input.action.recipient)) {
    reasons.push("SEND recipient is external.");
    score = Math.max(score, 68);
  }

  if (input.action.actionType === "UPDATE" && hasLargeNumericUpdate(input.action)) {
    reasons.push("UPDATE changes a numeric field by more than 20%.");
    score = Math.max(score, 70);
  }

  if (input.action.actionType === "SUBMIT") {
    reasons.push("SUBMIT actions are medium risk by default.");
    if (typeof input.action.amount === "number" && input.action.amount > 1000) {
      score = Math.max(score, 70);
      reasons.push("SUBMIT includes a high-value amount.");
    }
  }

  const riskScore = clampScore(score);
  return {
    id: input.id,
    actionIntentId: input.action.id,
    riskLevel: riskLevelForScore(riskScore),
    riskScore,
    reasons: [...new Set(reasons)],
    triggeredPolicies: input.triggeredPolicies,
    requiresHumanApproval:
      riskScore >= 65 ||
      input.action.environment === "production" ||
      (typeof input.action.amount === "number" && input.action.amount > 1000) ||
      (input.action.actionType === "SEND" && isExternalRecipient(input.action.recipient)) ||
      (input.action.actionType === "UPDATE" && hasLargeNumericUpdate(input.action)),
    createdAt: input.createdAt,
  };
}

export function isKnownVendor(vendorName: string | undefined): boolean {
  if (!vendorName?.trim()) return false;
  return APPROVED_DEMO_VENDORS.has(vendorName.trim());
}

export function isExternalRecipient(recipient: string | undefined): boolean {
  if (!recipient?.trim()) return false;
  const lower = recipient.trim().toLowerCase();
  if (!lower.includes("@")) return true;
  return !lower.endsWith("@onegent.local") && !lower.endsWith("@company.local");
}

export function hasLargeNumericUpdate(action: ActionIntent): boolean {
  for (const change of action.fieldsChanged) {
    if (numericDeltaOverThreshold(change.before, change.after)) return true;
  }
  const before = action.beforeState ?? {};
  const after = action.proposedAfterState ?? {};
  for (const key of Object.keys(after)) {
    if (numericDeltaOverThreshold(before[key], after[key])) return true;
  }
  return false;
}

function numericDeltaOverThreshold(before: unknown, after: unknown): boolean {
  if (typeof before !== "number" || typeof after !== "number") return false;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
  if (before === 0) return after !== 0;
  return Math.abs(after - before) / Math.abs(before) > 0.2;
}

function baseRiskScore(actionType: ActionType): number {
  if (actionType === "PAY") return 75;
  if (actionType === "SUBMIT") return 45;
  if (actionType === "SEND") return 35;
  return 40;
}

function riskLevelForScore(score: number): RiskLevel {
  if (score >= 90) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
