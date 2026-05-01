import * as fs from "node:fs";
import * as path from "node:path";
function loadDotenv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2]; if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadDotenv();
import { sql } from "../lib/db";
const runId = process.argv[2];
async function main() {
  const max = 30 * 60 * 1000; // 30min cap
  const start = Date.now();
  while (Date.now() - start < max) {
    const r = await sql`SELECT status, COUNT(*)::int AS n FROM benchmark_cases WHERE run_id=${runId} GROUP BY status ORDER BY status`;
    const counts: Record<string, number> = {};
    for (const row of r.rows) counts[row.status as string] = row.n as number;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const done = (counts.passed || 0) + (counts.failed || 0);
    console.log(`[wait] ${new Date().toISOString().slice(11,19)} ${JSON.stringify(counts)} done=${done}/${total}`);
    if (total > 0 && done === total) { console.log("[wait] all done"); process.exit(0); }
    await new Promise(r => setTimeout(r, 15000));
  }
  console.log("[wait] timeout");
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
