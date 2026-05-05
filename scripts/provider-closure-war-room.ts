import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  analyzeProviderClosureWarRoomBundle,
  formatProviderClosureDemoVerdictMarkdown,
  formatProviderClosureWarRoomPreflightMarkdown,
  formatProviderClosureWarRoomReportMarkdown,
  formatProviderClosureWarRoomSummaryMarkdown,
  normalizeProviderClosureVertical,
  PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES,
  ProviderClosureError,
  type ProviderClosureVertical,
  type ProviderClosureWarRoomResult,
} from "../lib/provider-closure";

export type ProviderClosureWarRoomCommand =
  | "preflight"
  | "analyze"
  | "summarize"
  | "demo-verdict";

export interface ProviderClosureWarRoomCliArgs {
  command: ProviderClosureWarRoomCommand;
  vertical?: ProviderClosureVertical;
  bundlePath?: string;
  markdown?: boolean;
  all?: boolean;
}

export interface ProviderClosureWarRoomFileOptions {
  cwd?: string;
  readFile?: (filePath: string) => Promise<string>;
  generatedAt?: string;
}

export interface ProviderClosureWarRoomCliIO
  extends ProviderClosureWarRoomFileOptions {
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export const PROVIDER_CLOSURE_WAR_ROOM_CLI_USAGE = [
  "Usage:",
  "  npx tsx scripts/provider-closure-war-room.ts preflight --vertical restaurant",
  "  npx tsx scripts/provider-closure-war-room.ts preflight --vertical flight",
  "  npx tsx scripts/provider-closure-war-room.ts preflight --vertical hotel",
  "  npx tsx scripts/provider-closure-war-room.ts analyze --vertical <restaurant|flight|hotel> --bundle <bundle.json>",
  "  npx tsx scripts/provider-closure-war-room.ts analyze --vertical <restaurant|flight|hotel> --bundle <bundle.json> --markdown",
  "  npx tsx scripts/provider-closure-war-room.ts summarize --all",
  "  npx tsx scripts/provider-closure-war-room.ts demo-verdict",
  "",
  "This CLI only reads local artifact JSON or bundled synthetic fixtures. It never starts a provider, worker, browser, booking flow, or OpenAI call.",
].join("\n");

const SYNTHETIC_SUMMARY_GENERATED_AT = "2026-05-04T22:00:00.000Z";

export function parseProviderClosureWarRoomCliArgs(
  argv: readonly string[],
): ProviderClosureWarRoomCliArgs {
  const args = argv.filter((arg) => arg.trim().length > 0);
  const command = args[0] as ProviderClosureWarRoomCommand | undefined;
  if (
    !command ||
    !["preflight", "analyze", "summarize", "demo-verdict"].includes(command)
  ) {
    throw new ProviderClosureError(
      "invalid_command",
      "Command is required. Use preflight, analyze, summarize, or demo-verdict.",
    );
  }

  const flags = parseFlags(args.slice(1));
  if (command === "preflight") {
    rejectUnexpectedFlags(flags, ["vertical"]);
    const vertical = normalizeProviderClosureVertical(flags.vertical);
    if (!vertical) {
      throw new ProviderClosureError(
        "invalid_kind",
        "Vertical is required. Use restaurant, flight, or hotel.",
      );
    }
    return { command, vertical };
  }

  if (command === "analyze") {
    rejectUnexpectedFlags(flags, ["vertical", "bundle", "markdown"]);
    const vertical = normalizeProviderClosureVertical(flags.vertical);
    if (!vertical) {
      throw new ProviderClosureError(
        "invalid_kind",
        "Vertical is required. Use restaurant, flight, or hotel.",
      );
    }
    if (!flags.bundle) {
      throw new ProviderClosureError(
        "usage",
        "Bundle path is required for analyze.",
      );
    }
    return {
      command,
      vertical,
      bundlePath: flags.bundle,
      markdown: flags.markdown === "true",
    };
  }

  if (command === "summarize") {
    rejectUnexpectedFlags(flags, ["all"]);
    if (flags.all !== "true") {
      throw new ProviderClosureError(
        "usage",
        "Use summarize --all to summarize bundled synthetic fixtures.",
      );
    }
    return { command, all: true };
  }

  rejectUnexpectedFlags(flags, []);
  return { command };
}

export async function runProviderClosureWarRoomCli(
  argv: readonly string[],
  io: ProviderClosureWarRoomCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));

  if (argv[0] === "-h" || argv[0] === "--help") {
    writeError(PROVIDER_CLOSURE_WAR_ROOM_CLI_USAGE);
    return 0;
  }

  try {
    const args = parseProviderClosureWarRoomCliArgs(argv);
    if (args.command === "preflight") {
      writeOutput(formatProviderClosureWarRoomPreflightMarkdown(args.vertical!));
      return 0;
    }

    if (args.command === "analyze") {
      const result = await analyzeProviderClosureWarRoomFile(args, io);
      writeOutput(
        args.markdown
          ? formatProviderClosureWarRoomReportMarkdown(result)
          : `${JSON.stringify(toProviderClosureWarRoomCliJson(result), null, 2)}\n`,
      );
      return 0;
    }

    const syntheticResults = analyzeSyntheticWarRoomFixtures(io.generatedAt);
    if (args.command === "summarize") {
      writeOutput(formatProviderClosureWarRoomSummaryMarkdown(syntheticResults));
      return 0;
    }

    writeOutput(formatProviderClosureDemoVerdictMarkdown(syntheticResults));
    return 0;
  } catch (error) {
    if (error instanceof ProviderClosureError) {
      writeError(`${error.message}\n${PROVIDER_CLOSURE_WAR_ROOM_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

export async function analyzeProviderClosureWarRoomFile(
  args: Pick<ProviderClosureWarRoomCliArgs, "vertical" | "bundlePath">,
  options: ProviderClosureWarRoomFileOptions = {},
): Promise<ProviderClosureWarRoomResult> {
  if (!args.vertical) {
    throw new ProviderClosureError(
      "invalid_kind",
      "Vertical is required. Use restaurant, flight, or hotel.",
    );
  }
  if (!args.bundlePath) {
    throw new ProviderClosureError(
      "usage",
      "Bundle path is required for analyze.",
    );
  }

  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), args.bundlePath);
  const readFile =
    options.readFile ?? ((filePath: string) => fs.readFile(filePath, "utf8"));

  let raw: string;
  try {
    raw = await readFile(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ProviderClosureError(
        "missing_file",
        `War-room bundle not found: ${resolvedPath}`,
      );
    }
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderClosureError(
      "invalid_json",
      `Invalid JSON in war-room bundle ${resolvedPath}: ${message}`,
    );
  }

  return analyzeProviderClosureWarRoomBundle(payload, args.vertical, {
    inputPath: resolvedPath,
    rawText: raw,
    generatedAt: options.generatedAt,
  });
}

export function analyzeSyntheticWarRoomFixtures(
  generatedAt = SYNTHETIC_SUMMARY_GENERATED_AT,
): ProviderClosureWarRoomResult[] {
  return PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES.map((fixture) =>
    analyzeProviderClosureWarRoomBundle(fixture, fixture.vertical, {
      generatedAt,
    }),
  );
}

export function toProviderClosureWarRoomCliJson(
  result: ProviderClosureWarRoomResult,
): Record<string, unknown> {
  const { evidence } = result;
  return {
    schemaVersion: result.schemaVersion,
    generatedAt: result.generatedAt,
    vertical: result.vertical,
    kind: result.kind,
    verdict: result.verdict,
    terminalState: result.terminalState,
    evidence: {
      schemaVersion: evidence.schemaVersion,
      vertical: evidence.vertical,
      kind: evidence.kind,
      fixtureId: evidence.fixtureId,
      inputPath: evidence.inputPath,
      synthetic: evidence.synthetic,
      liveAttempt: evidence.liveAttempt,
      evidenceCapturedAt: evidence.evidenceCapturedAt,
      jobId: evidence.jobId,
      taskId: evidence.taskId,
      provider: evidence.provider,
      scenario: evidence.scenario,
      status: evidence.status,
      dbRow: evidence.completeness.hasDbRow ? "[present]" : null,
      job: evidence.completeness.hasJob ? "[present]" : null,
      workerLogExcerpt: evidence.workerLogExcerpt
        ? `[present: ${evidence.workerLogExcerpt.length} chars]`
        : null,
      workerLogPath: evidence.workerLogPath,
      screenshotPaths: evidence.screenshotPaths,
      liveSnapshotPaths: evidence.liveSnapshotPaths,
      benchmarkReportPath: evidence.benchmarkReportPath,
      notes: evidence.notes.length > 0 ? `[present: ${evidence.notes.length}]` : [],
      completeness: evidence.completeness,
      freshness: evidence.freshness,
    },
    closureAnalysis: {
      terminalOutcome: result.closureAnalysis.terminalOutcome,
      outcomeLabel: result.closureAnalysis.outcomeLabel,
      confidence: result.closureAnalysis.confidence,
      providerState: result.closureAnalysis.providerAnalysis.state,
      runtimeClass: result.closureAnalysis.runtimeClass,
      runtimeSeverity: result.closureAnalysis.runtimeSeverity,
      exactNextStep: result.closureAnalysis.exactNextStep,
    },
    unsafeFindings: result.unsafeFindings,
    whatHappened: result.whatHappened,
    rootCause: result.rootCause,
    nextSingleAction: result.nextSingleAction,
    regressionChecklist: result.regressionChecklist,
    demoReadiness: result.demoReadiness,
    hardStops: result.hardStops,
  };
}

function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--markdown") {
      flags.markdown = "true";
      continue;
    }
    if (arg === "--all") {
      flags.all = "true";
      continue;
    }
    if (arg.startsWith("--vertical=")) {
      flags.vertical = arg.slice("--vertical=".length);
      continue;
    }
    if (arg === "--vertical") {
      flags.vertical = args[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      flags.bundle = arg.slice("--bundle=".length);
      continue;
    }
    if (arg === "--bundle") {
      flags.bundle = args[++i] ?? "";
      continue;
    }
    throw new ProviderClosureError("usage", `Unexpected argument: ${arg}`);
  }
  return flags;
}

function rejectUnexpectedFlags(
  flags: Record<string, string>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(flags).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new ProviderClosureError(
      "usage",
      `Unexpected option(s): ${unexpected.join(", ")}`,
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runProviderClosureWarRoomCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
