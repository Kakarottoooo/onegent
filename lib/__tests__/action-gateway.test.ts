import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAction,
  captureActionIntent,
  rejectAction,
  resetActionGatewayDemoStore,
  verifyAction,
} from "@/lib/action-gateway/service";
import type { CreateActionIntentInput } from "@/lib/action-gateway/types";

beforeEach(() => {
  resetActionGatewayDemoStore();
});

function baseAction(overrides: Partial<CreateActionIntentInput> = {}): CreateActionIntentInput {
  return {
    sourceAgentName: "TestAgent",
    sourceAgentRunId: "run-test",
    actionType: "SUBMIT",
    targetSystem: "Demo ERP",
    environment: "demo",
    title: "Submit demo action",
    businessObjectType: "purchase_order",
    businessObjectId: "PO-1",
    beforeState: { status: "DRAFT" },
    proposedAfterState: { status: "SUBMITTED" },
    fieldsChanged: [{ field: "status", before: "DRAFT", after: "SUBMITTED" }],
    ...overrides,
  };
}

describe("Action Gateway MVP policy and verification flow", () => {
  it("requires approval for PAY actions over 1000", () => {
    const review = captureActionIntent(baseAction({
      actionType: "PAY",
      amount: 1250,
      currency: "USD",
      vendorName: "Acme Industrial Supply",
      title: "Pay approved vendor invoice",
    }));

    expect(review.action.status).toBe("NEEDS_REVIEW");
    expect(review.riskAssessment.riskLevel).toBe("HIGH");
    expect(review.approvalRequest?.status).toBe("PENDING");
    expect(review.riskAssessment.triggeredPolicies).toContain(
      "Require approval for high-value actions over $1,000",
    );
  });

  it("requires approval for production environment actions", () => {
    const review = captureActionIntent(baseAction({
      environment: "production",
      amount: 100,
      title: "Submit production record update",
    }));

    expect(review.action.status).toBe("NEEDS_REVIEW");
    expect(review.approvalRequest?.status).toBe("PENDING");
    expect(review.riskAssessment.triggeredPolicies).toContain(
      "Require approval for all production actions",
    );
  });

  it("blocks payments to unknown vendors before execution", () => {
    const review = captureActionIntent(baseAction({
      actionType: "PAY",
      amount: 3200,
      currency: "USD",
      vendorName: "Unknown Vendor LLC",
      title: "Pay unknown vendor",
    }));

    expect(review.action.status).toBe("CANCELLED");
    expect(review.blocked).toBe(true);
    expect(review.approvalRequest).toBeUndefined();
    expect(review.verificationResult).toBeUndefined();
    expect(review.auditEvents.map((event) => event.eventType)).toContain("ACTION_CANCELLED");
  });

  it("requires approval for external SEND actions", () => {
    const review = captureActionIntent(baseAction({
      actionType: "SEND",
      targetSystem: "Demo Email",
      title: "Send external email",
      recipient: "customer@example.com",
      businessObjectType: "email",
      businessObjectId: "EMAIL-1",
    }));

    expect(review.action.status).toBe("NEEDS_REVIEW");
    expect(review.approvalRequest?.status).toBe("PENDING");
    expect(review.riskAssessment.triggeredPolicies).toContain(
      "Require approval for external emails",
    );
  });

  it("requires approval for inventory updates over 20 percent", () => {
    const review = captureActionIntent(baseAction({
      actionType: "UPDATE",
      targetSystem: "Demo Inventory",
      title: "Update inventory count",
      businessObjectType: "inventory_item",
      businessObjectId: "SKU-1",
      beforeState: { quantity: 100 },
      proposedAfterState: { quantity: 72 },
      fieldsChanged: [{ field: "quantity", before: 100, after: 72 }],
    }));

    expect(review.action.status).toBe("NEEDS_REVIEW");
    expect(review.approvalRequest?.status).toBe("PENDING");
    expect(review.riskAssessment.triggeredPolicies).toContain(
      "Require approval for inventory updates greater than 20%",
    );
  });

  it("allows low-risk demo SUBMIT actions through mock execution and verification", () => {
    const review = captureActionIntent(baseAction({
      amount: 250,
      vendorName: "Northwind Parts",
      title: "Submit low-risk demo request",
    }));

    expect(review.action.status).toBe("VERIFIED");
    expect(review.approvalRequest).toBeUndefined();
    expect(review.verificationResult?.success).toBe(true);
    expect(review.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "ACTION_APPROVED",
        "MOCK_EXECUTION_STARTED",
        "MOCK_EXECUTION_COMPLETED",
        "VERIFICATION_PASSED",
      ]),
    );
  });

  it("approving an action creates audit events and mock execution", () => {
    const captured = captureActionIntent(baseAction({
      amount: 4850,
      vendorName: "Acme Industrial Supply",
      title: "Procurement agent wants to submit a $4,850 purchase order",
    }));

    const approved = approveAction({
      id: captured.action.id,
      reviewerId: "ops-lead",
      reviewerComment: "Approved for demo submission.",
    });

    expect(approved.action.status).toBe("VERIFIED");
    expect(approved.approvalRequest?.status).toBe("APPROVED");
    expect(approved.verificationResult?.success).toBe(true);
    expect(approved.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "ACTION_APPROVED",
        "MOCK_EXECUTION_STARTED",
        "MOCK_EXECUTION_COMPLETED",
        "VERIFICATION_PASSED",
      ]),
    );
  });

  it("rejecting an action prevents mock execution", () => {
    const captured = captureActionIntent(baseAction({
      amount: 4850,
      vendorName: "Acme Industrial Supply",
      title: "High-value PO",
    }));

    const rejected = rejectAction({
      id: captured.action.id,
      reviewerComment: "Vendor paperwork needs review first.",
    });

    expect(rejected.action.status).toBe("REJECTED");
    expect(rejected.approvalRequest?.status).toBe("REJECTED");
    expect(rejected.verificationResult).toBeUndefined();
    expect(rejected.auditEvents.map((event) => event.eventType)).not.toContain(
      "MOCK_EXECUTION_STARTED",
    );
  });

  it("verification passes when expected state matches observed state", () => {
    const review = captureActionIntent(baseAction({
      amount: 250,
      vendorName: "Northwind Parts",
      proposedAfterState: { status: "SUBMITTED", amount: 250 },
    }));

    const verified = verifyAction(review.action.id, { status: "SUBMITTED", amount: 250 });

    expect(verified.action.status).toBe("VERIFIED");
    expect(verified.verificationResult?.success).toBe(true);
    expect(verified.verificationResult?.differences).toHaveLength(0);
  });

  it("verification fails when observed state differs", () => {
    const review = captureActionIntent(baseAction({
      amount: 250,
      vendorName: "Northwind Parts",
      proposedAfterState: { status: "SUBMITTED", amount: 250 },
    }));

    const verified = verifyAction(review.action.id, { status: "DRAFT", amount: 250 });

    expect(verified.action.status).toBe("FAILED_VERIFICATION");
    expect(verified.verificationResult?.success).toBe(false);
    expect(verified.verificationResult?.differences[0]).toContain("status");
  });
});
