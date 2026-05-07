import { writeFileSync } from "node:fs";
import {
  evaluateLayeredBenchmarkGate,
  renderLayeredBenchmarkMarkdown,
  runLayeredNoLiveBenchmark,
  type LayeredBenchmarkReport,
  type LayeredBenchmarkVerticalArg,
} from "@/lib/execution-layer/layered-benchmark";

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

const vertical = readArg("--vertical", "all") as LayeredBenchmarkVerticalArg;
if (!["all", "restaurant", "hotel", "flight", "activity"].includes(vertical)) {
  throw new Error(`Unsupported --vertical ${vertical}`);
}

const mode = readArg("--mode", "no-live");
if (mode !== "no-live") {
  throw new Error("Only --mode no-live is implemented. This script never runs providers or Browser Harness.");
}

const count = readCountArg("--count") ?? 10;
const report = runLayeredNoLiveBenchmark({
  vertical,
  count,
  mode: "no-live",
});

const gate = hasFlag("--gate")
  ? evaluateLayeredBenchmarkGate(report, {
      minArtifactCompletenessRate: readRateArg("--min-artifact-completeness"),
      maxUnknownFailureRate: readRateArg("--max-unknown-failure-rate"),
      maxRoutingMismatch: readCountArg("--max-routing-mismatch"),
      minL1DirectPassRate: readRateArg("--min-l1-direct-pass"),
      minL1PlusL2RecoveredPassRate: readRateArg("--min-l1-l2-recovered-pass"),
    })
  : null;

const output = hasFlag("--json")
  ? JSON.stringify(withGate(report, gate), null, 2)
  : renderLayeredBenchmarkMarkdown(report) + renderGate(gate);

const outputPath = readArg("--output", "");
if (outputPath) {
  writeFileSync(outputPath, output, "utf8");
}

console.log(output);

if (gate && !gate.pass) {
  console.error(`Layered benchmark gate failed:\n- ${gate.errors.join("\n- ")}`);
  process.exitCode = 1;
}

function withGate(
  reportBody: LayeredBenchmarkReport,
  gateResult: ReturnType<typeof evaluateLayeredBenchmarkGate> | null,
): LayeredBenchmarkReport | (LayeredBenchmarkReport & { gate: NonNullable<typeof gateResult> }) {
  return gateResult ? { ...reportBody, gate: gateResult } : reportBody;
}

function renderGate(gateResult: ReturnType<typeof evaluateLayeredBenchmarkGate> | null): string {
  if (!gateResult) return "";
  return `\n\n## Gate\n${gateResult.pass ? "PASS" : `FAIL\n- ${gateResult.errors.join("\n- ")}`}`;
}
