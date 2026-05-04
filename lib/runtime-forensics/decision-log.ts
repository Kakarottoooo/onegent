/**
 * Decision-log parser. Produces a compact summary suitable for the
 * dashboard drawer + the markdown bug report. Pure module.
 */

import type { DecisionLogEntryLike, DecisionLogSummary } from "./types";
import { truncate } from "./step-shape";

/**
 * Phrases worth surfacing as "notable" — these often correlate
 * with classifier signals but are useful even when classification
 * is "unknown".
 */
const NOTABLE_PHRASES: ReadonlyArray<{ rx: RegExp; label: string }> = [
  { rx: /probe[-_\s]?first|use_for_live_fill_test/i, label: "probe-first protocol" },
  { rx: /probe[-_\s]?recommended[-_\s]?case/i, label: "probe recommended case" },
  { rx: /strategy[-_\s]?ladder/i, label: "strategy ladder invocation" },
  { rx: /\bfallback\b|fall[-_\s]?back\s+to/i, label: "fallback path taken" },
  { rx: /retry\s+(scheduled|attempted|exhausted)/i, label: "retry scheduled / exhausted" },
  { rx: /timeout\s+(after|reached)/i, label: "timeout reached" },
  { rx: /captcha\s+(detected|wall|encountered)/i, label: "captcha encountered" },
  { rx: /two[-_\s]?factor|2fa/i, label: "two-factor auth" },
  { rx: /click[-_\s]?failed|button\s+(missing|not\s+found)/i, label: "click failed / button missing" },
  { rx: /selector\s+(not\s+found|missing|stale)/i, label: "selector not found" },
  { rx: /computer[-_\s]?use|cua\s+step/i, label: "Computer Use step" },
  { rx: /ai[-_\s]?(refill|audit)/i, label: "AI refill / audit invocation" },
];

/**
 * Build a summary of a decision-log array. Tolerates undefined,
 * null, non-array, mixed-shape entries.
 */
export function summarizeDecisionLog(
  log: DecisionLogEntryLike[] | null | undefined,
): DecisionLogSummary {
  const entries = Array.isArray(log) ? log.filter(isLikeEntry) : [];
  const byLevel: Partial<Record<string, number>> = {};
  const eventCounts = new Map<string, number>();
  const notableSignals = new Set<string>();

  for (const e of entries) {
    const level =
      typeof e.level === "string" && e.level.length > 0 ? e.level : "info";
    byLevel[level] = (byLevel[level] ?? 0) + 1;
    const event =
      typeof e.event === "string" && e.event.length > 0 ? e.event : "(unnamed)";
    eventCounts.set(event, (eventCounts.get(event) ?? 0) + 1);

    const text = textOf(e);
    for (const n of NOTABLE_PHRASES) {
      if (n.rx.test(text)) notableSignals.add(n.label);
    }
  }

  const topEvents = Array.from(eventCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 8)
    .map(([event, count]) => ({ event, count }));

  const excerpts = pickExcerpts(entries);

  return {
    totalEntries: entries.length,
    byLevel,
    topEvents,
    excerpts,
    notableSignals: Array.from(notableSignals).sort(),
  };
}

/** Pick the first 6 + last 6 entries (or all if total ≤ 12). */
export function pickExcerpts(
  entries: DecisionLogEntryLike[],
): DecisionLogEntryLike[] {
  if (entries.length === 0) return [];
  if (entries.length <= 12) return entries.map((e) => sanitizeEntry(e));
  const head = entries.slice(0, 6).map((e) => sanitizeEntry(e));
  const tail = entries.slice(-6).map((e) => sanitizeEntry(e));
  return [...head, ...tail];
}

function sanitizeEntry(e: DecisionLogEntryLike): DecisionLogEntryLike {
  return {
    at: typeof e.at === "string" ? e.at : null,
    level: typeof e.level === "string" ? e.level : null,
    event: typeof e.event === "string" ? e.event : null,
    message:
      typeof e.message === "string" ? truncate(e.message, 240) : null,
    data: trimData(e.data),
  };
}

function trimData(d: unknown): unknown {
  if (d === undefined || d === null) return d;
  if (typeof d === "string") return truncate(d, 240);
  try {
    const json = JSON.stringify(d);
    if (json.length <= 480) return d;
    return truncate(json, 480);
  } catch {
    return "(unserializable)";
  }
}

function textOf(e: DecisionLogEntryLike): string {
  const parts: string[] = [];
  if (typeof e.event === "string") parts.push(e.event);
  if (typeof e.message === "string") parts.push(e.message);
  if (e.data !== undefined && e.data !== null) {
    try {
      parts.push(typeof e.data === "string" ? e.data : JSON.stringify(e.data));
    } catch {
      /* ignore */
    }
  }
  return parts.join(" ");
}

function isLikeEntry(x: unknown): x is DecisionLogEntryLike {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
