import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatExpediaRetryArtifactBundleMarkdown,
  type ExpediaRetryArtifactBundle,
} from "../lib/runtime-forensics/expedia-retry-analysis";
import {
  formatHotelRetryArtifactBundleMarkdown,
  type HotelRetryArtifactBundle,
} from "../lib/runtime-forensics/hotel-retry-analysis";
import {
  formatRestaurantArtifactBundleMarkdown,
  type RestaurantArtifactBundle,
} from "../lib/runtime-forensics/restaurant-artifact-analysis";

export type ProviderArtifactKind = "expedia" | "hotel" | "restaurant";

export type ProviderArtifactCliErrorCode =
  | "usage"
  | "invalid_kind"
  | "missing_file"
  | "invalid_json"
  | "invalid_bundle"
  | "empty_bundle";

export class ProviderArtifactCliError extends Error {
  readonly code: ProviderArtifactCliErrorCode;
  readonly exitCode: number;

  constructor(code: ProviderArtifactCliErrorCode, message: string) {
    super(message);
    this.name = "ProviderArtifactCliError";
    this.code = code;
    this.exitCode = 1;
  }
}

export interface ProviderArtifactFileOptions {
  cwd?: string;
  readFile?: (filePath: string) => Promise<string>;
}

export interface ProviderArtifactCliIO extends ProviderArtifactFileOptions {
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export interface ProviderArtifactCliArgs {
  kind: ProviderArtifactKind;
  bundlePath: string;
}

export type ProviderArtifactBundle =
  | ExpediaRetryArtifactBundle
  | HotelRetryArtifactBundle
  | RestaurantArtifactBundle;

export const PROVIDER_ARTIFACT_KINDS: readonly ProviderArtifactKind[] = [
  "expedia",
  "hotel",
  "restaurant",
] as const;

export const PROVIDER_ARTIFACT_CLI_USAGE = [
  "Usage:",
  "  npx tsx scripts/analyze-provider-artifact.ts --kind expedia <bundle.json>",
  "  npx tsx scripts/analyze-provider-artifact.ts --kind hotel <bundle.json>",
  "  npx tsx scripts/analyze-provider-artifact.ts --kind restaurant <bundle.json>",
  "",
  "The bundle must already contain copied DB/log/screenshot metadata.",
  "This script is pure no-live analysis; it never starts a provider run.",
].join("\n");

export function parseProviderArtifactCliArgs(
  argv: readonly string[],
): ProviderArtifactCliArgs {
  const args = argv.filter((arg) => arg.trim().length > 0);
  let kindInput: string | undefined;
  let bundlePath: string | undefined;
  let expectedLength = 0;

  if (args[0] === "--kind") {
    kindInput = args[1];
    bundlePath = args[2];
    expectedLength = 3;
  } else if (args[0]?.startsWith("--kind=")) {
    kindInput = args[0].slice("--kind=".length);
    bundlePath = args[1];
    expectedLength = 2;
  } else {
    throw new ProviderArtifactCliError(
      "usage",
      "Artifact kind is required. Pass --kind expedia, --kind hotel, or --kind restaurant.",
    );
  }

  if (args.length > expectedLength) {
    throw new ProviderArtifactCliError(
      "usage",
      `Unexpected arguments: ${args.slice(expectedLength).join(" ")}`,
    );
  }

  const kind = normalizeProviderArtifactKind(kindInput);
  if (!kind) {
    throw new ProviderArtifactCliError(
      "invalid_kind",
      `Invalid artifact kind: ${kindInput ?? "(missing)"}. Expected one of: ${PROVIDER_ARTIFACT_KINDS.join(
        ", ",
      )}.`,
    );
  }
  if (!bundlePath) {
    throw new ProviderArtifactCliError(
      "usage",
      "Artifact bundle path is required.",
    );
  }

  return { kind, bundlePath };
}

export function normalizeProviderArtifactKind(
  value: string | undefined,
): ProviderArtifactKind | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return PROVIDER_ARTIFACT_KINDS.includes(normalized as ProviderArtifactKind)
    ? (normalized as ProviderArtifactKind)
    : null;
}

export async function loadProviderArtifactBundle(
  filePath: string,
  options: ProviderArtifactFileOptions = {},
): Promise<ProviderArtifactBundle> {
  const resolvedPath = resolveInputPath(filePath, options.cwd);
  const readFile = options.readFile ?? ((p: string) => fs.readFile(p, "utf8"));

  let raw: string;
  try {
    raw = await readFile(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ProviderArtifactCliError(
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
    throw new ProviderArtifactCliError(
      "invalid_json",
      `Invalid JSON in artifact bundle ${resolvedPath}: ${message}`,
    );
  }

  return validateProviderArtifactBundle(payload);
}

export function validateProviderArtifactBundle(
  payload: unknown,
): ProviderArtifactBundle {
  if (!isRecord(payload)) {
    throw new ProviderArtifactCliError(
      "invalid_bundle",
      "Artifact bundle must be a JSON object.",
    );
  }
  if (Object.keys(payload).length === 0) {
    throw new ProviderArtifactCliError(
      "empty_bundle",
      "Artifact bundle is empty.",
    );
  }

  return payload as ProviderArtifactBundle;
}

export async function analyzeProviderArtifactFile(
  args: ProviderArtifactCliArgs,
  options: ProviderArtifactFileOptions = {},
): Promise<string> {
  const bundle = await loadProviderArtifactBundle(args.bundlePath, options);
  return formatProviderArtifactBundleMarkdown(args.kind, bundle);
}

export function formatProviderArtifactBundleMarkdown(
  kind: ProviderArtifactKind,
  bundle: ProviderArtifactBundle,
): string {
  switch (kind) {
    case "expedia":
      return formatExpediaRetryArtifactBundleMarkdown(
        bundle as ExpediaRetryArtifactBundle,
      );
    case "hotel":
      return formatHotelRetryArtifactBundleMarkdown(
        bundle as HotelRetryArtifactBundle,
      );
    case "restaurant":
      return formatRestaurantArtifactBundleMarkdown(
        bundle as RestaurantArtifactBundle,
      );
  }
}

export async function runProviderArtifactCli(
  argv: readonly string[],
  io: ProviderArtifactCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));

  if (argv[0] === "-h" || argv[0] === "--help") {
    writeError(PROVIDER_ARTIFACT_CLI_USAGE);
    return 0;
  }

  try {
    const parsed = parseProviderArtifactCliArgs(argv);
    writeOutput(await analyzeProviderArtifactFile(parsed, io));
    return 0;
  } catch (error) {
    if (error instanceof ProviderArtifactCliError) {
      writeError(`${error.message}\n${PROVIDER_ARTIFACT_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

function resolveInputPath(filePath: string, cwd = process.cwd()): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new ProviderArtifactCliError(
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
  runProviderArtifactCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
