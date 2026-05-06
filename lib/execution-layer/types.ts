export type ExecutionLayer =
  | "provider_adapter"
  | "browser_harness"
  | "computer_use";

export type ExecutionStage =
  | "orchestrator_started"
  | "attempt_started"
  | "page_opened"
  | "stage_transition"
  | "before_action"
  | "after_action"
  | "executor_result"
  | "failure"
  | "layer_escalated"
  | "terminal_checkpoint"
  | "patch_proposal"
  | "layer_blocked";

export type ExecutionEventSeverity = "debug" | "info" | "warning" | "error";

export type ExecutorTerminalOutcome =
  | "success"
  | "safe_handoff"
  | "no_availability"
  | "login_required"
  | "otp_required"
  | "captcha_required"
  | "payment_boundary"
  | "provider_degraded"
  | "network_blocked"
  | "session_blocked"
  | "runtime_drift"
  | "model_env_blocked"
  | "unsafe_boundary"
  | "insufficient_evidence"
  | "failed_unknown";

export type LayerEscalationReason =
  | "selector_drift"
  | "progress_stall"
  | "iframe_miss"
  | "click_miss"
  | "field_fill_miss"
  | "unknown_page_mutation"
  | "provider_degraded"
  | "network_blocked"
  | "session_blocked"
  | "model_env_blocked"
  | "true_no_availability"
  | "unsafe_boundary"
  | "insufficient_evidence"
  | "policy_disabled";

export type ExecutionEvidenceKind =
  | "url"
  | "screenshot"
  | "dom_snapshot"
  | "html_snapshot"
  | "worker_log"
  | "decision_log"
  | "network_trace"
  | "provider_signal"
  | "browser_harness_jsonl"
  | "patch_proposal"
  | "operator_note";

export interface ExecutionEvidence {
  kind: ExecutionEvidenceKind;
  label: string;
  capturedAt?: string;
  path?: string;
  url?: string;
  value?: string;
  excerpt?: string;
  confidence?: "low" | "medium" | "high";
}

export interface ExecutionAttemptIdentity {
  taskId: string;
  jobId: string;
  attemptId: string;
  planVersion: number;
  provider: string;
  layer: ExecutionLayer;
}

export interface ExecutionAttempt extends ExecutionAttemptIdentity {
  sequence: number;
  startedAt: string;
  completedAt?: string;
}

export interface ExecutionEvent extends ExecutionAttemptIdentity {
  eventId: string;
  ts: string;
  stage: ExecutionStage;
  severity: ExecutionEventSeverity;
  message: string;
  terminalOutcome?: ExecutorTerminalOutcome;
  escalationReason?: LayerEscalationReason;
  nextLayer?: ExecutionLayer;
  evidence?: ExecutionEvidence[];
  details?: Record<string, unknown>;
}

export interface ExecutorResult {
  layer?: ExecutionLayer;
  terminalOutcome: ExecutorTerminalOutcome;
  message: string;
  evidence?: ExecutionEvidence[];
  escalationReason?: LayerEscalationReason;
  severity?: ExecutionEventSeverity;
  handoffUrl?: string;
  patchProposal?: unknown;
  details?: Record<string, unknown>;
}

export interface LayerPolicy {
  plannedLayers: readonly ExecutionLayer[];
  allowBrowserHarness: boolean;
  allowComputerUse: boolean;
  requireEvidenceForEscalation: boolean;
  runtimeDriftEscalationReasons: readonly LayerEscalationReason[];
  terminalWithoutEscalation: readonly ExecutorTerminalOutcome[];
  blockedWithoutEscalation: readonly ExecutorTerminalOutcome[];
}

export interface LayerEscalationRecord {
  fromLayer: ExecutionLayer;
  toLayer: ExecutionLayer;
  reason: LayerEscalationReason;
  message: string;
}

export interface LayerOrchestratorRun {
  finalResult: ExecutorResult;
  events: ExecutionEvent[];
  attempts: ExecutionAttempt[];
  invokedLayers: ExecutionLayer[];
  plannedLayers: readonly ExecutionLayer[];
  escalations: LayerEscalationRecord[];
}
