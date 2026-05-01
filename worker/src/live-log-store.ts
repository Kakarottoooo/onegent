/**
 * live-log-store.ts — In-memory ring buffer for real-time agent trace logs.
 *
 * The stagehand executor pushes each trace line here via liveLogPush().
 * The polling endpoint /api/booking-jobs/[id]/logs reads from here.
 * Entries are cleaned up 5 minutes after the job closes.
 */

const MAX_LINES = 2000;
const CLEANUP_DELAY_MS = 5 * 60_000;

export interface LiveLogLineEntry {
  line: string;
  ts: string;
}

interface LogEntry {
  lines: LiveLogLineEntry[];
  closedAt?: number;
  epoch: number; // increments on each liveLogReset — lets client detect a new run
}

// Use globalThis so the Map survives Next.js HMR module re-evaluations in dev.
// In production each serverless invocation gets its own process, but the DB
// fallback (logs/route.ts reading decisionLog from DB) handles that case.
declare global {
  // eslint-disable-next-line no-var
  var __liveLogStore: Map<string, LogEntry> | undefined;
}
if (!globalThis.__liveLogStore) globalThis.__liveLogStore = new Map<string, LogEntry>();
const store = globalThis.__liveLogStore;

/** Reset the log for a job — call at the start of each new run to clear stale entries. */
export function liveLogReset(jobId: string): void {
  const prev = store.get(jobId);
  store.set(jobId, { lines: [], epoch: (prev?.epoch ?? 0) + 1 });
}

export function liveLogPush(jobId: string, line: string): void {
  let entry = store.get(jobId);
  if (!entry) {
    entry = { lines: [], epoch: 1 };
    store.set(jobId, entry);
  }
  if (entry.lines.length < MAX_LINES) {
    entry.lines.push({ line, ts: new Date().toISOString() });
  }
}

/** Returns all lines after the given index (exclusive). */
export function liveLogGet(jobId: string, after = 0): LiveLogLineEntry[] {
  return (store.get(jobId)?.lines ?? []).slice(after);
}

/** Total number of lines stored. */
export function liveLogCount(jobId: string): number {
  return store.get(jobId)?.lines.length ?? 0;
}

export function liveLogClose(jobId: string): void {
  const entry = store.get(jobId);
  if (entry) {
    entry.closedAt = Date.now();
  }
  // Clean up after a delay so the UI can still fetch final lines
  setTimeout(() => store.delete(jobId), CLEANUP_DELAY_MS);
}

export function liveLogIsClosed(jobId: string): boolean {
  return !!(store.get(jobId)?.closedAt);
}

/** Current epoch for a job — increments every time liveLogReset is called. */
export function liveLogEpoch(jobId: string): number {
  return store.get(jobId)?.epoch ?? 0;
}
