#!/usr/bin/env node
/**
 * Phase 1 Quality Gate Orchestrator
 *
 *   npm run gate:phase1
 *   npm run gate:phase1 -- --include-smoke
 *   npm run gate:phase1 -- --include-e2e
 *   npm run gate:phase1 -- --json
 *   npm run gate:phase1 -- --label=ci-pr-42
 *   npm run gate:phase1 -- --allow-known-drift
 *
 * What this is: a no-token, no-provider, no-payment, no-OTP
 * orchestrator that runs the **Phase 1 build-time signal set** and
 * emits a single verdict + paste-ready markdown report.
 *
 * Pure logic (verdict, classification, formatting, argv parsing,
 * check definitions) lives in `lib/quality-gate/*` so the test
 * suite can cover it without spawning subprocesses. THIS file only
 * does:
 *   - argv → flags (delegated to parseArgv)
 *   - dev-server health probe (HEAD on baseUrl)
 *   - per-spec subprocess execution (child_process.spawn)
 *   - terminal banner / JSON emission
 *   - file IO (lib/quality-gate/loader.ts)
 *   - process.exit() with the verdict-derived code
 *
 * Exit codes:
 *   0 — pass | needs_polish (CI green; needs_polish is informational)
 *   1 — fail (any required check failed)
 *   2 — env_blocked (a required check needed an env we don't have)
 *   3 — runner internal error (orchestrator itself blew up)
 *
 * SAFETY RAILS (cannot be overridden by any flag):
 *   - NO live OpenAI / Computer Use call.
 *   - NO external booking provider (Resy / OpenTable / Expedia /
 *     Booking.com) navigation.
 *   - NO payment, OTP, CAPTCHA, or final-confirm interaction.
 *   - NO automatic dev server start (would conflict with codex's
 *     local worker / Next dev). --start-server is reserved and
 *     currently rejected.
 */

import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

import {
  buildQualityGateRun,
  classifyFailure,
  defineChecks,
  fileNameForQualityGateRun,
  formatQualityGateMarkdown,
  GATE_TAIL_BYTES,
  GATE_VERDICT_LABEL,
  makeRunIdFromIso,
  parseArgv,
  saveQualityGateRun,
  saveQualityGateMarkdown,
  statusSymbol,
  tailString,
  type CheckSpec,
  type CliFlags,
  type GateCheck,
  type GateRunnerMeta,
  type QualityGateRun,
} from "../lib/quality-gate";

const HELP_TEXT = `Usage: npm run gate:phase1 -- [flags]

Phase 1 Quality Gate orchestrator. Runs no-token, no-provider build-time
checks and emits verdict + markdown report.

Flags:
  --base-url=URL          Dev server base URL for optional probes (default
                          http://localhost:3000).
  --output-dir=PATH       Where to write <runId>.json + .md (default
                          ./benchmark/runs).
  --label=NAME            Tag the run (e.g. ci-pr-42). Surfaces in dashboard.
  --include-smoke         Run npm run smoke:phase1 as optional check
                          (requires dev server).
  --include-e2e           Run npm run preflight:founder-e2e and e2e:founder
                          (requires dev server).
  --no-drift              Skip the check-drift step entirely.
  --allow-known-drift     Treat a check-drift fail as known_existing_failure
                          instead of fail. Use when drift is a pre-existing
                          codex-domain issue you're not fixing in this PR.
                          Also activated by env QUALITY_GATE_KNOWN_DRIFT=1.
  --json                  Emit machine-readable JSON to stdout in addition
                          to writing the run file.
  --save-to-api           POST the run to /api/dev/phase1-quality-gates after
                          writing locally.
  --start-server          Reserved. Currently rejected to avoid colliding
                          with codex's local worker.
  --help, -h              Print this help.

Exit codes:
  0 = pass | needs_polish
  1 = fail
  2 = env_blocked (missing dev server when an --include-* check needed it)
  3 = runner internal error
`;

/* ─── Subprocess runner ───────────────────────────────────────────── */

