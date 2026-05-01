import * as fs from "node:fs";
import * as path from "node:path";
function loadDotenv() {
  const ps = [path.resolve(process.cwd(), ".env.local")];
  for (const p of ps) { if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p,"utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"(.*)"$/,"$1");
    }
  }
}
loadDotenv();
import { sql } from "../lib/db";
const runId = process.argv[2];
async function main() {
  const r = await sql`SELECT id, name, status, total_cases, success_cases FROM benchmark_runs WHERE id=${runId}`;
  console.log("run:", r.rows[0]);
  const cases = await sql`SELECT case_id, status, failure_reason, duration_seconds, booking_job_id FROM benchmark_cases WHERE run_id=${runId} ORDER BY case_id`;
  for (const row of cases.rows) console.log(row);
  const sample = await sql`SELECT bj.id, bj.status, bj.steps->0->'error' as err, jsonb_array_length(bj.steps->0->'decisionLog') as dl_len FROM booking_jobs bj JOIN benchmark_cases bc ON bc.booking_job_id=bj.id WHERE bc.run_id=${runId} LIMIT 5`;
  console.log("---sample jobs---");
  for (const j of sample.rows) console.log(j);
  process.exit(0);
}
main();
