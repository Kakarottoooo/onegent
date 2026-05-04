/**
 * Public surface for the Quality Gate module.
 *
 * Pure logic + types: import from `lib/quality-gate/report` (no fs,
 * usable in client components, edge functions, tests).
 *
 * Filesystem operations: import from `lib/quality-gate/loader`
 * (server-only — uses node:fs).
 *
 * The combined re-export here is for convenience in the runner +
 * dev API + tests. Don't import this barrel from a client
 * component (it'll pull node:fs into the bundle).
 */

export * from "./report";
// loader has the same `fileNameFromRunId` re-exported from report.
// Tell TS we want loader's *other* symbols, not the alias collision.
export {
  getQualityGateRunsDir,
  resolveSafeRunPath,
  QualityGateLoaderError,
  listQualityGateRunSummaries,
  readQualityGateSummary,
  readQualityGateRunByFile,
  saveQualityGateRun,
  saveQualityGateMarkdown,
} from "./loader";
export * from "./runner-helpers";
