import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  defaultCliFlags,
  defineChecks,
  makeRunIdFromIso,
  normalizeBaseUrl,
  parseArgv,
  statusSymbol,
  type CliFlags,
} from "../quality-gate/runner-helpers";

const fakeOpts = (env: Record<string, string | undefined> = {}) => ({
  cwd: "/fake/cwd",
  env: env as NodeJS.ProcessEnv,
});

/* ─── parseArgv ───────────────────────────────────────────────────── */

describe("parseArgv", () => {
  it("returns defaults for empty argv", () => {
    const flags = parseArgv([], fakeOpts());
    expect(flags.help).toBe(false);
    expect(flags.includeSmoke).toBe(false);
    expect(flags.includeE2e).toBe(false);
    expect(flags.noDrift).toBe(false);
    expect(flags.allowKnownDrift).toBe(false);
    expect(flags.json).toBe(false);
    expect(flags.saveToApi).toBe(false);
    expect(flags.startServer).toBe(false);
    expect(flags.baseUrl).toBe("http://localhost:3000");
  });
  it("--help / -h sets help", () => {
    expect(parseArgv(["--help"], fakeOpts()).help).toBe(true);
    expect(parseArgv(["-h"], fakeOpts()).help).toBe(true);
  });
  it("--include-smoke sets includeSmoke", () => {
    expect(parseArgv(["--include-smoke"], fakeOpts()).includeSmoke).toBe(true);
  });
  it("--include-e2e sets includeE2e", () => {
    expect(parseArgv(["--include-e2e"], fakeOpts()).includeE2e).toBe(true);
  });
  it("--no-drift sets noDrift", () => {
    expect(parseArgv(["--no-drift"], fakeOpts()).noDrift).toBe(true);
  });
  it("--allow-known-drift via flag", () => {
    expect(parseArgv(["--allow-known-drift"], fakeOpts()).allowKnownDrift).toBe(true);
  });
  it("--allow-known-drift via env QUALITY_GATE_KNOWN_DRIFT=1", () => {
    expect(
      parseArgv([], fakeOpts({ QUALITY_GATE_KNOWN_DRIFT: "1" })).allowKnownDrift,
    ).toBe(true);
  });
  it("env=2 does NOT set allowKnownDrift", () => {
    expect(
      parseArgv([], fakeOpts({ QUALITY_GATE_KNOWN_DRIFT: "2" })).allowKnownDrift,
    ).toBe(false);
  });
  it("--json sets json", () => {
    expect(parseArgv(["--json"], fakeOpts()).json).toBe(true);
  });
  it("--save-to-api sets saveToApi", () => {
    expect(parseArgv(["--save-to-api"], fakeOpts()).saveToApi).toBe(true);
  });
  it("--start-server sets startServer", () => {
    expect(parseArgv(["--start-server"], fakeOpts()).startServer).toBe(true);
  });
  it("--label=NAME sets label", () => {
    expect(parseArgv(["--label=ci-pr-42"], fakeOpts()).label).toBe("ci-pr-42");
  });
  it("--base-url=URL sets baseUrl", () => {
    expect(parseArgv(["--base-url=http://10.0.0.1:4000"], fakeOpts()).baseUrl).toBe(
      "http://10.0.0.1:4000",
    );
  });
  it("--output-dir=PATH resolves under root or absolute", () => {
    const out = parseArgv(["--output-dir=/tmp/runs"], fakeOpts()).outputDir;
    expect(path.isAbsolute(out)).toBe(true);
  });
  it("ignores unknown flags rather than crashing", () => {
    const flags = parseArgv(["--gibberish", "--also=nope"], fakeOpts());
    expect(flags.help).toBe(false);
    expect(flags.includeSmoke).toBe(false);
  });
  it("accumulates multiple flags in one call", () => {
    const flags = parseArgv(
      ["--include-smoke", "--include-e2e", "--allow-known-drift", "--label=x"],
      fakeOpts(),
    );
    expect(flags.includeSmoke).toBe(true);
    expect(flags.includeE2e).toBe(true);
    expect(flags.allowKnownDrift).toBe(true);
    expect(flags.label).toBe("x");
  });
  it("defaults outputDir to <cwd>/benchmark/runs", () => {
    const flags = defaultCliFlags(fakeOpts());
    expect(flags.outputDir).toBe(path.resolve("/fake/cwd", "benchmark", "runs"));
  });
});

/* ─── defineChecks ────────────────────────────────────────────────── */

