import { promises as fs } from "node:fs";
import path from "node:path";

import {
  listFounderE2eRunSummaries,
  type FounderRunSummary,
} from "@/lib/founder-e2e/loader";
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
import { aggregateForensics } from "@/lib/runtime-forensics/loader";
import type {
  FailureClass,
  ForensicsSeverity,
  ForensicsSummary,
} from "@/lib/runtime-forensics/types";
import { listPhase2Verticals } from "@/lib/demo-control-room/phase2-status";

export const DEMO_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type DemoReadinessVerdict = "ready" | "needs_attention" | "blocked";
export type DemoEvidenceTone = "good" | "warn" | "bad" | "neutral";

export interface DemoEvidenceDocLink {
  label: string;
  path: string;
  kind: "runbook" | "coordination" | "phase2";
  exists: boolean;
}

export interface DemoEvidenceSmoke {
  present: boolean;
  status: GateStatus | null;
  severity: string | null;
  command: string | null;
  hint: string;
}

export interface DemoEvidenceGate {
  available: boolean;
  summary: QualityGateRunSummary | null;
  relPath: string | null;
  smoke: DemoEvidenceSmoke;
}

export interface DemoEvidenceFounderE2e {
  available: boolean;
  summary: FounderRunSummary | null;
  relPath: string | null;
}

export interface RuntimeForensicsEvidence {
  scannedFiles: number;
  reportCount: number;
  p0Count: number;
  p1Count: number;
  legacyShapeCount: number;
  workerLogAvailable: boolean;
  workerLogPathHint: string;
  classCounts: Record<FailureClass, number>;
  severityCounts: Record<ForensicsSeverity, number>;
  latest: ForensicsSummary[];
}

export interface DemoHardStop {
  id: string;
  trigger: string;
  action: string;
}

export interface DemoRouteStep {
  index: number;
  href: string;
  label: string;
  purpose: string;
}

export interface DemoEvidenceReadiness {
  verdict: DemoReadinessVerdict;
  tone: DemoEvidenceTone;
  blockers: string[];
  warnings: string[];
}

export interface Phase2EvidenceLink {
  label: string;
  path: string;
  note: string;
}

export interface DemoEvidenceSnapshot {
  schemaVersion: typeof DEMO_EVIDENCE_SCHEMA_VERSION;
  generatedAt: string;
  readiness: DemoEvidenceReadiness;
  phase1Gate: DemoEvidenceGate;
  founderE2e: DemoEvidenceFounderE2e;
  runtimeForensics: RuntimeForensicsEvidence;
  docs: DemoEvidenceDocLink[];
  phase2Links: Phase2EvidenceLink[];
  hardStops: DemoHardStop[];
  routeOrder: DemoRouteStep[];
  notes: string[];
}

const SMOKE_CHECK_ID = "smoke:phase1";

export const DEMO_HARD_STOPS: DemoHardStop[] = [
  {
    id: "no-payment",
    trigger: "Payment, CVV, card form, or purchase review appears",
    action:
      "Stop the agent path. Say this is the manual payment boundary and take over yourself.",
  },
  {
    id: "no-otp",
    trigger: "OTP, SMS, phone verification, or email code appears",
    action:
      "Never type or bypass the code. Say the founder provides it manually outside the agent.",
  },
  {
    id: "no-captcha",
    trigger: "CAPTCHA or bot-check appears",
    action:
      "Do not solve or bypass inside the agent. Pause and classify it as a provider boundary.",
  },
  {
    id: "no-login-bypass",
    trigger: "Provider login or account-sensitive wall appears",
    action:
      "Stop. Login is a human warm-session step, not an automated demo action.",
  },
  {
    id: "no-final-confirm",
    trigger: "Final booking, reserve, purchase, or irreversible confirm button appears",
    action:
      "Do not click it. Say Onegent stops before irreversible provider actions.",
  },
  {
    id: "no-live-without-approval",
    trigger: "Resy or Expedia live run is not explicitly approved for this exact demo",
    action:
      "Use demo fixtures and control-room evidence. Do not run providers live from the stage.",
  },
];

export const DEMO_ROUTE_ORDER: DemoRouteStep[] = [
  {
    index: 1,
    href: "/dev/demo-readiness",
    label: "Demo readiness",
    purpose: "Compact go/no-go, hard stops, links, and route order.",
  },
  {
    index: 2,
    href: "/dev/demo-control-room",
    label: "Demo Control Room",
    purpose: "Full evidence dashboard and safe demo script.",
  },
  {
    index: 3,
    href: "/dev/phase1-quality-gates",
    label: "Phase 1 Quality Gate",
    purpose: "Open the latest gate artifact if the summary needs inspection.",
  },
  {
    index: 4,
    href: "/dev/founder-e2e",
    label: "Founder E2E",
    purpose: "Open the latest founder/manual or autonomous artifact if needed.",
  },
  {
    index: 5,
    href: "/",
    label: "Homepage chat",
    purpose: "Start the product demo from the user-facing first screen.",
  },
  {
    index: 6,
    href: "/tasks?view=history",
    label: "Task history",
    purpose: "Show auditability and prior task states.",
  },
  {
    index: 7,
    href: "/dev/runtime-forensics",
    label: "Runtime forensics",
    purpose: "Fallback route if a provider/runtime artifact needs explanation.",
  },
];

