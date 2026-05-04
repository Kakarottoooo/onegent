import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  BENCHMARK_RUN_FILE_PATTERN,
  aggregateForensics,
  extractJobsFromBenchmarkPayload,
  getBenchmarkRunsDir,
  getDebugScreenshotsDir,
  getWorkerLogPath,
  isSafeForensicsArtifactName,
  listBenchmarkRunFilenames,
  matchesFilter,
  readBenchmarkRunFile,
  readWorkerLogExcerpt,
  resolveSafeBenchmarkRunPath,
  resolveSafeScreenshotsPath,
} from "../runtime-forensics/loader";
import { RuntimeForensicsLoaderError } from "../runtime-forensics/types";

/* ─── Path safety unit tests ─────────────────────────────────────── */

describe("isSafeForensicsArtifactName", () => {
  it("accepts simple names", () => {
    expect(isSafeForensicsArtifactName("ok-name.json")).toBe(true);
    expect(isSafeForensicsArtifactName("R-003")).toBe(true);
  });
  it("rejects empty", () => {
    expect(isSafeForensicsArtifactName("")).toBe(false);
  });
  it("rejects null/undefined/non-string", () => {
    expect(isSafeForensicsArtifactName(null)).toBe(false);
    expect(isSafeForensicsArtifactName(undefined)).toBe(false);
    expect(isSafeForensicsArtifactName(42 as unknown as string)).toBe(false);
  });
  it("rejects path traversal", () => {
    expect(isSafeForensicsArtifactName("../etc/passwd")).toBe(false);
    expect(isSafeForensicsArtifactName("..")).toBe(false);
  });
  it("rejects forward / backward slashes", () => {
    expect(isSafeForensicsArtifactName("a/b")).toBe(false);
    expect(isSafeForensicsArtifactName("a\\b")).toBe(false);
  });
  it("rejects spaces and other special chars", () => {
    expect(isSafeForensicsArtifactName("name with space")).toBe(false);
    expect(isSafeForensicsArtifactName("name|pipe")).toBe(false);
    expect(isSafeForensicsArtifactName("name;semi")).toBe(false);
  });
  it("rejects names over 200 chars", () => {
    expect(isSafeForensicsArtifactName("a".repeat(201))).toBe(false);
  });
  it("BENCHMARK_RUN_FILE_PATTERN requires .json", () => {
    expect(BENCHMARK_RUN_FILE_PATTERN.test("ok.json")).toBe(true);
    expect(BENCHMARK_RUN_FILE_PATTERN.test("ok.md")).toBe(false);
    expect(BENCHMARK_RUN_FILE_PATTERN.test("ok")).toBe(false);
  });
});

describe("resolveSafeBenchmarkRunPath", () => {
  it("returns absolute path inside benchmark/runs/", () => {
    const p = resolveSafeBenchmarkRunPath("ok.json");
    expect(p.startsWith(getBenchmarkRunsDir() + path.sep)).toBe(true);
  });
  it("rejects unsafe names", () => {
    expect(() => resolveSafeBenchmarkRunPath("../etc.json")).toThrow(
      RuntimeForensicsLoaderError,
    );
    expect(() => resolveSafeBenchmarkRunPath("a/b.json")).toThrow();
  });
  it("rejects names with traversal pattern after safe-name check", () => {
    expect(() => resolveSafeBenchmarkRunPath("..\\evil.json")).toThrow();
  });
  it("rejects empty string", () => {
    expect(() => resolveSafeBenchmarkRunPath("")).toThrow();
  });
  it("rejects names without .json", () => {
    expect(() => resolveSafeBenchmarkRunPath("ok")).toThrow();
  });
});

describe("resolveSafeScreenshotsPath", () => {
  it("returns absolute path inside debug-screenshots/", () => {
    const p = resolveSafeScreenshotsPath("resy", "run-1");
    expect(p.startsWith(getDebugScreenshotsDir() + path.sep)).toBe(true);
  });
  it("rejects unsafe provider", () => {
    expect(() => resolveSafeScreenshotsPath("../etc", "run")).toThrow();
  });
  it("rejects unsafe run", () => {
    expect(() => resolveSafeScreenshotsPath("resy", "../../../etc")).toThrow();
  });
});

describe("getWorkerLogPath", () => {
  const original = process.env.WORKER_LOG_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_LOG_PATH;
    else process.env.WORKER_LOG_PATH = original;
  });
  it("defaults to ./codex-worker.log", () => {
    delete process.env.WORKER_LOG_PATH;
    const p = getWorkerLogPath();
    expect(p.endsWith("codex-worker.log")).toBe(true);
  });
  it("respects WORKER_LOG_PATH env", () => {
    process.env.WORKER_LOG_PATH = "C:/tmp/custom-worker.log";
    const p = getWorkerLogPath();
    expect(p).toBe(path.resolve("C:/tmp/custom-worker.log"));
  });
});

