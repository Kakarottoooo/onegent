import * as fs from "node:fs"; import * as path from "node:path";
const p = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(p)) for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
import("../lib/db").then(async ({sql}) => {
  const id = process.argv[2];
  const r = await sql`SELECT id, source, level, message, details, session_id, job_id, created_at FROM agent_logs WHERE job_id=${id} OR session_id=${id} ORDER BY created_at LIMIT 5`;
  for (const row of r.rows) {
    console.log("---");
    console.log("source:", row.source);
    console.log("level:", row.level);
    console.log("message:", row.message);
    console.log("details:", JSON.stringify(row.details, null, 2));
    console.log("session/job:", row.session_id, "/", row.job_id);
    console.log("created:", row.created_at);
  }
  process.exit(0);
});
