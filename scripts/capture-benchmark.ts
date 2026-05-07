import { writeFileSync } from "node:fs";
import {
  evaluateCaptureBenchmarkGate,
  renderCaptureBenchmarkMarkdown,
  runCaptureBenchmark,
  type CaptureBenchmarkReport,
  type CaptureBenchmarkVerticalArg,
} from "@/lib/capture/benchmark";

function readArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readRateArg(name: string): number | undefined {
  const value = readArg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric ${name}, got ${value}`);
  return parsed > 1 ? parsed / 100 : parsed;
}

function readCountArg(name: string): number | undefined {
  const value = readArg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric ${name}, got ${value}`);
  return Math.floor(parsed);
}

const vertical = readArg("--vertical", "all") as CaptureBenchmarkVerticalArg;
if (!["all", "restaurant", "hotel", "flight", "activity", "trip", "ambiguous", "refine", "profile", "chitchat"].includes(vertical)) {
  throw new Error(`Unsupported --vertical ${vertical}`);
}

const count = readCountArg("--count");
const report = runCaptureBenchmark({ vertical, count });
const gate = hasFlag("--gate")
  ? evaluateCaptureBenchmarkGate(report, {
      maxRoutingMismatch: readCountArg("--max-routing-mismatch"),
      minTaskReadyAccuracy: readRateArg("--min-task-ready-accuracy"),
      minSourceMetadataCompleteness: readRateArg("--min-source-metadata-completeness"),
      minArtifactCompleteness: readRateArg("--min-artifact-completeness"),
      maxUnknownFailureRate: readRateArg("--max-unknown-failure-rate"),
    })
  : null;

const output = hasFlag("--json")
  ? JSON.stringify(withGate(report, gate), null, 2)
  : renderCaptureBenchmarkMarkdown(report) + renderGate(gate);

const outputPath = readArg("--output");
if (outputPath) writeFileSync(outputPath, output, "utf8");

console.log(output);

if (gate && !gate.pass) {
  console.error(`Capture benchmark gate failed:\n- ${gate.errors.join("\n- ")}`);
  process.exitCode = 1;
}

function withGate(
  reportBody: CaptureBenchmarkReport,
  gateResult: ReturnType<typeof evaluateCaptureBenchmarkGate> | null,
): CaptureBenchmarkReport | (CaptureBenchmarkReport & { gate: NonNullable<typeof gateResult> }) {
  return gateResult ? { ...reportBody, gate: gateResult } : reportBody;
}

function renderGate(gateResult: ReturnType<typeof evaluateCaptureBenchmarkGate> | null): string {
  if (!gateResult) return "";
  return `\n\n## Gate\n${gateResult.pass ? "PASS" : `FAIL\n- ${gateResult.errors.join("\n- ")}`}`;
}
