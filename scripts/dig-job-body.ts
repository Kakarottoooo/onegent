import * as fs from "node:fs";
import * as path from "node:path";
function loadDotenv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    "C:\Users\Gzw19\onegent\.env.local",
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
    console.log(`[dig] env from ${p}`);
    return;
  }
}
loadDotenv();
import { sql } from "../lib/db";
const runId = process.argv[2];
async function main() {
  const cases = await sql`SELECT bc.case_id, bj.id, bj.steps->0->'body' as body, bj.steps->0->'error' as err FROM benchmark_cases bc JOIN booking_jobs bj ON bj.id=bc.booking_job_id WHERE bc.run_id=${runId} LIMIT 2`;
  for (const c of cases.rows) {
    console.log("===", c.case_id);
    console.log("err:", c.err);
    const body = c.body as Record<string, unknown>;
    console.log("body keys:", Object.keys(body));
    console.log("__source:", body.__source);
    console.log("scenario:", body.scenario);
    console.log("has params:", !!body.params, "params keys:", body.params ? Object.keys(body.params as Record<string, unknown>) : "n/a");
    console.log("has profile:", !!body.profile);
    console.log("profileId:", body.profileId);
    if (body.profile) {
      const p = body.profile as Record<string, unknown>;
      console.log("profile keys:", Object.keys(p));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
