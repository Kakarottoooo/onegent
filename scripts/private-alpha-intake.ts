import { readFileSync, writeFileSync } from "node:fs";
import {
  buildPrivateAlphaIntakeReport,
  parsePrivateAlphaInput,
  renderPrivateAlphaMarkdown,
} from "@/lib/capture/private-alpha";

const DEFAULT_INPUT = "lib/capture/__fixtures__/private-alpha-submissions.json";

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

const inputPath = readArg("--input", DEFAULT_INPUT);
const input = readFileSync(inputPath, "utf8");
const submissions = parsePrivateAlphaInput(input, inputPath);
const report = buildPrivateAlphaIntakeReport(submissions, {
  minAverageScore: readRateArg("--min-average-score"),
  minFixtureSeedCount: readCountArg("--min-fixture-seeds"),
  maxSensitiveCount: readCountArg("--max-sensitive-count"),
});

const output = hasFlag("--json")
  ? JSON.stringify(report, null, 2)
  : renderPrivateAlphaMarkdown(report);

const outputPath = readArg("--output");
if (outputPath) writeFileSync(outputPath, output, "utf8");

console.log(output);

if (hasFlag("--gate") && !report.summary.gatePass) {
  console.error(`Private alpha intake gate failed:\n- ${report.summary.gateErrors.join("\n- ")}`);
  process.exitCode = 1;
}
