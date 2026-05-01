import * as fs from "node:fs";
import * as path from "node:path";
const p = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(p)) for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
import("../lib/db").then(async ({sql}) => {
  for (const id of process.argv.slice(2)) {
    const r = await sql`SELECT id, status, created_at, updated_at, completed_at, steps->0->>'status' as step_status, steps->0->>'attemptCount' as attempts FROM booking_jobs WHERE id=${id}`;
    const j = r.rows[0];
    if (!j) { console.log(`${id}: NOT FOUND`); continue; }
    console.log(`${j.id}: status=${j.status} step_status=${j.step_status} attempts=${j.attempts} created=${j.created_at} updated=${j.updated_at} completed=${j.completed_at}`);
  }
  process.exit(0);
});
