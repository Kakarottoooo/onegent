import { randomUUID } from "crypto";
import { DEFAULT_ACTION_GATEWAY_POLICIES, evaluatePolicies } from "@/lib/action-gateway/policies";
import { assessActionRisk } from "@/lib/action-gateway/risk";
import { getActionGatewayStore, resetActionGatewayStore } from "@/lib/action-gateway/store";
import type {
  ActionGatewayState,
} from "@/lib/action-gateway/store";
import type {
  ActionIntent,
  ActionIntentStatus,
  ActionListFilters,
  ActionReview,
  ApprovalRequest,
  AuditEvent,
  CreateActionIntentInput,
  RiskAssessment,
  VerificationResult,
} from "@/lib/action-gateway/types";

export class ActionGatewayError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function captureActionIntent(input: CreateActionIntentInput): ActionReview {
  const store = getActionGatewayStore();
  const now = new Date().toISOString();
  const action = normalizeActionInput(input, now);
  store.actions.set(action.id, action);
  addAuditEvent(store, action.id, {
    eventType: "ACTION_CAPTURED",
    actorType: "AGENT",
    actorId: action.sourceAgentName,
    message: `Captured ${action.actionType} action from ${action.sourceAgentName}.`,
    metadata: { sourceAgentRunId: action.sourceAgentRunId },
  });

  const preliminaryPolicy = evaluatePolicies(action);
  const risk = assessActionRisk({
    id: randomUUID(),
    action,
    triggeredPolicies: preliminaryPolicy.triggeredPolicies,
    createdAt: now,
  });
  store.risks.set(action.id, risk);
  addAuditEvent(store, action.id, {
    eventType: "RISK_ASSESSED",
    actorType: "SYSTEM",
    actorId: "risk-engine",
    message: `Risk assessed as ${risk.riskLevel} (${risk.riskScore}/100).`,
    metadata: { reasons: risk.reasons },
  });

  const policy = evaluatePolicies(action);
  addAuditEvent(store, action.id, {
    eventType: "POLICY_EVALUATED",
    actorType: "SYSTEM",
    actorId: "policy-engine",
    message: `Policy effect: ${policy.effect}.`,
    metadata: {
      triggeredPolicies: policy.triggeredPolicies,
      reasons: policy.reasons,
    },
  });

  if (policy.blocked) {
    action.status = "CANCELLED";
    addAuditEvent(store, action.id, {
      eventType: "ACTION_CANCELLED",
      actorType: "SYSTEM",
      actorId: "policy-engine",
      message: "Action blocked by policy and cancelled before execution.",
      metadata: { triggeredPolicies: policy.triggeredPolicies },
    });
    return getActionReview(action.id);
  }

  if (policy.requiresHumanApproval || risk.requiresHumanApproval) {
    action.status = "NEEDS_REVIEW";
    const approval: ApprovalRequest = {
      id: randomUUID(),
      actionIntentId: action.id,
      riskAssessmentId: risk.id,
      requestedBy: action.sourceAgentName,
      assignedTo: "human-reviewer",
      status: "PENDING",
      createdAt: now,
    };
    store.approvals.set(action.id, approval);
    addAuditEvent(store, action.id, {
      eventType: "APPROVAL_REQUESTED",
      actorType: "SYSTEM",
      actorId: "approval-router",
      message: "Human approval requested before mock execution.",
      metadata: { approvalRequestId: approval.id },
    });
    return getActionReview(action.id);
  }

  action.status = "APPROVED";
  addAuditEvent(store, action.id, {
    eventType: "ACTION_APPROVED",
    actorType: "SYSTEM",
    actorId: "policy-engine",
    message: "Low-risk action approved automatically for mock execution.",
  });
  runMockExecution(action.id);
  verifyAction(action.id);
  return getActionReview(action.id);
}

export function listActionReviews(filters: ActionListFilters = {}): ActionReview[] {
  const store = getActionGatewayStore();
  return [...store.actions.values()]
    .filter((action) => matchesFilters(action, store.risks.get(action.id), filters))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((action) => getActionReview(action.id));
}

