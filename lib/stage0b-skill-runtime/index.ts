/**
 * Stage 0B Activity Provider Skill Runtime �?public no-live API.
 *
 * Pure helpers for the controlled Browser Harness lab documented in
 * docs/30-provider-debug/ACTIVITY_SKILL_LAB_RUNBOOK.md. None of these
 * symbols launch a browser, touch the network, or import Browser Harness.
 *
 * The lab runner script (`scripts/stage0b-activity-skill-lab.ts`) is the
 * only consumer that bridges to an external CLI; it imports from this
 * module to build / serialize / classify evidence and to read the
 * 20-URL plan. Cockpit / scorecard code consumes the same shapes
 * downstream by reading the JSONL evidence file the runner writes.
 */

export type {
  Stage0bLabProvider,
  LabAction,
  LabHardStopReason,
  LabVisibleFacts,
  LabOutcome,
  LabEvent,
  L2RecoveryClass,
  L2SafeNextAction,
  L2EvidenceBundle,
  L2RecoveryResult,
  SkillPatchKind,
  SkillPatchProposal,
  LabTestPlanEntry,
  Stage0bLabPlanName,
} from "./types";

export { STAGE0B_LAB_PROVIDERS } from "./types";

export {
  buildLabEvent,
  serializeLabEvent,
  parseLabEvent,
} from "./event-writer";

export {
  RECOVERY_OUTCOMES,
  STAGE0B_HARD_STOPS,
  buildL2RecoveryResult,
  safeNextActionFor,
  isHardStopOutcome,
  isSafeOutcome,
} from "./l2-recovery-result";

export { STAGE0B_TEST_PLAN, STAGE0B_PLAN_COUNTS } from "./test-plan";
export {
  TICKETMASTER_SKILL_FORGE_PLAN,
  TICKETMASTER_SKILL_FORGE_PLAN_COUNTS,
} from "./ticketmaster-forge-plan";
export {
  STUBHUB_SKILL_FORGE_PLAN,
  STUBHUB_SKILL_FORGE_PLAN_COUNTS,
} from "./stubhub-forge-plan";
export {
  EVENTBRITE_SKILL_FORGE_PLAN,
  EVENTBRITE_SKILL_FORGE_PLAN_COUNTS,
} from "./eventbrite-forge-plan";

export {
  STAGE0B_LAB_PLAN_REGISTRY,
  getAllStage0BLabPlanEntries,
  getStage0BLabPlanEntries,
  getStage0BLabPlanNames,
  isStage0BLabPlanName,
} from "./plan-registry";

export type {
  Stage0BLabPlanDefinition,
} from "./plan-registry";

export {
  STAGE0B_HARNESS_SENTINEL_END,
  STAGE0B_HARNESS_SENTINEL_START,
  buildBrowserHarnessPython,
} from "./harness-script";

export {
  parseStage0BLabRunnerArgs,
  selectStage0BLabEntries,
  parseBrowserHarnessPayload,
  buildStage0BLabResult,
  classifyStage0BOutcome,
  formatStage0BLabDryRun,
} from "./lab-runner";

export type {
  Stage0BLabRunnerArgs,
  BrowserHarnessPayload,
  Stage0BLabRunSummary,
} from "./lab-runner";

export {
  buildStage0BActivityLabEvidenceReport,
  buildStage0BActivityLabReportFromResults,
  findStage0BActivityLabResultPaths,
  parseStage0BActivityLabResultJson,
  renderStage0BActivityLabMarkdown,
} from "./lab-report";

export type {
  BuildStage0BActivityLabReportInput,
  ParsedStage0BActivityLabResult,
  Stage0BActivityLabBlocker,
  Stage0BActivityLabFileError,
  Stage0BActivityLabNextAction,
  Stage0BActivityLabOwner,
  Stage0BActivityLabPatchProposalSummary,
  Stage0BActivityLabPlanIdSource,
  Stage0BActivityLabPriority,
  Stage0BActivityLabReport,
  Stage0BActivityLabSummary,
} from "./lab-report";
