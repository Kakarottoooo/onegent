/**
 * Pure helpers used by the Phase 1 Quality Gate orchestrator
 * (`scripts/run-phase1-quality-gate.ts`). Lives here (rather than
 * inside the script) so we can unit-test the parsing /
 * classification / spec-derivation logic without spawning
 * subprocesses or touching argv.
 *
 * The runner script imports these and adds:
 *  - subprocess execution (child_process)
 *  - dev-server probing (fetch)
 *  - file IO (fs)
 *  - process.exit() with the verdict-derived code
 *
 * Everything in this file is deterministic given inputs.
 */

import path from "node:path";

import type { GateRequirement, GateStatus } from "./report";

/* ─── CLI flag schema ─────────────────────────────────────────────── */

export interface CliFlags {
  baseUrl: string;
  outputDir: string;
  label?: string;
  includeSmoke: boolean;
  includeE2e: boolean;
  noDrift: boolean;
  allowKnownDrift: boolean;
  json: boolean;
  saveToApi: boolean;
  startServer: boolean;
  help: boolean;
}

export interface ParseArgvOptions {
  /** What process.cwd() returns. Test seam. */
  cwd: string;
  /** Read-only env source. Test seam. */
  env: NodeJS.ProcessEnv;
}

export function defaultCliFlags(opts: ParseArgvOptions): CliFlags {
  return {
    baseUrl: "http://localhost:3000",
    outputDir: path.resolve(opts.cwd, "benchmark", "runs"),
    label: undefined,
    includeSmoke: false,
    includeE2e: false,
    noDrift: false,
    allowKnownDrift: opts.env.QUALITY_GATE_KNOWN_DRIFT === "1",
    json: false,
    saveToApi: false,
    startServer: false,
    help: false,
  };
}

/**
 * Pure argv parser. Tolerates unknown flags rather than rejecting
 * (so older / newer doc copies that mention a flag we don't have
 * yet don't crash the runner).
 */
export function parseArgv(argv: ReadonlyArray<string>, opts: ParseArgvOptions): CliFlags {
  const flags = defaultCliFlags(opts);
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--base-url=")) flags.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--output-dir=")) flags.outputDir = path.resolve(arg.slice("--output-dir=".length));
    else if (arg.startsWith("--label=")) flags.label = arg.slice("--label=".length);
    else if (arg === "--include-smoke") flags.includeSmoke = true;
    else if (arg === "--include-e2e") flags.includeE2e = true;
    else if (arg === "--no-drift") flags.noDrift = true;
    else if (arg === "--allow-known-drift") flags.allowKnownDrift = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--save-to-api") flags.saveToApi = true;
    else if (arg === "--start-server") flags.startServer = true;
    // unknown flags ignored intentionally
  }
  return flags;
}

/* ─── Check spec ──────────────────────────────────────────────────── */

