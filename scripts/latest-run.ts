import * as fs from "node:fs";
import * as path from "node:path";
const p = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(p)) for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
import("../lib/db").then(async ({ sql }) => {
  const r = await sql`SELECT id, name, status, created_at FROM benchmark_runs ORDER BY created_at DESC LIMIT 5`;
  for (const row of r.rows) console.log(`${row.id} ${row.status} ${row.name} (${row.created_at})`);
  process.exit(0);
});
