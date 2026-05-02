/**
 * One-shot script: dispatch a benchmark run programmatically (bypasses
 * the /api/internal/benchmark/seed endpoint's Clerk auth gate).
 *
 * Usage:  npx tsx scripts/trigger-benchmark.ts [maxCases]
 * Default maxCases = 30 (full v2.1 dataset).
 */

import * as fs from "node:fs";
import * as path from "node:path";

function loadDotenv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
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
    console.log(`[trigger] loaded env from ${p}`);
    return;
  }
  console.warn(`[trigger] no .env.local found`);
}

loadDotenv();

import { runRestaurantBenchmark } from "../lib/benchmark/run-restaurant-benchmark";

async function main() {
  const maxCases = parseInt(process.argv[2] ?? "30", 10);
  const name = `Smoke run ${new Date().toLocaleString()}`;
  console.log(`[trigger] starting benchmark: name="${name}" maxCases=${maxCases} mode=dry_run`);
  const result = await runRestaurantBenchmark({
    name,
    mode: "dry_run",
    maxCases,
    batchSize: 5,
  });
  console.log(`[trigger] dispatched: run_id=${result.run_id} dispatched=${result.dispatched}/${result.total}`);
  console.log(`[trigger] dashboard: http://localhost:3000/internal/benchmark/${result.run_id}`);
  console.log(`[trigger] message: ${result.message ?? "(none)"}`);
}

main().catch((err) => {
  console.error("trigger failed:", err);
  process.exit(1);
});
