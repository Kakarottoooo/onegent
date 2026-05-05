import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildPhaseClosureEvidencePack,
  formatPhaseClosureEvidencePackMarkdown,
  PHASE_CLOSURE_REQUIRED_DOCS,
  type PhaseClosureDocumentKey,
  type PhaseClosureEvidenceDocuments,
  type PhaseClosureEvidencePack,
} from "../lib/phase-closure-evidence";

export interface PhaseClosureEvidenceCliIO {
  cwd?: string;
  readFile?: (filePath: string) => Promise<string>;
  getCanonicalSha?: () => string;
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export interface PhaseClosureEvidenceCliArgs {
  json: boolean;
}

export const PHASE_CLOSURE_EVIDENCE_CLI_USAGE = [
  "Usage:",
  "  npx tsx scripts/phase-closure-evidence.ts",
  "  npx tsx scripts/phase-closure-evidence.ts --json",
  "",
  "Reads local docs/reports only and prints the no-live Phase Closure Evidence Pack.",
].join("\n");

export class PhaseClosureEvidenceCliError extends Error {
  readonly exitCode = 1;

  constructor(message: string) {
    super(message);
    this.name = "PhaseClosureEvidenceCliError";
  }
}

export function parsePhaseClosureEvidenceCliArgs(
  argv: readonly string[],
): PhaseClosureEvidenceCliArgs {
  const args = argv.filter((arg) => arg.trim().length > 0);
  if (args.length === 0) return { json: false };
  if (args.length === 1 && args[0] === "--json") return { json: true };
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    throw new PhaseClosureEvidenceCliError(PHASE_CLOSURE_EVIDENCE_CLI_USAGE);
  }
  throw new PhaseClosureEvidenceCliError(
    `Unexpected argument(s): ${args.join(" ")}`,
  );
}

export async function runPhaseClosureEvidenceCli(
  argv: readonly string[],
  io: PhaseClosureEvidenceCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));

  if (argv[0] === "--help" || argv[0] === "-h") {
    writeError(PHASE_CLOSURE_EVIDENCE_CLI_USAGE);
    return 0;
  }

  try {
    const args = parsePhaseClosureEvidenceCliArgs(argv);
    const pack = await loadPhaseClosureEvidencePack(io);
    writeOutput(
      args.json
        ? `${JSON.stringify(toPhaseClosureEvidenceCliJson(pack), null, 2)}\n`
        : formatPhaseClosureEvidencePackMarkdown(pack),
    );
    return 0;
  } catch (error) {
    if (error instanceof PhaseClosureEvidenceCliError) {
      writeError(`${error.message}\n${PHASE_CLOSURE_EVIDENCE_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

export async function loadPhaseClosureEvidencePack(
  options: Pick<
    PhaseClosureEvidenceCliIO,
    "cwd" | "readFile" | "getCanonicalSha"
  > = {},
): Promise<PhaseClosureEvidencePack> {
  const cwd = options.cwd ?? process.cwd();
  const documents = await readPhaseClosureDocuments(cwd, options.readFile);
  const canonicalIntegratedPreviewSha =
    options.getCanonicalSha?.() ?? readCanonicalIntegratedPreviewSha(cwd);

  return buildPhaseClosureEvidencePack({
    canonicalIntegratedPreviewSha,
    documents,
  });
}

export async function readPhaseClosureDocuments(
  cwd: string,
  readFile: (filePath: string) => Promise<string> = (filePath) =>
    fs.readFile(filePath, "utf8"),
): Promise<PhaseClosureEvidenceDocuments> {
  const documents: PhaseClosureEvidenceDocuments = {
    phaseStatus: "",
    huddle: "",
    codex: "",
    claude: "",
    phase2: "",
    providerClosureAcceptance: "",
    providerClosureOperatorRoom: "",
    liveClosureEvidenceProtocol: "",
    demoFreezeAcceptance: "",
    demoControlRoom: "",
    ycDemoRunbook: "",
  };
  await Promise.all(
    (Object.entries(PHASE_CLOSURE_REQUIRED_DOCS) as Array<
      [PhaseClosureDocumentKey, string]
    >).map(async ([key, relPath]) => {
      const fullPath = path.join(cwd, relPath);
      try {
        documents[key] = await readFile(fullPath);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          throw new PhaseClosureEvidenceCliError(
            `Required evidence document missing: ${relPath}`,
          );
        }
        throw error;
      }
    }),
  );
  return documents;
}

export function readCanonicalIntegratedPreviewSha(cwd: string): string {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "origin/codex/integrated-preview-20260504"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "unknown";
  }
}

export function toPhaseClosureEvidenceCliJson(
  pack: PhaseClosureEvidencePack,
): Record<string, unknown> {
  return {
    schemaVersion: pack.schemaVersion,
    generatedAt: pack.generatedAt,
    canonicalIntegratedPreviewSha: pack.canonicalIntegratedPreviewSha,
    providerClosureLiveVerifiedEvidencePresent:
      pack.providerClosureLiveVerifiedEvidencePresent,
    latestR030Evidence: pack.latestR030Evidence,
    phases: pack.phases,
    checks: pack.checks,
    integrationAnchors: pack.integrationAnchors,
    hardStops: pack.hardStops,
    summary: pack.summary,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runPhaseClosureEvidenceCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
