import { describe, expect, it } from "vitest";

import {
  CANONICAL_PHASE_CLOSURE_BASE_SHA,
  PHASE_CLOSURE_REQUIRED_DOCS,
} from "@/lib/phase-closure-evidence";
import {
  parsePhaseClosureEvidenceCliArgs,
  runPhaseClosureEvidenceCli,
} from "@/scripts/phase-closure-evidence";

describe("phase closure evidence CLI", () => {
  it("parses markdown and JSON modes", () => {
    expect(parsePhaseClosureEvidenceCliArgs([])).toEqual({ json: false });
    expect(parsePhaseClosureEvidenceCliArgs(["--json"])).toEqual({
      json: true,
    });
  });

  it("prints the markdown evidence pack from local docs", async () => {
    const output: string[] = [];
    const exitCode = await runPhaseClosureEvidenceCli([], {
      getCanonicalSha: () => CANONICAL_PHASE_CLOSURE_BASE_SHA,
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write error");
      },
    });

    expect(exitCode).toBe(0);
    const markdown = output.join("\n");
    expect(markdown).toContain("# Phase Closure Evidence Pack");
    expect(markdown).toContain("63837d9");
    expect(markdown).toContain("| Phase 0A |");
    expect(markdown).toContain("model_env_transient");
    expect(markdown).toContain("Phase 2 remains frozen");
  });

  it("prints JSON without claiming live verification", async () => {
    const output: string[] = [];
    const exitCode = await runPhaseClosureEvidenceCli(["--json"], {
      getCanonicalSha: () => CANONICAL_PHASE_CLOSURE_BASE_SHA,
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write error");
      },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output.join("\n"));
    expect(parsed.providerClosureLiveVerifiedEvidencePresent).toBe(false);
    expect(parsed.phases.find((p: { phase: string }) => p.phase === "Phase 2").closureVerdict).toBe(
      "frozen",
    );
  });

  it("fails cleanly when a required evidence doc is missing", async () => {
    const errors: string[] = [];
    const missing = PHASE_CLOSURE_REQUIRED_DOCS.phaseStatus.replace(
      /\\/g,
      "/",
    );
    const exitCode = await runPhaseClosureEvidenceCli([], {
      cwd: process.cwd(),
      getCanonicalSha: () => CANONICAL_PHASE_CLOSURE_BASE_SHA,
      readFile: async (filePath) => {
        if (filePath.replace(/\\/g, "/").endsWith(missing)) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return "placeholder";
      },
      writeOutput: () => {
        throw new Error("should not write output");
      },
      writeError: (text) => errors.push(text),
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Required evidence document missing");
  });
});
