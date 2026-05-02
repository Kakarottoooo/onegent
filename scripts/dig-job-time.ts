import * as fs from "node:fs";
import * as path from "node:path";
function loadDotenv() {
  const ps = ["C:\Users\Gzw19\onegent\.env.local"];
  for (const p of ps) { if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p,"utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"(.*)"$/,"$1");
    }
  }
}
loadDotenv();
import { sql } from "../lib/db";
const runId = process.argv[2];
async function main() {
  const r = await sql`SELECT bc.case_id, bj.id, bj.status, bj.created_at, bj.completed_at, bj.steps->0->'error' as err FROM benchmark_cases bc JOIN booking_jobs bj ON bj.id=bc.booking_job_id WHERE bc.run_id=${runId} ORDER BY bj.created_at`;
  for (const row of r.rows) console.log(row);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
