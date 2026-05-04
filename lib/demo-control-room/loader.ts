/**
 * Demo Control Room loader.
 *
 * Composes existing artifact loaders into a single snapshot the
 * `/dev/demo-control-room` server component renders. Each section is
 * graceful: when an artifact is missing, the snapshot still resolves
 * with `available: false` + a hint instead of throwing.
 *
 * Sources (read-only):
 *   - `benchmark/runs/phase1-quality-gate-*.json` via
 *     `lib/quality-gate/loader.ts`
 *   - `benchmark/runs/founder-e2e-*.json` via
 *     `lib/founder-e2e/loader.ts`
 *   - The `smoke:phase1` check inside the latest gate run
 *
 * No DB. No live runner. No worker. Pure orchestration over
 * already-shipped loaders.
 */

import {
  listQualityGateRunSummaries,
  readQualityGateRunByFile,
} from "@/lib/quality-gate/loader";
import type {
  GateCheck,
  GateStatus,
  GateVerdict,
  QualityGateRun,
  QualityGateRunSummary,
} from "@/lib/quality-gate/report";

import { listFounderE2eRunSummaries } from "@/lib/founder-e2e/loader";
import type { FounderRunSummary } from "@/lib/founder-e2e/loader";

import {
  PHASE_2_VERTICALS,
  summarizePhase2Posture,
  type Phase2Vertical,
} from "./phase2-status";

/* ------ Public types ---------------------------------------------------------------------------------------------------- */

export const DEMO_CONTROL_ROOM_SCHEMA_VERSION = 1 as const;

/** Smoke check pulled out of the latest gate's `checks[]`. */
export interface SmokeCheckSnapshot {
  /** True when the check appears in the latest gate. */
  present: boolean;
  /** Pass / fail / known_existing_failure / etc when present. */
  status: GateStatus | null;
  /** Severity when present. */
  severity: string | null;
  /** Duration ms when present. */
  durationMs: number | null;
  /** Friendly explanation rendered when smoke is absent. */
  hint: string;
  /** ID of the smoke check we look for (constant). */
  checkId: string;
}

export interface QualityGateSection {
  available: boolean;
  summary: QualityGateRunSummary | null;
  /** Path under `benchmark/runs/`; never absolute. */
  relPath: string | null;
  smoke: SmokeCheckSnapshot;
  /** Friendly hint when no run was found. */
  emptyHint: string;
}

export interface FounderE2eSection {
  available: boolean;
  summary: FounderRunSummary | null;
  /** Path under `benchmark/runs/`; never absolute. */
  relPath: string | null;
  /** Friendly hint when no run was found. */
  emptyHint: string;
}

export interface RuntimeForensicsLink {
  /** Always shown -?link, not data. */
  href: string;
  /** Helper note about what the linked dashboard does. */
  description: string;
}

export interface Phase2Section {
  posture: ReturnType<typeof summarizePhase2Posture>["posture"];
  postureLabel: string;
  verticals: ReadonlyArray<Phase2Vertical>;
}

export interface DemoControlRoomSnapshot {
  schemaVersion: typeof DEMO_CONTROL_ROOM_SCHEMA_VERSION;
  generatedAt: string;
  qualityGate: QualityGateSection;
  founderE2e: FounderE2eSection;
  runtimeForensics: RuntimeForensicsLink;
  phase2: Phase2Section;
  /** Loader-attached notes (graceful empty-state explanations). */
  notes: string[];
}

/* ------ Constants ---------------------------------------------------------------------------------------------------------- */

const SMOKE_CHECK_ID = "smoke:phase1";

const QUALITY_GATE_EMPTY_HINT =
  "No `phase1-quality-gate-*.json` artifacts in `benchmark/runs/`. " +
  "Run `npm run gate:phase1 -- --allow-known-drift` to produce one.";

const FOUNDER_E2E_EMPTY_HINT =
  "No `founder-e2e-*.json` artifacts in `benchmark/runs/`. " +
  "Run `npm run e2e:founder` (autonomous) or open `/dev/founder-e2e` " +
  "and complete a checklist run before the demo.";

const SMOKE_ABSENT_HINT =
  "Latest gate did not include the `smoke:phase1` check. " +
  "Re-run with `npm run gate:phase1 -- --include-smoke --allow-known-drift` " +
  "to produce a smoke verdict.";

const RUNTIME_FORENSICS_DESCRIPTION =
  "Read-only triage workbench for provider runtime failures. Use it after " +
  "a demo if the booking flow stalls -?it pre-classifies the failure " +
  "across 8 categories (legacy-shape, no-availability, OTP, checkout, " +
  "5xx, etc.) and surfaces a paste-ready bug report.";

/* ------ Public API -------------------------------------------------------------------------------------------------------- */

