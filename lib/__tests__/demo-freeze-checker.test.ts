import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDemoFreezeReport,
  formatDemoFreezeMarkdown,
  loadDemoFreezeReport,
  REQUIRED_DEMO_DOCS,
  type DemoFreezeDocStatus,
} from "@/scripts/check-demo-freeze";
import {
  DEMO_HARD_STOPS,
  DEMO_ROUTE_ORDER,
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

describe("formatDemoFreezeMarkdown", () => {
  it("renders the required freeze summary sections", () => {
    const report = buildDemoFreezeReport(makeSnapshot(), allDocsPresent());
    const markdown = formatDemoFreezeMarkdown(report);

    expect(markdown).toContain("# Demo Freeze Check");
    expect(markdown).toContain("Verdict: ready");
    expect(markdown).toContain(
      "Latest gate file: benchmark/runs/phase1-quality-gate-ready.json",
    );
    expect(markdown).toContain(
      "Founder E2E file: benchmark/runs/founder-e2e-auto-ready.json",
    );
    expect(markdown).toContain("## Required Demo Routes");
    expect(markdown).toContain("1. /dev/demo-readiness - Demo readiness");
    expect(markdown).toContain("## Demo Docs");
    expect(markdown).toContain("present - YC demo runbook");
    expect(markdown).toContain("## Hard Stops");
    expect(markdown).toContain("Payment, CVV, card form");
    expect(markdown).toContain("Phase 2 is audited and not live-verified");
    expect(markdown).toContain("No live provider, payment, CVV, OTP, CAPTCHA");
  });

  it("blocks on inherited blockers and marks missing docs as needs_attention", () => {
    const blocked = buildDemoFreezeReport(
      makeSnapshot({
        readiness: {
          verdict: "blocked",
          tone: "bad",
          blockers: ["Phase 1 quality gate is fail."],
          warnings: [],
        },
      }),
      allDocsPresent(),
    );
    expect(blocked.verdict).toBe("blocked");

    const missingDoc = buildDemoFreezeReport(makeSnapshot(), [
      { label: "YC demo runbook", path: "docs/90-archive/phase1-demo/YC_DEMO_RUNBOOK.md", exists: false },
    ]);
    expect(missingDoc.verdict).toBe("needs_attention");
    expect(missingDoc.warnings.join(" ")).toContain("Missing required demo docs");
  });
});

describe("loadDemoFreezeReport", () => {
  const originalCwd = process.cwd();
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "demo-freeze-checker-"));
    process.chdir(tmpRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("reads latest gate, founder E2E, demo docs, and route list", async () => {
    await seedRunbooks(tmpRoot);
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    await writeJson(
      path.join(tmpRoot, "benchmark", "runs", "phase1-quality-gate-ready.json"),
      makeGateRun({ verdict: "pass", smokeStatus: "pass" }),
    );
    await writeFounderRun(tmpRoot);

    const report = await loadDemoFreezeReport({ generatedAt: NOW });

    expect(report.verdict).toBe("ready");
    expect(report.latestGateFile).toBe(
      "benchmark/runs/phase1-quality-gate-ready.json",
    );
    expect(report.founderE2eFile).toBe(
      "benchmark/runs/founder-e2e-auto-ready.json",
    );
    expect(report.docs.every((doc) => doc.exists)).toBe(true);
    expect(report.docs.map((doc) => doc.path)).toContain(
      "docs/90-archive/phase1-demo/YC_DEMO_OPERATOR_CARD.md",
    );
    expect(report.requiredRoutes.map((route) => route.href)).toContain(
      "/dev/demo-control-room",
    );
    expect(report.phase2Warning).toContain("not live-verified");
  });
});

function allDocsPresent(): DemoFreezeDocStatus[] {
  return REQUIRED_DEMO_DOCS.map((doc) => ({ ...doc, exists: true }));
}

function makeSnapshot(
  overrides: Partial<DemoEvidenceSnapshot> = {},
): DemoEvidenceSnapshot {
  const base: DemoEvidenceSnapshot = {
    schemaVersion: 1,
    generatedAt: NOW,
    readiness: {
      verdict: "ready",
      tone: "good",
      blockers: [],
      warnings: [],
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
        present: true,
        status: "pass",
        severity: "skipped",
        command: "npm run smoke:phase1",
        hint: "ok",
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
    runtimeForensics: {
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
    },
    docs: [],
    phase2Links: [],
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
  for (const doc of REQUIRED_DEMO_DOCS) {
    const file = path.join(root, doc.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `# ${doc.label}\n`, "utf8");
  }

  const extraDocs = [
    "docs/90-archive/phase1-demo/PHASE_1_QUALITY_GATE.md",
    "docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md",
    "docs/10-coordination/phase2.md",
    "docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    "docs/90-archive/phase2-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
  ];
  for (const doc of extraDocs) {
    const file = path.join(root, doc);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `# ${path.basename(doc)}\n`, "utf8");
  }
}

async function writeJson(file: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}
