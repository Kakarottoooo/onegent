import { writeFileSync } from "node:fs";
import {
  evaluateInternalBenchmarkGate,
  renderInternalBenchmarkMarkdown,
  runInternalNoLiveBenchmark,
  type InternalBenchmarkReport,
  type InternalBenchmarkVerticalArg,
} from "@/lib/internal-benchmark";

function readArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readRateArg(name: string): number | undefined {
  const value = readArg(name, "");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric ${name}, got ${value}`);
  }
  return parsed > 1 ? parsed / 100 : parsed;
}

function readCountArg(name: string): number | undefined {
  const value = readArg(name, "");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric ${name}, got ${value}`);
  }
  return Math.floor(parsed);
}

const vertical = readArg("--vertical", "all") as InternalBenchmarkVerticalArg;
if (!["all", "restaurant", "hotel", "flight", "activity", "trip"].includes(vertical)) {
  throw new Error(`Unsupported --vertical ${vertical}`);
}

const mode = readArg("--mode", "no-live");
if (mode !== "no-live") {
  throw new Error("Only --mode no-live is implemented. small-live/live are documented future modes only.");
}

const count = Number(readArg("--count", "10"));
const report = runInternalNoLiveBenchmark({
  vertical,
  count: Number.isFinite(count) ? count : 10,
  mode: "no-live",
});

let gate:
  | ReturnType<typeof evaluateInternalBenchmarkGate>
  | null = null;

if (hasFlag("--gate")) {
  gate = evaluateInternalBenchmarkGate(report, {
    minSuccessRate: readRateArg("--min-success-rate"),
    minArtifactCompletenessRate: readRateArg("--min-artifact-completeness"),
    maxRoutingMismatch: readCountArg("--max-routing-mismatch"),
    maxOwnerUnassigned: readCountArg("--max-owner-unassigned"),
    maxFailureCounts: {
      nlu_wrong_vertical: readCountArg("--max-nlu-wrong-vertical"),
      nlu_constraint_lost: readCountArg("--max-nlu-constraint-lost"),
      task_workspace_artifact_incomplete: readCountArg("--max-artifact-incomplete"),
      provider_simulated_block: readCountArg("--max-provider-simulated-block"),
      manual_boundary_expected: readCountArg("--max-manual-boundary"),
      unsupported_request: readCountArg("--max-unsupported-request"),
      stale_session_or_provider_degraded: readCountArg("--max-stale-session-or-provider-degraded"),
      performance_budget_exceeded: readCountArg("--max-performance-budget-exceeded"),
    },
  });
}

const output = hasFlag("--json")
  ? JSON.stringify(withGate(report, gate), null, 2)
  : renderInternalBenchmarkMarkdown(report) + renderGate(gate);
const outputPath = readArg("--output", "");
if (outputPath) {
  writeFileSync(outputPath, output, "utf8");
}

if (hasFlag("--json")) {
  console.log(output);
} else {
  console.log(output);
}

if (gate && !gate.pass) {
  console.error(`Internal benchmark gate failed:\n- ${gate.errors.join("\n- ")}`);
  process.exitCode = 1;
}

function withGate(
  report: InternalBenchmarkReport,
  gateResult: ReturnType<typeof evaluateInternalBenchmarkGate> | null,
): InternalBenchmarkReport | (InternalBenchmarkReport & { gate: NonNullable<typeof gateResult> }) {
  return gateResult ? { ...report, gate: gateResult } : report;
}

function renderGate(gateResult: ReturnType<typeof evaluateInternalBenchmarkGate> | null): string {
  if (!gateResult) return "";
  return `\n\n## Gate\n${gateResult.pass ? "PASS" : `FAIL\n- ${gateResult.errors.join("\n- ")}`}`;
}
