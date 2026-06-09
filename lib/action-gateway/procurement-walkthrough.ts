import { randomUUID } from "crypto";
import {
  createDraftProcurementDemoPurchaseOrder,
  getMockPurchaseOrder,
  PROCUREMENT_DEMO_PO_ID,
  purchaseOrderToVerificationState,
} from "@/lib/action-gateway/mock-procurement";
import {
  captureActionIntent,
  getActionReview,
  resetActionGatewayDemoStore,
} from "@/lib/action-gateway/service";
import { getActionGatewayStore } from "@/lib/action-gateway/store";
import type {
  ActionAuditPacket,
  ActionExecutionSummary,
  ActionReview,
  AuditEvent,
  MockPurchaseOrder,
} from "@/lib/action-gateway/types";

export interface ProcurementWalkthroughState {
  purchaseOrder: MockPurchaseOrder;
  review: ActionReview;
}

export function resetProcurementWalkthroughDemo(): ProcurementWalkthroughState {
  resetActionGatewayDemoStore();
  const purchaseOrder = createDraftProcurementDemoPurchaseOrder();
  const review = captureActionIntent({
    workspaceId: "procurement-walkthrough",
    workflowId: "procurement-po-approval",
    sourceAgentName: "ProcurementAgent",
    sourceAgentRunId: "run-procurement-po-4850",
    actionType: "SUBMIT",
    targetSystem: "Mock ERP",
    environment: "demo",
    title: "Procurement agent wants to submit a $4,850 purchase order",
    description:
      "Local deterministic walkthrough action. No external system is contacted.",
    businessObjectType: "PurchaseOrder",
    businessObjectId: purchaseOrder.id,
    amount: purchaseOrder.amount,
    currency: purchaseOrder.currency,
    vendorName: purchaseOrder.vendor,
    beforeState: purchaseOrderToVerificationState(purchaseOrder),
    proposedAfterState: {
      ...purchaseOrderToVerificationState(purchaseOrder),
      status: "SUBMITTED",
    },
    fieldsChanged: [{ field: "status", before: "DRAFT", after: "SUBMITTED" }],
    rawAgentReasoningSummary:
      "Replacement motor needed for Line 3 by Friday. Vendor is approved. Lead time meets requirement. Amount exceeds approval threshold.",
  });
  getActionGatewayStore().mockPurchaseOrders.set(purchaseOrder.id, {
    ...purchaseOrder,
    actionIntentId: review.action.id,
  });
  return getProcurementWalkthroughState();
}

export function getProcurementWalkthroughState(): ProcurementWalkthroughState {
  return getExistingProcurementWalkthroughState() ?? resetProcurementWalkthroughDemo();
}

export function getExistingProcurementWalkthroughState(): ProcurementWalkthroughState | null {
  const purchaseOrder = getMockPurchaseOrder(PROCUREMENT_DEMO_PO_ID);
  if (!purchaseOrder?.actionIntentId) {
    return null;
  }
  return {
    purchaseOrder,
    review: getActionReview(purchaseOrder.actionIntentId),
  };
}

export function generateActionAuditPacket(actionIntentId: string): ActionAuditPacket {
  recordAuditPacketGenerated(actionIntentId);
  const review = getActionReview(actionIntentId);
  return {
    demo: true,
    product: "Onegent Action Gateway",
    scenario: "Procurement PO Approval",
    actionIntent: review.action,
    riskAssessment: review.riskAssessment,
    triggeredPolicies: review.riskAssessment.triggeredPolicies,
    approvalRequest: review.approvalRequest,
    execution: buildExecutionSummary(review),
    verificationResult: review.verificationResult,
    auditEvents: review.auditEvents,
    disclaimer:
      "This packet was generated from a local demo. No real external action was performed.",
  };
}

function recordAuditPacketGenerated(actionIntentId: string): AuditEvent {
  const store = getActionGatewayStore();
  if (!store.actions.has(actionIntentId)) {
    throw new Error("Action not found");
  }
  const event: AuditEvent = {
    id: randomUUID(),
    actionIntentId,
    eventType: "AUDIT_PACKET_GENERATED",
    actorType: "SYSTEM",
    actorId: "audit-packet-builder",
    message: "Audit packet generated for demo review.",
    metadata: { demo: true, scenario: "Procurement PO Approval" },
    createdAt: new Date().toISOString(),
  };
  const list = store.auditEvents.get(actionIntentId) ?? [];
  list.push(event);
  store.auditEvents.set(actionIntentId, list);
  return event;
}

function buildExecutionSummary(review: ActionReview): ActionExecutionSummary {
  const completed = review.auditEvents.find((event) => event.eventType === "MOCK_EXECUTION_COMPLETED");
  const started = review.auditEvents.find((event) => event.eventType === "MOCK_EXECUTION_STARTED");
  return {
    method: review.action.targetSystem === "Mock ERP" ? "LOCAL_MOCK_ERP" : "MOCK",
    status: completed ? "COMPLETED" : "NOT_EXECUTED",
    targetSystem: review.action.targetSystem,
    previousState: started?.metadata?.previousState as Record<string, unknown> | undefined,
    observedState: (completed?.metadata?.observedState ??
      review.verificationResult?.observedState) as Record<string, unknown> | undefined,
  };
}
