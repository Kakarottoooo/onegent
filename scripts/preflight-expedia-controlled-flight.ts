import { pathToFileURL } from "node:url";

import {
  EXPEDIA_CONTROLLED_RETRY_PROMPT,
  EXPEDIA_CONTROLLED_RETRY_START_URL,
  EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS,
  EXPEDIA_FLIGHT_HARD_STOPS,
  validateExpediaFlightLiveReadiness,
  type ExpediaFlightLiveReadinessInput,
  type ExpediaFlightLiveReadinessResult,
} from "../lib/runtime-forensics/expedia-flight-live-readiness";

export type ExpediaControlledFlightPreflightErrorCode =
  | "usage"
  | "unsafe_scope"
  | "missing_confirmation";

export class ExpediaControlledFlightPreflightError extends Error {
  readonly code: ExpediaControlledFlightPreflightErrorCode;
  readonly exitCode = 1;

  constructor(code: ExpediaControlledFlightPreflightErrorCode, message: string) {
    super(message);
    this.name = "ExpediaControlledFlightPreflightError";
    this.code = code;
  }
}

export interface ExpediaControlledFlightPreflightArgs {
  prompt: string;
  startUrl: string;
  confirmedOneControlledRetry: boolean;
}

export interface ExpediaControlledFlightPreflightIO {
  env?: Record<string, string | undefined>;
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export const EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_USAGE = [
  "Usage:",
  "  npx tsx scripts/preflight-expedia-controlled-flight.ts --confirm-one-controlled-retry --prompt <exact-prompt> --start-url <exact-url>",
  "",
  "This script is pure no-live readiness validation. It never starts a provider run.",
  "It only supports the exact Expedia MCO -> BNA 2026-06-01 controlled retry.",
].join("\n");

const UNSAFE_SCOPE_ARGS = new Set([
  "--all",
  "--broad",
  "--live",
  "--provider",
  "--providers",
  "--kind",
  "--vertical",
  "--suite",
]);

export function parseExpediaControlledFlightPreflightArgs(
  argv: readonly string[],
): ExpediaControlledFlightPreflightArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    throw new ExpediaControlledFlightPreflightError("usage", EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_USAGE);
  }

  const args = [...argv];
  let prompt: string | undefined;
  let startUrl: string | undefined;
  let confirmedOneControlledRetry = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    const argName = arg.split("=")[0] ?? arg;
    if (UNSAFE_SCOPE_ARGS.has(argName)) {
      throw new ExpediaControlledFlightPreflightError(
        "unsafe_scope",
        `Unsafe broad-run argument is not supported: ${argName}`,
      );
    }

    if (arg === "--confirm-one-controlled-retry") {
      confirmedOneControlledRetry = true;
      continue;
    }
    if (arg === "--prompt") {
      prompt = args[++index];
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      prompt = arg.slice("--prompt=".length);
      continue;
    }
    if (arg === "--start-url") {
      startUrl = args[++index];
      continue;
    }
    if (arg.startsWith("--start-url=")) {
      startUrl = arg.slice("--start-url=".length);
      continue;
    }

    throw new ExpediaControlledFlightPreflightError(
      "usage",
      `Unexpected argument: ${arg}`,
    );
  }

  if (!confirmedOneControlledRetry) {
    throw new ExpediaControlledFlightPreflightError(
      "missing_confirmation",
      "Missing --confirm-one-controlled-retry. This preflight only covers one exact approved task.",
    );
  }
  if (!prompt || !startUrl) {
    throw new ExpediaControlledFlightPreflightError(
      "usage",
      "Both --prompt and --start-url are required.",
    );
  }

  return {
    prompt,
    startUrl,
    confirmedOneControlledRetry,
  };
}

export function buildExpediaControlledFlightReadinessInput(
  args: ExpediaControlledFlightPreflightArgs,
  env: Record<string, string | undefined>,
): ExpediaFlightLiveReadinessInput {
  return {
    env,
    prompt: args.prompt,
    startUrl: args.startUrl,
    hardStops: [...EXPEDIA_FLIGHT_HARD_STOPS],
    artifactPaths: {
      workerLogPath: EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.workerLogPath,
      screenshotPaths: [EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.screenshotGlob],
      liveSnapshotPaths: [EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.liveSnapshotGlob],
      benchmarkReportPath: EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.benchmarkReportGlob,
    },
  };
}

export function formatExpediaControlledFlightPreflightMarkdown(
  result: ExpediaFlightLiveReadinessResult,
): string {
  const lines: string[] = [];
  lines.push("## Expedia Controlled Flight Preflight");
  lines.push("");
  lines.push(`- **Status**: \`${result.ok ? "pass" : "fail"}\``);
  lines.push("- **Task**: `MCO -> BNA, 2026-06-01, 1 adult, economy`");
  lines.push("- **Input prompt**: exact controlled prompt required");
  lines.push("- **Start URL**: exact controlled Expedia flight URL required");
  lines.push("- **Env values**: intentionally omitted");
  lines.push("");
  lines.push("### Checks");
  lines.push("");
  for (const check of result.checks) {
    lines.push(`- ${check.ok ? "[pass]" : "[fail]"} **${check.label}**: ${check.detail}`);
  }
  lines.push("");
  lines.push("### Hard Stops");
  lines.push("");
  for (const stop of EXPEDIA_FLIGHT_HARD_STOPS) {
    lines.push(`- ${stop}`);
  }
  return lines.join("\n");
}

export async function runExpediaControlledFlightPreflightCli(
  argv: readonly string[],
  io: ExpediaControlledFlightPreflightIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));

  try {
    const parsed = parseExpediaControlledFlightPreflightArgs(argv);
    const result = validateExpediaFlightLiveReadiness(
      buildExpediaControlledFlightReadinessInput(parsed, io.env ?? process.env),
    );
    writeOutput(formatExpediaControlledFlightPreflightMarkdown(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof ExpediaControlledFlightPreflightError) {
      const message = error.code === "usage"
        ? error.message
        : `${error.message}\n${EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_USAGE}`;
      writeError(message);
      return error.code === "usage" && error.message === EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_USAGE ? 0 : error.exitCode;
    }
    throw error;
  }
}

export const EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_EXAMPLE = {
  prompt: EXPEDIA_CONTROLLED_RETRY_PROMPT,
  startUrl: EXPEDIA_CONTROLLED_RETRY_START_URL,
} as const;

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runExpediaControlledFlightPreflightCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
