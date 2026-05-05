import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analyzeRestaurantArtifactBundle,
  formatRestaurantArtifactAnalysisMarkdown,
  formatRestaurantArtifactBundleMarkdown,
  type RestaurantArtifactBundle,
  type RestaurantArtifactState,
} from "@/lib/runtime-forensics/restaurant-artifact-analysis";
import {
  analyzeRestaurantArtifactFile,
  loadRestaurantArtifactBundle,
  RestaurantArtifactCliError,
  runRestaurantArtifactCli,
  validateRestaurantArtifactBundle,
} from "@/scripts/analyze-restaurant-artifact";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "lib",
  "runtime-forensics",
  "__fixtures__",
  "restaurant-artifact-analysis",
);

const CASES: Array<{ file: string; state: RestaurantArtifactState; provider: string }> = [
  {
    file: "resy-modal-disabled-details-api-failed.json",
    state: "resy_modal_disabled_details_api_failed",
    provider: "resy",
  },
  {
    file: "resy-otp-login-boundary.json",
    state: "resy_otp_login_boundary",
    provider: "resy",
  },
  {
    file: "resy-no-availability.json",
    state: "resy_no_availability",
    provider: "resy",
  },
  {
    file: "opentable-phone-otp-handoff.json",
    state: "opentable_phone_otp_handoff",
    provider: "opentable",
  },
  {
    file: "opentable-form-incomplete.json",
    state: "opentable_form_incomplete",
    provider: "opentable",
  },
  {
    file: "provider-network-degraded.json",
    state: "provider_network_degraded",
    provider: "resy",
  },
  {
    file: "safe-manual-review-reached.json",
    state: "safe_manual_review_reached",
    provider: "opentable",
  },
];

describe("analyzeRestaurantArtifactBundle", () => {
  it.each(CASES)("classifies $file", async ({ file, state, provider }) => {
    const bundle = await readFixture(file);
    const analysis = analyzeRestaurantArtifactBundle(bundle);

    expect(analysis.state).toBe(state);
    expect(analysis.jobId).toMatch(/^fixture-restaurant-/);
    expect(analysis.provider).toBe(provider);
    expect(analysis.scenario).toBeTruthy();
    expect(analysis.signals.length).toBeGreaterThan(0);
  });

  it("prioritizes Resy OTP/login over generic safe handoff", async () => {
    const bundle = await readFixture("resy-otp-login-boundary.json");
    const analysis = analyzeRestaurantArtifactBundle(bundle);

    expect(analysis.state).toBe("resy_otp_login_boundary");
    expect(analysis.signals.map((signal) => signal.kind)).toContain(
      "safe_manual_review_reached",
    );
    expect(analysis.signals[0]?.kind).toBe("resy_otp_login_boundary");
  });

  it("prioritizes OpenTable phone/OTP handoff over final button visibility", async () => {
    const bundle = await readFixture("opentable-phone-otp-handoff.json");
    const analysis = analyzeRestaurantArtifactBundle(bundle);

    expect(analysis.state).toBe("opentable_phone_otp_handoff");
    expect(analysis.signals[0]?.kind).toBe("opentable_phone_otp_handoff");
  });

  it("returns insufficient evidence for bundles without known signals", () => {
    const analysis = analyzeRestaurantArtifactBundle({
      job: {
        id: "fixture-restaurant-no-signals",
        provider: "resy",
        scenario: "R-000",
        status: "failed",
      },
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.confidence).toBe("low");
    expect(analysis.signals).toEqual([]);
  });
});

describe("restaurant artifact markdown helpers", () => {
  it("formats a paste-ready summary from an analysis", async () => {
    const bundle = await readFixture("resy-modal-disabled-details-api-failed.json");
    const analysis = analyzeRestaurantArtifactBundle(bundle);
    const markdown = formatRestaurantArtifactAnalysisMarkdown(analysis);

    expect(markdown).toContain("## Restaurant Artifact Analysis");
    expect(markdown).toContain("resy_modal_disabled_details_api_failed");
    expect(markdown).toContain("worker/.debug-screenshots/resy-fixture-modal-disabled");
    expect(markdown).toContain("### Next Action");
  });

  it("formats a paste-ready summary directly from an artifact bundle", async () => {
    const bundle = await readFixture("safe-manual-review-reached.json");
    const markdown = formatRestaurantArtifactBundleMarkdown(bundle);

    expect(markdown).toContain("safe_manual_review_reached");
    expect(markdown).toContain("Restaurant Artifact Analysis");
    expect(markdown).toContain("codex-worker.log");
  });
});

describe("restaurant artifact CLI helpers", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "restaurant-artifact-cli-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("prints restaurant markdown for a local bundle JSON", async () => {
    const file = await writeJson("bundle.json", {
      job: {
        id: "fixture-restaurant-cli-network",
        provider: "resy",
        scenario: "R-NETWORK",
        status: "failed",
      },
      workerLogExcerpt: "[resy] provider degraded: 504 gateway timeout",
      workerLogPath: "codex-worker.log",
    });

    const markdown = await analyzeRestaurantArtifactFile(file);

    expect(markdown).toContain("## Restaurant Artifact Analysis");
    expect(markdown).toContain("provider_network_degraded");
    expect(markdown).toContain("fixture-restaurant-cli-network");
  });

  it("reports missing files with a typed CLI error", async () => {
    await expect(
      loadRestaurantArtifactBundle(path.join(tmpRoot, "missing.json")),
    ).rejects.toMatchObject({
      name: "RestaurantArtifactCliError",
      code: "missing_file",
    });
  });

  it("reports invalid JSON with a typed CLI error", async () => {
    const file = path.join(tmpRoot, "invalid.json");
    await fs.writeFile(file, "{", "utf8");

    await expect(loadRestaurantArtifactBundle(file)).rejects.toMatchObject({
      name: "RestaurantArtifactCliError",
      code: "invalid_json",
    });
  });

  it("rejects an empty bundle", () => {
    expect(() => validateRestaurantArtifactBundle({})).toThrow(
      RestaurantArtifactCliError,
    );
    try {
      validateRestaurantArtifactBundle({});
    } catch (error) {
      expect(error).toMatchObject({ code: "empty_bundle" });
    }
  });

  it("rejects non-object bundle JSON", () => {
    expect(() => validateRestaurantArtifactBundle([])).toThrow(
      RestaurantArtifactCliError,
    );
    try {
      validateRestaurantArtifactBundle([]);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_bundle" });
    }
  });

  it("returns exit code 1 and writes usage for missing argv", async () => {
    const errors: string[] = [];

    const exitCode = await runRestaurantArtifactCli([], {
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
        id: "fixture-restaurant-cli-review",
        provider: "opentable",
        scenario: "OT-REVIEW",
        status: "ready_for_confirmation",
        terminalReason: "ready_for_confirmation",
      },
    });
    const output: string[] = [];

    const exitCode = await runRestaurantArtifactCli([file], {
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write error");
      },
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("safe_manual_review_reached");
  });

  async function writeJson(name: string, value: unknown): Promise<string> {
    const file = path.join(tmpRoot, name);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    return file;
  }
});

async function readFixture(file: string): Promise<RestaurantArtifactBundle> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, file), "utf8");
  return JSON.parse(raw) as RestaurantArtifactBundle;
}
