import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analyzeExpediaRetryArtifactFile,
  ExpediaRetryArtifactCliError,
  loadExpediaRetryArtifactBundle,
  runExpediaRetryArtifactCli,
  validateExpediaRetryArtifactBundle,
} from "@/scripts/analyze-expedia-retry-artifact";

describe("Expedia retry artifact CLI helpers", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "expedia-artifact-cli-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("prints existing markdown analysis for a local bundle JSON", async () => {
    const file = await writeJson("bundle.json", {
      job: {
        id: "fixture-expedia-cli-card-scan",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt:
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught\n" +
        "[flight-rpa] no matching flight button found",
      workerLogPath: "codex-worker.log",
    });

    const markdown = await analyzeExpediaRetryArtifactFile(file);

    expect(markdown).toContain("## Expedia Retry Artifact Analysis");
    expect(markdown).toContain("card_scan_failed_before_fallback");
    expect(markdown).toContain("fixture-expedia-cli-card-scan");
  });

  it("reports missing files with a typed CLI error", async () => {
    await expect(
      loadExpediaRetryArtifactBundle(path.join(tmpRoot, "missing.json")),
    ).rejects.toMatchObject({
      name: "ExpediaRetryArtifactCliError",
      code: "missing_file",
    });
  });

  it("reports invalid JSON with a typed CLI error", async () => {
    const file = path.join(tmpRoot, "invalid.json");
    await fs.writeFile(file, "{", "utf8");

    await expect(loadExpediaRetryArtifactBundle(file)).rejects.toMatchObject({
      name: "ExpediaRetryArtifactCliError",
      code: "invalid_json",
    });
  });

  it("rejects an empty bundle", () => {
    expect(() => validateExpediaRetryArtifactBundle({})).toThrow(
      ExpediaRetryArtifactCliError,
    );
    try {
      validateExpediaRetryArtifactBundle({});
    } catch (error) {
      expect(error).toMatchObject({ code: "empty_bundle" });
    }
  });

  it("rejects non-object bundle JSON", () => {
    expect(() => validateExpediaRetryArtifactBundle([])).toThrow(
      ExpediaRetryArtifactCliError,
    );
    try {
      validateExpediaRetryArtifactBundle([]);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_bundle" });
    }
  });

  it("keeps unknown but valid bundles as insufficient_evidence", async () => {
    const file = await writeJson("unknown-valid.json", {
      job: {
        id: "fixture-expedia-cli-unknown",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
    });

    const markdown = await analyzeExpediaRetryArtifactFile(file);

    expect(markdown).toContain("insufficient_evidence");
    expect(markdown).toContain("No known Expedia retry signals");
  });

  it("returns exit code 1 and writes usage for missing argv", async () => {
    const errors: string[] = [];

    const exitCode = await runExpediaRetryArtifactCli([], {
      writeError: (text) => errors.push(text),
      writeOutput: () => {
        throw new Error("should not write output");
      },
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Usage:");
  });

  it("returns exit code 0 and writes markdown for valid argv", async () => {
    const file = await writeJson("bundle.json", {
      job: {
        id: "fixture-expedia-cli-network",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
        errorMessage: "Expedia unavailable: HTTP 503 response.",
      },
    });
    const output: string[] = [];

    const exitCode = await runExpediaRetryArtifactCli([file], {
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write error");
      },
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("network_provider_failure");
  });

  async function writeJson(name: string, value: unknown): Promise<string> {
    const file = path.join(tmpRoot, name);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    return file;
  }
});
