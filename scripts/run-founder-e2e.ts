#!/usr/bin/env -S npx tsx
/**
 * scripts/run-founder-e2e.ts — Phase 1.5 autonomous Founder E2E runner.
 *
 * Walks the autonomous-only checks (`pathId = "auto"`) end-to-end against an
 * already-running Next.js dev server, then writes a Founder QA Run JSON +
 * Markdown report under benchmark/runs/.
 *
 * USAGE
 *   npm run dev                 # in another terminal
 *   npm run e2e:founder
 *   npm run e2e:founder:headed
 *   npm run e2e:founder:json    # JSON-only stdout for CI
 *
 * FLAGS
 *   --base-url=<url>      override SMOKE_BASE_URL (default http://localhost:3000)
 *   --headed              run chromium with a visible browser window
 *   --json                emit machine-readable JSON to stdout (no banner)
 *   --output-dir=<path>   override benchmark/runs/
 *   --save-to-api         POST the run to /api/dev/founder-e2e-runs after the
 *                         local file lands. Falls back gracefully if the API
 *                         is gated off.
 *   --start-server        IGNORED in this version (placeholder for future
 *                         auto-launch). The runner refuses to silently start
 *                         a server because it would conflict with codex's
 *                         live worker / Next dev.
 *   --label=<text>        attach a label to runnerMeta.label.
 *
 * EXIT CODES
 *   0 — verdict pass OR needs_polish (no P0)
 *   1 — verdict fail (>=1 P0 outstanding)
 *   2 — dev server unreachable
 *   3 — playwright chromium not installed
 *
 * SAFETY BOUNDARIES (cannot be overridden by flags)
 *   - No live OpenAI / Computer Use call.
 *   - No real booking provider (Resy / OpenTable / Expedia).
 *   - No payment / OTP / CAPTCHA submission.
 *   - No automatic dev-server start.
 *   - No clicks on external "Confirm" / "Pay" / "Submit" buttons.
 *   - No automatic Clerk login (those probes report skipped, not pass).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  buildAutoRunFromProbes,
  buildScreenshotRelPath,
  formatAutoRunMarkdown,
  formatRunnerBanner,
  normalizeBaseUrl,
  summarizeRunForRunner,
  type ProbeResult,
} from "../lib/founder-e2e/runner-report";

// Lazy import so missing playwright is a soft error (exit 3, not unhandled).
type Browser = import("playwright").Browser;
let chromium: typeof import("playwright").chromium;
let playwrightVersion: string | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ chromium } = await import("playwright"));
  try {
    const pkg = (await import("playwright/package.json", {
      with: { type: "json" },
    })) as { default?: { version?: string } };
    playwrightVersion = pkg.default?.version;
  } catch {
    playwrightVersion = undefined;
  }
} catch (err) {
  process.stderr.write(
    `\nplaywright is not installed. Run: npx playwright install chromium\n  ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(3);
}

const REPO_ROOT = path.resolve(process.cwd());

/* ─── argv parsing ────────────────────────────────────────────────── */

const argv = process.argv.slice(2);

function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}

function value(name: string, fallback?: string): string | undefined {
  const eqPrefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(eqPrefix)) return arg.slice(eqPrefix.length);
  }
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < argv.length && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  return fallback;
}

const HEADED = flag("headed");
const JSON_ONLY = flag("json");
const SAVE_TO_API = flag("save-to-api");
const LABEL = value("label");
const BASE_URL = normalizeBaseUrl(
  value("base-url", process.env.SMOKE_BASE_URL ?? "http://localhost:3000"),
);
const OUTPUT_DIR_REL = value("output-dir", "benchmark/runs") ?? "benchmark/runs";
const OUTPUT_DIR = path.resolve(REPO_ROOT, OUTPUT_DIR_REL);

/* ─── tiny logger ─────────────────────────────────────────────────── */

const COLOR =
  process.stdout.isTTY && !JSON_ONLY
    ? {
        red: (s: string) => `\x1b[31m${s}\x1b[0m`,
        green: (s: string) => `\x1b[32m${s}\x1b[0m`,
        yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
        dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
        bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
      }
    : {
        red: (s: string) => s,
        green: (s: string) => s,
        yellow: (s: string) => s,
        dim: (s: string) => s,
        bold: (s: string) => s,
      };

function log(line = ""): void {
  if (JSON_ONLY) return;
  process.stdout.write(`${line}\n`);
}

function warn(line: string): void {
  process.stderr.write(`${line}\n`);
}

/* ─── server health ───────────────────────────────────────────────── */