interface SpawnResult {
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface SpawnOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Wrapper around child_process.spawn with shell:true (so commands
 * like `npx vitest run …` and `npm run check-drift` work
 * cross-platform without resolving binaries by hand).
 *
 * Captures stdout + stderr and bounds memory on chatty processes
 * by trimming chunk buffers periodically. Tail extraction
 * (truncating to GATE_TAIL_BYTES) is left to the caller via
 * tailString.
 */
function runShell(opts: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const STREAM_CAP = GATE_TAIL_BYTES * 8;

    const child = spawn(opts.command, {
      cwd: opts.cwd,
      shell: true,
      env: { ...process.env, ...(opts.env ?? {}) },
    });

    let timedOut = false;
    let timeout: NodeJS.Timeout | null = null;
    if (opts.timeoutMs && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          /* noop */
        }
      }, opts.timeoutMs);
    }

    function capChunks(buffer: Buffer[], totalBytes: number) {
      if (totalBytes <= STREAM_CAP * 4) return;
      let kept = 0;
      const trimmed: Buffer[] = [];
      for (let i = buffer.length - 1; i >= 0; i--) {
        const c = buffer[i];
        kept += c.length;
        trimmed.unshift(c);
        if (kept >= STREAM_CAP * 2) break;
      }
      buffer.splice(0, buffer.length, ...trimmed);
    }

    child.stdout?.on("data", (buf: Buffer) => {
      stdoutBytes += buf.length;
      stdoutChunks.push(buf);
      capChunks(stdoutChunks, stdoutBytes);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderrBytes += buf.length;
      stderrChunks.push(buf);
      capChunks(stderrChunks, stderrBytes);
    });
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: `[gate runner] spawn error: ${err.message}`,
        timedOut: false,
      });
    });
    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        signal: signal ?? null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
      });
    });
  });
}

/** Probe a URL with a HEAD request, short timeout. Returns true on 2xx/3xx. */
async function isDevServerAlive(baseUrl: string, timeoutMs = 2500): Promise<boolean> {
  const url = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(handle);
  }
}

/** Vitest target check — true if any of the given paths exists on disk. */
function vitestFilesExist(targets: string[], cwd: string): boolean {
  return targets.some((rel) => existsSync(path.resolve(cwd, rel)));
}

/* ─── Per-check execution ─────────────────────────────────────────── */

interface ExecuteCtx {
  cwd: string;
  serverAlive: boolean;
  baseUrl: string;
}

async function executeCheck(spec: CheckSpec, ctx: ExecuteCtx): Promise<GateCheck> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const baseCheck: GateCheck = {
    id: spec.id,
    label: spec.label,
    command: spec.command,
    requirement: spec.requirement,
    status: "pending",
    severity: "skipped",
    durationMs: 0,
    startedAt,
    stdoutTail: "",
    stderrTail: "",
  };

  // Skip path 1: needs server but server is down.
  if (spec.needsServer && !ctx.serverAlive) {
    return {
      ...baseCheck,
      status: "skipped",
      severity: classifyFailure({
        id: spec.id,
        requirement: spec.requirement,
        status: "skipped",
        skipReason: "dev_server_unreachable",
      }),
      notes: `Dev server not reachable at ${ctx.baseUrl} — skipped.`,
    };
  }

  // Skip path 2: vitest target files don't exist on this branch.
  if (spec.vitestTargets && spec.vitestTargets.length > 0) {
    if (!vitestFilesExist(spec.vitestTargets, ctx.cwd)) {
      return {
        ...baseCheck,
        status: "skipped",
        severity: classifyFailure({
          id: spec.id,
          requirement: spec.requirement,
          status: "skipped",
          skipReason: "no_matching_test_files",
        }),
        notes: `No matching test files found: ${spec.vitestTargets.join(", ")}`,
      };
    }
  }

  // Actually run the subprocess.
  const result = await runShell({
    command: spec.command,
    cwd: ctx.cwd,
    timeoutMs: spec.timeoutMs,
    env: spec.env,
  });
  const durationMs = Date.now() - startMs;
  const stdoutTail = tailString(result.stdout);
  const stderrTail = tailString(result.stderr);

  if (result.timedOut) {
    return {
      ...baseCheck,
      status: "fail",
      severity: classifyFailure({ id: spec.id, requirement: spec.requirement, status: "fail" }),
      durationMs,
      exitCode: result.exitCode,
      stdoutTail,
      stderrTail,
      notes: `Timed out after ${spec.timeoutMs}ms`,
    };
  }

  if (result.exitCode === 0) {
    return {
      ...baseCheck,
      status: "pass",
      severity: "skipped",
      durationMs,
      exitCode: 0,
      stdoutTail,
      stderrTail,
    };
  }

  // Non-zero exit. Possibly downgrade if allowKnownExistingFailure.
  if (spec.allowKnownExistingFailure) {
    return {
      ...baseCheck,
      status: "known_existing_failure",
      severity: classifyFailure({
        id: spec.id,
        requirement: spec.requirement,
        status: "known_existing_failure",
      }),
      durationMs,
      exitCode: result.exitCode,
      stdoutTail,
      stderrTail,
      notes:
        "Pre-existing failure on this branch; downgraded via --allow-known-drift. Not blocking the gate.",
    };
  }

  return {
    ...baseCheck,
    status: "fail",
    severity: classifyFailure({ id: spec.id, requirement: spec.requirement, status: "fail" }),
    durationMs,
    exitCode: result.exitCode,
    stdoutTail,
    stderrTail,
  };
}