export interface CheckSpec {
  id: string;
  label: string;
  command: string;
  requirement: GateRequirement;
  needsServer?: boolean;
  timeoutMs?: number;
  vitestTargets?: string[];
  allowKnownExistingFailure?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the deterministic list of checks for a given flag set.
 *
 * Order matters for the report banner. Required checks first (so
 * their results land at the top of the dashboard table), then
 * optional gates added by --include-* flags.
 */
export function defineChecks(flags: CliFlags): CheckSpec[] {
  const checks: CheckSpec[] = [
    {
      id: "tsc",
      label: "TypeScript typecheck (--noEmit)",
      command: "npx tsc --noEmit --pretty false",
      requirement: "required",
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:flight-time-filter",
      label: "vitest: flight-time-filter (Phase 1 founder bug)",
      command: "npx vitest run lib/__tests__/flight-time-filter.test.ts",
      requirement: "required",
      vitestTargets: ["lib/__tests__/flight-time-filter.test.ts"],
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:profile-gap-decision",
      label: "vitest: profile-gap-decision",
      command: "npx vitest run lib/__tests__/profile-gap-decision.test.ts",
      requirement: "required",
      vitestTargets: ["lib/__tests__/profile-gap-decision.test.ts"],
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:profile-gap-on-save",
      label: "vitest: profile-gap-on-save",
      command: "npx vitest run lib/__tests__/profile-gap-on-save.test.ts",
      requirement: "required",
      vitestTargets: ["lib/__tests__/profile-gap-on-save.test.ts"],
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:chat-plan-query",
      label: "vitest: chat-plan-query",
      command: "npx vitest run lib/__tests__/chat-plan-query.test.ts",
      requirement: "required",
      vitestTargets: ["lib/__tests__/chat-plan-query.test.ts"],
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:founder-e2e",
      label: "vitest: founder-e2e schema + helpers",
      command: "npx vitest run lib/__tests__/founder-e2e.test.ts",
      requirement: "required",
      vitestTargets: ["lib/__tests__/founder-e2e.test.ts"],
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:founder-e2e-runner",
      label: "vitest: founder-e2e-runner (autonomous)",
      command: "npx vitest run lib/__tests__/founder-e2e-runner.test.ts",
      requirement: "required",
      vitestTargets: ["lib/__tests__/founder-e2e-runner.test.ts"],
      timeoutMs: 5 * 60_000,
    },
    {
      id: "vitest:quality-gate",
      label: "vitest: quality-gate self-test",
      command:
        "npx vitest run lib/__tests__/quality-gate-report.test.ts lib/__tests__/quality-gate-runner.test.ts",
      requirement: "required",
      vitestTargets: [
        "lib/__tests__/quality-gate-report.test.ts",
        "lib/__tests__/quality-gate-runner.test.ts",
      ],
      timeoutMs: 5 * 60_000,
    },
  ];

  if (!flags.noDrift) {
    checks.push({
      id: "check-drift",
      label: "check-drift (lib ↔ worker)",
      command: "npm run check-drift",
      requirement: "required",
      timeoutMs: 60_000,
      allowKnownExistingFailure: flags.allowKnownDrift,
    });
  }

  if (flags.includeE2e) {
    checks.push(
      {
        id: "preflight:founder-e2e",
        label: "preflight: founder-e2e (dev server probes)",
        command: "npm run preflight:founder-e2e",
        requirement: "optional",
        needsServer: true,
        timeoutMs: 60_000,
      },
      {
        id: "e2e:founder",
        label: "e2e:founder (autonomous workbench runner)",
        command: "npm run e2e:founder",
        requirement: "optional",
        needsServer: true,
        timeoutMs: 5 * 60_000,
      },
    );
  }

  if (flags.includeSmoke) {
    checks.push({
      id: "smoke:phase1",
      label: "smoke:phase1 (no-token Phase 1 surfaces)",
      command: "npm run smoke:phase1",
      requirement: "optional",
      needsServer: true,
      timeoutMs: 3 * 60_000,
    });
  }

  return checks;
}

/* ─── Misc helpers ────────────────────────────────────────────────── */

/** Status → terminal symbol for the runner banner. */
export function statusSymbol(s: GateStatus): string {
  switch (s) {
    case "pass":
      return "✓";
    case "fail":
      return "✗";
    case "skipped":
      return "·";
    case "known_existing_failure":
      return "!";
    case "pending":
    default:
      return "?";
  }
}

/**
 * Convert an ISO timestamp into a filename-safe runId.
 * "2026-05-04T01:02:03.123Z" → "2026-05-04T01-02-03-123Z".
 */
export function makeRunIdFromIso(startedAt: string): string {
  return startedAt.replace(/[:.]/g, "-");
}

/**
 * Normalize a base URL: enforce http(s) scheme, strip trailing
 * slash. Returns null on unsupported schemes (file://, javascript:,
 * etc). Caller should fall back to a default.
 */
export function normalizeBaseUrl(input: string | undefined): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Strip trailing slash for predictability.
  const out = url.toString().replace(/\/+$/, "");
  return out;
}
