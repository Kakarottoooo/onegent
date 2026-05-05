/**
 * Provider Closure Operator Room - artifact-graceful loader.
 *
 * Composes the static lane manifest with read-only artifact counts
 * pulled from `benchmark/runs/`. The loader never:
 *
 *   - reads the database;
 *   - reads `.env.local`;
 *   - opens a browser;
 *   - starts a worker;
 *   - navigates a provider;
 *   - calls OpenAI;
 *   - imports `lib/live-operator-checklist/**` (which may be unmerged).
 *
 * If the artifacts directory is missing or empty, every section
 * resolves with `available: false` plus a friendly hint instead of
 * throwing. The cockpit is required to render even with zero
 * artifacts.
 */

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

import { listProviderLanes } from "./lanes";

import type {
  LaneArtifactSummary,
  LaneTone,
  OperatorChecklistLink,
  ProviderClosureRoomSnapshot,
  ProviderLane,
  ProviderLaneId,
  ProviderLaneSnapshot,
} from "./types";

/* ------ Public API -------------------------------------------------------------------------------------------------------- */

export interface LoadOptions {
  /** Override for tests; defaults to `new Date().toISOString()`. */
  generatedAt?: string;
  /** Override the benchmark runs dir (used by tests). */
  benchmarkRunsDir?: string;
  /** Override the dev page existence probe. */
  checklistPagePath?: string;
}

export async function loadProviderClosureRoomSnapshot(
  options: LoadOptions = {},
): Promise<ProviderClosureRoomSnapshot> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const notes: string[] = [];

  const dir =
    options.benchmarkRunsDir ??
    path.resolve(process.cwd(), "benchmark", "runs");

  const artifactFilenames = await listClosureArtifactFilenames(dir, notes);

  const lanes = listProviderLanes().map<ProviderLaneSnapshot>((lane) => {
    const summary = summarizeArtifactsForLane(lane, artifactFilenames);
    return {
      lane,
      tone: deriveLaneTone(lane.id),
      artifacts: summary,
    };
  });

  const checklist = await probeOperatorChecklist(options.checklistPagePath);

  return {
    schemaVersion: 1,
    generatedAt,
    lanes,
    checklist,
    notes,
  };
}

/* ------ Artifact filename listing (graceful) ------------------------------------------------------------------ */

async function listClosureArtifactFilenames(
  dir: string,
  notes: string[],
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      notes.push(
        `benchmark/runs/ not present; cockpit shows zero artifacts per lane`,
      );
      return [];
    }
    notes.push(
      `benchmark/runs/ listing failed: ${(err as Error).message}`.slice(
        0,
        240,
      ),
    );
    return [];
  }
  // Drop quality-gate + founder-e2e meta artifacts; they belong to
  // the demo control room, not provider closure work.
  return entries
    .filter(
      (n) =>
        typeof n === "string" &&
        n.endsWith(".json") &&
        !n.startsWith("phase1-quality-gate-") &&
        !n.startsWith("founder-e2e-"),
    )
    .sort()
    .reverse();
}

/* ------ Lane filename markers -------------------------------------------------------------------------------- */

/**
 * Filename substrings that indicate the artifact is closure-related
 * for a given lane. Matched against the lowercase filename. These
 * are best-effort markers, not authoritative classification - the
 * artifact analyzers remain the source of truth.
 */
const LANE_FILENAME_MARKERS: Record<ProviderLaneId, string[]> = {
  restaurant: [
    "phase0-resy",
    "resy",
    "opentable",
    "restaurant",
  ],
  flight: ["expedia-flight", "expedia-retry", "flight-rpa", "flight-"],
  hotel: ["booking-com", "hotels-com", "hotel-retry", "hotel-"],
};

const EMPTY_HINTS: Record<ProviderLaneId, string> = {
  restaurant:
    "No restaurant closure artifacts under benchmark/runs/. Generate a " +
    "synthetic template with `create-artifact-bundle-template.ts " +
    "--kind restaurant` and fill from existing post-run evidence, or " +
    "wait for the next founder-approved Resy/OpenTable retry.",
  flight:
    "No Expedia flight closure artifacts under benchmark/runs/. Generate " +
    "a synthetic template with `create-artifact-bundle-template.ts " +
    "--kind expedia` and fill from existing post-run evidence, or wait " +
    "for the next founder-approved Expedia retry.",
  hotel:
    "No hotel closure artifacts under benchmark/runs/. Generate a " +
    "synthetic template with `create-artifact-bundle-template.ts " +
    "--kind hotel` and fill from existing post-run evidence, or wait " +
    "for the next founder-approved Booking.com retry.",
};

/* ------ Per-lane artifact summary -------------------------------------------------------------------------- */

export function summarizeArtifactsForLane(
  lane: ProviderLane,
  artifactFilenames: string[],
): LaneArtifactSummary {
  const markers = LANE_FILENAME_MARKERS[lane.id] ?? [];
  const matching = artifactFilenames.filter((f) =>
    markers.some((m) => f.toLowerCase().includes(m)),
  );
  return {
    totalBenchmarkArtifacts: artifactFilenames.length,
    laneBenchmarkArtifacts: matching.length,
    latestArtifactFile: matching[0] ?? null,
    emptyHint: EMPTY_HINTS[lane.id],
  };
}

/* ------ Tone -------------------------------------------------------------------------------------------------------------- */

const LANE_TONE: Record<ProviderLaneId, LaneTone> = {
  restaurant: "warn",
  flight: "warn",
  hotel: "neutral",
};

function deriveLaneTone(id: ProviderLaneId): LaneTone {
  return LANE_TONE[id] ?? "neutral";
}

/* ------ Operator checklist probe (no hard import) -------------------------------------------------------- */

const CHECKLIST_PAGE_REL_PATH = "app/dev/live-operator-checklist/page.tsx";
const CHECKLIST_PAGE_HREF = "/dev/live-operator-checklist";

const CHECKLIST_NOTE_AVAILABLE =
  "An operator checklist surface is available at " +
  "/dev/live-operator-checklist with per-provider hard stops + " +
  "evidence + analyzer commands. Open it for a vertical-specific " +
  "checklist alongside this cockpit.";

const CHECKLIST_NOTE_PLACEHOLDER =
  "If a /dev/live-operator-checklist page lands in a future " +
  "integrated-preview cherry-pick, this cockpit will link to it. " +
  "Until then, the per-lane runbooks above remain canonical.";

/**
 * Probe whether `/dev/live-operator-checklist` exists in the
 * current worktree. Probing is filesystem-only - no module import,
 * so unmerged sidecar branches cannot break this build.
 */
async function probeOperatorChecklist(
  override?: string,
): Promise<OperatorChecklistLink> {
  const candidate =
    override ?? path.resolve(process.cwd(), CHECKLIST_PAGE_REL_PATH);
  try {
    if (existsSync(candidate)) {
      return {
        available: true,
        href: CHECKLIST_PAGE_HREF,
        note: CHECKLIST_NOTE_AVAILABLE,
      };
    }
  } catch {
    /* fall through */
  }
  return {
    available: false,
    href: CHECKLIST_PAGE_HREF,
    note: CHECKLIST_NOTE_PLACEHOLDER,
  };
}