/* ─── extractJobsFromBenchmarkPayload ────────────────────────────── */

describe("extractJobsFromBenchmarkPayload", () => {
  it("returns [] for null/non-object", () => {
    expect(extractJobsFromBenchmarkPayload(null, "x")).toEqual([]);
    expect(extractJobsFromBenchmarkPayload(42, "x")).toEqual([]);
    expect(extractJobsFromBenchmarkPayload([], "x")).toEqual([]);
  });
  it("extracts from { cases: [...] }", () => {
    const out = extractJobsFromBenchmarkPayload(
      {
        cases: [
          { id: "j1", provider: "resy", scenario: "R-003" },
          { id: "j2", provider: "opentable", scenario: "OT-1" },
        ],
      },
      "src.json",
    );
    expect(out.length).toBe(2);
    expect(out[0].id).toBe("j1");
    expect(out[0].loaderNotes).toEqual(["from:src.json"]);
  });
  it("extracts from { runs: [...] }", () => {
    const out = extractJobsFromBenchmarkPayload(
      { runs: [{ id: "r1" }] },
      "src.json",
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("r1");
  });
  it("falls back to single object", () => {
    const out = extractJobsFromBenchmarkPayload(
      { id: "single", provider: "resy" },
      "src.json",
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("single");
  });
  it("duck-casts alternative field names", () => {
    const out = extractJobsFromBenchmarkPayload(
      { cases: [{ jobId: "x", task_id: "tsk", caseId: "C-1" }] },
      "src.json",
    );
    expect(out[0].id).toBe("x");
    expect(out[0].taskId).toBe("tsk");
    expect(out[0].scenario).toBe("C-1");
  });
  it("filters non-object case entries", () => {
    const out = extractJobsFromBenchmarkPayload(
      { cases: [42, null, { id: "valid" }] },
      "src.json",
    );
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("valid");
  });
});

/* ─── matchesFilter ──────────────────────────────────────────────── */

describe("matchesFilter", () => {
  it("undefined filter accepts everything", () => {
    expect(matchesFilter({ id: "x" }, undefined)).toBe(true);
  });
  it("matches jobId", () => {
    expect(matchesFilter({ id: "x" }, { jobId: "x" })).toBe(true);
    expect(matchesFilter({ id: "x" }, { jobId: "y" })).toBe(false);
  });
  it("matches taskId", () => {
    expect(matchesFilter({ taskId: "t1" }, { taskId: "t1" })).toBe(true);
    expect(matchesFilter({ taskId: "t1" }, { taskId: "t2" })).toBe(false);
  });
  it("matches sessionId", () => {
    expect(matchesFilter({ sessionId: "s1" }, { sessionId: "s1" })).toBe(true);
    expect(matchesFilter({ sessionId: "s1" }, { sessionId: "s2" })).toBe(false);
  });
  it("matches provider case-insensitively", () => {
    expect(matchesFilter({ provider: "Resy" }, { provider: "resy" })).toBe(true);
    expect(matchesFilter({ provider: "resy" }, { provider: "RESY" })).toBe(true);
    expect(matchesFilter({ provider: "resy" }, { provider: "expedia" })).toBe(
      false,
    );
  });
  it("matches status case-insensitively", () => {
    expect(matchesFilter({ status: "Failed" }, { status: "failed" })).toBe(true);
  });
});

/* ─── filesystem integration (with tmp cwd) ──────────────────────── */

describe("loader filesystem integration", () => {
  const originalCwd = process.cwd();
  const originalEnv = process.env.WORKER_LOG_PATH;
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rfor-"));
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    process.chdir(tmpRoot);
    delete process.env.WORKER_LOG_PATH;
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalEnv === undefined) delete process.env.WORKER_LOG_PATH;
    else process.env.WORKER_LOG_PATH = originalEnv;
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("listBenchmarkRunFilenames returns [] when no files", async () => {
    const list = await listBenchmarkRunFilenames();
    expect(list).toEqual([]);
  });
  it("listBenchmarkRunFilenames returns [] when dir missing", async () => {
    await fs.rm(path.join(tmpRoot, "benchmark"), { recursive: true });
    const list = await listBenchmarkRunFilenames();
    expect(list).toEqual([]);
  });
  it("listBenchmarkRunFilenames excludes phase1-quality-gate prefix", async () => {
    const dir = path.join(tmpRoot, "benchmark", "runs");
    await fs.writeFile(path.join(dir, "phase0.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(dir, "phase1-quality-gate-x.json"),
      "{}",
      "utf8",
    );
    const list = await listBenchmarkRunFilenames();
    expect(list).toEqual(["phase0.json"]);
  });
  it("listBenchmarkRunFilenames excludes founder-e2e prefix", async () => {
    const dir = path.join(tmpRoot, "benchmark", "runs");
    await fs.writeFile(path.join(dir, "phase0.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(dir, "founder-e2e-quick-2026.json"),
      "{}",
      "utf8",
    );
    const list = await listBenchmarkRunFilenames();
    expect(list).toEqual(["phase0.json"]);
  });
  it("readBenchmarkRunFile returns parsed JSON", async () => {
    const dir = path.join(tmpRoot, "benchmark", "runs");
    await fs.writeFile(
      path.join(dir, "good.json"),
      JSON.stringify({ cases: [{ id: "j1" }] }),
      "utf8",
    );
    const parsed = (await readBenchmarkRunFile("good.json")) as {
      cases: { id: string }[];
    };
    expect(parsed.cases[0].id).toBe("j1");
  });
  it("readBenchmarkRunFile throws on bad JSON", async () => {
    const dir = path.join(tmpRoot, "benchmark", "runs");
    await fs.writeFile(path.join(dir, "bad.json"), "{this is not json", "utf8");
    await expect(readBenchmarkRunFile("bad.json")).rejects.toThrow(
      RuntimeForensicsLoaderError,
    );
  });
  it("readBenchmarkRunFile throws on missing file", async () => {
    await expect(readBenchmarkRunFile("missing.json")).rejects.toThrow(
      RuntimeForensicsLoaderError,
    );
  });
  it("readWorkerLogExcerpt returns null when log missing", async () => {
    const excerpt = await readWorkerLogExcerpt();
    expect(excerpt).toBeNull();
  });
  it("readWorkerLogExcerpt reads tail when log present", async () => {
    await fs.writeFile(path.join(tmpRoot, "codex-worker.log"), "hello world", "utf8");
    const excerpt = await readWorkerLogExcerpt();
    expect(excerpt).toBe("hello world");
  });
  it("readWorkerLogExcerpt filter mode keeps matching lines + 2 of context", async () => {
    const lines = [
      "line 0",
      "line 1 with KEYWORD",
      "line 2 (context)",
      "line 3 (context)",
      "line 4 (no match)",
      "line 5 with KEYWORD",
      "line 6",
    ];
    await fs.writeFile(
      path.join(tmpRoot, "codex-worker.log"),
      lines.join("\n"),
      "utf8",
    );
    const excerpt = await readWorkerLogExcerpt({ filterSubstring: "KEYWORD" });
    expect(excerpt).toContain("line 1 with KEYWORD");
    expect(excerpt).toContain("line 2 (context)");
    expect(excerpt).toContain("line 3 (context)");
    expect(excerpt).toContain("line 5 with KEYWORD");
    expect(excerpt).toContain("line 6");
    expect(excerpt).not.toContain("line 0");
  });
  it("readWorkerLogExcerpt respects maxBytes cap", async () => {
    const big = "x".repeat(50_000);
    await fs.writeFile(path.join(tmpRoot, "codex-worker.log"), big, "utf8");
    const excerpt = await readWorkerLogExcerpt({ maxBytes: 1024 });
    expect(excerpt!.length).toBeLessThanOrEqual(1024);
  });
});

/* ─── aggregateForensics — empty-state handling ──────────────────── */

describe("aggregateForensics — graceful empty state", () => {
  const originalCwd = process.cwd();
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rfor-agg-"));
    process.chdir(tmpRoot);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns empty reports + summaries when no benchmark dir", async () => {
    const r = await aggregateForensics();
    expect(r.reports).toEqual([]);
    expect(r.summaries).toEqual([]);
    expect(r.benchmarkRunsScanned).toBe(0);
    expect(r.workerLogAvailable).toBe(false);
    expect(r.loaderNotes.length).toBeGreaterThan(0);
  });
  it("workerLogPathHint is always a non-empty string", async () => {
    const r = await aggregateForensics();
    expect(typeof r.workerLogPathHint).toBe("string");
    expect(r.workerLogPathHint.length).toBeGreaterThan(0);
  });
  it("respects limit option", async () => {
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(
        path.join(tmpRoot, "benchmark", "runs", `run-${i}.json`),
        JSON.stringify({ cases: [{ id: `c-${i}` }] }),
        "utf8",
      );
    }
    const r = await aggregateForensics({ limit: 2 });
    expect(r.reports.length).toBeLessThanOrEqual(2);
  });
  it("filter by provider works post-extraction", async () => {
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "mix.json"),
      JSON.stringify({
        cases: [
          { id: "a", provider: "resy" },
          { id: "b", provider: "expedia" },
          { id: "c", provider: "opentable" },
        ],
      }),
      "utf8",
    );
    const r = await aggregateForensics({ filter: { provider: "resy" } });
    expect(r.reports.map((rep) => rep.jobId)).toEqual(["a"]);
  });
  it("never throws on completely garbage benchmark file", async () => {
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "bad.json"),
      "{not json",
      "utf8",
    );
    const r = await aggregateForensics();
    expect(r.reports).toEqual([]);
    expect(r.loaderNotes.some((n) => n.includes("skipped bad.json"))).toBe(
      true,
    );
  });
});
