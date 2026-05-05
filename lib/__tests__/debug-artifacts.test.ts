// Tests for lib/debug-artifacts.ts.
//
// Covers:
//   - parseRunId: ISO-with-dashes + label round-trips, handles ms variants,
//     returns null capturedAt on garbage
//   - listDebugArtifacts: provider whitelist, run-dir pattern, newest-first
//     sort, summary.json parsed when present, totals aggregated, missing
//     root then empty index
//   - readDebugArtifactAsset: provider/run/file allowlists, path-traversal
//     guard, returns content-type by extension, missing then null
//
// Uses real fs in a tmp subtree under worker/.debug-screenshots/<TEST_RUN_PREFIX>
// with cleanup. The provider whitelist only covers known providers, so we
// reuse "opentable" for tests since that is the only writer in the wild.
//
// Note: vitest oxc-based transformer rejects TS non-null assertion
// postfix-bang syntax, so this file uses explicit narrowing throughout
// (early-return guard pattern after toBeDefined assertions). It also
// reacts to backticks inside JSDoc-style block comments as if they
// opened template literals; this single-line // comment style avoids
// that hazard.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEBUG_ARTIFACTS_ROOT,
  listDebugArtifacts,
  parseRunId,
  readDebugArtifactAsset,
  type DebugArtifactProvider,
  type DebugArtifactRun,
} from "../debug-artifacts";

const TEST_RUN_PREFIX = "2099-01-01T00-00-00-000Z-CLAUDE-TEST-";
const cleanupRunDirs = new Set<string>();

interface MakeTestRunOpts {
  summary?: object | null;
  png?: boolean;
  html?: boolean;
  unrelatedFile?: boolean;
}

