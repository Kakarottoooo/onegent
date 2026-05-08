import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  buildStage0BActivityLabEvidenceReport,
  renderStage0BActivityLabMarkdown,
} from "@/lib/stage0b-skill-runtime";

type Args = {
  evidenceRoot: string;
  resultPaths: string[];
  json: boolean;
  markdown: boolean;
  output?: string;
  help: boolean;
};

export function parseStage0BActivityLabReportArgs(argv: string[]): Args {
  const args: Args = {
    evidenceRoot: ".stage0b-evidence",
    resultPaths: [],
    json: false,
    markdown: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--evidence-root") {
      if (!next) throw new Error("--evidence-root requires a value");
      args.evidenceRoot = next;
      index += 1;
    } else if (token === "--result" || token === "--input") {
      if (!next) throw new Error(`${token} requires a value`);
      args.resultPaths.push(next);
      index += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--markdown") {
      args.markdown = true;
    } else if (token === "--output") {
      if (!next) throw new Error("--output requires a value");
      args.output = next;
      index += 1;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    } else {
      args.resultPaths.push(token);
    }
  }

  return args;
}

export function main(argv = process.argv.slice(2)): void {
  const args = parseStage0BActivityLabReportArgs(argv);
  if (args.help) {
    console.log(helpText());
    return;
  }
  const report = buildStage0BActivityLabEvidenceReport({
    evidenceRoot: args.evidenceRoot,
    ...(args.resultPaths.length > 0 ? { resultPaths: args.resultPaths } : {}),
  });
  const output = args.json && !args.markdown
    ? JSON.stringify(report, null, 2)
    : renderStage0BActivityLabMarkdown(report);
  if (args.output) writeFileSync(args.output, output, "utf8");
  console.log(output);
}

function helpText(): string {
  return [
    "Usage: npx tsx scripts/stage0b-activity-lab-report.ts [--json|--markdown] [--evidence-root .stage0b-evidence] [--result path/to/result.json]",
    "",
    "Reads local Stage 0B result.json files only. It never starts Browser Harness, providers, workers, or OpenAI.",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
