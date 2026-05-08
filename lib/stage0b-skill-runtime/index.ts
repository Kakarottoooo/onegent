/**
 * Stage 0B Activity Provider Skill Runtime — public no-live API.
 *
 * Pure helpers for the controlled Browser Harness lab documented in
 * docs/30-provider-debug/STAGE0B_TM_SEATGEEK_LAB.md. None of these
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
  parseStage0BLabRunnerArgs,
  selectStage0BLabEntries,
  buildBrowserHarnessPython,
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
