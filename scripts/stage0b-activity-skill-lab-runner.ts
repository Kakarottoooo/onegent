import { pathToFileURL } from "node:url";

import {
  formatStage0BLabDryRun,
  parseStage0BLabRunnerArgs,
  runStage0BLabEntry,
  selectStage0BLabEntries,
} from "@/lib/stage0b-skill-runtime/lab-runner";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseStage0BLabRunnerArgs(argv);
  const entries = selectStage0BLabEntries(args);

  if (args.dryRun || !args.live) {
    console.log(formatStage0BLabDryRun(entries));
    if (!args.live) {
      console.log("");
      console.log("No browser was launched. Add --live to run Browser Harness and write .stage0b-evidence/.");
    }
    return;
  }

  const summaries = [];
  for (const entry of entries) {
    try {
      const summary = runStage0BLabEntry(entry, args);
      summaries.push(summary);
      console.log(`${entry.id}\t${summary.classification}\t${summary.safeNextAction}\t${summary.resultPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${entry.id}\tERROR\t${message}`);
      if (args.stopOnError) {
        throw error;
      }
    }
  }

  console.log(JSON.stringify({
    total: summaries.length,
    by_classification: countBy(summaries.map((summary) => summary.classification)),
    results: summaries,
  }, null, 2));
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
