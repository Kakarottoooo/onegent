import * as fs from "node:fs";
import * as path from "node:path";
const p = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(p)) for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
import("../lib/db").then(async ({sql}) => {
  for (const id of process.argv.slice(2)) {
    const r = await sql`SELECT created_at, source, level, message, details FROM agent_logs WHERE job_id=${id} AND message LIKE '%Cannot resolve profile%' ORDER BY created_at LIMIT 1`;
    console.log(`${id}: ${r.rows[0]?.created_at} src=${r.rows[0]?.source} msg=${(r.rows[0]?.message ?? "(none)").slice(0,80)}`);
  }
  process.exit(0);
});
