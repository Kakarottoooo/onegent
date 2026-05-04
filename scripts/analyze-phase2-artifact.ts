/**
 * Pure no-live Phase 2 artifact analyzer.
 *
 * Reads an operator-assembled JSON bundle from disk and prints paste-ready
 * Markdown. It does not open a provider, query the DB, start a worker, or run
 * any live browser automation.
 */

import { readFileSync } from "node:fs";

import {
  formatExpediaRetryArtifactBundleMarkdown,
  type ExpediaRetryArtifactBundle,
} from "../lib/runtime-forensics/expedia-retry-analysis";
import {
  formatHotelRetryArtifactBundleMarkdown,
  type HotelRetryArtifactBundle,
} from "../lib/runtime-forensics/hotel-retry-analysis";

type AnalyzerKind = "flight" | "hotel";

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const bundle = JSON.parse(readFileSync(parsed.bundlePath, "utf8")) as unknown;

  if (parsed.kind === "flight") {
    console.log(
      formatExpediaRetryArtifactBundleMarkdown(
        bundle as ExpediaRetryArtifactBundle,
      ),
    );
    return;
  }

  console.log(
    formatHotelRetryArtifactBundleMarkdown(bundle as HotelRetryArtifactBundle),
  );
}

function parseArgs(
  args: string[],
): { kind: AnalyzerKind; bundlePath: string } | null {
  const [kindInput, bundlePath] = args;
  const kind = normalizeKind(kindInput);
  if (!kind || !bundlePath) return null;
  return { kind, bundlePath };
}

function normalizeKind(value: string | undefined): AnalyzerKind | null {
  switch ((value ?? "").trim().toLowerCase()) {
    case "flight":
    case "expedia":
    case "expedia-flight":
      return "flight";
    case "hotel":
    case "booking":
    case "booking-com":
    case "hotels":
    case "hotels-com":
      return "hotel";
    default:
      return null;
  }
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/analyze-phase2-artifact.ts flight <bundle.json>",
      "  npx tsx scripts/analyze-phase2-artifact.ts hotel <bundle.json>",
      "",
      "The bundle must already contain copied DB/log/screenshot metadata.",
      "This script is pure no-live analysis; it never starts a provider run.",
    ].join("\n"),
  );
}

main();
