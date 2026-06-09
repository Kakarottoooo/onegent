# Action Gateway API Example

This is the minimal integration shape for another AI agent. It is intentionally
not a full SDK.

```ts
async function submitHighRiskActionToOnegent() {
  const action = {
    sourceAgentName: "ProcurementPilot",
    sourceAgentRunId: "run-2026-06-09-001",
    actionType: "SUBMIT",
    targetSystem: "Demo ERP",
    environment: "staging",
    title: "Procurement agent wants to submit a $4,850 purchase order",
    description: "Replacement part purchase order prepared by an AI agent.",
    businessObjectType: "purchase_order",
    businessObjectId: "PO-DEMO-4850",
    amount: 4850,
    currency: "USD",
    vendorName: "Acme Industrial Supply",
    beforeState: {
      poNumber: "PO-DEMO-4850",
      status: "DRAFT",
      amount: 4850,
    },
    proposedAfterState: {
      poNumber: "PO-DEMO-4850",
      status: "SUBMITTED",
      amount: 4850,
    },
    fieldsChanged: [
      { field: "status", before: "DRAFT", after: "SUBMITTED" },
    ],
    rawAgentReasoningSummary:
      "Approved vendor, replacement part in stock, amount exceeds approval threshold.",
  };

  const capture = await fetch("http://localhost:3000/api/action-gateway/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  }).then((res) => res.json());

  if (!capture.ok) throw new Error(capture.error);

  const review = capture.review;
  if (review.blocked) {
    return { proceed: false, reason: "Onegent blocked the action by policy." };
  }

  if (review.approvalRequest?.status === "PENDING") {
    return {
      proceed: false,
      reason: "Waiting for human approval in Onegent.",
      actionId: review.action.id,
      reviewUrl: `/action-gateway/actions/${review.action.id}`,
    };
  }

  if (review.action.status === "VERIFIED") {
    return { proceed: true, actionId: review.action.id };
  }

  return { proceed: false, reason: `Unhandled status: ${review.action.status}` };
}
```

Agent-side rule:

```text
Never touch a real system after a high-risk action is captured unless Onegent
returns an approved and verified state for the intended action, or the human
explicitly takes over.
```

Current MVP limitation: approval, execution, and verification are demo/mock only.
