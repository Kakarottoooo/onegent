import { getActionGatewayStore } from "@/lib/action-gateway/store";
import type { ActionIntent, MockPurchaseOrder } from "@/lib/action-gateway/types";

export const PROCUREMENT_DEMO_PO_ID = "PO-DEMO-4850";

export function createDraftProcurementDemoPurchaseOrder(now = new Date().toISOString()): MockPurchaseOrder {
  const purchaseOrder: MockPurchaseOrder = {
    id: PROCUREMENT_DEMO_PO_ID,
    vendor: "Acme Industrial Supply",
    amount: 4850,
    currency: "USD",
    status: "DRAFT",
    vendorApproved: true,
    lineItem: "Replacement motor for Line 3",
    lastUpdatedAt: now,
  };
  getActionGatewayStore().mockPurchaseOrders.set(purchaseOrder.id, purchaseOrder);
  return purchaseOrder;
}

export function getMockPurchaseOrder(id: string): MockPurchaseOrder | undefined {
  return getActionGatewayStore().mockPurchaseOrders.get(id);
}

export function isMockProcurementAction(action: ActionIntent): boolean {
  const objectType = action.businessObjectType.toLowerCase().replaceAll("_", "");
  return action.targetSystem === "Mock ERP" && objectType === "purchaseorder";
}

export function executeMockProcurementSubmission(action: ActionIntent): {
  previousState: Record<string, unknown>;
  observedState: Record<string, unknown>;
} | null {
  if (!isMockProcurementAction(action)) return null;
  const store = getActionGatewayStore();
  const existing = store.mockPurchaseOrders.get(action.businessObjectId);
  if (!existing) return null;

  const previousState = purchaseOrderToVerificationState(existing);
  const updated: MockPurchaseOrder = {
    ...existing,
    status: "SUBMITTED",
    actionIntentId: action.id,
    lastUpdatedAt: new Date().toISOString(),
  };
  store.mockPurchaseOrders.set(updated.id, updated);
  return {
    previousState,
    observedState: purchaseOrderToVerificationState(updated),
  };
}

export function purchaseOrderToVerificationState(
  purchaseOrder: MockPurchaseOrder,
): Record<string, unknown> {
  return {
    poNumber: purchaseOrder.id,
    status: purchaseOrder.status,
    vendor: purchaseOrder.vendor,
    amount: purchaseOrder.amount,
    currency: purchaseOrder.currency,
    vendorApproved: purchaseOrder.vendorApproved,
    lineItem: purchaseOrder.lineItem,
  };
}