export function getActionReview(id: string): ActionReview {
  const store = getActionGatewayStore();
  const action = store.actions.get(id);
  if (!action) throw new ActionGatewayError("Action not found", 404);
  const riskAssessment = store.risks.get(id);
  if (!riskAssessment) throw new ActionGatewayError("Risk assessment missing", 500);
  return {
    action,
    riskAssessment,
    approvalRequest: store.approvals.get(id),
    verificationResult: store.verifications.get(id),
    auditEvents: store.auditEvents.get(id) ?? [],
    policyRules: DEFAULT_ACTION_GATEWAY_POLICIES,
    blocked: action.status === "CANCELLED",
  };
}

export function approveAction(input: {
  id: string;
  reviewerId?: string;
  reviewerComment?: string;
}): ActionReview {
  const store = getActionGatewayStore();
  const action = getStoredAction(store, input.id);
  const approval = store.approvals.get(action.id);
  if (!approval || approval.status !== "PENDING") {
    throw new ActionGatewayError("No pending approval request for this action", 409);
  }
  const now = new Date().toISOString();
  approval.status = "APPROVED";
  approval.reviewedAt = now;
  approval.reviewerComment = input.reviewerComment;
  action.status = "APPROVED";
  addAuditEvent(store, action.id, {
    eventType: "ACTION_APPROVED",
    actorType: "HUMAN",
    actorId: input.reviewerId ?? "human-reviewer",
    message: input.reviewerComment || "Human reviewer approved the action.",
    metadata: { approvalRequestId: approval.id },
  });
  runMockExecution(action.id);
  verifyAction(action.id);
  return getActionReview(action.id);
}

export function rejectAction(input: {
  id: string;
  reviewerId?: string;
  reviewerComment?: string;
}): ActionReview {
  const store = getActionGatewayStore();
  const action = getStoredAction(store, input.id);
  const approval = store.approvals.get(action.id);
  if (approval) {
    approval.status = "REJECTED";
    approval.reviewedAt = new Date().toISOString();
    approval.reviewerComment = input.reviewerComment;
  }
  action.status = "REJECTED";
  addAuditEvent(store, action.id, {
    eventType: "ACTION_REJECTED",
    actorType: "HUMAN",
    actorId: input.reviewerId ?? "human-reviewer",
    message: input.reviewerComment || "Human reviewer rejected the action.",
    metadata: approval ? { approvalRequestId: approval.id } : undefined,
  });
  return getActionReview(action.id);
}

export function verifyAction(
  id: string,
  observedState?: Record<string, unknown>,
): ActionReview {
  const store = getActionGatewayStore();
  const action = getStoredAction(store, id);
  const expected = action.proposedAfterState ?? {};
  const observed = observedState ?? store.mockObservedStates.get(id) ?? {};
  const differences = diffStates(expected, observed);
  const success = differences.length === 0;
  const verification: VerificationResult = {
    id: randomUUID(),
    actionIntentId: id,
    expectedState: expected,
    observedState: observed,
    success,
    differences,
    verificationMethod: "MOCK",
    createdAt: new Date().toISOString(),
  };
  store.verifications.set(id, verification);
  action.status = success ? "VERIFIED" : "FAILED_VERIFICATION";
  addAuditEvent(store, id, {
    eventType: success ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED",
    actorType: "SYSTEM",
    actorId: "mock-verifier",
    message: success
      ? "Mock verification passed."
      : "Mock verification failed; observed state differed from expected state.",
    metadata: { differences },
  });
  return getActionReview(id);
}

export function resetActionGatewayDemoStore(): void {
  resetActionGatewayStore();
}

function runMockExecution(id: string): void {
  const store = getActionGatewayStore();
  const action = getStoredAction(store, id);
  addAuditEvent(store, id, {
    eventType: "MOCK_EXECUTION_STARTED",
    actorType: "SYSTEM",
    actorId: "mock-executor",
    message: "Mock execution started. No external system was touched.",
  });
  action.status = "EXECUTED";
  const observed = action.proposedAfterState ?? { mockExecuted: true };
  store.mockObservedStates.set(id, observed);
  addAuditEvent(store, id, {
    eventType: "MOCK_EXECUTION_COMPLETED",
    actorType: "SYSTEM",
    actorId: "mock-executor",
    message: "Mock execution completed against demo state only.",
    metadata: { observedState: observed },
  });
}

