/**
 * scripts/check-drift.ts
 *
 * B+B2 architecture has two copies of the booking executor (lib/ for Vercel
 * in-process path, worker/src/ for Railway/local worker). Functional drift
 * between them = behaviour diverges depending on which path runs a job —
 * silent prod bugs.
 *
 * This script enforces: a curated list of paired files MUST be byte-identical.
 * Run via:
 *   npm run check-drift
 *   npx tsx scripts/check-drift.ts
 *
 * Also runs in CI (.github/workflows/check-drift.yml) on every push + PR.
 *
 * --- Paired files ---
 *
 * Strict (byte-identical, recursively for dirs):
 *   - lib/booking-autopilot/         ↔ worker/src/booking-autopilot/
 *   - lib/core/                      ↔ worker/src/core/
 *   - lib/booking-errors.ts          ↔ worker/src/booking-errors.ts
 *   - lib/live-log-store.ts          ↔ worker/src/live-log-store.ts
 *   - lib/encryption.ts              ↔ worker/src/encryption.ts
 *   - lib/autonomy.ts                ↔ worker/src/autonomy.ts
 *   - lib/types.ts                   ↔ worker/src/types.ts
 *   - lib/browser-session-store.ts   ↔ worker/src/browser-session-store.ts
 *   - lib/monitors.ts                ↔ worker/src/monitors.ts
 *   - lib/memory.ts                  ↔ worker/src/memory.ts
 *
 * Excluded by design:
 *   - lib/db.ts                      ↔ worker/src/db.ts
 *     (worker has a simplified DB adapter — intentional drift)
 *   - lib/tools.ts                   ↔ worker/src/tools.ts
 *     (different import paths because worker flattens agent/planners/)
 *   - lib/agent/planners/booking-links.ts ↔ worker/src/booking-links.ts
 *     (different filenames; comment-only body diff per audit)
 *
 * --- Fix when this fails ---
 *
 * 1. Run `diff -rq lib/<path> worker/src/<path>` to see which files drifted.
 * 2. `cp lib/<file> worker/src/<file>` (or vice versa) until diff is empty.
 * 3. Re-run this script; commit when it passes.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

interface Pair {
  lib: string;
  worker: string;
  /** Recursive directory diff vs single-file diff. */
  recursive?: boolean;
}

const STRICT_PAIRS: Pair[] = [
  { lib: "lib/booking-autopilot", worker: "worker/src/booking-autopilot", recursive: true },
  { lib: "lib/core", worker: "worker/src/core", recursive: true },
  { lib: "lib/booking-errors.ts", worker: "worker/src/booking-errors.ts" },
  { lib: "lib/live-log-store.ts", worker: "worker/src/live-log-store.ts" },
  { lib: "lib/encryption.ts", worker: "worker/src/encryption.ts" },
  { lib: "lib/autonomy.ts", worker: "worker/src/autonomy.ts" },
  { lib: "lib/types.ts", worker: "worker/src/types.ts" },
  { lib: "lib/browser-session-store.ts", worker: "worker/src/browser-session-store.ts" },
  { lib: "lib/monitors.ts", worker: "worker/src/monitors.ts" },
  { lib: "lib/memory.ts", worker: "worker/src/memory.ts" },
];

interface Drift {
  pair: Pair;
  /** Output of `diff -q` (or `diff -rq` for recursive). */
  detail: string;
}

function runDiff(left: string, right: string, recursive: boolean): string {
  const args = recursive ? ["-rq", left, right] : ["-q", left, right];
  const result = spawnSync("diff", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  // diff exits 0 when identical, 1 when differs, 2+ on error
  if (result.status === 0) return "";
  if (result.status === 1) return result.stdout.trim();
  // Pair missing on one side or exec error
  const stderr = (result.stderr ?? "").trim();
  return stderr || `diff exited with status ${result.status}`;
}

function checkPair(pair: Pair): Drift | null {
  const leftAbs = path.join(ROOT, pair.lib);
  const rightAbs = path.join(ROOT, pair.worker);
  if (!fs.existsSync(leftAbs)) {
    return { pair, detail: `MISSING (lib side): ${pair.lib}` };
  }
  if (!fs.existsSync(rightAbs)) {
    return { pair, detail: `MISSING (worker side): ${pair.worker}` };
  }
  const out = runDiff(pair.lib, pair.worker, pair.recursive ?? false);
  if (!out) return null;
  return { pair, detail: out };
}

function main(): void {
  const drifts: Drift[] = [];
  for (const pair of STRICT_PAIRS) {
    const drift = checkPair(pair);
    if (drift) drifts.push(drift);
  }

  if (drifts.length === 0) {
    console.log("✅ No drift. lib and worker are byte-identical for all strict pairs.");
    process.exit(0);
  }

  console.error("❌ Drift detected between lib/ and worker/src/:\n");
  for (const d of drifts) {
    console.error(`--- ${d.pair.lib}  ↔  ${d.pair.worker} ---`);
    console.error(d.detail);
    console.error("");
  }
  console.error("Fix:");
  console.error(
    "  Pick the canonical side (usually lib/ for new logic from chat-commit / NLU,",
  );
  console.error(
    "  worker/src/ for booking automation changes), then `cp <canonical> <other>`",
  );
  console.error(
    "  until `diff -rq` shows nothing. See scripts/check-drift.ts header for the",
  );
  console.error("  full pair list and rationale.");
  process.exit(1);
}

main();
