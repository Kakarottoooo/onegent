import * as fs from "node:fs";
import * as path from "node:path";
const p = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(p)) for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
import("../lib/db").then(async ({ sql }) => {
  const jobId = process.argv[2];
  const r = await sql`SELECT created_at, source, level, message, details, session_id, job_id FROM agent_logs WHERE job_id=${jobId} OR session_id=${jobId} ORDER BY created_at`;
  console.log(`agent_logs entries for job ${jobId}:`, r.rows.length);
  for (const row of r.rows) {
    const d = row.details as Record<string, unknown> ?? {};
    console.log(`[${row.created_at}] [${row.source}] sess=${row.session_id?.slice(0,12)} job=${row.job_id?.slice(0,12)} type=${d.type ?? '-'}: ${(row.message as string)?.slice(0,150)}`);
  }
  process.exit(0);
});
