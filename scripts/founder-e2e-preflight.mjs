#!/usr/bin/env node
/**
 * scripts/founder-e2e-preflight.mjs — Phase 1.5 Founder QA Suite preflight.
 *
 * No-token, no-live-provider readiness check for /dev/founder-e2e and the
 * routes the founder will exercise in the Quick path. Runs against an
 * already-running Next.js dev server.
 *
 * Verifies:
 *   1. Dev server responds at SMOKE_BASE_URL.
 *   2. /dev/founder-e2e renders + key copy ("Founder QA Suite", "Quick path"
 *      header, "Save run" button) is present.
 *   3. /api/dev/founder-e2e-runs?template=quick returns a fresh empty run
 *      with the expected schema fields.
 *   4. /api/dev/founder-e2e-runs (no params) returns a list response.
 *   5. /dev/benchmark-runs and /tasks/demo-* still render (cross-link
 *      sanity).
 *
 * Hard rules:
 *   - No live OpenAI / Computer Use / Resy / OpenTable.
 *   - No POSTs to provider endpoints; the only POST is a no-op JSON parse
 *     check against /api/dev/founder-e2e-runs (GET only).
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — at least one check failed
 *   2 — dev server unreachable at SMOKE_BASE_URL
 *   3 — playwright chromium not installed
 */
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const NAV_TIMEOUT_MS = 15_000;
const ASSERT_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 3_000;

const COLOR = process.stdout.isTTY
  ? {
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
    }
  : {
      red: (s) => s,
      green: (s) => s,
      yellow: (s) => s,
      dim: (s) => s,
      bold: (s) => s,
    };

const ROUTES = [
  {
    path: "/dev/founder-e2e",
    expects: ["Founder QA Suite", "Quick path", "Save run"],
    note: "Founder QA workbench renders both paths + save controls.",
  },
  {
    path: "/dev/benchmark-runs",
    expects: ["Phase 0 benchmark runs"],
    note: "Cross-linked dashboard still renders.",
  },
  {
    path: "/tasks/demo-executing",
    expects: ["Buvette in West Village", "Running"],
    note: "Demo tasks still render (Quick path A.3 cross-check).",
  },
  {
    path: "/tasks/demo-awaiting-profile",
    expects: ["Carbone tonight", "Need details"],
    note: "Quick path A.4 inline ProfileGapCard surface still renders.",
  },
];

async function checkServerAlive(baseUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + "/", {
      method: "GET",
      signal: ctrl.signal,
      redirect: "manual",
    });
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkApiTemplate(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/dev/founder-e2e-runs?template=quick`, {
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          message:
            "API returned 404. In non-dev environments set ENABLE_DEV_BENCHMARK_API=1.",
        };
      }
      return { ok: false, message: `API returned ${res.status}` };
    }
    const json = await res.json();
    if (!json || typeof json !== "object" || !json.run) {
      return { ok: false, message: "API response missing `run` field" };
    }
    const run = json.run;
    const requiredFields = ["schemaVersion", "kind", "id", "pathId", "results", "summary", "exit"];
    const missing = requiredFields.filter((f) => !(f in run));
    if (missing.length) {
      return { ok: false, message: `run missing fields: ${missing.join(", ")}` };
    }
    if (run.pathId !== "quick") {
      return { ok: false, message: `expected pathId=quick, got ${run.pathId}` };
    }
    if (run.kind !== "founder-e2e-run") {
      return { ok: false, message: `expected kind=founder-e2e-run, got ${run.kind}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkApiList(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/dev/founder-e2e-runs`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, message: `API returned ${res.status}` };
    }
    const json = await res.json();
    if (!json || typeof json !== "object" || !Array.isArray(json.runs)) {
      return { ok: false, message: "API response missing `runs` array" };
    }
    return { ok: true, total: json.total ?? json.runs.length };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function smokeRoute(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
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

async function main() {
  console.log(COLOR.bold("\nFounder QA preflight"));
  console.log(COLOR.dim(`Target: ${BASE_URL}\n`));

  const health = await checkServerAlive(BASE_URL);
  if (!health.ok) {
    console.log(COLOR.red("✗ Server unreachable."));
    console.log(COLOR.dim(`  ${health.error}`));
    console.log(COLOR.yellow("  Start dev server first: `npm run dev` (or `npx next dev --webpack`)."));
    process.exit(2);
  }
  console.log(COLOR.green(`✓ Server alive (${health.status})`));

  const apiTemplate = await checkApiTemplate(BASE_URL);
  if (apiTemplate.ok) {
    console.log(COLOR.green("✓ API /api/dev/founder-e2e-runs?template=quick returns valid run"));
  } else {
    console.log(COLOR.red("✗ API template check failed"));
    console.log(COLOR.dim(`  ${apiTemplate.message}`));
  }

  const apiList = await checkApiList(BASE_URL);
  if (apiList.ok) {
    console.log(
      COLOR.green(`✓ API /api/dev/founder-e2e-runs (list) ok — ${apiList.total} saved`),
    );
  } else {
    console.log(COLOR.red("✗ API list check failed"));
    console.log(COLOR.dim(`  ${apiList.message}`));
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.log(COLOR.red("✗ playwright chromium not installed."));
    console.log(COLOR.dim(`  ${err instanceof Error ? err.message : err}`));
    console.log(COLOR.yellow("  Run: npx playwright install chromium"));
    process.exit(3);
  }

  let routesFailed = 0;
  for (const route of ROUTES) {
    const result = await smokeRoute(browser, route);
    const ok = result.missing.length === 0 && result.consoleErrors.length === 0;
    if (ok) {
      console.log(COLOR.green(`✓ ${route.path}`));
    } else {
      routesFailed += 1;
      console.log(COLOR.red(`✗ ${route.path}`));
      if (result.missing.length) {
        console.log(COLOR.dim(`  missing: ${result.missing.join(", ")}`));
      }
      if (result.consoleErrors.length) {
        console.log(COLOR.dim(`  console errors:`));
        for (const e of result.consoleErrors) console.log(COLOR.dim(`    ${e}`));
      }
    }
    console.log(COLOR.dim(`  ${route.note}`));
  }

  await browser.close();

  const apiOk = apiTemplate.ok && apiList.ok;
  const allOk = apiOk && routesFailed === 0;
  console.log("");
  if (allOk) {
    console.log(COLOR.green(COLOR.bold("All preflight checks passed.")));
    console.log(COLOR.dim("Open http://localhost:3000/dev/founder-e2e to run the walkthrough."));
    process.exit(0);
  }
  console.log(COLOR.red(COLOR.bold("Preflight FAILED.")));
  if (!apiOk) console.log(COLOR.dim("  API problems above — fix those first."));
  if (routesFailed) console.log(COLOR.dim(`  ${routesFailed} route(s) failed`));
  process.exit(1);
}

await main();
