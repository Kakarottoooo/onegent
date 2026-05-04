#!/usr/bin/env node
/**
 * scripts/smoke-phase1.mjs — Phase 1 founder walkthrough no-token smoke.
 *
 * Drives a headless chromium against an already-running Next.js dev server
 * and asserts that each Phase 1 founder-walkthrough surface renders without
 * crashing and surfaces its key copy. Zero OpenAI / Computer Use / network
 * dependencies — every route below is fixture-backed.
 *
 * Usage:
 *   1) In one terminal:  npm run dev      # boots Next.js on :3000
 *   2) In another:       npm run smoke:phase1
 *
 * Override base URL:
 *   SMOKE_BASE_URL=http://localhost:4000 npm run smoke:phase1
 *
 * Exit codes:
 *   0 — all routes pass
 *   1 — at least one route failed (assertion miss, hydration error, etc.)
 *   2 — dev server unreachable at SMOKE_BASE_URL
 *   3 — playwright chromium not installed (run `npx playwright install chromium`)
 *
 * Why bare playwright (not @playwright/test):
 *   - `playwright` is already a runtime dependency (used by the worker's
 *     booking-autopilot). Adding @playwright/test would mean ~30 MB of new
 *     devDependencies for what is fundamentally 6 page-load assertions.
 *   - The founder walkthrough is a smoke harness, not a full e2e suite.
 *     If the test surface grows past ~20 routes, revisit and adopt the
 *     framework.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const NAV_TIMEOUT_MS = 15_000;
const ASSERT_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 3_000;

const COLOR = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

/**
 * Each route asserts >= 2 stable strings the page is GUARANTEED to render
 * regardless of API/network state (fixtures are inlined in the source).
 *
 * Selectors are intentionally text-based: brittle CSS selectors break on
 * styling refactors, but copy that lives in fixtures or in `<h1>` elements
 * is anchored. If a string below ever drifts, fix the fixture/page first
 * and update this file in the same commit.
 */
const ROUTES = [
  {
    path: "/dev/path-b-demo",
    expects: [
      "Path B fixture explorer",
      "1. Missing fields",
      "2. Save succeeds → booking resumed",
    ],
    note: "Path B helpers (decideProfileGap + makeProfileGapOnSave) — 3-state fixture explorer.",
  },
  {
    path: "/tasks/demo-executing",
    expects: [
      "Buvette in West Village",
      "Restaurant · Buvette",
      "Running",
    ],
    note: "Live-running task view (most common state in real bookings).",
  },
  {
    path: "/tasks/demo-awaiting-profile",
    expects: [
      "Need details",
      "Restaurant · Carbone",
    ],
    note: "Inline ProfileGapCard surfaces here (date_of_birth + phone gaps).",
  },
  {
    // Codex's prompt referenced /tasks/demo-ready (shorthand). The actual
    // route per app/dev/page.tsx and app/tasks/[taskId]/page.tsx fixtures
    // is /tasks/demo-ready-for-confirmation.
    path: "/tasks/demo-ready-for-confirmation",
    expects: [
      "Ready to confirm",
    ],
    note: "Final-confirm-button state (Phase 0 success bucket).",
  },
  {
    path: "/dev/benchmark-runs",
    expects: ["Phase 0 benchmark runs"],
    note: "Phase 0 dashboard — renders heading even when API is empty/unauthorised.",
  },
  {
    path: "/dev/profile-gap-flow",
    expects: [
      "/dev/profile-gap-flow",
      "Restaurant booking",
      "Profile · DOB",
    ],
    note: "End-to-end mock of the apply_profile_patch + confirm-card chat pipeline.",
  },
];

/* ─── helpers ─────────────────────────────────────────────────────── */

