import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  analyzeProviderClosureArtifact,
  formatProviderClosurePreflightMarkdown,
  formatProviderClosureReportMarkdown,
  normalizeProviderClosureKind,
  ProviderClosureError,
  type ProviderClosureAnalysis,
  type ProviderClosureKind,
} from "../lib/provider-closure";

export type ProviderClosureCommand = "preflight" | "analyze" | "report";

export interface ProviderClosureCliArgs {
  command: ProviderClosureCommand;
  kind: ProviderClosureKind;
  artifactPath?: string;
  markdown?: boolean;
}

export interface ProviderClosureFileOptions {
  cwd?: string;
  readFile?: (filePath: string) => Promise<string>;
}

export interface ProviderClosureCliIO extends ProviderClosureFileOptions {
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export const PROVIDER_CLOSURE_CLI_USAGE = [
  "Usage:",
  "  npx tsx scripts/provider-closure.ts preflight --kind restaurant",
  "  npx tsx scripts/provider-closure.ts preflight --kind flight",
  "  npx tsx scripts/provider-closure.ts preflight --kind hotel",
  "  npx tsx scripts/provider-closure.ts analyze --kind <restaurant|flight|hotel> --artifact <bundle.json>",
  "  npx tsx scripts/provider-closure.ts report --kind <restaurant|flight|hotel> --artifact <bundle.json> --markdown",
  "",
  "This CLI only reads local artifact JSON. It never starts a provider run, browser, worker, or OpenAI call.",
].join("\n");

export function parseProviderClosureCliArgs(
  argv: readonly string[],
): ProviderClosureCliArgs {
  const args = argv.filter((arg) => arg.trim().length > 0);
  const command = args[0] as ProviderClosureCommand | undefined;
  if (!command || !["preflight", "analyze", "report"].includes(command)) {
    throw new ProviderClosureError(
      "invalid_command",
      "Command is required. Use preflight, analyze, or report.",
    );
  }

  const flags = parseFlags(args.slice(1));
  const kind = normalizeProviderClosureKind(flags.kind);
  if (!kind) {
    throw new ProviderClosureError(
      "invalid_kind",
      "Kind is required. Use restaurant, flight, or hotel.",
    );
  }

  if (command === "preflight") {
    rejectUnexpectedFlags(flags, ["kind"]);
    return { command, kind };
  }

  if (!flags.artifact) {
    throw new ProviderClosureError(
      "usage",
      "Artifact path is required for analyze/report.",
    );
  }
  rejectUnexpectedFlags(flags, ["kind", "artifact", "markdown"]);

  return {
    command,
    kind,
    artifactPath: flags.artifact,
    markdown: flags.markdown === "true",
  };
}

export async function runProviderClosureCli(
  argv: readonly string[],
  io: ProviderClosureCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));

  if (argv[0] === "-h" || argv[0] === "--help") {
    writeError(PROVIDER_CLOSURE_CLI_USAGE);
    return 0;
  }

  try {
    const args = parseProviderClosureCliArgs(argv);
    if (args.command === "preflight") {
      writeOutput(formatProviderClosurePreflightMarkdown(args.kind));
      return 0;
    }

    const analysis = await analyzeProviderClosureFile(args, io);
    if (args.command === "report") {
      writeOutput(formatProviderClosureReportMarkdown(analysis));
    } else {
      writeOutput(`${JSON.stringify(analysis, null, 2)}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ProviderClosureError) {
      writeError(`${error.message}\n${PROVIDER_CLOSURE_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

export async function analyzeProviderClosureFile(
  args: Pick<ProviderClosureCliArgs, "kind" | "artifactPath">,
  options: ProviderClosureFileOptions = {},
): Promise<ProviderClosureAnalysis> {
  if (!args.artifactPath) {
    throw new ProviderClosureError(
      "usage",
      "Artifact path is required for analyze/report.",
    );
  }
  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), args.artifactPath);
  const readFile = options.readFile ?? ((filePath: string) => fs.readFile(filePath, "utf8"));

  let raw: string;
  try {
    raw = await readFile(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ProviderClosureError(
        "missing_file",
        `Artifact file not found: ${resolvedPath}`,
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
      `Invalid JSON in artifact ${resolvedPath}: ${message}`,
    );
  }

  return analyzeProviderClosureArtifact(payload, args.kind, {
    inputPath: resolvedPath,
    rawText: raw,
  });
}

function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--markdown") {
      flags.markdown = "true";
      continue;
    }
    if (arg.startsWith("--kind=")) {
      flags.kind = arg.slice("--kind=".length);
      continue;
    }
    if (arg === "--kind") {
      flags.kind = args[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      flags.artifact = arg.slice("--artifact=".length);
      continue;
    }
    if (arg === "--artifact") {
      flags.artifact = args[++i] ?? "";
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
  runProviderClosureCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
