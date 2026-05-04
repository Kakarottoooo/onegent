import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_HARD_STOPS,
  DEMO_ROUTE_ORDER,
  deriveDemoReadiness,
  extractSmokeEvidence,
  formatDemoReadinessMarkdown,
  loadDemoEvidenceSnapshot,
  type DemoEvidenceSnapshot,
} from "@/lib/demo-evidence";
import {
  buildAutoRunFromProbes,
  FOUNDER_E2E_PATHS,
  listAllSteps,
  type ProbeResult,
  type RunnerMeta,
} from "@/lib/founder-e2e";
import type { QualityGateRun } from "@/lib/quality-gate/report";

const NOW = "2026-05-04T12:00:00.000Z";

describe("demo evidence constants", () => {
  it("hard stops include the forbidden live boundaries", () => {
    const text = JSON.stringify(DEMO_HARD_STOPS).toLowerCase();
    expect(text).toContain("payment");
    expect(text).toContain("cvv");
    expect(text).toContain("otp");
    expect(text).toContain("captcha");
    expect(text).toContain("login");
    expect(text).toContain("final");
    expect(text).toContain("live");
  });

  it("route order starts with demo-readiness and links control room", () => {
    expect(DEMO_ROUTE_ORDER[0].href).toBe("/dev/demo-readiness");
    expect(DEMO_ROUTE_ORDER.some((step) => step.href === "/dev/demo-control-room")).toBe(true);
  });
});

describe("formatDemoReadinessMarkdown", () => {
  it("renders verdict, blockers, warnings, routes, hard stops, and docs", () => {
    const markdown = formatDemoReadinessMarkdown(makeSnapshot());
    expect(markdown).toContain("# Demo Readiness Export");
    expect(markdown).toContain("Verdict: needs_attention");
    expect(markdown).toContain("## Blockers");
    expect(markdown).toContain("- Gate is stale");
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain("- Smoke missing");
    expect(markdown).toContain("## Exact Demo Route Order");
    expect(markdown).toContain("1. /dev/demo-readiness - Demo readiness");
    expect(markdown).toContain("## Hard Stops");
    expect(markdown).toContain("Payment, CVV, card form");
    expect(markdown).toContain("## Useful Docs");
    expect(markdown).toContain("present - YC demo runbook");
    expect(markdown).toContain("missing - Missing doc");
  });

  it("renders none rows when there are no blockers or warnings", () => {
    const snapshot = makeSnapshot({
      readiness: {
        verdict: "ready",
        tone: "good",
        blockers: [],
        warnings: [],
      },
    });
    const markdown = formatDemoReadinessMarkdown(snapshot);
    expect(markdown).toContain("## Blockers\n\n- None");
    expect(markdown).toContain("## Warnings\n\n- None");
  });

  it("is deterministic and does not stringify objects", () => {
    const snapshot = makeSnapshot();
    expect(formatDemoReadinessMarkdown(snapshot)).toBe(
      formatDemoReadinessMarkdown(snapshot),
    );
    expect(formatDemoReadinessMarkdown(snapshot)).not.toContain("[object Object]");
  });

  it("includes the safety boundary line", () => {
    const markdown = formatDemoReadinessMarkdown(makeSnapshot());
    expect(markdown).toContain(
      "No live provider, payment, OTP, CAPTCHA, login bypass, or final confirmation",
    );
  });
});

describe("extractSmokeEvidence", () => {
  it("returns absent when no run is available", () => {
    const smoke = extractSmokeEvidence(null);
    expect(smoke.present).toBe(false);
    expect(smoke.hint).toContain("--include-smoke");
  });

  it("extracts smoke status and command", () => {
    const run = makeGateRun({
      verdict: "pass",
      smokeStatus: "pass",
    });
    const smoke = extractSmokeEvidence(run);
    expect(smoke.present).toBe(true);
    expect(smoke.status).toBe("pass");
    expect(smoke.command).toBe("npm run smoke:phase1");
  });
});