function normalizeActionInput(input: CreateActionIntentInput, now: string): ActionIntent {
  if (!input.sourceAgentName?.trim()) throw new ActionGatewayError("sourceAgentName required");
  if (!input.sourceAgentRunId?.trim()) throw new ActionGatewayError("sourceAgentRunId required");
  if (!input.actionType) throw new ActionGatewayError("actionType required");
  if (!input.targetSystem?.trim()) throw new ActionGatewayError("targetSystem required");
  if (!input.environment) throw new ActionGatewayError("environment required");
  if (!input.title?.trim()) throw new ActionGatewayError("title required");
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId?.trim() || "demo-workspace",
    workflowId: input.workflowId?.trim() || `workflow-${randomUUID()}`,
    sourceAgentName: input.sourceAgentName.trim(),
    sourceAgentRunId: input.sourceAgentRunId.trim(),
    actionType: input.actionType,
    targetSystem: input.targetSystem.trim(),
    ...(input.targetUrl?.trim() ? { targetUrl: input.targetUrl.trim() } : {}),
    environment: input.environment,
    title: input.title.trim(),
    description: input.description?.trim() || "",
    businessObjectType: input.businessObjectType?.trim() || "business_object",
    businessObjectId: input.businessObjectId?.trim() || `object-${randomUUID()}`,
    ...(typeof input.amount === "number" && Number.isFinite(input.amount)
      ? { amount: input.amount }
      : {}),
    ...(input.currency?.trim() ? { currency: input.currency.trim().toUpperCase() } : {}),
    ...(input.recipient?.trim() ? { recipient: input.recipient.trim() } : {}),
    ...(input.vendorName?.trim() ? { vendorName: input.vendorName.trim() } : {}),
    ...(input.beforeState ? { beforeState: input.beforeState } : {}),
    ...(input.proposedAfterState ? { proposedAfterState: input.proposedAfterState } : {}),
    fieldsChanged: input.fieldsChanged ?? [],
    ...(input.rawAgentReasoningSummary?.trim()
      ? { rawAgentReasoningSummary: input.rawAgentReasoningSummary.trim() }
      : {}),
    screenshots: input.screenshots ?? [],
    domSnapshotRefs: input.domSnapshotRefs ?? [],
    createdAt: now,
    status: "CAPTURED",
  };
}

function matchesFilters(
  action: ActionIntent,
  risk: RiskAssessment | undefined,
  filters: ActionListFilters,
): boolean {
  if (filters.status && action.status !== filters.status) return false;
  if (filters.actionType && action.actionType !== filters.actionType) return false;
  if (filters.sourceAgentName && action.sourceAgentName !== filters.sourceAgentName) {
    return false;
  }
  if (filters.riskLevel && risk?.riskLevel !== filters.riskLevel) return false;
  return true;
}

function getStoredAction(store: ActionGatewayState, id: string): ActionIntent {
  const action = store.actions.get(id);
  if (!action) throw new ActionGatewayError("Action not found", 404);
  if (action.status === "CANCELLED") {
    throw new ActionGatewayError("Action was cancelled by policy and cannot execute", 409);
  }
  if (action.status === "REJECTED") {
    throw new ActionGatewayError("Action was rejected and cannot execute", 409);
  }
  return action;
}

function addAuditEvent(
  store: ActionGatewayState,
  actionIntentId: string,
  input: Omit<AuditEvent, "id" | "actionIntentId" | "createdAt">,
): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(),
    actionIntentId,
    createdAt: new Date().toISOString(),
    ...input,
  };
  const list = store.auditEvents.get(actionIntentId) ?? [];
  list.push(event);
  store.auditEvents.set(actionIntentId, list);
  return event;
}

function diffStates(
  expected: Record<string, unknown>,
  observed: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(expected), ...Object.keys(observed)]);
  const differences: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(observed[key])) {
      differences.push(`${key}: expected ${formatValue(expected[key])}, observed ${formatValue(observed[key])}`);
    }
  }
  return differences;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

export function statusLabel(status: ActionIntentStatus): string {
  return status.replaceAll("_", " ").toLowerCase();
}
