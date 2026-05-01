/**
 * One-shot diag tool: dump decisionLog tail + step.error for the most
 * recent benchmark run, focused on the cases the v1 baseline failed on.
 *
 * Usage:  npx tsx scripts/dig-benchmark.ts
 */

// Manual .env.local loader — tsx doesn't auto-load it like Next.js does.
import * as fs from "node:fs";
import * as path from "node:path";

function loadDotenv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../../../.env.local"),
    "C:\\Users\\Gzw19\\onegent\\.env.local",
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
    console.log(`[dig] loaded env from ${p}`);
    return;
  }
  console.warn(`[dig] no .env.local found in any candidate path`);
}

loadDotenv();

import { sql } from "../lib/db";

const FOCUS_CASES = [
  // Run 3 dig: focus on provider_timeout (5 new cases) + verify RC C fix
  "nyc_restaurant_005", // Cosme — succeeded payment_stop 1m3s (was 3m36s)
  "nyc_restaurant_009", // Gramercy Tavern — succeeded payment_stop 2m56s
  "nyc_restaurant_010", // Gramercy Tavern — provider_timeout 6m59s (NEW)
  "nyc_restaurant_011", // Nobu — succeeded payment_stop 5m54s
  "nyc_restaurant_014", // The Modern — provider_timeout 6m59s (NEW)
  "nyc_restaurant_017", // Tao Downtown — provider_timeout 6m59s (NEW)
  "nyc_restaurant_018", // Don Angie — provider_timeout 7m1s (NEW)
  "nyc_restaurant_020", // Daniel — executor_error 5m57s
];

async function main() {
  // Find the most recent run
  const runQ = await sql`
    SELECT id, name, created_at FROM benchmark_runs
    ORDER BY created_at DESC LIMIT 1
  `;
  const run = runQ.rows[0] as { id: string; name: string; created_at: string };
  console.log(`Latest run: ${run.id} — ${run.name} (${run.created_at})\n`);

  // Pull the focus cases
  const casesQ = await sql`
    SELECT
      bc.case_id,
      bc.status,
      bc.failure_reason,
      bc.duration_seconds,
      bc.booking_job_id,
      bc.audit,
      bj.steps
    FROM benchmark_cases bc
    LEFT JOIN booking_jobs bj ON bj.id = bc.booking_job_id
    WHERE bc.run_id = ${run.id}
      AND bc.case_id = ANY(${FOCUS_CASES as unknown as string})
    ORDER BY bc.case_id
  `;

  for (const row of casesQ.rows as Array<{
    case_id: string;
    status: string;
    failure_reason: string | null;
    duration_seconds: number | null;
    booking_job_id: string | null;
    audit: Record<string, unknown> | null;
    steps: Array<{ status: string; error?: string | null; decisionLog?: Array<{ message: string; type?: string; outcome?: string }> }> | null;
  }>) {
    console.log("═".repeat(70));
    console.log(`${row.case_id}  ·  ${row.status}  ·  ${row.failure_reason ?? "—"}  ·  ${row.duration_seconds ?? "—"}s`);
    console.log("═".repeat(70));

    if (!row.steps || row.steps.length === 0) {
      console.log("[no booking_job step found]");
      console.log();
      continue;
    }

    const step = row.steps[0];
    console.log(`step.status = ${step.status}`);
    if (step.error) {
      console.log(`step.error = ${step.error.slice(0, 300)}`);
    }
    const log = step.decisionLog ?? [];
    console.log(`decisionLog has ${log.length} entries; last 18:`);
    for (const entry of log.slice(-18)) {
      const t = entry.type ?? "—";
      const m = (entry.message ?? "").slice(0, 220);
      console.log(`  [${t}] ${m}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("dig failed:", err);
  process.exit(1);
});
