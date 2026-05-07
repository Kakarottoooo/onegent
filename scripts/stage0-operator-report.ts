import { writeFileSync } from "node:fs";
import {
  buildStage0OperatorReport,
  renderStage0OperatorMarkdown,
} from "@/lib/internal-benchmark/stage0-operator-report";
import type { CaptureBenchmarkVerticalArg } from "@/lib/capture/benchmark";

function readArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readCountArg(name: string): number | undefined {
  const value = readArg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric ${name}, got ${value}`);
  return Math.floor(parsed);
}

const captureVertical = readArg("--capture-vertical", "all") as CaptureBenchmarkVerticalArg;
const report = buildStage0OperatorReport({
  captureVertical,
  captureCount: readCountArg("--capture-count"),
  internalCount: readCountArg("--internal-count"),
  layeredCount: readCountArg("--layered-count"),
});

const output = hasFlag("--json")
  ? JSON.stringify(report, null, 2)
  : renderStage0OperatorMarkdown(report);

const outputPath = readArg("--output");
if (outputPath) writeFileSync(outputPath, output, "utf8");

console.log(output);
