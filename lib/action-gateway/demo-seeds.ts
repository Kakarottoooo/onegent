import { captureActionIntent, resetActionGatewayDemoStore } from "@/lib/action-gateway/service";
import type { ActionReview, CreateActionIntentInput } from "@/lib/action-gateway/types";

export const PROCUREMENT_DEMO_TITLE =
  "Procurement agent wants to submit a $4,850 purchase order";

export function demoActionInputs(): CreateActionIntentInput[] {
  return [
    {
      sourceAgentName: "ProcurementPilot",
      sourceAgentRunId: "run-procurement-po-4850",
      actionType: "SUBMIT",
      targetSystem: "Demo ERP",
      environment: "staging",
      title: PROCUREMENT_DEMO_TITLE,
      description:
        "An AI procurement agent found a replacement part and wants to submit a purchase order.",
      businessObjectType: "purchase_order",
      businessObjectId: "PO-DEMO-4850",
      amount: 4850,
      currency: "USD",
      vendorName: "Acme Industrial Supply",
      beforeState: {
        poNumber: "PO-DEMO-4850",
        status: "DRAFT",
        vendor: "Acme Industrial Supply",
        amount: 4850,
      },
      proposedAfterState: {
        poNumber: "PO-DEMO-4850",
        status: "SUBMITTED",
        vendor: "Acme Industrial Supply",
        amount: 4850,
      },
      fieldsChanged: [{ field: "status", before: "DRAFT", after: "SUBMITTED" }],
      rawAgentReasoningSummary:
        "Replacement part is in stock at an approved vendor. Amount exceeds the approval threshold.",
    },
    {
      sourceAgentName: "OpsSubmitBot",
      sourceAgentRunId: "run-demo-submit-250",
      actionType: "SUBMIT",
      targetSystem: "Demo Vendor Portal",
      environment: "demo",
      title: "Submit a $250 demo maintenance request",
      businessObjectType: "maintenance_request",
      businessObjectId: "MR-DEMO-250",
      amount: 250,
      currency: "USD",
      vendorName: "Northwind Parts",
      beforeState: { status: "DRAFT", amount: 250 },
      proposedAfterState: { status: "SUBMITTED", amount: 250 },
      fieldsChanged: [{ field: "status", before: "DRAFT", after: "SUBMITTED" }],
      rawAgentReasoningSummary:
        "Low-value demo request in a demo environment can be mock-executed.",
    },
    {
      sourceAgentName: "InvoicePayAgent",
      sourceAgentRunId: "run-unknown-vendor-pay",
      actionType: "PAY",
      targetSystem: "Demo AP",
      environment: "staging",
      title: "Pay $3,200 invoice to unknown vendor",
      businessObjectType: "invoice",
      businessObjectId: "INV-UNKNOWN-3200",
      amount: 3200,
      currency: "USD",
      vendorName: "Unverified Vendor LLC",
      beforeState: { invoiceStatus: "PENDING", paymentStatus: "UNPAID" },
      proposedAfterState: { invoiceStatus: "PENDING", paymentStatus: "PAID" },
      fieldsChanged: [{ field: "paymentStatus", before: "UNPAID", after: "PAID" }],
      rawAgentReasoningSummary:
        "Invoice matched a PDF attachment, but the vendor is not approved.",
    },
    {
      sourceAgentName: "CustomerSuccessAgent",
      sourceAgentRunId: "run-external-email-send",
      actionType: "SEND",
      targetSystem: "Demo Email",
      environment: "staging",
      title: "Send contract change email to external customer",
      businessObjectType: "email",
      businessObjectId: "EMAIL-DEMO-EXTERNAL",
      recipient: "buyer@example-customer.com",
      beforeState: { status: "DRAFT" },
      proposedAfterState: { status: "SENT" },
      fieldsChanged: [{ field: "status", before: "DRAFT", after: "SENT" }],
      rawAgentReasoningSummary:
        "Agent drafted a high-importance email that changes contract terms.",
    },
    {
      sourceAgentName: "InventoryOpsAgent",
      sourceAgentRunId: "run-large-inventory-update",
      actionType: "UPDATE",
      targetSystem: "Demo Inventory",
      environment: "staging",
      title: "Update pump inventory quantity by more than 20%",
      businessObjectType: "inventory_item",
      businessObjectId: "SKU-PUMP-17",
      beforeState: { sku: "SKU-PUMP-17", quantity: 100 },
      proposedAfterState: { sku: "SKU-PUMP-17", quantity: 62 },
      fieldsChanged: [{ field: "quantity", before: 100, after: 62 }],
      rawAgentReasoningSummary:
        "Agent reconciled a stock count from a warehouse note and wants to update inventory.",
    },
  ];
}

export function seedDemoActions(options: { reset?: boolean } = {}): ActionReview[] {
  if (options.reset) resetActionGatewayDemoStore();
  return demoActionInputs().map((input) => captureActionIntent(input));
}
