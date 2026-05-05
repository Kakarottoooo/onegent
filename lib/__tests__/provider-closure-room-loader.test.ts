import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getProviderLane,
  loadProviderClosureRoomSnapshot,
  summarizeArtifactsForLane,
} from "@/lib/provider-closure-room";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "provider-closure-room-"));
}

async function writeFiles(dir: string, names: string[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const n of names) {
    await fs.writeFile(path.join(dir, n), "{}", "utf8");
  }
}

describe("provider-closure-room loader", () => {
  let tmpRoot: string;
  let runsDir: string;

  beforeEach(async () => {
    tmpRoot = await makeTempDir();
    runsDir = path.join(tmpRoot, "benchmark", "runs");
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns three lanes in the canonical order even with no artifacts", async () => {
    const snap = await loadProviderClosureRoomSnapshot({
      benchmarkRunsDir: runsDir,
      checklistPagePath: path.join(tmpRoot, "no-such-page.tsx"),
    });
    expect(snap.lanes.map((l) => l.lane.id)).toEqual([
      "restaurant",
      "flight",
      "hotel",
    ]);
    for (const l of snap.lanes) {
      expect(l.artifacts.totalBenchmarkArtifacts).toBe(0);
      expect(l.artifacts.laneBenchmarkArtifacts).toBe(0);
      expect(l.artifacts.latestArtifactFile).toBeNull();
      expect(l.artifacts.emptyHint.length).toBeGreaterThan(0);
    }
    // Loader must record a graceful empty-state note.
    expect(snap.notes.some((n) => /benchmark\/runs\//.test(n))).toBe(true);
  });

  it("counts and assigns artifacts per lane based on filename markers", async () => {
    await writeFiles(runsDir, [
      // Restaurant
      "phase0-resy-2026-05-04T19-29-48-731Z.json",
      "resy-availability-probe-2026-05-04T02-48-49-759Z.json",
      "opentable-fixture-r9.json",
      "restaurant-artifact-bundle.json",
      // Flight
      "expedia-flight-fixture.json",
      "expedia-retry-2026-05-04.json",
      "flight-rpa-mco-bna.json",
      // Hotel
      "booking-com-fixture.json",
      "hotels-com-fixture.json",
      "hotel-retry-yotel.json",
      // Meta artifacts that must be filtered out (they belong to demo control room)
      "phase1-quality-gate-2026-05-04T17-37-20-323Z.json",
      "founder-e2e-2026-05-04T18-30-22-001Z.json",
    ]);

    const snap = await loadProviderClosureRoomSnapshot({
      benchmarkRunsDir: runsDir,
      checklistPagePath: path.join(tmpRoot, "no-such-page.tsx"),
    });

    const restaurant = snap.lanes.find((l) => l.lane.id === "restaurant")!;
    const flight = snap.lanes.find((l) => l.lane.id === "flight")!;
    const hotel = snap.lanes.find((l) => l.lane.id === "hotel")!;

    // Total excludes phase1-quality-gate and founder-e2e prefixes.
    expect(restaurant.artifacts.totalBenchmarkArtifacts).toBe(10);
    expect(flight.artifacts.totalBenchmarkArtifacts).toBe(10);
    expect(hotel.artifacts.totalBenchmarkArtifacts).toBe(10);

    expect(restaurant.artifacts.laneBenchmarkArtifacts).toBe(4);
    expect(flight.artifacts.laneBenchmarkArtifacts).toBe(3);
    expect(hotel.artifacts.laneBenchmarkArtifacts).toBe(3);

    expect(restaurant.artifacts.latestArtifactFile).not.toBeNull();
    expect(flight.artifacts.latestArtifactFile).not.toBeNull();
    expect(hotel.artifacts.latestArtifactFile).not.toBeNull();
  });

  it("filters out phase1-quality-gate-* and founder-e2e-* meta artifacts", async () => {
    await writeFiles(runsDir, [
      "phase1-quality-gate-2026-05-04T00-00-00-000Z.json",
      "phase1-quality-gate-2026-05-04T01-00-00-000Z.json",
      "founder-e2e-2026-05-04T02-00-00-000Z.json",
    ]);
    const snap = await loadProviderClosureRoomSnapshot({
      benchmarkRunsDir: runsDir,
      checklistPagePath: path.join(tmpRoot, "no-such-page.tsx"),
    });
    for (const l of snap.lanes) {
      expect(l.artifacts.totalBenchmarkArtifacts).toBe(0);
      expect(l.artifacts.laneBenchmarkArtifacts).toBe(0);
    }
  });

  it("checklist link is a placeholder when /dev/live-operator-checklist is absent", async () => {
    const snap = await loadProviderClosureRoomSnapshot({
      benchmarkRunsDir: runsDir,
      checklistPagePath: path.join(tmpRoot, "absent-checklist", "page.tsx"),
    });
    expect(snap.checklist.available).toBe(false);
    expect(snap.checklist.href).toBe("/dev/live-operator-checklist");
    expect(snap.checklist.note).toMatch(/lands in a future/i);
  });

  it("checklist link reports available when the page file exists on disk", async () => {
    const checklistDir = path.join(tmpRoot, "app", "dev", "live-operator-checklist");
    await fs.mkdir(checklistDir, { recursive: true });
    const pagePath = path.join(checklistDir, "page.tsx");
    await fs.writeFile(pagePath, "export default function P(){return null}", "utf8");

    const snap = await loadProviderClosureRoomSnapshot({
      benchmarkRunsDir: runsDir,
      checklistPagePath: pagePath,
    });
    expect(snap.checklist.available).toBe(true);
    expect(snap.checklist.href).toBe("/dev/live-operator-checklist");
    expect(snap.checklist.note).toMatch(/operator checklist surface/i);
  });

  it("snapshot fields are populated and ASCII-only", async () => {
    const snap = await loadProviderClosureRoomSnapshot({
      benchmarkRunsDir: runsDir,
      checklistPagePath: path.join(tmpRoot, "no-such-page.tsx"),
      generatedAt: "2026-05-04T20:00:00.000Z",
    });
    expect(snap.schemaVersion).toBe(1);
    expect(snap.generatedAt).toBe("2026-05-04T20:00:00.000Z");
    const blob = JSON.stringify(snap);
    expect(blob).not.toMatch(/[^\x00-\x7F]/);
  });

  it("summarizeArtifactsForLane is pure and matches loader output", () => {
    const lane = getProviderLane("flight")!;
    const filenames = [
      "expedia-flight-fixture.json",
      "phase0-resy-fixture.json",
      "hotel-retry-yotel.json",
    ];
    const summary = summarizeArtifactsForLane(lane, filenames);
    expect(summary.totalBenchmarkArtifacts).toBe(3);
    expect(summary.laneBenchmarkArtifacts).toBe(1);
    expect(summary.latestArtifactFile).toBe("expedia-flight-fixture.json");
  });
});
