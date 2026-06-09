import type {
  ActionIntent,
  ApprovalRequest,
  AuditEvent,
  RiskAssessment,
  VerificationResult,
} from "@/lib/action-gateway/types";

export interface ActionGatewayState {
  actions: Map<string, ActionIntent>;
  risks: Map<string, RiskAssessment>;
  approvals: Map<string, ApprovalRequest>;
  verifications: Map<string, VerificationResult>;
  auditEvents: Map<string, AuditEvent[]>;
  mockObservedStates: Map<string, Record<string, unknown>>;
}

const globalForActionGateway = globalThis as typeof globalThis & {
  __onegentActionGatewayStore?: ActionGatewayState;
};

// MVP/demo-only storage. This is intentionally isolated from the existing
// travel/Postgres layer so local Action Gateway demos do not require real
// credentials, paid services, vendor systems, or irreversible actions.
export function getActionGatewayStore(): ActionGatewayState {
  if (!globalForActionGateway.__onegentActionGatewayStore) {
    globalForActionGateway.__onegentActionGatewayStore = {
      actions: new Map(),
      risks: new Map(),
      approvals: new Map(),
      verifications: new Map(),
      auditEvents: new Map(),
      mockObservedStates: new Map(),
    };
  }
  return globalForActionGateway.__onegentActionGatewayStore;
}

export function resetActionGatewayStore(): void {
  globalForActionGateway.__onegentActionGatewayStore = {
    actions: new Map(),
    risks: new Map(),
    approvals: new Map(),
    verifications: new Map(),
    auditEvents: new Map(),
    mockObservedStates: new Map(),
  };
}
