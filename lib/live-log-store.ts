/**
 * live-log-store.ts — In-memory ring buffer for real-time agent trace logs.
 *
 * The stagehand executor pushes each trace line here via liveLogPush().
 * The polling endpoint /api/booking-jobs/[id]/logs reads from here.
 * Entries are cleaned up 5 minutes after the job closes.
 */

const MAX_LINES = 2000;
const CLEANUP_DELAY_MS = 5 * 60_000;

interface LogEntry {
  lines: string[];
  closedAt?: number;
}

const store = new Map<string, LogEntry>();

/** Reset the log for a job — call at the start of each new run to clear stale entries. */
export function liveLogReset(jobId: string): void {
  store.set(jobId, { lines: [] });
}

export function liveLogPush(jobId: string, line: string): void {
  let entry = store.get(jobId);
  if (!entry) {
    entry = { lines: [] };
    store.set(jobId, entry);
  }
  if (entry.lines.length < MAX_LINES) {
    entry.lines.push(line);
  }
}

/** Returns all lines after the given index (exclusive). */
export function liveLogGet(jobId: string, after = 0): string[] {
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
