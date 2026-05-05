import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatExpediaRetryArtifactBundleMarkdown,
  type ExpediaRetryArtifactBundle,
} from "../lib/runtime-forensics/expedia-retry-analysis";

export type ExpediaRetryArtifactCliErrorCode =
  | "usage"
  | "missing_file"
  | "invalid_json"
  | "invalid_bundle"
  | "empty_bundle";

export class ExpediaRetryArtifactCliError extends Error {
  readonly code: ExpediaRetryArtifactCliErrorCode;
  readonly exitCode: number;

  constructor(code: ExpediaRetryArtifactCliErrorCode, message: string) {
    super(message);
    this.name = "ExpediaRetryArtifactCliError";
    this.code = code;
    this.exitCode = 1;
  }
}

export interface ExpediaRetryArtifactFileOptions {
  cwd?: string;
  readFile?: (filePath: string) => Promise<string>;
}

export interface ExpediaRetryArtifactCliIO extends ExpediaRetryArtifactFileOptions {
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export const EXPEDIA_RETRY_ARTIFACT_CLI_USAGE =
  "Usage: npx tsx scripts/analyze-expedia-retry-artifact.ts <artifact-bundle.json>";

export async function loadExpediaRetryArtifactBundle(
  filePath: string,
  options: ExpediaRetryArtifactFileOptions = {},
): Promise<ExpediaRetryArtifactBundle> {
  const resolvedPath = resolveInputPath(filePath, options.cwd);
  const readFile = options.readFile ?? ((p: string) => fs.readFile(p, "utf8"));

  let raw: string;
  try {
    raw = await readFile(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ExpediaRetryArtifactCliError(
        "missing_file",
        `Artifact bundle file not found: ${resolvedPath}`,
      );
    }
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExpediaRetryArtifactCliError(
      "invalid_json",
      `Invalid JSON in artifact bundle ${resolvedPath}: ${message}`,
    );
  }

  return validateExpediaRetryArtifactBundle(payload);
}

export async function analyzeExpediaRetryArtifactFile(
  filePath: string,
  options: ExpediaRetryArtifactFileOptions = {},
): Promise<string> {
  const bundle = await loadExpediaRetryArtifactBundle(filePath, options);
  return formatExpediaRetryArtifactBundleMarkdown(bundle);
}

export async function runExpediaRetryArtifactCli(
  argv: readonly string[],
  io: ExpediaRetryArtifactCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));
  const filePath = argv[0];

  if (!filePath || filePath === "-h" || filePath === "--help") {
    writeError(EXPEDIA_RETRY_ARTIFACT_CLI_USAGE);
    return filePath ? 0 : 1;
  }

  try {
    writeOutput(await analyzeExpediaRetryArtifactFile(filePath, io));
    return 0;
  } catch (error) {
    if (error instanceof ExpediaRetryArtifactCliError) {
      writeError(`${error.message}\n${EXPEDIA_RETRY_ARTIFACT_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

export function validateExpediaRetryArtifactBundle(
  payload: unknown,
): ExpediaRetryArtifactBundle {
  if (!isRecord(payload)) {
    throw new ExpediaRetryArtifactCliError(
      "invalid_bundle",
      "Artifact bundle must be a JSON object.",
    );
  }
  if (Object.keys(payload).length === 0) {
    throw new ExpediaRetryArtifactCliError(
      "empty_bundle",
      "Artifact bundle is empty.",
    );
  }

  return payload as ExpediaRetryArtifactBundle;
}

function resolveInputPath(filePath: string, cwd = process.cwd()): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new ExpediaRetryArtifactCliError(
      "usage",
      "Artifact bundle path is required.",
    );
  }
  return path.resolve(cwd, trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runExpediaRetryArtifactCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
