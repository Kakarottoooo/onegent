import {
  DEFAULT_LAYER_POLICY,
  decideLayerTransition,
} from "./policy";
import type {
  ExecutionAttempt,
  ExecutionAttemptIdentity,
  ExecutionEvent,
  ExecutionLayer,
  ExecutorResult,
  LayerEscalationRecord,
  LayerOrchestratorRun,
  LayerPolicy,
} from "./types";

export interface LayerOrchestratorInput {
  identity: Omit<ExecutionAttemptIdentity, "layer">;
  results: readonly ExecutorResult[];
  policy?: LayerPolicy;
  now?: () => string;
}

export function runNoLiveLayerOrchestrator(
  input: LayerOrchestratorInput,
): LayerOrchestratorRun {
  const policy = input.policy ?? DEFAULT_LAYER_POLICY;
  const now = input.now ?? (() => new Date().toISOString());
  const events: ExecutionEvent[] = [];
  const attempts: ExecutionAttempt[] = [];
  const invokedLayers: ExecutionLayer[] = [];
  const escalations: LayerEscalationRecord[] = [];

  let layer: ExecutionLayer = "provider_adapter";
  let sequence = 0;
  let resultIndex = 0;
  let finalResult: ExecutorResult | null = null;

  events.push(
    makeEvent(input.identity, layer, events.length, now(), {
      stage: "orchestrator_started",
      severity: "info",
      message: "Execution Layer V2 no-live orchestrator started.",
      details: { plannedLayers: policy.plannedLayers },
    }),
  );

  while (true) {
    sequence += 1;
    invokedLayers.push(layer);
    attempts.push({
      ...input.identity,
      layer,
      sequence,
      startedAt: now(),
    });

    events.push(
      makeEvent(input.identity, layer, events.length, now(), {
        stage: "attempt_started",
        severity: "info",
        message: `Starting ${layer} execution attempt.`,
        details: { sequence },
      }),
    );

    const result = normalizeResultForLayer(
      layer,
      input.results[resultIndex],
    );
    resultIndex += 1;

    events.push(
      makeEvent(input.identity, layer, events.length, now(), {
        stage: result.terminalOutcome === "runtime_drift" ? "failure" : "executor_result",
        severity: result.severity ?? severityForOutcome(result.terminalOutcome),
        message: result.message,
        terminalOutcome: result.terminalOutcome,
        escalationReason: result.escalationReason,
        evidence: result.evidence,
        details: {
          ...(result.details ?? {}),
          handoffUrl: result.handoffUrl,
          hasPatchProposal: Boolean(result.patchProposal),
        },
      }),
    );

    attempts[attempts.length - 1].completedAt = now();

    const decision = decideLayerTransition(layer, result, policy);
    if (decision.action === "escalate" && decision.nextLayer) {
      escalations.push({
        fromLayer: layer,
        toLayer: decision.nextLayer,
        reason: decision.reason ?? "insufficient_evidence",
        message: decision.message,
      });
      events.push(
        makeEvent(input.identity, layer, events.length, now(), {
          stage: "layer_escalated",
          severity: "warning",
          message: decision.message,
          terminalOutcome: result.terminalOutcome,
          escalationReason: decision.reason ?? undefined,
          nextLayer: decision.nextLayer,
          evidence: result.evidence,
        }),
      );
      layer = decision.nextLayer;
      continue;
    }

    if (decision.action === "blocked") {
      events.push(
        makeEvent(input.identity, layer, events.length, now(), {
          stage: "layer_blocked",
          severity: "warning",
          message: decision.message,
          terminalOutcome: result.terminalOutcome,
          escalationReason: decision.reason ?? undefined,
          nextLayer: decision.nextLayer,
          evidence: result.evidence,
        }),
      );
    }

    events.push(
      makeEvent(input.identity, layer, events.length, now(), {
        stage: "terminal_checkpoint",
        severity: severityForOutcome(result.terminalOutcome),
        message: decision.message,
        terminalOutcome: result.terminalOutcome,
        escalationReason: decision.reason ?? undefined,
        evidence: result.evidence,
      }),
    );
    finalResult = result;
    break;
  }

  return {
    finalResult: finalResult ?? normalizeResultForLayer(layer, undefined),
    events,
    attempts,
    invokedLayers,
    plannedLayers: policy.plannedLayers,
    escalations,
  };
}

function normalizeResultForLayer(
  layer: ExecutionLayer,
  result: ExecutorResult | undefined,
): ExecutorResult {
  if (!result) {
    return {
      layer,
      terminalOutcome: "insufficient_evidence",
      severity: "error",
      message: `No mock executor result was provided for ${layer}.`,
      escalationReason: "insufficient_evidence",
      evidence: [],
    };
  }
  return {
    ...result,
    layer,
  };
}

function makeEvent(
  identity: Omit<ExecutionAttemptIdentity, "layer">,
  layer: ExecutionLayer,
  index: number,
  ts: string,
  event: Omit<
    ExecutionEvent,
    | "eventId"
    | "ts"
    | "taskId"
    | "jobId"
    | "attemptId"
    | "planVersion"
    | "provider"
    | "layer"
  >,
): ExecutionEvent {
  return {
    ...identity,
    layer,
    eventId: `${identity.jobId}:${identity.attemptId}:${layer}:${index}`,
    ts,
    ...event,
  };
}

function severityForOutcome(
  outcome: ExecutorResult["terminalOutcome"],
): ExecutionEvent["severity"] {
  switch (outcome) {
    case "success":
    case "safe_handoff":
    case "payment_boundary":
      return "info";
    case "no_availability":
    case "login_required":
    case "otp_required":
    case "captcha_required":
    case "provider_degraded":
    case "network_blocked":
    case "session_blocked":
    case "model_env_blocked":
    case "runtime_drift":
      return "warning";
    case "unsafe_boundary":
    case "insufficient_evidence":
    case "failed_unknown":
      return "error";
  }
}
