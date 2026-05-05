/**
 * Provider Closure Operator Room - barrel re-export.
 *
 * Pure module - no fs side effects at import time. Imported by the
 * `/dev/provider-closure` server component, the loader's tests, and
 * the lane manifest tests.
 */

export {
  PROVIDER_LANES,
  getProviderLane,
  laneTaxonomyClassesAreKnown,
  listProviderLanes,
} from "./lanes";

export {
  loadProviderClosureRoomSnapshot,
  summarizeArtifactsForLane,
} from "./loader";

export type {
  CliCommandBlock,
  EvidenceRequirement,
  HardStop,
  InspectAfterRun,
  LaneArtifactSummary,
  LaneReference,
  LaneTone,
  NextAllowedAction,
  OperatorChecklistLink,
  ProviderClosureRoomSnapshot,
  ProviderClosureTerminalOutcome,
  ProviderLane,
  ProviderLaneId,
  ProviderLaneSnapshot,
} from "./types";