describe("defineChecks", () => {
  function flagsWith(overrides: Partial<CliFlags> = {}): CliFlags {
    return { ...defaultCliFlags(fakeOpts()), ...overrides };
  }

  it("default → 9 checks: 8 vitest/tsc required + check-drift", () => {
    const checks = defineChecks(flagsWith());
    expect(checks.length).toBe(9);
    expect(checks.find((c) => c.id === "tsc")).toBeDefined();
    expect(checks.find((c) => c.id === "check-drift")).toBeDefined();
  });
  it("--no-drift drops check-drift", () => {
    const checks = defineChecks(flagsWith({ noDrift: true }));
    expect(checks.find((c) => c.id === "check-drift")).toBeUndefined();
    expect(checks.length).toBe(8);
  });
  it("--include-e2e adds preflight + e2e (2 optional)", () => {
    const checks = defineChecks(flagsWith({ includeE2e: true }));
    expect(checks.find((c) => c.id === "preflight:founder-e2e")).toBeDefined();
    expect(checks.find((c) => c.id === "e2e:founder")).toBeDefined();
    expect(
      checks.find((c) => c.id === "e2e:founder")?.requirement,
    ).toBe("optional");
  });
  it("--include-smoke adds smoke (1 optional)", () => {
    const checks = defineChecks(flagsWith({ includeSmoke: true }));
    expect(checks.find((c) => c.id === "smoke:phase1")).toBeDefined();
    expect(
      checks.find((c) => c.id === "smoke:phase1")?.requirement,
    ).toBe("optional");
  });
  it("all-includes → 12 checks", () => {
    const checks = defineChecks(
      flagsWith({ includeE2e: true, includeSmoke: true }),
    );
    expect(checks.length).toBe(12);
  });
  it("required checks come first", () => {
    const checks = defineChecks(
      flagsWith({ includeE2e: true, includeSmoke: true }),
    );
    const reqIdx = checks.findIndex((c) => c.requirement === "required");
    const optIdx = checks.findIndex((c) => c.requirement === "optional");
    expect(reqIdx).toBeLessThan(optIdx);
  });
  it("tsc is first", () => {
    const checks = defineChecks(flagsWith());
    expect(checks[0].id).toBe("tsc");
  });
  it("vitest:flight-time-filter is required (Phase 1 founder bug)", () => {
    const checks = defineChecks(flagsWith());
    const c = checks.find((x) => x.id === "vitest:flight-time-filter");
    expect(c).toBeDefined();
    expect(c?.requirement).toBe("required");
  });
  it("check-drift respects allowKnownDrift", () => {
    const checks = defineChecks(flagsWith({ allowKnownDrift: true }));
    const drift = checks.find((c) => c.id === "check-drift");
    expect(drift?.allowKnownExistingFailure).toBe(true);
  });
  it("check-drift WITHOUT allowKnownDrift defaults to false", () => {
    const checks = defineChecks(flagsWith());
    const drift = checks.find((c) => c.id === "check-drift");
    expect(drift?.allowKnownExistingFailure).toBe(false);
  });
  it("e2e + smoke checks have needsServer=true", () => {
    const checks = defineChecks(
      flagsWith({ includeE2e: true, includeSmoke: true }),
    );
    expect(checks.find((c) => c.id === "preflight:founder-e2e")?.needsServer).toBe(true);
    expect(checks.find((c) => c.id === "e2e:founder")?.needsServer).toBe(true);
    expect(checks.find((c) => c.id === "smoke:phase1")?.needsServer).toBe(true);
  });
  it("required checks (tsc, vitest, check-drift) do NOT need server", () => {
    const checks = defineChecks(flagsWith());
    for (const c of checks) {
      expect(c.needsServer ?? false).toBe(false);
    }
  });
  it("all checks have a non-empty command", () => {
    const checks = defineChecks(
      flagsWith({ includeE2e: true, includeSmoke: true }),
    );
    for (const c of checks) {
      expect(c.command.length).toBeGreaterThan(0);
    }
  });
  it("vitest target globs are concrete file paths", () => {
    const checks = defineChecks(flagsWith());
    for (const c of checks) {
      if (c.vitestTargets) {
        for (const t of c.vitestTargets) {
          expect(t).toMatch(/^lib\/__tests__\//);
          expect(t.endsWith(".test.ts")).toBe(true);
        }
      }
    }
  });
});

/* ─── statusSymbol ────────────────────────────────────────────────── */

describe("statusSymbol", () => {
  it("pass → ✓", () => expect(statusSymbol("pass")).toBe("✓"));
  it("fail → ✗", () => expect(statusSymbol("fail")).toBe("✗"));
  it("skipped → ·", () => expect(statusSymbol("skipped")).toBe("·"));
  it("known_existing_failure → !", () => expect(statusSymbol("known_existing_failure")).toBe("!"));
  it("pending → ?", () => expect(statusSymbol("pending")).toBe("?"));
});

/* ─── makeRunIdFromIso ────────────────────────────────────────────── */

describe("makeRunIdFromIso", () => {
  it("replaces colons", () => {
    expect(makeRunIdFromIso("2026-05-04T08:00:00.000Z")).toBe("2026-05-04T08-00-00-000Z");
  });
  it("replaces dots", () => {
    expect(makeRunIdFromIso("2026-05-04T08:00:00.000Z")).not.toContain(".");
  });
  it("leaves an already-safe id unchanged", () => {
    expect(makeRunIdFromIso("abc-123")).toBe("abc-123");
  });
});

/* ─── normalizeBaseUrl ────────────────────────────────────────────── */

describe("normalizeBaseUrl", () => {
  it("preserves http URL (strips trailing slash)", () => {
    expect(normalizeBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });
  it("preserves https URL", () => {
    expect(normalizeBaseUrl("https://example.com")).toBe("https://example.com");
  });
  it("rejects file://", () => {
    expect(normalizeBaseUrl("file:///etc/passwd")).toBeNull();
  });
  it("rejects javascript: scheme", () => {
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
  });
  it("rejects bare host (no scheme)", () => {
    expect(normalizeBaseUrl("localhost:3000")).toBeNull();
  });
  it("rejects empty input", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
  });
  it("preserves port + path", () => {
    expect(normalizeBaseUrl("http://10.0.0.1:4000/dev")).toBe(
      "http://10.0.0.1:4000/dev",
    );
  });
});
