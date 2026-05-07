import { readFileSync, writeFileSync } from "node:fs";
import {
  buildLayeredOperatorCockpit,
  parseLayeredOperatorAgentInput,
  parseLayeredOperatorBenchmarkInput,
  parseMergedCommitsInput,
  renderLayeredOperatorCockpitMarkdown,
} from "@/lib/internal-benchmark/layered-operator-cockpit";

function readArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readOptionalFile(pathname: string): string {
  return pathname ? readFileSync(pathname, "utf8") : "";
}

const benchmarkPath = readArg("--benchmark");
const intakePath = readArg("--intake");
if (!benchmarkPath) throw new Error("Missing --benchmark <layered-benchmark-report.json|md>.");
if (!intakePath) throw new Error("Missing --intake <agent-intake-queue.json|md>.");

const mergedCommitText = [
  readArg("--merged-commits"),
  readOptionalFile(readArg("--merged-commits-file")),
].filter(Boolean).join("\n");

const report = buildLayeredOperatorCockpit({
  benchmarkReport: parseLayeredOperatorBenchmarkInput(readFileSync(benchmarkPath, "utf8"), benchmarkPath),
  agentReports: parseLayeredOperatorAgentInput(readFileSync(intakePath, "utf8"), intakePath),
  recentMergedCommits: parseMergedCommitsInput(mergedCommitText),
  requiredBaseBranch: readArg("--required-base-branch", "origin/codex/goal-core-reliability-long-run"),
  requiredBaseCommit: readArg("--required-base-commit") || undefined,
  recommendedBase: readArg("--recommended-base") || undefined,
});

const output = hasFlag("--json")
  ? JSON.stringify(report, null, 2)
  : renderLayeredOperatorCockpitMarkdown(report);

const outputPath = readArg("--output");
if (outputPath) writeFileSync(outputPath, output, "utf8");

console.log(output);

if (hasFlag("--fail-on-gate") && report.benchmarkGate.pass === false) process.exitCode = 1;
if (hasFlag("--fail-on-conflict") && report.conflictWarnings.length > 0) process.exitCode = 1;
