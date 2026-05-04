import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  analyzeExpediaRetryArtifactBundle,
  type ExpediaRetryArtifactBundle,
} from "../lib/runtime-forensics/expedia-retry-analysis";
import { FIXTURE_EXPECTED_CLASS, FIXTURE_FILENAMES } from "../lib/runtime-forensics/__fixtures__/index";
import {
  analyzeHotelRetryArtifactBundle,
  type HotelRetryArtifactBundle,
} from "../lib/runtime-forensics/hotel-retry-analysis";
import {
  analyzeRestaurantArtifactBundle,
  type RestaurantArtifactBundle,
} from "../lib/runtime-forensics/restaurant-artifact-analysis";

export type ArtifactFixtureDomain = "restaurant" | "expedia" | "hotel";

export type ArtifactFixtureSource =
  | "restaurant-artifact-analysis"
  | "expedia-retry-analysis"
  | "hotel-retry-analysis"
  | "runtime-forensics-demo";

export interface ArtifactFixtureRecord {
  relativePath: string;
  source: ArtifactFixtureSource;
  domain: ArtifactFixtureDomain;
  className: string;
  provider: string;
  scenario: string;
  status: string;
  fixtureId: string | null;
}

export interface ArtifactFixtureClassCount {
  className: string;
  count: number;
}

export interface ArtifactFixtureDomainCount {
  domain: ArtifactFixtureDomain;
  count: number;
  classes: ArtifactFixtureClassCount[];
}

interface AnalyzerSource {
  source: Exclude<ArtifactFixtureSource, "runtime-forensics-demo">;
  domain: ArtifactFixtureDomain;
  fixtureDir: string;
}

const FIXTURE_ROOT = path.join("lib", "runtime-forensics", "__fixtures__");

const ANALYZER_SOURCES: readonly AnalyzerSource[] = [
  {
    source: "restaurant-artifact-analysis",
    domain: "restaurant",
    fixtureDir: path.join(FIXTURE_ROOT, "restaurant-artifact-analysis"),
  },
  {
    source: "expedia-retry-analysis",
    domain: "expedia",
    fixtureDir: path.join(FIXTURE_ROOT, "expedia-retry-analysis"),
  },
  {
    source: "hotel-retry-analysis",
    domain: "hotel",
    fixtureDir: path.join(FIXTURE_ROOT, "hotel-retry-analysis"),
  },
] as const;

const DOMAIN_ORDER: readonly ArtifactFixtureDomain[] = [
  "restaurant",
  "expedia",
  "hotel",
] as const;

