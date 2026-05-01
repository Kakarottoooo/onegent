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
  // Round 2: Nobu succeeded comparators (vs 011 failed)
  "nyc_restaurant_011", // Nobu Downtown — 54s failed (picker said picked=7:00 PM but seen=[6:30,6:45,7:15,9:00])
  "nyc_restaurant_012", // Nobu Downtown — 1m40s succeeded ✓
  "nyc_restaurant_013", // Nobu Downtown — 2m5s succeeded ✓
  // Round 2: Gramercy both failed — real dead or render race?
  "nyc_restaurant_009", // Gramercy Tavern — 53s failed
  "nyc_restaurant_010", // Gramercy Tavern — 52s failed
  // Round 2: Don Angie OT (006/007 failed) vs legacy Resy 008 (also failed)
  "nyc_restaurant_006", // Don Angie OT — 1m12s failed
  "nyc_restaurant_007", // Don Angie OT — 1m11s failed
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
    console.log(`decisionLog has ${log.length} entries; last 30:`);
    for (const entry of log.slice(-30)) {
      const t = entry.type ?? "—";
      const m = (entry.message ?? "").slice(0, 260);
      console.log(`  [${t}] ${m}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("dig failed:", err);
  process.exit(1);
});