async function checkServerAlive() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${BASE_URL}/`, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "manual",
    });
    return { ok: true as const, status: res.status };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/* ─── runner state ────────────────────────────────────────────────── */

const probes: ProbeResult[] = [];
const runId = `founder-e2e-${new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z")}`;
const ASSETS_DIR = path.resolve(REPO_ROOT, "benchmark/runs/founder-e2e-assets", runId);

async function ensureAssetsDir(): Promise<void> {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
}

/* ─── render probe (reusable) ─────────────────────────────────────── */

async function renderProbe(
  browser: Browser,
  stepId: string,
  urlPath: string,
  expectedTexts: string[],
  severity?: "P0" | "P1" | "P2" | "P3",
): Promise<ProbeResult> {
  const url = `${BASE_URL}${urlPath}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const expected = /Failed to fetch|NetworkError|401|403|ENABLE_DEV_BENCHMARK_API/.test(text);
    if (!expected) consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const start = Date.now();
  const missing: string[] = [];
  let navError: string | undefined;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    for (const expected of expectedTexts) {
      try {
        await page
          .getByText(expected, { exact: false })
          .first()
          .waitFor({ state: "attached", timeout: 5000 });
      } catch {
        missing.push(expected);
      }
    }
  } catch (err) {
    navError = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - start;

  let screenshotPath: string | undefined;
  if (missing.length || navError) {
    try {
      await ensureAssetsDir();
      const fileName = `${stepId.replace(/[^A-Za-z0-9._-]/g, "-")}.png`;
      const rel = buildScreenshotRelPath(runId, fileName);
      if (rel) {
        screenshotPath = rel;
        const abs = path.resolve(REPO_ROOT, "benchmark/runs", rel);
        await page.screenshot({ path: abs, fullPage: false }).catch(() => {});
      }
    } catch {}
  }
  await context.close();

  const status: ProbeResult["status"] = navError ? "fail" : missing.length ? "fail" : "pass";
  const actual = navError
    ? `navigation error: ${navError}`
    : missing.length
      ? `missing copy: ${missing.join(", ")}`
      : `all expected text present in ${durationMs}ms`;
  return {
    stepId,
    status,
    actual,
    severity,
    url,
    screenshotPath,
    notes: consoleErrors.length ? `console errors: ${consoleErrors.join(" | ")}` : undefined,
    durationMs,
  };
}

/* ─── api probes ──────────────────────────────────────────────────── */

async function probeApiTemplate(): Promise<ProbeResult> {
  const url = `${BASE_URL}/api/dev/founder-e2e-runs?template=quick`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) {
        return {
          stepId: "auto:api:template",
          status: "fail",
          actual: "API returned 404 — set ENABLE_DEV_BENCHMARK_API=1",
          url,
        };
      }
      return {
        stepId: "auto:api:template",
        status: "fail",
        actual: `API returned ${res.status}`,
        url,
      };
    }
    const json = (await res.json()) as { run?: { kind?: string; pathId?: string } };
    if (!json?.run || json.run.kind !== "founder-e2e-run" || json.run.pathId !== "quick") {
      return {
        stepId: "auto:api:template",
        status: "fail",
        actual: `unexpected shape: ${JSON.stringify(json).slice(0, 200)}`,
        url,
      };
    }
    return {
      stepId: "auto:api:template",
      status: "pass",
      actual: "template run shape valid",
      url,
    };
  } catch (err) {
    return {
      stepId: "auto:api:template",
      status: "fail",
      actual: err instanceof Error ? err.message : String(err),
      url,
    };
  }
}

async function probeApiList(): Promise<ProbeResult> {
  const url = `${BASE_URL}/api/dev/founder-e2e-runs`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {
        stepId: "auto:api:list",
        status: "fail",
        actual: `API returned ${res.status}`,
        url,
      };
    }
    const json = (await res.json()) as { runs?: unknown[]; total?: number };
    if (!Array.isArray(json?.runs)) {
      return {
        stepId: "auto:api:list",
        status: "fail",
        actual: "list response missing runs[] array",
        url,
      };
    }
    return {
      stepId: "auto:api:list",
      status: "pass",
      actual: `list ok — ${json.total ?? json.runs.length} saved runs`,
      url,
    };
  } catch (err) {
    return {
      stepId: "auto:api:list",
      status: "fail",
      actual: err instanceof Error ? err.message : String(err),
      url,
    };
  }
}

async function probeApiTraversal(): Promise<ProbeResult> {
  const url = `${BASE_URL}/api/dev/founder-e2e-runs?file=${encodeURIComponent("../escape.json")}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404 || res.status === 400) {
      return {
        stepId: "auto:api:traversal",
        status: "pass",
        actual: `traversal request returned ${res.status} (rejected)`,
        url,
      };
    }
    return {
      stepId: "auto:api:traversal",
      status: "fail",
      actual: `traversal returned ${res.status} — security regression`,
      severity: "P0",
      url,
    };
  } catch (err) {
    return {
      stepId: "auto:api:traversal",
      status: "fail",
      actual: err instanceof Error ? err.message : String(err),
      url,
    };
  }
}

