import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatRestaurantArtifactBundleMarkdown,
  type RestaurantArtifactBundle,
} from "../lib/runtime-forensics/restaurant-artifact-analysis";

export type RestaurantArtifactCliErrorCode =
  | "usage"
  | "missing_file"
  | "invalid_json"
  | "invalid_bundle"
  | "empty_bundle";

export class RestaurantArtifactCliError extends Error {
  readonly code: RestaurantArtifactCliErrorCode;
  readonly exitCode: number;

  constructor(code: RestaurantArtifactCliErrorCode, message: string) {
    super(message);
    this.name = "RestaurantArtifactCliError";
    this.code = code;
    this.exitCode = 1;
  }
}

export interface RestaurantArtifactFileOptions {
  cwd?: string;
  readFile?: (filePath: string) => Promise<string>;
}

export interface RestaurantArtifactCliIO extends RestaurantArtifactFileOptions {
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export const RESTAURANT_ARTIFACT_CLI_USAGE =
  "Usage: npx tsx scripts/analyze-restaurant-artifact.ts <artifact-bundle.json>";

export async function loadRestaurantArtifactBundle(
  filePath: string,
  options: RestaurantArtifactFileOptions = {},
): Promise<RestaurantArtifactBundle> {
  const resolvedPath = resolveInputPath(filePath, options.cwd);
  const readFile = options.readFile ?? ((p: string) => fs.readFile(p, "utf8"));

  let raw: string;
  try {
    raw = await readFile(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new RestaurantArtifactCliError(
        "missing_file",
        `Restaurant artifact bundle file not found: ${resolvedPath}`,
      );
    }
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RestaurantArtifactCliError(
      "invalid_json",
      `Invalid JSON in restaurant artifact bundle ${resolvedPath}: ${message}`,
    );
  }

  return validateRestaurantArtifactBundle(payload);
}

export async function analyzeRestaurantArtifactFile(
  filePath: string,
  options: RestaurantArtifactFileOptions = {},
): Promise<string> {
  const bundle = await loadRestaurantArtifactBundle(filePath, options);
  return formatRestaurantArtifactBundleMarkdown(bundle);
}

export async function runRestaurantArtifactCli(
  argv: readonly string[],
  io: RestaurantArtifactCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));
  const filePath = argv[0];

  if (!filePath || filePath === "-h" || filePath === "--help") {
    writeError(RESTAURANT_ARTIFACT_CLI_USAGE);
    return filePath ? 0 : 1;
  }

  try {
    writeOutput(await analyzeRestaurantArtifactFile(filePath, io));
    return 0;
  } catch (error) {
    if (error instanceof RestaurantArtifactCliError) {
      writeError(`${error.message}\n${RESTAURANT_ARTIFACT_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

export function validateRestaurantArtifactBundle(
  payload: unknown,
): RestaurantArtifactBundle {
  if (!isRecord(payload)) {
    throw new RestaurantArtifactCliError(
      "invalid_bundle",
      "Restaurant artifact bundle must be a JSON object.",
    );
  }
  if (Object.keys(payload).length === 0) {
    throw new RestaurantArtifactCliError(
      "empty_bundle",
      "Restaurant artifact bundle is empty.",
    );
  }

  return payload as RestaurantArtifactBundle;
}

function resolveInputPath(filePath: string, cwd = process.cwd()): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new RestaurantArtifactCliError(
      "usage",
      "Restaurant artifact bundle path is required.",
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
  runRestaurantArtifactCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
