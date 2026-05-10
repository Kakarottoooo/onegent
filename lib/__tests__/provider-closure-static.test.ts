import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("provider closure docs static guards", () => {
  it("keeps one synthetic closure report per kind", () => {
    const reports = [
      "docs/90-archive/provider-debug/provider-closure-reports/RESTAURANT_SYNTHETIC_CLOSURE_REPORT.md",
      "docs/90-archive/provider-debug/provider-closure-reports/FLIGHT_SYNTHETIC_CLOSURE_REPORT.md",
      "docs/90-archive/provider-debug/provider-closure-reports/HOTEL_SYNTHETIC_CLOSURE_REPORT.md",
    ];

    for (const relPath of reports) {
      expect(existsSync(path.join(ROOT, relPath)), relPath).toBe(true);
      const markdown = read(relPath);
      expect(markdown).toContain("# Provider Closure Report");
      expect(markdown).toContain("## Exact Next Step");
      expect(markdown).toContain("No live provider run from this harness");
    }
  });

  it("documents the provider closure harness in the live protocol", () => {
    const protocol = read("docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md");

    expect(protocol).toContain("scripts/provider-closure.ts");
    expect(protocol).toContain("safe_handoff");
    expect(protocol).toContain("model_env_transient");
    expect(protocol).toContain("unsafe_blocked");
  });

  it("keeps closure docs free of mutating live controls", () => {
    const docs = [
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
      "docs/90-archive/provider-debug/provider-closure-reports/RESTAURANT_SYNTHETIC_CLOSURE_REPORT.md",
      "docs/90-archive/provider-debug/provider-closure-reports/FLIGHT_SYNTHETIC_CLOSURE_REPORT.md",
      "docs/90-archive/provider-debug/provider-closure-reports/HOTEL_SYNTHETIC_CLOSURE_REPORT.md",
      "docs/10-coordination/goal.md",
    ];

    for (const relPath of docs) {
      const badLines = read(relPath)
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => hasMutatingLiveControl(line))
        .filter(({ line }) => !isHardStopLine(line));

      expect(badLines, relPath).toEqual([]);
    }
  });
});

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function hasMutatingLiveControl(line: string): boolean {
  return [
    /<button\b/i,
    /\bon(?:Click|Submit)\s*=/i,
    /\b(run|start|retry|rerun|re-run)\s+(live|provider|booking|controlled retry)\b/i,
    /\b(live|provider|booking|controlled retry)\s+(run|retry)\s+button\b/i,
    /\bone[-\s]?click\s+live\b/i,
  ].some((pattern) => pattern.test(line));
}

function isHardStopLine(line: string): boolean {
  return /\b(do not|never|no\s+|not\s+|without|forbidden|must not|does not|should not|cannot|only copy|no-live|hard stop|is not involved|does not authorize|never starts|no live)\b/i.test(
    line,
  );
}