describe("deriveDemoReadiness", () => {
  it("blocks on failing gate", () => {
    const readiness = deriveDemoReadiness({
      phase1Gate: {
        available: true,
        summary: {
          runId: "x",
          generatedAt: NOW,
          fileName: "phase1-quality-gate-x.json",
          verdict: "fail",
          exitCode: 1,
          totalChecks: 1,
          passCount: 0,
          failCount: 1,
          skippedCount: 0,
          knownExistingFailureCount: 0,
          durationMs: 1,
          command: "gate",
        },
        relPath: "benchmark/runs/phase1-quality-gate-x.json",
        smoke: { present: true, status: "pass", severity: "skipped", command: "smoke", hint: "ok" },
      },
      founderE2e: { available: false, summary: null, relPath: null },
      runtimeForensics: emptyRuntime(),
      docs: [],
    });
    expect(readiness.verdict).toBe("blocked");
    expect(readiness.blockers.join(" ")).toMatch(/quality gate/);
  });
});

describe("loadDemoEvidenceSnapshot", () => {
  const originalCwd = process.cwd();
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "demo-evidence-"));
    process.chdir(tmpRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("gracefully loads with no artifacts or docs", async () => {
    const snap = await loadDemoEvidenceSnapshot({ generatedAt: NOW });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.generatedAt).toBe(NOW);
    expect(snap.phase1Gate.available).toBe(false);
    expect(snap.founderE2e.available).toBe(false);
    expect(snap.runtimeForensics.reportCount).toBe(0);
    expect(snap.readiness.verdict).toBe("needs_attention");
    expect(snap.docs.some((doc) => !doc.exists)).toBe(true);
  });

  it("summarizes gate, founder artifact, smoke, runtime, and docs", async () => {
    await seedRunbooks(tmpRoot);
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    await writeJson(
      path.join(tmpRoot, "benchmark", "runs", "phase1-quality-gate-ready.json"),
      makeGateRun({ verdict: "pass", smokeStatus: "pass" }),
    );
    await writeFounderRun(tmpRoot);
    await writeJson(path.join(tmpRoot, "benchmark", "runs", "runtime.json"), {
      cases: [
        {
          id: "job-1",
          provider: "resy",
          scenario: "R-003",
          status: "failed",
          terminalReason: "Provider returned no availability",
          updatedAt: NOW,
          steps: [{ type: "restaurant", body: { __source: "test" } }],
        },
      ],
    });

    const snap = await loadDemoEvidenceSnapshot({ generatedAt: NOW });
    expect(snap.phase1Gate.available).toBe(true);
    expect(snap.phase1Gate.smoke.status).toBe("pass");
    expect(snap.founderE2e.available).toBe(true);
    expect(snap.runtimeForensics.reportCount).toBe(1);
    expect(snap.docs.every((doc) => doc.exists)).toBe(true);
    expect(snap.readiness.verdict).toBe("ready");
  });
});

function makeGateRun(options: {
  verdict: "pass" | "needs_polish" | "fail" | "env_blocked";
  smokeStatus?: "pass" | "fail" | "skipped" | "known_existing_failure";
}): QualityGateRun {
  const checks = [
    {
      id: "tsc",
      label: "TypeScript",
      command: "npx tsc --noEmit --pretty false",
      requirement: "required" as const,
      status: options.verdict === "fail" ? "fail" as const : "pass" as const,
      severity: "p0" as const,
      durationMs: 100,
      startedAt: NOW,
      exitCode: options.verdict === "fail" ? 1 : 0,
      stdoutTail: "",
      stderrTail: "",
    },
  ];
  if (options.smokeStatus) {
    checks.push({
      id: "smoke:phase1",
      label: "Smoke",
      command: "npm run smoke:phase1",
      requirement: "optional",
      status: options.smokeStatus,
      severity: "skipped",
      durationMs: 200,
      startedAt: NOW,
      exitCode: options.smokeStatus === "fail" ? 1 : 0,
      stdoutTail: "",
      stderrTail: "",
    });
  }

  return {
    schemaVersion: 1,
    runId: "ready",
    generatedAt: NOW,
    checks,
    verdict: options.verdict,
    exitCode: options.verdict === "fail" ? 1 : 0,
    runnerMeta: {
      command: "npm run gate:phase1",
      nodeVersion: "v22",
      durationMs: 1000,
      startedAt: NOW,
    },
  };
}

