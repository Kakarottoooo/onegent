#!/usr/bin/env node
/**
 * No-live demo freeze checker.
 *
 * Reads local artifacts and docs only:
 *   - latest Phase 1 quality gate artifact
 *   - latest founder E2E artifact
 *   - required demo docs
 *   - required demo route order and hard stops
 *
 * It does not query DBs, start workers, call providers, start live sessions,
 * enter payment/OTP/CAPTCHA/login data, or click final confirmation.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEMO_HARD_STOPS,
  DEMO_ROUTE_ORDER,
  loadDemoEvidenceSnapshot,
  type DemoEvidenceSnapshot,
  type DemoHardStop,
  type DemoReadinessVerdict,
  type DemoRouteStep,
} from "../lib/demo-evidence";

export interface DemoFreezeDocStatus {
  label: string;
  path: string;
  exists: boolean;
}

export interface DemoFreezeReport {
  generatedAt: string;
  verdict: DemoReadinessVerdict;
  latestGateFile: string | null;
  founderE2eFile: string | null;
  blockers: string[];
  warnings: string[];
  docs: DemoFreezeDocStatus[];
  requiredRoutes: DemoRouteStep[];
  hardStops: DemoHardStop[];
  phase2Warning: string;
}

export const REQUIRED_DEMO_DOCS: ReadonlyArray<Omit<DemoFreezeDocStatus, "exists">> = [
  {
    label: "YC demo runbook",
    path: "docs/90-archive/phase1-demo/YC_DEMO_RUNBOOK.md",
  },
  {
    label: "Demo freeze acceptance",
    path: "docs/90-archive/phase1-demo/DEMO_FREEZE_ACCEPTANCE.md",
  },
  {
    label: "YC demo operator card",
    path: "docs/90-archive/phase1-demo/YC_DEMO_OPERATOR_CARD.md",
  },
  {
    label: "Demo Control Room",
    path: "docs/90-archive/phase1-demo/DEMO_CONTROL_ROOM.md",
  },
];

const PHASE2_WARNING =
  "Phase 2 is audited and not live-verified. Do not present Expedia, Booking.com, or Hotels.com as live demo-ready.";

export async function loadDemoFreezeReport(
  options: { generatedAt?: string } = {},
): Promise<DemoFreezeReport> {
  const snapshot = await loadDemoEvidenceSnapshot(options);
  const docs = await loadDemoDocs();
  return buildDemoFreezeReport(snapshot, docs);
}

export function buildDemoFreezeReport(
  snapshot: DemoEvidenceSnapshot,
  docs: DemoFreezeDocStatus[],
): DemoFreezeReport {
  const warnings = [...snapshot.readiness.warnings];
  const missingDocs = docs.filter((doc) => !doc.exists);
  if (missingDocs.length > 0) {
    warnings.push(
      `Missing required demo docs: ${missingDocs.map((doc) => doc.path).join(", ")}`,
    );
  }

  const verdict = deriveFreezeVerdict({
    snapshotVerdict: snapshot.readiness.verdict,
    blockers: snapshot.readiness.blockers,
    warnings,
  });

  return {
    generatedAt: snapshot.generatedAt,
    verdict,
    latestGateFile: snapshot.phase1Gate.relPath,
    founderE2eFile: snapshot.founderE2e.relPath,
    blockers: snapshot.readiness.blockers,
    warnings,
    docs,
    requiredRoutes: snapshot.routeOrder,
    hardStops: snapshot.hardStops,
    phase2Warning: PHASE2_WARNING,
  };
}

export function formatDemoFreezeMarkdown(report: DemoFreezeReport): string {
  const lines: string[] = [];

  lines.push("# Demo Freeze Check");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Latest gate file: ${report.latestGateFile ?? "missing"}`);
  lines.push(`Founder E2E file: ${report.founderE2eFile ?? "missing"}`);
  lines.push("");

  lines.push("## Blockers");
  lines.push("");
  pushList(lines, report.blockers);
  lines.push("");

  lines.push("## Warnings");
  lines.push("");
  pushList(lines, [...report.warnings, report.phase2Warning]);
  lines.push("");

  lines.push("## Required Demo Routes");
  lines.push("");
  for (const route of report.requiredRoutes) {
    lines.push(`${route.index}. ${route.href} - ${route.label}`);
    lines.push(`   - ${route.purpose}`);
  }
  lines.push("");

  lines.push("## Demo Docs");
  lines.push("");
  for (const doc of report.docs) {
    lines.push(`- ${doc.exists ? "present" : "missing"} - ${doc.label}: ${doc.path}`);
  }
  lines.push("");

  lines.push("## Hard Stops");
  lines.push("");
  for (const stop of report.hardStops) {
    lines.push(`- ${stop.trigger}`);
    lines.push(`  - ${stop.action}`);
  }
  lines.push("");

  lines.push("## Safety Boundary");
  lines.push("");
  lines.push(
    "No live provider, payment, CVV, OTP, CAPTCHA, login bypass, retry, or final confirmation is authorized by this checker.",
  );

  return lines.join("\n");
}

async function loadDemoDocs(): Promise<DemoFreezeDocStatus[]> {
  const out: DemoFreezeDocStatus[] = [];
  for (const doc of REQUIRED_DEMO_DOCS) {
    out.push({
      ...doc,
      exists: await pathExists(path.resolve(process.cwd(), doc.path)),
    });
  }
  return out;
}

function deriveFreezeVerdict(input: {
  snapshotVerdict: DemoReadinessVerdict;
  blockers: string[];
  warnings: string[];
}): DemoReadinessVerdict {
  if (input.snapshotVerdict === "blocked" || input.blockers.length > 0) {
    return "blocked";
  }
  if (input.snapshotVerdict === "needs_attention" || input.warnings.length > 0) {
    return "needs_attention";
  }
  return "ready";
}

function pushList(lines: string[], items: string[]): void {
  if (items.length === 0) {
    lines.push("- None");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const report = await loadDemoFreezeReport();
  // eslint-disable-next-line no-console
  console.log(formatDemoFreezeMarkdown(report));
  process.exitCode = report.verdict === "blocked" ? 1 : 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[demo-freeze] internal error:", err);
    process.exitCode = 3;
  });
}