async function probeApiBadPayload(): Promise<ProbeResult> {
  const url = `${BASE_URL}/api/dev/founder-e2e-runs`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "wrong-kind", schemaVersion: 99 }),
    });
    if (res.status >= 400 && res.status < 500) {
      return {
        stepId: "auto:api:bad-payload",
        status: "pass",
        actual: `garbage payload rejected with ${res.status}`,
        url,
      };
    }
    return {
      stepId: "auto:api:bad-payload",
      status: "fail",
      actual: `garbage payload returned ${res.status} — schema validation broken`,
      url,
    };
  } catch (err) {
    return {
      stepId: "auto:api:bad-payload",
      status: "fail",
      actual: err instanceof Error ? err.message : String(err),
      url,
    };
  }
}

async function probePaymentGuard(): Promise<ProbeResult> {
  const url = `${BASE_URL}/api/v1/users/me/profile`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_number: "4111111111111111", cvv: "123" }),
    });
    if (res.status >= 400 && res.status < 500) {
      const body = await res.text();
      return {
        stepId: "auto:security:payment-guard",
        status: "pass",
        actual: `${res.status} — payment fields rejected (no auth or guard)`,
        notes: body ? `body[:200]: ${body.slice(0, 200)}` : undefined,
        url,
      };
    }
    return {
      stepId: "auto:security:payment-guard",
      status: "fail",
      actual: `${res.status} — payment guard FAILED — P0 regulatory regression`,
      severity: "P0",
      url,
    };
  } catch (err) {
    return {
      stepId: "auto:security:payment-guard",
      status: "fail",
      actual: err instanceof Error ? err.message : String(err),
      url,
    };
  }
}

async function probeUnauthorizedTask(browser: Browser): Promise<ProbeResult> {
  const fakeUuid = "00000000-0000-0000-0000-deadbeef0000";
  const url = `${BASE_URL}/tasks/${fakeUuid}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const start = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    const finalUrl = page.url();
    const html = await page.content().catch(() => "");
    const looksLeaked = /(Buvette|Carbone|Sirrah|TAO Downtown|Atomix|Resy|OpenTable)/i.test(html);
    const looksAuthGate =
      /(Sign in|sign-in|signin|Continue with Clerk|Need to sign in)/i.test(html) ||
      finalUrl.includes("/sign-in") ||
      (resp && resp.status() === 401);
    if (looksLeaked && !looksAuthGate) {
      return {
        stepId: "auto:security:unauthorized-task",
        status: "fail",
        actual: "HTML contains restaurant content without sign-in gate — ownership leak",
        severity: "P0",
        url,
        notes: `final URL: ${finalUrl}`,
      };
    }
    return {
      stepId: "auto:security:unauthorized-task",
      status: "pass",
      actual: looksAuthGate
        ? "sign-in card / redirect detected, no task leaked"
        : "no task content visible to anonymous viewer",
      url,
      notes: `final URL: ${finalUrl}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      stepId: "auto:security:unauthorized-task",
      status: "fail",
      actual: err instanceof Error ? err.message : String(err),
      url,
    };
  } finally {
    await context.close();
  }
}

/* ─── main run ────────────────────────────────────────────────────── */

const startedAtIso = new Date().toISOString();
const startedAtMs = Date.now();