/* ─── Banner ──────────────────────────────────────────────────────── */

function printBanner(run: QualityGateRun): void {
  const verdictLabel = GATE_VERDICT_LABEL[run.verdict] ?? run.verdict;
  const lines: string[] = [];
  lines.push("");
  lines.push("━".repeat(60));
  lines.push(` Phase 1 Quality Gate — ${verdictLabel}`);
  lines.push("━".repeat(60));
  lines.push(` Run id     : ${run.runId}`);
  lines.push(` Exit code  : ${run.exitCode}`);
  lines.push(` Duration   : ${(run.runnerMeta.durationMs / 1000).toFixed(1)}s`);
  lines.push(` Total      : ${run.checks.length}`);
  lines.push(
    ` Pass / Fail / Skipped / Known-existing : ${
      run.checks.filter((c) => c.status === "pass").length
    } / ${run.checks.filter((c) => c.status === "fail").length} / ${
      run.checks.filter((c) => c.status === "skipped").length
    } / ${run.checks.filter((c) => c.status === "known_existing_failure").length}`,
  );
  lines.push("━".repeat(60));
  for (const c of run.checks) {
    const symbol = statusSymbol(c.status);
    const reqMark = c.requirement === "required" ? "[req]" : "[opt]";
    const dur = `${(c.durationMs / 1000).toFixed(1)}s`.padStart(7);
    lines.push(` ${symbol} ${reqMark} ${c.id.padEnd(34)} ${dur}`);
  }
  lines.push("━".repeat(60));
  lines.push("");
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

/* ─── Main ────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags: CliFlags = parseArgv(argv, { cwd: process.cwd(), env: process.env });

  if (flags.help) {
    // eslint-disable-next-line no-console
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (flags.startServer) {
    // eslint-disable-next-line no-console
    console.error(
      "[gate runner] --start-server is reserved and currently rejected to avoid colliding with codex's local worker. Start the dev server manually, then rerun.",
    );
    process.exit(3);
  }

  const cwd = process.cwd();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const runId = makeRunIdFromIso(startedAt);

  const serverAlive = await isDevServerAlive(flags.baseUrl);

  const specs = defineChecks(flags);
  const ctx: ExecuteCtx = { cwd, serverAlive, baseUrl: flags.baseUrl };

  const checks: GateCheck[] = [];
  for (const spec of specs) {
    if (!flags.json) {
      // eslint-disable-next-line no-console
      console.log(`[gate runner] running: ${spec.id} (${spec.command})`);
    }
    const out = await executeCheck(spec, ctx);
    checks.push(out);
  }

  const durationMs = Date.now() - startMs;
  const runnerMeta: GateRunnerMeta = {
    command: ["npm run gate:phase1", ...argv].join(" "),
    baseUrl: flags.baseUrl,
    nodeVersion: process.version,
    durationMs,
    label: flags.label,
    startedAt,
  };
  const run: QualityGateRun = buildQualityGateRun({
    runId,
    generatedAt: new Date().toISOString(),
    checks,
    runnerMeta,
  });

  // Persist to disk.
  const outputDir = flags.outputDir;
  await fs.mkdir(outputDir, { recursive: true });
  const fileNameJson = fileNameForQualityGateRun(run.runId, "json");
  const fileNameMd = fileNameForQualityGateRun(run.runId, "md");
  const defaultDir = path.resolve(cwd, "benchmark", "runs");
  const useLoader = path.resolve(outputDir) === defaultDir;
  if (useLoader) {
    await saveQualityGateRun(run, { fileName: fileNameJson });
    await saveQualityGateMarkdown(fileNameMd, formatQualityGateMarkdown(run));
  } else {
    const jsonPath = path.resolve(outputDir, fileNameJson);
    const mdPath = path.resolve(outputDir, fileNameMd);
    await fs.writeFile(jsonPath, JSON.stringify(run, null, 2) + "\n", "utf8");
    await fs.writeFile(mdPath, formatQualityGateMarkdown(run), "utf8");
  }

  if (flags.saveToApi) {
    try {
      await fetch(`${flags.baseUrl.replace(/\/$/, "")}/api/dev/phase1-quality-gates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run),
      });
    } catch (err) {
      // Don't fail the run if the API push fails. The local file is
      // already on disk.
      // eslint-disable-next-line no-console
      console.warn(
        `[gate runner] --save-to-api: POST failed (${(err as Error).message}). Local file is still written.`,
      );
    }
  }

  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(run, null, 2));
  } else {
    printBanner(run);
  }

  process.exit(run.exitCode);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[gate runner] internal error:", err);
  process.exit(3);
});