const DOC_LINKS: Omit<DemoEvidenceDocLink, "exists">[] = [
  {
    label: "YC demo runbook",
    path: "docs/40-phase1/YC_DEMO_RUNBOOK.md",
    kind: "runbook",
  },
  {
    label: "Demo Control Room runbook",
    path: "docs/40-phase1/DEMO_CONTROL_ROOM.md",
    kind: "runbook",
  },
  {
    label: "Phase 1 quality gate",
    path: "docs/40-phase1/PHASE_1_QUALITY_GATE.md",
    kind: "runbook",
  },
  {
    label: "Founder E2E",
    path: "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
    kind: "runbook",
  },
  {
    label: "Phase 2 coordination",
    path: "docs/10-coordination/phase2.md",
    kind: "coordination",
  },
  {
    label: "Expedia controlled retry runbook",
    path: "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    kind: "phase2",
  },
  {
    label: "Phase 2 revival audit",
    path: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
    kind: "phase2",
  },
];

export async function loadDemoEvidenceSnapshot(
  options: { generatedAt?: string } = {},
): Promise<DemoEvidenceSnapshot> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const notes: string[] = [];

  const phase1Gate = await loadLatestQualityGate(notes);
  const founderE2e = await loadLatestFounderE2e(notes);
  const runtimeForensics = await loadRuntimeForensicsEvidence(notes);
  const docs = await loadDocLinks();
  const phase2Links = buildPhase2Links();
  const readiness = deriveDemoReadiness({
    phase1Gate,
    founderE2e,
    runtimeForensics,
    docs,
  });

  return {
    schemaVersion: DEMO_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    readiness,
    phase1Gate,
    founderE2e,
    runtimeForensics,
    docs,
    phase2Links,
    hardStops: DEMO_HARD_STOPS,
    routeOrder: DEMO_ROUTE_ORDER,
    notes,
  };
}

