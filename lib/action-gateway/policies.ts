import type {
  ActionIntent,
  PolicyEffect,
  PolicyEvaluation,
  PolicyRule,
} from "@/lib/action-gateway/types";
import {
  hasLargeNumericUpdate,
  isExternalRecipient,
  isKnownVendor,
} from "@/lib/action-gateway/risk";

const policyTimestamp = "2026-06-09T00:00:00.000Z";

export const DEFAULT_ACTION_GATEWAY_POLICIES: PolicyRule[] = [
  {
    id: "policy-pay-over-1000",
    name: "Purchase orders over $1,000 require human approval.",
    description: "Any payment or high-value commercial action over $1,000 must be reviewed by a human.",
    enabled: true,
    actionTypes: ["SUBMIT", "PAY", "SEND", "UPDATE"],
    condition: "amount > 1000",
    effect: "REQUIRE_APPROVAL",
    createdAt: policyTimestamp,
    updatedAt: policyTimestamp,
  },
  {
    id: "policy-production-actions",
    name: "Require approval for all production actions",
    description: "Production actions must not execute without human approval.",
    enabled: true,
    actionTypes: ["SUBMIT", "PAY", "SEND", "UPDATE"],
    condition: "environment == production",
    effect: "REQUIRE_APPROVAL",
    createdAt: policyTimestamp,
    updatedAt: policyTimestamp,
  },
  {
    id: "policy-unknown-vendor-payment",
    name: "Block payments to unknown vendors",
    description: "Payments to vendors outside the approved vendor list are blocked in the MVP.",
    enabled: true,
    actionTypes: ["PAY"],
    condition: "vendorName missing or not approved",
    effect: "BLOCK",
    createdAt: policyTimestamp,
    updatedAt: policyTimestamp,
  },
  {
    id: "policy-external-email",
    name: "Require approval for external emails",
    description: "Important outbound messages to external recipients require human review.",
    enabled: true,
    actionTypes: ["SEND"],
    condition: "recipient is external",
    effect: "REQUIRE_APPROVAL",
    createdAt: policyTimestamp,
    updatedAt: policyTimestamp,
  },
  {
    id: "policy-large-inventory-update",
    name: "Require approval for inventory updates greater than 20%",
    description: "Large numeric inventory/record changes require review before mock execution.",
    enabled: true,
    actionTypes: ["UPDATE"],
    condition: "numeric field change > 20%",
    effect: "REQUIRE_APPROVAL",
    createdAt: policyTimestamp,
    updatedAt: policyTimestamp,
  },
  {
    id: "policy-low-risk-demo-submit",
    name: "Allow low-risk demo/staging submit actions",
    description: "Low-risk demo or staging submissions can proceed through mock execution.",
    enabled: true,
    actionTypes: ["SUBMIT"],
    condition: "environment != production and amount <= 1000",
    effect: "ALLOW",
    createdAt: policyTimestamp,
    updatedAt: policyTimestamp,
  },
];

export function evaluatePolicies(
  action: ActionIntent,
  policies: PolicyRule[] = DEFAULT_ACTION_GATEWAY_POLICIES,
): PolicyEvaluation {
  const triggered: Array<{ rule: PolicyRule; reason: string }> = [];
  for (const rule of policies) {
    if (!rule.enabled || !rule.actionTypes.includes(action.actionType)) continue;
    const reason = policyReason(action, rule.id);
    if (reason) triggered.push({ rule, reason });
  }

  const hasBlock = triggered.some((item) => item.rule.effect === "BLOCK");
  const hasApproval = triggered.some((item) => item.rule.effect === "REQUIRE_APPROVAL");
  const effect: PolicyEffect = hasBlock ? "BLOCK" : hasApproval ? "REQUIRE_APPROVAL" : "ALLOW";

  return {
    effect,
    triggeredPolicies: triggered.map((item) => item.rule.name),
    reasons: triggered.map((item) => item.reason),
    requiresHumanApproval: effect === "REQUIRE_APPROVAL",
    blocked: effect === "BLOCK",
  };
}

function policyReason(action: ActionIntent, policyId: string): string | null {
  if (policyId === "policy-pay-over-1000") {
    return typeof action.amount === "number" && action.amount > 1000
      ? "Amount is over the $1,000 approval threshold."
      : null;
  }
  if (policyId === "policy-production-actions") {
    return action.environment === "production"
      ? "Production environment actions require human approval."
      : null;
  }
  if (policyId === "policy-unknown-vendor-payment") {
    return !isKnownVendor(action.vendorName)
      ? "Vendor is not on the approved vendor list."
      : null;
  }
  if (policyId === "policy-external-email") {
    return isExternalRecipient(action.recipient)
      ? "Recipient is outside the trusted internal domains."
      : null;
  }
  if (policyId === "policy-large-inventory-update") {
    return hasLargeNumericUpdate(action)
      ? "Numeric record change is greater than 20%."
      : null;
  }
  if (policyId === "policy-low-risk-demo-submit") {
    return action.environment !== "production" &&
      (typeof action.amount !== "number" || action.amount <= 1000)
      ? "Low-risk demo/staging submit action is allowed for mock execution."
      : null;
  }
  return null;
}