async function main(): Promise<never> {
  log(COLOR.bold("Founder QA autonomous runner"));
  log(COLOR.dim(`Target: ${BASE_URL}`));
  log(COLOR.dim(`Run id: ${runId}`));

  const health = await checkServerAlive();
  if (!health.ok) {
    warn(`✗ dev server unreachable at ${BASE_URL}: ${health.error}`);
    warn("  Start `npm run dev` (or `npx next dev --webpack`) and retry.");
    process.exit(2);
  }
  log(COLOR.green(`✓ server alive (${health.status})`));
  probes.push({
    stepId: "auto:health:1",
    status: "pass",
    actual: `HTTP ${health.status}`,
    url: `${BASE_URL}/`,
    durationMs: 0,
  });

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: !HEADED });
  } catch (err) {
    warn("✗ playwright chromium not installed");
    warn(`  ${err instanceof Error ? err.message : err}`);
    warn("  Run: npx playwright install chromium");
    process.exit(3);
  }

  const renderTargets: { stepId: string; path: string; expects: string[]; severity?: "P0" | "P1" | "P2" | "P3" }[] = [
    {
      stepId: "auto:self:1",
      path: "/dev/founder-e2e",
      expects: ["Founder QA Suite", "Quick path", "Save run"],
      severity: "P0",
    },
    { stepId: "auto:render:path-b-demo", path: "/dev/path-b-demo", expects: ["Path B fixture explorer", "1. Missing fields"] },
    { stepId: "auto:render:tasks-executing", path: "/tasks/demo-executing", expects: ["Buvette in West Village", "Running"] },
    {
      stepId: "auto:render:tasks-awaiting-profile",
      path: "/tasks/demo-awaiting-profile",
      expects: ["Carbone tonight", "Need details"],
      severity: "P0",
    },
    { stepId: "auto:render:tasks-ready", path: "/tasks/demo-ready-for-confirmation", expects: ["TAO Downtown", "Ready to confirm"] },
    { stepId: "auto:render:tasks-failed", path: "/tasks/demo-failed", expects: ["Atomix", "Failed"] },
    { stepId: "auto:render:benchmark-runs", path: "/dev/benchmark-runs", expects: ["Phase 0 benchmark runs"] },
    { stepId: "auto:render:profile-gap-flow", path: "/dev/profile-gap-flow", expects: ["Restaurant booking", "Profile · DOB"] },
  ];

  for (const t of renderTargets) {
    const probe = await renderProbe(browser, t.stepId, t.path, t.expects, t.severity);
    if (probe.status === "pass") log(COLOR.green(`✓ ${t.path}`));
    else log(COLOR.red(`✗ ${t.path}: ${probe.actual}`));
    probes.push(probe);
  }

  for (const probe of [
    await probeApiTemplate(),
    await probeApiList(),
    await probeApiTraversal(),
    await probeApiBadPayload(),
    await probePaymentGuard(),
    await probeUnauthorizedTask(browser),
  ]) {
    const ok = probe.status === "pass";
    log((ok ? COLOR.green("✓ ") : COLOR.red("✗ ")) + probe.stepId + " — " + probe.actual);
    probes.push(probe);
  }

  await browser.close();

  const durationMs = Date.now() - startedAtMs;

  const run = buildAutoRunFromProbes({
    probes,
    runnerMeta: {
      command: `npx tsx scripts/run-founder-e2e.ts ${argv.join(" ")}`.trim(),
      baseUrl: BASE_URL,
      browser: `chromium${playwrightVersion ? ` ${playwrightVersion}` : ""}`,
      durationMs,
      playwrightVersion,
      nodeVersion: process.version,
      label: LABEL,
    },
    runId,
    now: () => startedAtIso,
  });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, `${runId}-auto.json`);
  await fs.writeFile(jsonPath, JSON.stringify(run, null, 2), "utf8");
  const mdPath = path.join(OUTPUT_DIR, `${runId}-auto.md`);
  await fs.writeFile(mdPath, formatAutoRunMarkdown(run), "utf8");

  if (SAVE_TO_API) {
    try {
      const res = await fetch(`${BASE_URL}/api/dev/founder-e2e-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run),
      });
      if (res.ok) {
        log(COLOR.dim(`saved to API: ${res.status}`));
      } else {
        log(COLOR.yellow(`api save returned ${res.status} — local file still written`));
      }
    } catch (err) {
      log(COLOR.yellow(`api save errored — local file still written: ${err instanceof Error ? err.message : err}`));
    }
  }

  const view = summarizeRunForRunner(run);
  if (JSON_ONLY) {
    process.stdout.write(
      JSON.stringify(
        {
          runId: run.id,
          verdict: view.verdict,
          exitCode: view.exitCode,
          summary: view,
          jsonPath: path.relative(REPO_ROOT, jsonPath),
          mdPath: path.relative(REPO_ROOT, mdPath),
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    log("");
    log(formatRunnerBanner(view));
    log(COLOR.dim(`json:     ${path.relative(REPO_ROOT, jsonPath)}`));
    log(COLOR.dim(`markdown: ${path.relative(REPO_ROOT, mdPath)}`));
    if (await dirHasFiles(ASSETS_DIR)) {
      log(COLOR.dim(`screenshots: benchmark/runs/founder-e2e-assets/${runId}/`));
    }
  }

  process.exit(view.exitCode);
}

async function dirHasFiles(p: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

await main();