const makeTestRun = async (label: string, opts: MakeTestRunOpts = {}): Promise<string> => {
  const runId = TEST_RUN_PREFIX + label;
  const dir = path.join(DEBUG_ARTIFACTS_ROOT, "opentable", runId);
  await fs.mkdir(dir, { recursive: true });
  cleanupRunDirs.add(dir);
  if (opts.summary !== null) {
    await fs.writeFile(
      path.join(dir, "summary.json"),
      JSON.stringify(
        opts.summary ?? {
          label,
          url: "https://www.opentable.com/booking/details?test=1",
          viewport: { width: 1280, height: 720 },
          summary: { error: "test error" },
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
  if (opts.png) {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    await fs.writeFile(path.join(dir, "page.png"), pngBytes);
  }
  if (opts.html) {
    await fs.writeFile(path.join(dir, "page.html"), "<html><body>x</body></html>", "utf-8");
  }
  if (opts.unrelatedFile) {
    await fs.writeFile(path.join(dir, "secret.env"), "OPENAI=...", "utf-8");
  }
  return runId;
};

const findProvider = (
  providers: DebugArtifactProvider[],
  name: string,
): DebugArtifactProvider | undefined =>
  providers.find((p) => p.provider === name);

const findRun = (
  runs: DebugArtifactRun[],
  runId: string,
): DebugArtifactRun | undefined => runs.find((r) => r.runId === runId);

beforeEach(() => {
  cleanupRunDirs.clear();
});

afterEach(async () => {
  for (const dir of cleanupRunDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("parseRunId", () => {
  it("parses the codex writer format with milliseconds", () => {
    const out = parseRunId("2026-05-04T00-03-31-072Z-phone-gate-manual-review");
    expect(out.capturedAt).toBe("2026-05-04T00:03:31.072Z");
    expect(out.label).toBe("phone-gate-manual-review");
  });

  it("parses the format without milliseconds", () => {
    const out = parseRunId("2026-05-04T00-03-31Z-some-label");
    expect(out.capturedAt).toBe("2026-05-04T00:03:31.000Z");
    expect(out.label).toBe("some-label");
  });

  it("returns null capturedAt for non-conformant dirnames", () => {
    expect(parseRunId("not-a-timestamp").capturedAt).toBeNull();
    expect(parseRunId("not-a-timestamp").label).toBe("not-a-timestamp");
  });

  it("handles labels with hyphens (greedy match doesn't truncate)", () => {
    const out = parseRunId(
      "2026-05-04T00-03-31-072Z-guest-form-incomplete-firstName-lastName",
    );
    expect(out.label).toBe("guest-form-incomplete-firstName-lastName");
  });
});

describe("readDebugArtifactAsset", () => {
  it("rejects unwhitelisted providers", async () => {
    const out = await readDebugArtifactAsset("evil", "any", "summary.json");
    expect(out).toBeNull();
  });

  it("rejects path-traversal in runId", async () => {
    const out = await readDebugArtifactAsset("opentable", "../../../etc", "summary.json");
    expect(out).toBeNull();
  });

  it("rejects files not in the allowlist", async () => {
    const runId = await makeTestRun("ALLOWLIST-GUARD", { unrelatedFile: true });
    const out = await readDebugArtifactAsset("opentable", runId, "secret.env");
    expect(out).toBeNull();
  });

  it("returns bytes + correct content-type for summary.json", async () => {
    const runId = await makeTestRun("READ-SUMMARY");
    const out = await readDebugArtifactAsset("opentable", runId, "summary.json");
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.contentType).toBe("application/json; charset=utf-8");
    const parsed = JSON.parse(out.bytes.toString("utf-8"));
    expect(parsed.label).toBe("READ-SUMMARY");
  });

  it("returns image/png for page.png", async () => {
    const runId = await makeTestRun("READ-PNG", { png: true });
    const out = await readDebugArtifactAsset("opentable", runId, "page.png");
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.contentType).toBe("image/png");
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  it("returns null for missing files", async () => {
    const runId = await makeTestRun("NO-PNG-HERE");
    expect(await readDebugArtifactAsset("opentable", runId, "page.png")).toBeNull();
  });
});

describe("listDebugArtifacts", () => {
  it("lists known provider runs sorted newest-first within provider", async () => {
    await makeTestRun("ORDER-A");
    await makeTestRun("ORDER-B");
    await makeTestRun("ORDER-C");

    const index = await listDebugArtifacts();
    const opentable = findProvider(index.providers, "opentable");
    expect(opentable).toBeDefined();
    if (!opentable) return;
    const testRuns = opentable.runs.filter((r) => r.runId.startsWith(TEST_RUN_PREFIX));
    const expectedOrder = [
      TEST_RUN_PREFIX + "ORDER-C",
      TEST_RUN_PREFIX + "ORDER-B",
      TEST_RUN_PREFIX + "ORDER-A",
    ];
    expect(testRuns.map((r) => r.runId)).toEqual(expectedOrder);
  });

  it("populates summary + capturedAt + label + files for each run", async () => {
    const runId = await makeTestRun("FULL-METADATA", { png: true, html: true });
    const index = await listDebugArtifacts();
    const opentable = findProvider(index.providers, "opentable");
    expect(opentable).toBeDefined();
    if (!opentable) return;
    const run = findRun(opentable.runs, runId);
    expect(run).toBeDefined();
    if (!run) return;
    // parseRunId splits on first Z+dash; the test prefix CLAUDE-TEST- becomes
    // part of the label by design (everything after the trailing Z).
    expect(run.label).toBe("CLAUDE-TEST-FULL-METADATA");
    expect(run.capturedAt).toBe("2099-01-01T00:00:00.000Z");
    expect(run.summary).not.toBeNull();
    expect(run.summary?.label).toBe("FULL-METADATA");
    expect(run.files.slice().sort()).toEqual(["page.html", "page.png", "summary.json"]);
  });

  it("ignores unrelated files in the run dir", async () => {
    const runId = await makeTestRun("HIDE-UNRELATED", { unrelatedFile: true });
    const index = await listDebugArtifacts();
    const opentable = findProvider(index.providers, "opentable");
    if (!opentable) return;
    const run = findRun(opentable.runs, runId);
    if (!run) return;
    expect(run.files).not.toContain("secret.env");
  });

  it("returns null summary when summary.json is absent / unparseable", async () => {
    const runId1 = await makeTestRun("NO-SUMMARY", { summary: null });
    const runId2 = await makeTestRun("BAD-SUMMARY", { summary: { not: "the right shape" } });

    const index = await listDebugArtifacts();
    const opentable = findProvider(index.providers, "opentable");
    if (!opentable) return;
    const r1 = findRun(opentable.runs, runId1);
    const r2 = findRun(opentable.runs, runId2);
    expect(r1?.summary).toBeNull();
    expect(r2?.summary).toBeNull();
  });

  it("counts totals across providers + runs", async () => {
    await makeTestRun("TOTALS-A");
    await makeTestRun("TOTALS-B");
    const index = await listDebugArtifacts();
    expect(index.totals.providers).toBeGreaterThanOrEqual(1);
    expect(index.totals.runs).toBeGreaterThanOrEqual(2);
  });
});
