import type {
  ExecutionAttemptIdentity,
  ExecutionEventSeverity,
  ExecutionEvidence,
  ExecutionStage,
  LayerEscalationReason,
} from "./types";

export const BROWSER_HARNESS_CONTRACT_VERSION = 1 as const;

export type BrowserHarnessJsonlEventType =
  | "harness_started"
  | "page_opened"
  | "stage_changed"
  | "before_action"
  | "after_action"
  | "failure"
  | "patch_proposal"
  | "terminal_checkpoint";

export interface BrowserHarnessJsonlEvent
  extends Omit<ExecutionAttemptIdentity, "layer"> {
  schemaVersion: typeof BROWSER_HARNESS_CONTRACT_VERSION;
  bridge: "browser_harness_jsonl";
  layer: "browser_harness";
  eventId: string;
  ts: string;
  type: BrowserHarnessJsonlEventType;
  stage: ExecutionStage;
  severity: ExecutionEventSeverity;
  message: string;
  url?: string;
  action?: {
    kind: "click" | "fill" | "select" | "wait" | "navigate" | "observe";
    target?: string;
    valueRedacted?: string;
  };
  evidence?: ExecutionEvidence[];
  patchProposal?: BrowserHarnessPatchProposal;
  raw?: Record<string, unknown>;
}

export interface BrowserHarnessSelectorDiscovery {
  name: string;
  selector: string;
  strategy: "css" | "role" | "text" | "xpath" | "frame_locator" | "visual";
  confidence: "low" | "medium" | "high";
  evidenceRefs: string[];
}

export interface BrowserHarnessSuggestedTest {
  name: string;
  fileHint: string;
  assertion: string;
}

export interface BrowserHarnessPatchProposal {
  schemaVersion: typeof BROWSER_HARNESS_CONTRACT_VERSION;
  proposalId: string;
  createdAt: string;
  provider: string;
  targetStage: string;
  driftClass: Extract<
    LayerEscalationReason,
    | "selector_drift"
    | "progress_stall"
    | "iframe_miss"
    | "click_miss"
    | "field_fill_miss"
    | "unknown_page_mutation"
  >;
  discoveredSelectors: BrowserHarnessSelectorDiscovery[];
  strategy: string;
  evidence: ExecutionEvidence[];
  suggestedTests: BrowserHarnessSuggestedTest[];
  canAutoApply: false;
  productionMutation: "forbidden";
  rationale: string;
}

export interface BrowserHarnessBridgeCommand {
  command: "start_browser_harness";
  schemaVersion: typeof BROWSER_HARNESS_CONTRACT_VERSION;
  cwd: string;
  jobId: string;
  stdinJsonl: true;
  stdoutJsonl: true;
  noLiveProviderRun: true;
}

export function createBrowserHarnessPatchProposal(
  input: Omit<
    BrowserHarnessPatchProposal,
    "schemaVersion" | "proposalId" | "createdAt" | "canAutoApply" | "productionMutation"
  > & {
    proposalId?: string;
    createdAt?: string;
  },
): BrowserHarnessPatchProposal {
  return {
    schemaVersion: BROWSER_HARNESS_CONTRACT_VERSION,
    proposalId:
      input.proposalId ??
      `bhp-${input.provider}-${input.targetStage}`.replace(/[^a-z0-9_-]+/gi, "-"),
    createdAt: input.createdAt ?? new Date().toISOString(),
    provider: input.provider,
    targetStage: input.targetStage,
    driftClass: input.driftClass,
    discoveredSelectors: input.discoveredSelectors,
    strategy: input.strategy,
    evidence: input.evidence,
    suggestedTests: input.suggestedTests,
    canAutoApply: false,
    productionMutation: "forbidden",
    rationale: input.rationale,
  };
}

export function assertBrowserHarnessPatchProposalSafe(
  proposal: BrowserHarnessPatchProposal,
): void {
  if (proposal.canAutoApply !== false) {
    throw new Error("Browser Harness patch proposals must never auto-apply.");
  }
  if (proposal.productionMutation !== "forbidden") {
    throw new Error("Browser Harness patch proposals must not mutate provider code.");
  }
}
