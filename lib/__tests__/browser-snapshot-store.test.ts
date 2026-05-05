import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listBrowserSnapshots,
  saveBrowserSnapshot,
  type BrowserSnapshotEntry,
} from "@/lib/browser-snapshot-store";

describe("browser snapshot store", () => {
  const originalSnapshotDir = process.env.ONEGENT_SNAPSHOT_DIR;
  const originalReadDirs = process.env.ONEGENT_SNAPSHOT_READ_DIRS;
  const originalDisableDiscovery = process.env.ONEGENT_DISABLE_SNAPSHOT_DISCOVERY;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "onegent-snapshots-"));
    process.env.ONEGENT_DISABLE_SNAPSHOT_DISCOVERY = "1";
  });

  afterEach(async () => {
    if (originalSnapshotDir === undefined) delete process.env.ONEGENT_SNAPSHOT_DIR;
    else process.env.ONEGENT_SNAPSHOT_DIR = originalSnapshotDir;
    if (originalReadDirs === undefined) delete process.env.ONEGENT_SNAPSHOT_READ_DIRS;
    else process.env.ONEGENT_SNAPSHOT_READ_DIRS = originalReadDirs;
    if (originalDisableDiscovery === undefined) {
      delete process.env.ONEGENT_DISABLE_SNAPSHOT_DISCOVERY;
    } else {
      process.env.ONEGENT_DISABLE_SNAPSHOT_DISCOVERY = originalDisableDiscovery;
    }
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("uses a user-local shared snapshot root by default", async () => {
    const jobId = "job-shared-default";
    delete process.env.ONEGENT_SNAPSHOT_DIR;
    delete process.env.ONEGENT_SNAPSHOT_READ_DIRS;
    process.env.LOCALAPPDATA = tempRoot;

    await saveBrowserSnapshot({
      jobId,
      ts: "2026-05-05T06:32:00.000Z",
      title: "Shared",
      status: "live",
      imageBase64: "shared",
    });

    const snapshots = await listBrowserSnapshots(jobId);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      jobId,
      title: "Shared",
      imageBase64: "shared",
    });
  });

  it("reads snapshots from configured cross-worktree read directories", async () => {
    const jobId = "job-cross-worktree";
    const primaryRoot = path.join(tempRoot, "ui", ".debug-screenshots", "live");
    const secondaryRoot = path.join(tempRoot, "worker", ".debug-screenshots", "live");
    process.env.ONEGENT_SNAPSHOT_DIR = primaryRoot;
    process.env.ONEGENT_SNAPSHOT_READ_DIRS = secondaryRoot;

    const secondaryEntry: BrowserSnapshotEntry = {
      id: "secondary-1",
      jobId,
      ts: "2026-05-05T06:30:00.000Z",
      title: "Loaded booking page",
      status: "live",
      imageBase64: "abc123",
      url: "https://www.opentable.com/example",
    };
    const secondaryJobDir = path.join(secondaryRoot, jobId);
    await mkdir(secondaryJobDir, { recursive: true });
    await writeFile(
      path.join(secondaryJobDir, `${secondaryEntry.id}.json`),
      JSON.stringify(secondaryEntry),
      "utf8",
    );

    const snapshots = await listBrowserSnapshots(jobId);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      id: "secondary-1",
      jobId,
      url: "https://www.opentable.com/example",
    });
  });

  it("merges primary and read-directory snapshots in chronological order", async () => {
    const jobId = "job-merged";
    const primaryRoot = path.join(tempRoot, "ui", ".debug-screenshots", "live");
    const secondaryRoot = path.join(tempRoot, "worker", ".debug-screenshots", "live");
    process.env.ONEGENT_SNAPSHOT_DIR = primaryRoot;
    process.env.ONEGENT_SNAPSHOT_READ_DIRS = secondaryRoot;

    await saveBrowserSnapshot({
      jobId,
      ts: "2026-05-05T06:29:00.000Z",
      title: "Primary",
      status: "live",
      imageBase64: "primary",
    });

    const secondaryEntry: BrowserSnapshotEntry = {
      id: "secondary-newer",
      jobId,
      ts: "2026-05-05T06:31:00.000Z",
      title: "Secondary",
      status: "live",
      imageBase64: "secondary",
    };
    const secondaryJobDir = path.join(secondaryRoot, jobId);
    await mkdir(secondaryJobDir, { recursive: true });
    await writeFile(
      path.join(secondaryJobDir, `${secondaryEntry.id}.json`),
      JSON.stringify(secondaryEntry),
      "utf8",
    );

    const snapshots = await listBrowserSnapshots(jobId);

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual([
      expect.stringMatching(/^[0-9]+-[0-9a-f]+$/),
      "secondary-newer",
    ]);
  });

  it("keeps the latest 120 snapshots without reversing the stream", async () => {
    const jobId = "job-long-run";
    const primaryRoot = path.join(tempRoot, "ui", ".debug-screenshots", "live");
    process.env.ONEGENT_SNAPSHOT_DIR = primaryRoot;

    for (let i = 0; i < 125; i += 1) {
      await saveBrowserSnapshot({
        jobId,
        ts: new Date(Date.UTC(2026, 4, 5, 7, 0, i)).toISOString(),
        title: `Frame ${i}`,
        status: "live",
        imageBase64: `frame-${i}`,
      });
    }

    const snapshots = await listBrowserSnapshots(jobId);

    expect(snapshots).toHaveLength(120);
    expect(snapshots[0].title).toBe("Frame 5");
    expect(snapshots.at(-1)?.title).toBe("Frame 124");
  });
});