export function formatDemoReadinessMarkdown(
  snapshot: DemoEvidenceSnapshot,
): string {
  const lines: string[] = [];
  lines.push("# Demo Readiness Export");
  lines.push("");
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push(`Verdict: ${snapshot.readiness.verdict}`);
  lines.push("");

  lines.push("## Blockers");
  if (snapshot.readiness.blockers.length === 0) {
    lines.push("");
    lines.push("- None");
  } else {
    lines.push("");
    for (const blocker of snapshot.readiness.blockers) {
      lines.push(`- ${blocker}`);
    }
  }
  lines.push("");

  lines.push("## Warnings");
  if (snapshot.readiness.warnings.length === 0) {
    lines.push("");
    lines.push("- None");
  } else {
    lines.push("");
    for (const warning of snapshot.readiness.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");

  lines.push("## Evidence Summary");
  lines.push("");
  lines.push(`- Phase 1 gate: ${formatGateLine(snapshot)}`);
  lines.push(`- Founder E2E: ${formatFounderLine(snapshot)}`);
  lines.push(`- Smoke: ${formatSmokeLine(snapshot)}`);
  lines.push(
    `- Runtime forensics: ${snapshot.runtimeForensics.reportCount} report(s), ` +
      `${snapshot.runtimeForensics.p0Count} P0, ` +
      `${snapshot.runtimeForensics.legacyShapeCount} legacy-shape`,
  );
  lines.push("");

  lines.push("## Exact Demo Route Order");
  lines.push("");
  for (const step of snapshot.routeOrder) {
    lines.push(`${step.index}. ${step.href} - ${step.label}`);
    lines.push(`   - ${step.purpose}`);
  }
  lines.push("");

  lines.push("## Hard Stops");
  lines.push("");
  for (const stop of snapshot.hardStops) {
    lines.push(`- ${stop.trigger}`);
    lines.push(`  - ${stop.action}`);
  }
  lines.push("");

  lines.push("## Useful Docs");
  lines.push("");
  for (const doc of snapshot.docs) {
    lines.push(
      `- ${doc.exists ? "present" : "missing"} - ${doc.label}: ${doc.path}`,
    );
  }
  lines.push("");

  lines.push("## Phase 2 / Expedia Links");
  lines.push("");
  for (const link of snapshot.phase2Links) {
    lines.push(`- ${link.label}: ${link.path}`);
    lines.push(`  - ${link.note}`);
  }
  lines.push("");

  lines.push("## Safety Boundary");
  lines.push("");
  lines.push(
    "No live provider, payment, OTP, CAPTCHA, login bypass, or final confirmation is authorized by this export.",
  );

  return lines.join("\n");
}

async function loadLatestQualityGate(
  notes: string[],
): Promise<DemoEvidenceGate> {
  let summaries: QualityGateRunSummary[] = [];
  try {
    summaries = await listQualityGateRunSummaries();
  } catch (err) {
    notes.push(`quality-gate list failed: ${errorMessage(err)}`);
  }

  const latest = summaries[0] ?? null;
  if (!latest) {
    return {
      available: false,
      summary: null,
      relPath: null,
      smoke: absentSmoke(),
    };
  }

  let fullRun: QualityGateRun | null = null;
  try {
    fullRun = await readQualityGateRunByFile(latest.fileName);
  } catch (err) {
    notes.push(`quality-gate read failed: ${errorMessage(err)}`);
  }

  return {
    available: true,
    summary: latest,
    relPath: `benchmark/runs/${latest.fileName}`,
    smoke: extractSmokeEvidence(fullRun),
  };
}

async function loadLatestFounderE2e(
  notes: string[],
): Promise<DemoEvidenceFounderE2e> {
  let summaries: FounderRunSummary[] = [];
  try {
    summaries = await listFounderE2eRunSummaries();
  } catch (err) {
    notes.push(`founder-e2e list failed: ${errorMessage(err)}`);
  }

  const latest = summaries[0] ?? null;
  if (!latest) {
    return { available: false, summary: null, relPath: null };
  }
  return {
    available: true,
    summary: latest,
    relPath: `benchmark/runs/${latest.file}`,
  };
}

async function loadRuntimeForensicsEvidence(
  notes: string[],
): Promise<RuntimeForensicsEvidence> {
  let aggregate;
  try {
    aggregate = await aggregateForensics({
      limit: 25,
      includeFixtures: false,
      attachWorkerLog: false,
    });
  } catch (err) {
    notes.push(`runtime-forensics aggregate failed: ${errorMessage(err)}`);
    return emptyRuntimeForensicsEvidence();
  }

  const classCounts = {} as Record<FailureClass, number>;
  const severityCounts: Record<ForensicsSeverity, number> = {
    p0: 0,
    p1: 0,
    p2: 0,
    p3: 0,
    info: 0,
  };

  for (const summary of aggregate.summaries) {
    classCounts[summary.primaryClass] =
      (classCounts[summary.primaryClass] ?? 0) + 1;
    severityCounts[summary.severity] += 1;
  }

  notes.push(...aggregate.loaderNotes.slice(0, 5));

  return {
    scannedFiles: aggregate.benchmarkRunsScanned,
    reportCount: aggregate.reports.length,
    p0Count: severityCounts.p0,
    p1Count: severityCounts.p1,
    legacyShapeCount: aggregate.summaries.filter((s) => s.hasLegacyShapeBug)
      .length,
    workerLogAvailable: aggregate.workerLogAvailable,
    workerLogPathHint: aggregate.workerLogPathHint,
    classCounts,
    severityCounts,
    latest: aggregate.summaries.slice(0, 5),
  };
}

function emptyRuntimeForensicsEvidence(): RuntimeForensicsEvidence {
  return {
    scannedFiles: 0,
    reportCount: 0,
    p0Count: 0,
    p1Count: 0,
    legacyShapeCount: 0,
    workerLogAvailable: false,
    workerLogPathHint: path.resolve(process.cwd(), "codex-worker.log"),
    classCounts: {} as Record<FailureClass, number>,
    severityCounts: { p0: 0, p1: 0, p2: 0, p3: 0, info: 0 },
    latest: [],
  };
}

export function extractSmokeEvidence(
  run: QualityGateRun | null,
): DemoEvidenceSmoke {
  const check = findSmokeCheck(run);
  if (!check) return absentSmoke();
  return {
    present: true,
    status: check.status,
    severity: check.severity,
    command: check.command,
    hint: "Smoke was present in the latest Phase 1 gate artifact.",
  };
}

function findSmokeCheck(run: QualityGateRun | null): GateCheck | null {
  if (!run) return null;
  return run.checks.find((check) => check.id === SMOKE_CHECK_ID) ?? null;
}

function absentSmoke(): DemoEvidenceSmoke {
  return {
    present: false,
    status: null,
    severity: null,
    command: null,
    hint:
      "Latest gate did not include smoke. For pre-demo evidence, run `npm run gate:phase1 -- --include-smoke --allow-known-drift`.",
  };
}

async function loadDocLinks(): Promise<DemoEvidenceDocLink[]> {
  const out: DemoEvidenceDocLink[] = [];
  for (const doc of DOC_LINKS) {
    out.push({
      ...doc,
      exists: await pathExists(path.resolve(process.cwd(), doc.path)),
    });
  }
  return out;
}

function buildPhase2Links(): Phase2EvidenceLink[] {
  const out: Phase2EvidenceLink[] = [
    {
      label: "Phase 2 coordination",
      path: "docs/10-coordination/phase2.md",
      note: "Current owner notes and no-live approval boundary.",
    },
    {
      label: "Expedia controlled retry runbook",
      path: "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      note: "Checklist only; not approval to run live Expedia.",
    },
  ];
  for (const vertical of listPhase2Verticals()) {
    out.push({
      label: vertical.displayName,
      path: vertical.evidence[0]?.ref ?? "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
      note: vertical.liveVerifiedNote,
    });
  }
  return out;
}

export function deriveDemoReadiness(input: {
  phase1Gate: DemoEvidenceGate;
  founderE2e: DemoEvidenceFounderE2e;
  runtimeForensics: RuntimeForensicsEvidence;
  docs: DemoEvidenceDocLink[];
}): DemoEvidenceReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const gate = input.phase1Gate.summary;
  if (!input.phase1Gate.available || !gate) {
    warnings.push("No Phase 1 quality gate artifact found.");
  } else if (isBlockingGateVerdict(gate.verdict)) {
    blockers.push(`Phase 1 quality gate is ${gate.verdict}.`);
  } else {
    if (gate.verdict === "needs_polish") {
      warnings.push("Phase 1 quality gate needs polish.");
    }
    if (gate.knownExistingFailureCount > 0) {
      warnings.push(
        `Phase 1 quality gate has ${gate.knownExistingFailureCount} known-existing failure(s).`,
      );
    }
  }

  const smoke = input.phase1Gate.smoke;
  if (!smoke.present) {
    warnings.push("No smoke verdict in the latest Phase 1 gate artifact.");
  } else if (smoke.status === "fail") {
    blockers.push("smoke:phase1 failed in the latest gate artifact.");
  } else if (smoke.status !== "pass") {
    warnings.push(`smoke:phase1 status is ${smoke.status ?? "unknown"}.`);
  }

  const founder = input.founderE2e.summary;
  if (!input.founderE2e.available || !founder) {
    warnings.push("No founder E2E artifact found.");
  } else {
    if (founder.runnerVerdict === "fail" || founder.blocker > 0 || founder.p0Count > 0) {
      blockers.push("Founder E2E has a fail, blocker, or P0 issue.");
    } else if (
      founder.runnerVerdict === "needs_polish" ||
      founder.fail > 0 ||
      founder.p1Count > 0
    ) {
      warnings.push("Founder E2E needs polish.");
    }
  }

  if (input.runtimeForensics.p0Count > 0 || input.runtimeForensics.legacyShapeCount > 0) {
    blockers.push("Runtime forensics has P0 or legacy-shape artifact evidence.");
  } else if (input.runtimeForensics.p1Count > 0) {
    warnings.push("Runtime forensics has P1 artifact evidence to inspect.");
  }

  const missingDocs = input.docs.filter((doc) => !doc.exists);
  if (missingDocs.length > 0) {
    warnings.push(
      `Missing demo docs: ${missingDocs.map((doc) => doc.path).join(", ")}`,
    );
  }

  if (blockers.length > 0) {
    return { verdict: "blocked", tone: "bad", blockers, warnings };
  }
  if (warnings.length > 0) {
    return { verdict: "needs_attention", tone: "warn", blockers, warnings };
  }
  return { verdict: "ready", tone: "good", blockers, warnings };
}

function isBlockingGateVerdict(verdict: GateVerdict): boolean {
  return verdict === "fail" || verdict === "env_blocked";
}

function formatGateLine(snapshot: DemoEvidenceSnapshot): string {
  const gate = snapshot.phase1Gate.summary;
  if (!gate) return "no artifact";
  return `${gate.verdict}, ${gate.passCount}/${gate.totalChecks} pass (${snapshot.phase1Gate.relPath ?? "no path"})`;
}

function formatFounderLine(snapshot: DemoEvidenceSnapshot): string {
  const founder = snapshot.founderE2e.summary;
  if (!founder) return "no artifact";
  return `${founder.runnerVerdict ?? "manual"}, ${founder.pass}/${founder.total} pass (${snapshot.founderE2e.relPath ?? "no path"})`;
}

function formatSmokeLine(snapshot: DemoEvidenceSnapshot): string {
  const smoke = snapshot.phase1Gate.smoke;
  if (!smoke.present) return "not present";
  return `${smoke.status ?? "unknown"} (${smoke.command ?? "no command"})`;
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240);
}
