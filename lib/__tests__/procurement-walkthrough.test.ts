import { beforeEach, describe, expect, it } from "vitest";
import { approveAction, rejectAction } from "@/lib/action-gateway/service";
import {
  generateActionAuditPacket,
  getProcurementWalkthroughState,
  resetProcurementWalkthroughDemo,
} from "@/lib/action-gateway/procurement-walkthrough";

beforeEach(() => {
  resetProcurementWalkthroughDemo();
});

describe("procurement walkthrough demo", () => {
  it("resets to a deterministic draft PO with a pending high-risk action", () => {
    const state = getProcurementWalkthroughState();

    expect(state.purchaseOrder.id).toBe("PO-DEMO-4850");
    expect(state.purchaseOrder.status).toBe("DRAFT");
    expect(state.purchaseOrder.vendor).toBe("Acme Industrial Supply");
    expect(state.purchaseOrder.vendorApproved).toBe(true);
    expect(state.review.action.sourceAgentName).toBe("ProcurementAgent");
    expect(state.review.action.status).toBe("NEEDS_REVIEW");
    expect(state.review.riskAssessment.riskLevel).toBe("HIGH");
    expect(state.review.riskAssessment.triggeredPolicies).toContain(
      "Purchase orders over $1,000 require human approval.",
    );
    expect(state.review.approvalRequest?.status).toBe("PENDING");
    expect(state.review.verificationResult).toBeUndefined();
  });

  it("approving updates only the local mock ERP PO and verifies the expected state", () => {
    const state = getProcurementWalkthroughState();
    const approved = approveAction({
      id: state.review.action.id,
      reviewerId: "demo-founder",
      reviewerComment: "Approved for the walkthrough.",
    });
    const after = getProcurementWalkthroughState();

    expect(after.purchaseOrder.status).toBe("SUBMITTED");
    expect(after.purchaseOrder.actionIntentId).toBe(approved.action.id);
    expect(approved.action.status).toBe("VERIFIED");
    expect(approved.verificationResult?.success).toBe(true);
    expect(approved.verificationResult?.verificationMethod).toBe("LOCAL_MOCK_ERP");
    expect(approved.verificationResult?.differences).toEqual([]);
    expect(approved.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "ACTION_CAPTURED",
        "RISK_ASSESSED",
        "POLICY_EVALUATED",
        "APPROVAL_REQUESTED",
        "ACTION_APPROVED",
        "MOCK_EXECUTION_STARTED",
        "MOCK_EXECUTION_COMPLETED",
        "VERIFICATION_PASSED",
      ]),
    );
  });

  it("rejecting leaves the mock ERP purchase order in draft and prevents execution", () => {
    const state = getProcurementWalkthroughState();
    const rejected = rejectAction({
      id: state.review.action.id,
      reviewerId: "demo-founder",
      reviewerComment: "Rejected during walkthrough.",
    });
    const after = getProcurementWalkthroughState();

    expect(rejected.action.status).toBe("REJECTED");
    expect(rejected.approvalRequest?.status).toBe("REJECTED");
    expect(after.purchaseOrder.status).toBe("DRAFT");
    expect(rejected.verificationResult).toBeUndefined();
    expect(rejected.auditEvents.map((event) => event.eventType)).not.toContain(
      "MOCK_EXECUTION_COMPLETED",
    );
  });

  it("exports a demo audit packet and records packet generation", () => {
    const state = getProcurementWalkthroughState();
    approveAction({ id: state.review.action.id, reviewerId: "demo-founder" });

    const packet = generateActionAuditPacket(state.review.action.id);

    expect(packet.demo).toBe(true);
    expect(packet.product).toBe("Onegent Action Gateway");
    expect(packet.scenario).toBe("Procurement PO Approval");
    expect(packet.actionIntent.businessObjectId).toBe("PO-DEMO-4850");
    expect(packet.execution.method).toBe("LOCAL_MOCK_ERP");
    expect(packet.verificationResult?.success).toBe(true);
    expect(packet.disclaimer).toContain("No real external action was performed");
    expect(packet.auditEvents.map((event) => event.eventType)).toContain(
      "AUDIT_PACKET_GENERATED",
    );
  });
});
