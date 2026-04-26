/**
 * @onegent/worker — Booking-autopilot poll loop.
 *
 * Polls `booking_jobs` every POLL_INTERVAL_MS for status='queued', claims
 * one via `FOR UPDATE SKIP LOCKED`, and executes via runBrowserTask.
 *
 * D1 scope (this file today): connect to Postgres, prove we can see queued
 * jobs, log them. No actual job execution — that's D2 work, where pollOnce()
 * will be replaced with claimAndRun().
 */
import { sql } from "@vercel/postgres";
import { hostname } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Local-dev convenience: hydrate process.env from ../.env.local if present.
// In Docker / Railway this file doesn't exist — we silently fall through to
// whatever the container injected.
const localEnvPath = resolve(process.cwd(), "..", ".env.local");
if (existsSync(localEnvPath)) {
  for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const POLL_INTERVAL_MS = 10_000;
const WORKER_ID =
  process.env.WORKER_INSTANCE_ID ||
  `worker-${hostname()}-${Math.random().toString(36).slice(2, 8)}`;

let shuttingDown = false;

function log(...parts: unknown[]): void {
  console.log(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...parts);
}

function logError(msg: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  console.error(`[${new Date().toISOString()}] [${WORKER_ID}] ${msg}: ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOnce(): Promise<void> {
  // D1: just count. D2 will replace this with FOR UPDATE SKIP LOCKED claim.
  const result = await sql<{ count: string }>`
    SELECT COUNT(*)::text AS count
    FROM booking_jobs
    WHERE status = 'queued'
  `;
  const count = parseInt(result.rows[0]?.count ?? "0", 10);

  if (count === 0) {
    log(`no queued jobs (sleeping ${POLL_INTERVAL_MS / 1000}s)`);
    return;
  }

  log(`${count} queued job(s) detected — D2 will claim+run them here`);
}

async function main(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL env var is required");
  }

  log(`starting — node ${process.version} on ${process.platform}`);
  log(`poll interval: ${POLL_INTERVAL_MS / 1000}s`);

  await sql`SELECT 1 AS ping`;
  log(`postgres connected`);

  while (!shuttingDown) {
    try {
      await pollOnce();
    } catch (err) {
      logError("poll iteration failed", err);
    }
    if (!shuttingDown) await sleep(POLL_INTERVAL_MS);
  }

  log(`graceful shutdown complete`);
  process.exit(0);
}

process.on("SIGTERM", () => {
  log(`SIGTERM received — exiting after current poll`);
  shuttingDown = true;
});

process.on("SIGINT", () => {
  log(`SIGINT received — exiting after current poll`);
  shuttingDown = true;
});

main().catch((err) => {
  logError("fatal error in main", err);
  process.exit(1);
});