export async function loadDemoControlRoomSnapshot(options: {
  generatedAt?: string;
} = {}): Promise<DemoControlRoomSnapshot> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const notes: string[] = [];

  const qualityGate = await loadQualityGateSection(notes);
  const founderE2e = await loadFounderE2eSection(notes);
  const phase2 = buildPhase2Section();

  return {
    schemaVersion: DEMO_CONTROL_ROOM_SCHEMA_VERSION,
    generatedAt,
    qualityGate,
    founderE2e,
    runtimeForensics: {
      href: "/dev/runtime-forensics",
      description: RUNTIME_FORENSICS_DESCRIPTION,
    },
    phase2,
    notes,
  };
}

/* ------ Quality Gate ---------------------------------------------------------------------------------------------------- */

async function loadQualityGateSection(
  notes: string[],
): Promise<QualityGateSection> {
  let summaries: QualityGateRunSummary[] = [];
  try {
    summaries = await listQualityGateRunSummaries();
  } catch (err) {
    notes.push(
      `quality-gate listing failed: ${(err as Error).message}`.slice(0, 240),
    );
  }
  const latest = summaries[0] ?? null;
  if (!latest) {
    return {
      available: false,
      summary: null,
      relPath: null,
      smoke: emptySmokeSnapshot(),
      emptyHint: QUALITY_GATE_EMPTY_HINT,
    };
  }

  let fullRun: QualityGateRun | null = null;
  try {
    fullRun = await readQualityGateRunByFile(latest.fileName);
  } catch (err) {
    notes.push(
      `quality-gate read failed: ${(err as Error).message}`.slice(0, 240),
    );
  }

  return {
    available: true,
    summary: latest,
    relPath: `benchmark/runs/${latest.fileName}`,
    smoke: extractSmokeFromRun(fullRun),
    emptyHint: QUALITY_GATE_EMPTY_HINT,
  };
}

/** Pull the `smoke:phase1` check from a gate run's checks[]. */
export function extractSmokeFromRun(
  run: QualityGateRun | null,
): SmokeCheckSnapshot {
  if (!run || !Array.isArray(run.checks)) return emptySmokeSnapshot();
  const check = run.checks.find((c) => c?.id === SMOKE_CHECK_ID) ?? null;
  if (!check) return emptySmokeSnapshot();
  return {
    present: true,
    status: check.status as GateStatus,
    severity: typeof check.severity === "string" ? check.severity : null,
    durationMs:
      typeof check.durationMs === "number" ? check.durationMs : null,
    hint:
      "Smoke check present in latest gate. Re-run is cheap if you want " +
      "fresher evidence.",
    checkId: SMOKE_CHECK_ID,
  };
}

function emptySmokeSnapshot(): SmokeCheckSnapshot {
  return {
    present: false,
    status: null,
    severity: null,
    durationMs: null,
    hint: SMOKE_ABSENT_HINT,
    checkId: SMOKE_CHECK_ID,
  };
}

/* ------ Founder E2E ------------------------------------------------------------------------------------------------------ */

async function loadFounderE2eSection(
  notes: string[],
): Promise<FounderE2eSection> {
  let summaries: FounderRunSummary[] = [];
  try {
    summaries = await listFounderE2eRunSummaries();
  } catch (err) {
    notes.push(
      `founder-e2e listing failed: ${(err as Error).message}`.slice(0, 240),
    );
  }
  const latest = summaries[0] ?? null;
  if (!latest) {
    return {
      available: false,
      summary: null,
      relPath: null,
      emptyHint: FOUNDER_E2E_EMPTY_HINT,
    };
  }
  return {
    available: true,
    summary: latest,
    relPath: `benchmark/runs/${latest.file}`,
    emptyHint: FOUNDER_E2E_EMPTY_HINT,
  };
}

/* ------ Phase 2 -------------------------------------------------------------------------------------------------------------- */

function buildPhase2Section(): Phase2Section {
  const posture = summarizePhase2Posture();
  return {
    posture: posture.posture,
    postureLabel: posture.label,
    verticals: PHASE_2_VERTICALS,
  };
}

/* ------ Helpers -------------------------------------------------------------------------------------------------------------- */

/**
 * Convenience accessor for the verdict tone -?the dashboard uses
 * this to color-code each card. Pure function, exported for tests.
 */
export function verdictTone(
  verdict: GateVerdict | undefined | null,
): "good" | "warn" | "bad" | "neutral" {
  if (verdict === "pass") return "good";
  if (verdict === "needs_polish") return "warn";
  if (verdict === "fail") return "bad";
  if (verdict === "env_blocked") return "neutral";
  return "neutral";
}

/** Convenience: founder-e2e verdict tone. */
export function founderVerdictTone(
  verdict: FounderRunSummary["runnerVerdict"] | undefined | null,
): "good" | "warn" | "bad" | "neutral" {
  if (verdict === "pass") return "good";
  if (verdict === "needs_polish") return "warn";
  if (verdict === "fail") return "bad";
  return "neutral";
}

/** Pretty-format a duration in ms for display. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Re-export pickable check helper for tests. */
export type { GateCheck };