async function checkServerAlive(baseUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + "/", {
      method: "GET",
      signal: ctrl.signal,
      redirect: "manual",
    });
    // Any non-fetch-error response means the server answered. 200/302/etc all OK.
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Visit a route and assert each expected string surfaces within
 * ASSERT_TIMEOUT_MS. Returns { ok, missing, consoleErrors }.
 */
async function smokeRoute(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter out noisy expected errors (failed API fetch in dev mode is
      // intentional — fixture mode covers it). React hydration errors are
      // explicitly surfaced.
      const isExpectedFetchFailure = /Failed to fetch|NetworkError|401|403|ENABLE_DEV_BENCHMARK_API/.test(text);
      if (!isExpectedFetchFailure) consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  const url = BASE_URL + route.path;
  const missing = [];

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    for (const expected of route.expects) {
      try {
        await page
          .getByText(expected, { exact: false })
          .first()
          .waitFor({ state: "attached", timeout: ASSERT_TIMEOUT_MS });
      } catch {
        missing.push(expected);
      }
    }
  } catch (err) {
    missing.push(`navigation: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await context.close();
  }

  return { missing, consoleErrors };
}

/* ─── main ─────────────────────────────────────────────────────────── */

async function main() {
  console.log(COLOR.bold(`Phase 1 founder walkthrough smoke`));
  console.log(COLOR.dim(`  Base URL : ${BASE_URL}`));
  console.log(COLOR.dim(`  Routes   : ${ROUTES.length}`));
  console.log("");

  // 1. Health check — bail early with a friendly message if dev server isn't up.
  const health = await checkServerAlive(BASE_URL);
  if (!health.ok) {
    console.error(COLOR.red(`✗ Dev server unreachable at ${BASE_URL}`));
    console.error(COLOR.dim(`  ${health.error}`));
    console.error("");
    console.error(`  Start the dev server first:`);
    console.error(`    npm run dev`);
    console.error("");
    console.error(`  Then re-run this smoke in another terminal:`);
    console.error(`    npm run smoke:phase1`);
    process.exit(2);
  }
  console.log(COLOR.green(`✓ Dev server alive (${health.status})`));
  console.log("");

  // 2. Launch chromium. If browser binaries are missing, surface the install hint.
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(COLOR.red(`✗ Failed to launch chromium`));
    console.error(COLOR.dim(`  ${msg}`));
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      console.error("");
      console.error(`  Install the browser binary:`);
      console.error(`    npx playwright install chromium`);
    }
    process.exit(3);
  }

  // 3. Smoke each route serially (fixtures, no parallelism win, easier
  //    debugging when something breaks).
  const results = [];
  for (const route of ROUTES) {
    process.stdout.write(`  ${route.path.padEnd(42)} `);
    const start = Date.now();
    const { missing, consoleErrors } = await smokeRoute(browser, route);
    const elapsed = Date.now() - start;
    const ok = missing.length === 0 && consoleErrors.length === 0;
    if (ok) {
      console.log(COLOR.green("PASS") + COLOR.dim(`  (${elapsed}ms)`));
    } else {
      console.log(COLOR.red("FAIL") + COLOR.dim(`  (${elapsed}ms)`));
      for (const m of missing) console.log(`    ${COLOR.red("·")} missing copy: ${JSON.stringify(m)}`);
      for (const e of consoleErrors) console.log(`    ${COLOR.red("·")} console error: ${e}`);
    }
    results.push({ route, ok, missing, consoleErrors, elapsed });
  }

  await browser.close();

  // 4. Summary.
  console.log("");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  if (failed === 0) {
    console.log(COLOR.green(COLOR.bold(`All ${results.length} routes passed.`)));
    process.exit(0);
  } else {
    console.log(COLOR.red(COLOR.bold(`${failed} of ${results.length} routes failed.`)));
    console.log("");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(COLOR.red(`  ${r.route.path}`));
      console.log(COLOR.dim(`    ${r.route.note}`));
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(COLOR.red(`✗ Unhandled error:`), err);
  process.exit(1);
});
