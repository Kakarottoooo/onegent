import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analyzeProviderClosureFile,
  parseProviderClosureCliArgs,
  runProviderClosureCli,
} from "@/scripts/provider-closure";

describe("provider closure CLI", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "provider-closure-cli-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("parses preflight, analyze, and report commands", () => {
    expect(parseProviderClosureCliArgs(["preflight", "--kind", "flight"])).toEqual({
      command: "preflight",
      kind: "expedia-flight",
    });
    expect(
      parseProviderClosureCliArgs([
        "analyze",
        "--kind=restaurant",
        "--artifact",
        "bundle.json",
      ]),
    ).toMatchObject({
      command: "analyze",
      kind: "restaurant",
      artifactPath: "bundle.json",
    });
    expect(
      parseProviderClosureCliArgs([
        "report",
        "--kind",
        "hotel",
        "--artifact=bundle.json",
        "--markdown",
      ]),
    ).toMatchObject({
      command: "report",
      kind: "hotel",
      artifactPath: "bundle.json",
      markdown: true,
    });
  });

  it("prints a no-live preflight checklist", async () => {
    const output: string[] = [];
    const exitCode = await runProviderClosureCli(
      ["preflight", "--kind", "flight"],
      {
        writeOutput: (text) => output.push(text),
        writeError: () => {
          throw new Error("should not write error");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("Provider Closure Preflight");
    expect(output.join("\n")).toContain("No live provider run");
    expect(output.join("\n")).toContain("provider-closure.ts analyze --kind flight");
  });

  it("analyzes local artifact JSON without live access", async () => {
    const file = await writeJson("flight.json", {
      schemaVersion: 1,
      kind: "expedia-flight",
      synthetic: true,
      fixtureId: "fixture-provider-closure-cli-flight",
      job: {
        id: "fixture-provider-closure-cli-flight",
        provider: "expedia",
        scenario: "flight",
        status: "manual_review",
      },
      workerLogExcerpt:
        "[flight-rpa] Checkout reached: traveler review page visible\n[flight-rpa] safe handoff",
    });

    const analysis = await analyzeProviderClosureFile({
      kind: "expedia-flight",
      artifactPath: file,
    });

    expect(analysis.terminalOutcome).toBe("safe_handoff");
    expect(analysis.providerAnalysis.state).toBe(
      "checkout_manual_review_reached",
    );
  });

  it("prints JSON for analyze and Markdown for report", async () => {
    const file = await writeJson("hotel.json", {
      schemaVersion: 1,
      kind: "hotel",
      synthetic: true,
      fixtureId: "fixture-provider-closure-cli-hotel",
      job: {
        id: "fixture-provider-closure-cli-hotel",
        provider: "booking-com",
        scenario: "hotel",
        status: "manual_review",
      },
      workerLogExcerpt: "Booking.com guest details page visible and loaded.",
    });
    const analyzeOutput: string[] = [];
    const reportOutput: string[] = [];

    expect(
      await runProviderClosureCli(["analyze", "--kind", "hotel", "--artifact", file], {
        writeOutput: (text) => analyzeOutput.push(text),
        writeError: () => {
          throw new Error("should not write error");
        },
      }),
    ).toBe(0);
    expect(JSON.parse(analyzeOutput.join("\n")).terminalOutcome).toBe(
      "safe_handoff",
    );

    expect(
      await runProviderClosureCli(
        ["report", "--kind", "hotel", "--artifact", file, "--markdown"],
        {
          writeOutput: (text) => reportOutput.push(text),
          writeError: () => {
            throw new Error("should not write error");
          },
        },
      ),
    ).toBe(0);
    expect(reportOutput.join("\n")).toContain("# Provider Closure Report");
    expect(reportOutput.join("\n")).toContain("## Exact Next Step");
  });

  it("rejects unsafe artifact content", async () => {
    const file = await writeJson("unsafe.json", {
      schemaVersion: 1,
      kind: "restaurant",
      job: {
        id: "fixture-unsafe-cli",
        provider: "resy",
        scenario: "R-030",
        status: "failed",
      },
      workerLogExcerpt: "verification code: 123456",
    });
    const errors: string[] = [];

    const exitCode = await runProviderClosureCli(
      ["analyze", "--kind", "restaurant", "--artifact", file],
      {
        writeOutput: () => {
          throw new Error("should not write output");
        },
        writeError: (text) => errors.push(text),
      },
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("unsafe data");
  });

  async function writeJson(name: string, value: unknown): Promise<string> {
    const file = path.join(tmpRoot, name);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    return file;
  }
});