export async function listArtifactFixtures(
  rootDir = process.cwd(),
): Promise<ArtifactFixtureRecord[]> {
  const records: ArtifactFixtureRecord[] = [];

  for (const source of ANALYZER_SOURCES) {
    const absoluteDir = path.join(rootDir, source.fixtureDir);
    const files = await sortedJsonFiles(absoluteDir);
    for (const file of files) {
      const payload = await readJsonFile(path.join(absoluteDir, file));
      const className = classifyAnalyzerFixture(source.source, payload);
      records.push(
        buildRecord({
          payload,
          rootDir,
          absolutePath: path.join(absoluteDir, file),
          source: source.source,
          domain: source.domain,
          className,
        }),
      );
    }
  }

  for (const file of FIXTURE_FILENAMES) {
    const absolutePath = path.join(rootDir, FIXTURE_ROOT, file);
    const payload = await readJsonFile(absolutePath);
    records.push(
      buildRecord({
        payload,
        rootDir,
        absolutePath,
        source: "runtime-forensics-demo",
        domain: inferRuntimeFixtureDomain(payload, file),
        className: FIXTURE_EXPECTED_CLASS[file],
      }),
    );
  }

  return records.sort((a, b) => {
    const domainDelta =
      DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain);
    if (domainDelta !== 0) return domainDelta;
    const classDelta = a.className.localeCompare(b.className);
    if (classDelta !== 0) return classDelta;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

export function countArtifactFixturesByDomain(
  fixtures: readonly ArtifactFixtureRecord[],
): ArtifactFixtureDomainCount[] {
  return DOMAIN_ORDER.map((domain) => {
    const domainFixtures = fixtures.filter((fixture) => fixture.domain === domain);
    const classCounts = new Map<string, number>();
    for (const fixture of domainFixtures) {
      classCounts.set(fixture.className, (classCounts.get(fixture.className) ?? 0) + 1);
    }

    return {
      domain,
      count: domainFixtures.length,
      classes: Array.from(classCounts.entries())
        .map(([className, count]) => ({ className, count }))
        .sort((a, b) => a.className.localeCompare(b.className)),
    };
  }).filter((entry) => entry.count > 0);
}

export function formatArtifactFixtureSummary(
  fixtures: readonly ArtifactFixtureRecord[],
): string {
  const lines: string[] = [];
  lines.push("Artifact fixture corpus");
  lines.push(`Total fixtures: ${fixtures.length}`);
  lines.push("");

  for (const domain of countArtifactFixturesByDomain(fixtures)) {
    lines.push(`${domain.domain}: ${domain.count}`);
    for (const classCount of domain.classes) {
      lines.push(`  ${classCount.className}: ${classCount.count}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

async function sortedJsonFiles(absoluteDir: string): Promise<string[]> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readJsonFile(absolutePath: string): Promise<unknown> {
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function classifyAnalyzerFixture(
  source: Exclude<ArtifactFixtureSource, "runtime-forensics-demo">,
  payload: unknown,
): string {
  switch (source) {
    case "restaurant-artifact-analysis":
      return analyzeRestaurantArtifactBundle(payload as RestaurantArtifactBundle).state;
    case "expedia-retry-analysis":
      return analyzeExpediaRetryArtifactBundle(payload as ExpediaRetryArtifactBundle).state;
    case "hotel-retry-analysis":
      return analyzeHotelRetryArtifactBundle(payload as HotelRetryArtifactBundle).state;
  }
}

function buildRecord(input: {
  payload: unknown;
  rootDir: string;
  absolutePath: string;
  source: ArtifactFixtureSource;
  domain: ArtifactFixtureDomain;
  className: string;
}): ArtifactFixtureRecord {
  const job = getJobRecord(input.payload);
  return {
    relativePath: path.relative(input.rootDir, input.absolutePath).replace(/\\/g, "/"),
    source: input.source,
    domain: input.domain,
    className: input.className,
    provider: readString(job, "provider") ?? "unknown",
    scenario: readString(job, "scenario") ?? "unknown",
    status: readString(job, "status") ?? "unknown",
    fixtureId: readString(job, "id"),
  };
}

function inferRuntimeFixtureDomain(
  payload: unknown,
  file: string,
): ArtifactFixtureDomain {
  const job = getJobRecord(payload);
  const provider = readString(job, "provider")?.toLowerCase() ?? "";
  const scenario = readString(job, "scenario")?.toLowerCase() ?? "";
  const name = file.toLowerCase();

  if (
    provider.includes("resy") ||
    provider.includes("opentable") ||
    scenario.startsWith("r-") ||
    scenario.startsWith("ot-") ||
    name.includes("resy") ||
    name.includes("opentable")
  ) {
    return "restaurant";
  }

  if (
    provider.includes("booking") ||
    provider.includes("hotels") ||
    scenario.includes("hotel") ||
    scenario.startsWith("htl-") ||
    name.includes("booking") ||
    name.includes("hotel")
  ) {
    return "hotel";
  }

  return "expedia";
}

function getJobRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const job = value.job;
  return isRecord(job) ? job : value;
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  listArtifactFixtures()
    .then((fixtures) => {
      console.log(formatArtifactFixtureSummary(fixtures));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