async function writeFounderRun(root: string): Promise<void> {
  const probes: ProbeResult[] = listAllSteps(FOUNDER_E2E_PATHS.auto).map((step) => ({
    stepId: step.id,
    status: "pass",
    actual: "ok",
    url: "http://localhost:3000/",
  }));
  const runnerMeta: RunnerMeta = {
    command: "npx tsx scripts/run-founder-e2e.ts",
    baseUrl: "http://localhost:3000",
    durationMs: 1000,
  };
  const run = buildAutoRunFromProbes({
    probes,
    runnerMeta,
    runId: "founder-e2e-auto-ready",
    now: () => NOW,
  });
  await writeJson(
    path.join(root, "benchmark", "runs", "founder-e2e-auto-ready.json"),
    run,
  );
}

async function seedRunbooks(root: string): Promise<void> {
  const docs = [
    "docs/40-phase1/YC_DEMO_RUNBOOK.md",
    "docs/40-phase1/DEMO_CONTROL_ROOM.md",
    "docs/40-phase1/PHASE_1_QUALITY_GATE.md",
    "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
    "docs/10-coordination/phase2.md",
    "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
  ];
  for (const doc of docs) {
    const file = path.join(root, doc);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `# ${path.basename(doc)}\n`, "utf8");
  }
}

async function writeJson(file: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}

function emptyRuntime() {
  return {
    scannedFiles: 0,
    reportCount: 0,
    p0Count: 0,
    p1Count: 0,
    legacyShapeCount: 0,
    workerLogAvailable: false,
    workerLogPathHint: "codex-worker.log",
    classCounts: {},
    severityCounts: { p0: 0, p1: 0, p2: 0, p3: 0, info: 0 },
    latest: [],
  };
}

function makeSnapshot(
  overrides: Partial<DemoEvidenceSnapshot> = {},
): DemoEvidenceSnapshot {
  const base: DemoEvidenceSnapshot = {
    schemaVersion: 1,
    generatedAt: NOW,
    readiness: {
      verdict: "needs_attention",
      tone: "warn",
      blockers: ["Gate is stale"],
      warnings: ["Smoke missing"],
    },
    phase1Gate: {
      available: true,
      summary: {
        runId: "gate",
        generatedAt: NOW,
        fileName: "phase1-quality-gate-ready.json",
        verdict: "pass",
        exitCode: 0,
        totalChecks: 9,
        passCount: 9,
        failCount: 0,
        skippedCount: 0,
        knownExistingFailureCount: 0,
        durationMs: 1000,
        command: "npm run gate:phase1",
      },
      relPath: "benchmark/runs/phase1-quality-gate-ready.json",
      smoke: {
        present: false,
        status: null,
        severity: null,
        command: null,
        hint: "missing",
      },
    },
    founderE2e: {
      available: true,
      summary: {
        file: "founder-e2e-auto-ready.json",
        runId: "founder",
        pathId: "auto",
        startedAt: NOW,
        updatedAt: NOW,
        meetsBar: true,
        pass: 15,
        fail: 0,
        blocker: 0,
        skipped: 0,
        pending: 0,
        total: 15,
        p0Count: 0,
        p1Count: 0,
        source: "automated",
        runnerVerdict: "pass",
      },
      relPath: "benchmark/runs/founder-e2e-auto-ready.json",
    },
    runtimeForensics: emptyRuntime(),
    docs: [
      {
        label: "YC demo runbook",
        path: "docs/40-phase1/YC_DEMO_RUNBOOK.md",
        kind: "runbook",
        exists: true,
      },
      {
        label: "Missing doc",
        path: "docs/missing.md",
        kind: "runbook",
        exists: false,
      },
    ],
    phase2Links: [
      {
        label: "Expedia",
        path: "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
        note: "candidate, not live-verified",
      },
    ],
    hardStops: DEMO_HARD_STOPS,
    routeOrder: DEMO_ROUTE_ORDER,
    notes: [],
  };

  return {
    ...base,
    ...overrides,
    readiness: overrides.readiness ?? base.readiness,
  };
}
