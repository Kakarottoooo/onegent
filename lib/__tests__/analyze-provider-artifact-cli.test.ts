import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analyzeProviderArtifactFile,
  parseProviderArtifactCliArgs,
  ProviderArtifactCliError,
  runProviderArtifactCli,
  validateProviderArtifactBundle,
} from "@/scripts/analyze-provider-artifact";

describe("provider artifact CLI helpers", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "provider-artifact-cli-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("parses valid --kind arguments", () => {
    expect(
      parseProviderArtifactCliArgs(["--kind", "expedia", "bundle.json"]),
    ).toEqual({
      kind: "expedia",
      bundlePath: "bundle.json",
    });
    expect(
      parseProviderArtifactCliArgs(["--kind=hotel", "bundle.json"]),
    ).toEqual({
      kind: "hotel",
      bundlePath: "bundle.json",
    });
  });

  it("rejects invalid artifact kinds", () => {
    expect(() =>
      parseProviderArtifactCliArgs(["--kind", "flight", "bundle.json"]),
    ).toThrow(ProviderArtifactCliError);
    try {
      parseProviderArtifactCliArgs(["--kind", "flight", "bundle.json"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_kind" });
    }
  });

  it("reports missing files", async () => {
    await expect(
      analyzeProviderArtifactFile({
        kind: "restaurant",
        bundlePath: path.join(tmpRoot, "missing.json"),
      }),
    ).rejects.toMatchObject({
      name: "ProviderArtifactCliError",
      code: "missing_file",
    });
  });

  it("reports invalid JSON", async () => {
    const file = path.join(tmpRoot, "invalid.json");
    await fs.writeFile(file, "{", "utf8");

    await expect(
      analyzeProviderArtifactFile({ kind: "hotel", bundlePath: file }),
    ).rejects.toMatchObject({
      name: "ProviderArtifactCliError",
      code: "invalid_json",
    });
  });

  it("rejects empty bundle JSON", () => {
    expect(() => validateProviderArtifactBundle({})).toThrow(
      ProviderArtifactCliError,
    );
    try {
      validateProviderArtifactBundle({});
    } catch (error) {
      expect(error).toMatchObject({ code: "empty_bundle" });
    }
  });

  it("routes expedia bundles to the Expedia analyzer", async () => {
    const file = await writeJson("expedia.json", {
      job: {
        id: "fixture-provider-cli-expedia",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt:
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught\n" +
        "[flight-rpa] no matching flight button found",
    });
    const output: string[] = [];

    const exitCode = await runProviderArtifactCli(["--kind", "expedia", file], {
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write error");
      },
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("## Expedia Retry Artifact Analysis");
    expect(output.join("\n")).toContain("card_scan_failed_before_fallback");
  });

  it("routes hotel bundles to the hotel analyzer", async () => {
    const file = await writeJson("hotel.json", {
      job: {
        id: "fixture-provider-cli-hotel",
        provider: "booking-com",
        scenario: "hotel",
        status: "awaiting_manual_review",
      },
      workerLogExcerpt: "Booking.com guest details page visible and loaded.",
    });
    const output: string[] = [];

    const exitCode = await runProviderArtifactCli(["--kind", "hotel", file], {
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write error");
      },
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("## Hotel Retry Artifact Analysis");
    expect(output.join("\n")).toContain("guest_details_manual_review_reached");
  });

  it("routes restaurant bundles to the restaurant analyzer", async () => {
    const file = await writeJson("restaurant.json", {
      job: {
        id: "fixture-provider-cli-restaurant",
        provider: "resy",
        scenario: "R-030",
        status: "failed",
        errorMessage: "Resy details API failed and reservation modal disabled.",
      },
    });
    const output: string[] = [];

    const exitCode = await runProviderArtifactCli(
      ["--kind", "restaurant", file],
      {
        writeOutput: (text) => output.push(text),
        writeError: () => {
          throw new Error("should not write error");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("## Restaurant Artifact Analysis");
    expect(output.join("\n")).toContain(
      "resy_modal_disabled_details_api_failed",
    );
  });

  it("returns exit code 1 and usage for invalid kind", async () => {
    const errors: string[] = [];
    const exitCode = await runProviderArtifactCli(
      ["--kind", "flight", "bundle.json"],
      {
        writeError: (text) => errors.push(text),
        writeOutput: () => {
          throw new Error("should not write output");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Invalid artifact kind");
    expect(errors.join("\n")).toContain("Usage:");
  });

  async function writeJson(name: string, value: unknown): Promise<string> {
    const file = path.join(tmpRoot, name);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    return file;
  }
});
