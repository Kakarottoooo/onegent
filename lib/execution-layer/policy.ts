import type {
  ExecutionLayer,
  ExecutorResult,
  ExecutorTerminalOutcome,
  LayerEscalationReason,
  LayerPolicy,
} from "./types";

export const RUNTIME_DRIFT_ESCALATION_REASONS = [
  "selector_drift",
  "progress_stall",
  "iframe_miss",
  "click_miss",
  "field_fill_miss",
  "unknown_page_mutation",
] as const satisfies readonly LayerEscalationReason[];

export const TERMINAL_OUTCOMES_WITHOUT_ESCALATION = [
  "success",
  "safe_handoff",
  "no_availability",
  "login_required",
  "otp_required",
  "captcha_required",
  "payment_boundary",
  "unsafe_boundary",
] as const satisfies readonly ExecutorTerminalOutcome[];

export const BLOCKED_OUTCOMES_WITHOUT_ESCALATION = [
  "provider_degraded",
  "network_blocked",
  "session_blocked",
  "model_env_blocked",
] as const satisfies readonly ExecutorTerminalOutcome[];

export const DEFAULT_LAYER_POLICY: LayerPolicy = {
  plannedLayers: ["provider_adapter", "browser_harness", "computer_use"],
  allowBrowserHarness: true,
  allowComputerUse: false,
  requireEvidenceForEscalation: true,
  runtimeDriftEscalationReasons: RUNTIME_DRIFT_ESCALATION_REASONS,
  terminalWithoutEscalation: TERMINAL_OUTCOMES_WITHOUT_ESCALATION,
  blockedWithoutEscalation: BLOCKED_OUTCOMES_WITHOUT_ESCALATION,
};

export interface LayerPolicyDecision {
  action: "stop" | "escalate" | "blocked";
  reason: LayerEscalationReason | null;
  nextLayer?: ExecutionLayer;
  message: string;
}

export function classifyEscalationReason(
  result: ExecutorResult,
): LayerEscalationReason | null {
  if (result.escalationReason) return result.escalationReason;
  switch (result.terminalOutcome) {
    case "no_availability":
      return "true_no_availability";
    case "provider_degraded":
      return "provider_degraded";
    case "network_blocked":
      return "network_blocked";
    case "session_blocked":
      return "session_blocked";
    case "model_env_blocked":
      return "model_env_blocked";
    case "unsafe_boundary":
      return "unsafe_boundary";
    case "insufficient_evidence":
    case "failed_unknown":
      return "insufficient_evidence";
    default:
      return null;
  }
}

export function hasEscalationEvidence(result: ExecutorResult): boolean {
  return (result.evidence ?? []).some((evidence) => {
    return Boolean(
      evidence.path ??
        evidence.url ??
        evidence.value ??
        evidence.excerpt ??
        evidence.label,
    );
  });
}

export function isRuntimeDriftReason(
  reason: LayerEscalationReason | null | undefined,
  policy: LayerPolicy = DEFAULT_LAYER_POLICY,
): boolean {
  return Boolean(
    reason && policy.runtimeDriftEscalationReasons.includes(reason),
  );
}

export function decideLayerTransition(
  layer: ExecutionLayer,
  result: ExecutorResult,
  policy: LayerPolicy = DEFAULT_LAYER_POLICY,
): LayerPolicyDecision {
  const reason = classifyEscalationReason(result);

  if (policy.terminalWithoutEscalation.includes(result.terminalOutcome)) {
    return {
      action: "stop",
      reason,
      message: `${result.terminalOutcome} is terminal for ${layer}.`,
    };
  }

  if (policy.blockedWithoutEscalation.includes(result.terminalOutcome)) {
    return {
      action: "stop",
      reason,
      message: `${result.terminalOutcome} is classified evidence, not an executor drift escalation.`,
    };
  }

  if (
    result.terminalOutcome !== "runtime_drift" ||
    !isRuntimeDriftReason(reason, policy)
  ) {
    return {
      action: "stop",
      reason: reason ?? "insufficient_evidence",
      message: `${result.terminalOutcome} is not eligible for automatic layer escalation.`,
    };
  }

  if (policy.requireEvidenceForEscalation && !hasEscalationEvidence(result)) {
    return {
      action: "stop",
      reason: "insufficient_evidence",
      message: "Runtime drift was reported without supporting evidence.",
    };
  }

  if (layer === "provider_adapter") {
    if (!policy.allowBrowserHarness) {
      return {
        action: "blocked",
        reason: "policy_disabled",
        nextLayer: "browser_harness",
        message: "Browser Harness escalation is represented but disabled by policy.",
      };
    }
    return {
      action: "escalate",
      reason,
      nextLayer: "browser_harness",
      message: `Escalating provider adapter drift to Browser Harness: ${reason}.`,
    };
  }

  if (layer === "browser_harness") {
    if (!policy.allowComputerUse) {
      return {
        action: "blocked",
        reason: "policy_disabled",
        nextLayer: "computer_use",
        message: "Computer Use route is represented for future L3 but disabled in the no-live skeleton.",
      };
    }
    return {
      action: "escalate",
      reason,
      nextLayer: "computer_use",
      message: `Escalating Browser Harness drift to Computer Use: ${reason}.`,
    };
  }

  return {
    action: "stop",
    reason: "policy_disabled",
    message: "Computer Use is terminal in this no-live skeleton.",
  };
}
