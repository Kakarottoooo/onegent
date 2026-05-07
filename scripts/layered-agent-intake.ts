import { readFileSync, writeFileSync } from "node:fs";
import {
  classifyAgentIntakeQueue,
  parseAgentIntakeInput,
  renderAgentIntakeMarkdown,
  type AgentIntakeQueueReport,
} from "@/lib/internal-benchmark/agent-intake";

function readArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readCsvArg(name: string): string[] {
  return readArg(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const inputPath = readArg("--input");
if (!inputPath) {
  throw new Error("Missing --input <agent-return-report.json|md>.");
}

const source = readFileSync(inputPath, "utf8");
const reports = parseAgentIntakeInput(source, inputPath);
const queueReport = classifyAgentIntakeQueue(reports, {
  requiredBaseBranch: readArg("--required-base-branch", "origin/codex/goal-core-reliability-long-run"),
  requiredBaseCommit: readArg("--required-base-commit") || undefined,
  recommendedBase: readArg("--recommended-base") || undefined,
  mergedBranches: readCsvArg("--merged-branches"),
});

const output = hasFlag("--json")
  ? JSON.stringify(queueReport, null, 2)
  : renderAgentIntakeMarkdown(queueReport);

const outputPath = readArg("--output");
if (outputPath) {
  writeFileSync(outputPath, output, "utf8");
}

console.log(output);

if (hasFlag("--fail-on-reject") && queueReport.summary.reject > 0) {
  process.exitCode = 1;
}

if (hasFlag("--fail-on-followup") && hasBlockingFollowup(queueReport)) {
  process.exitCode = 1;
}

function hasBlockingFollowup(report: AgentIntakeQueueReport): boolean {
  return report.summary.reject > 0 || report.summary.needsFollowup > 0;
}
