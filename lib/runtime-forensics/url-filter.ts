/**
 * URL <-> filter state serialization for the runtime-forensics dashboard.
 *
 * Format: comma-separated multi-select, tolerant parser. Example:
 *
 *   ?providers=resy,opentable&classes=otp_or_login_required,unknown
 *     &severities=p0,p1&hideUnknown=1&sort=severity:desc&showFixtures=1
 *
 * Parser rules:
 *   - empty segments are dropped (",,resy," -> ["resy"])
 *   - duplicates are dedup'd, insertion order preserved
 *   - unknown values for enum fields (classes / severities / sort key /
 *     sort dir) are dropped + recorded in warnings (never throws)
 *   - missing keys = empty array (no filter applied)
 *   - bool flags accept "1" / "true" / "yes" / "on" (case-insensitive)
 *   - `?examples=1` is treated as an alias for `showFixtures=1`
 *
 * Pure module. No browser or fs dependencies; safe to import from
 * client + server + tests.
 */

import {
  type FailureClass,
  type ForensicsSeverity,
  type ForensicsSummary,
  FAILURE_CLASS_LABEL,
  FAILURE_CLASS_SEVERITY,
  FORENSICS_SEVERITY_LABEL,
} from "./types";

/* ─── Public types ────────────────────────────────────────────────── */

export type SortKey = "severity" | "updatedAt" | "provider" | "scenario";
export type SortDir = "asc" | "desc";

export interface FilterState {
  providers: string[];
  classes: FailureClass[];
  severities: ForensicsSeverity[];
  hideUnknown: boolean;
  showFixtures: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  /** Single-value filters preserved for parity with the V1 API. */
  jobId: string | null;
  taskId: string | null;
  sessionId: string | null;
}

export interface ParseResult {
  state: FilterState;
  warnings: string[];
}

/* ─── Constants ───────────────────────────────────────────────────── */

const DEFAULT_SORT_KEY: SortKey = "severity";
const DEFAULT_SORT_DIR: SortDir = "desc";

export const DEFAULT_FILTER_STATE: FilterState = Object.freeze({
  providers: [],
  classes: [],
  severities: [],
  hideUnknown: false,
  showFixtures: false,
  sortKey: DEFAULT_SORT_KEY,
  sortDir: DEFAULT_SORT_DIR,
  jobId: null,
  taskId: null,
  sessionId: null,
}) as FilterState;

export const VALID_SORT_KEYS: ReadonlyArray<SortKey> = [
  "severity",
  "updatedAt",
  "provider",
  "scenario",
];
export const VALID_SORT_DIRS: ReadonlyArray<SortDir> = ["asc", "desc"];

const VALID_FAILURE_CLASSES: ReadonlySet<string> = new Set(
  Object.keys(FAILURE_CLASS_LABEL),
);
const VALID_SEVERITIES: ReadonlySet<string> = new Set(
  Object.keys(FORENSICS_SEVERITY_LABEL),
);

/** Hard cap on multi-select length (defends against pathological URLs). */
const MAX_LIST_LEN = 32;
const MAX_SCALAR_LEN = 200;

/* ─── Parser ──────────────────────────────────────────────────────── */

/**
 * Parse a query into a FilterState. Tolerant of empty segments, dup
 * values, unknown enum values, missing keys, and oversized inputs.
 * Never throws.
 */
export function parseFiltersFromQuery(
  query:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
): ParseResult {
  const get = makeReader(query);
  const warnings: string[] = [];

  const providers = capList(parseStringList(get("providers")), MAX_LIST_LEN);
  const classesRaw = capList(parseStringList(get("classes")), MAX_LIST_LEN);
  const severitiesRaw = capList(parseStringList(get("severities")), MAX_LIST_LEN);

  const classes: FailureClass[] = [];
  for (const c of classesRaw) {
    if (VALID_FAILURE_CLASSES.has(c)) {
      if (!classes.includes(c as FailureClass)) {
        classes.push(c as FailureClass);
      }
    } else {
      warnings.push(`classes: dropped unknown value "${truncate(c, 40)}"`);
    }
  }

  const severities: ForensicsSeverity[] = [];
  for (const s of severitiesRaw) {
    if (VALID_SEVERITIES.has(s)) {
      if (!severities.includes(s as ForensicsSeverity)) {
        severities.push(s as ForensicsSeverity);
      }
    } else {
      warnings.push(`severities: dropped unknown value "${truncate(s, 40)}"`);
    }
  }

  // Sort: "key:dir" with each part validated independently.
  let sortKey: SortKey = DEFAULT_SORT_KEY;
  let sortDir: SortDir = DEFAULT_SORT_DIR;
  const sortRaw = trimOrNull(get("sort"));
  if (sortRaw !== null) {
    const parts = sortRaw.split(":");
    const k = parts[0]?.trim() ?? "";
    const d = parts[1]?.trim() ?? "";
    if (k.length > 0) {
      if (VALID_SORT_KEYS.includes(k as SortKey)) {
        sortKey = k as SortKey;
      } else {
        warnings.push(`sort: dropped unknown key "${truncate(k, 40)}"`);
      }
    }
    if (d.length > 0) {
      if (VALID_SORT_DIRS.includes(d as SortDir)) {
        sortDir = d as SortDir;
      } else {
        warnings.push(`sort: dropped unknown direction "${truncate(d, 40)}"`);
      }
    }
  }

  const hideUnknown = parseBoolFlag(get("hideUnknown"));
  const showFixturesRaw = parseBoolFlag(get("showFixtures"));
  // ?examples=1 is the API alias the dashboard URL uses for share parity.
  const examplesAlias = parseBoolFlag(get("examples"));
  const showFixtures = showFixturesRaw || examplesAlias;

  const state: FilterState = {
    providers,
    classes,
    severities,
    hideUnknown,
    showFixtures,
    sortKey,
    sortDir,
    jobId: trimOrNull(get("jobId")),
    taskId: trimOrNull(get("taskId")),
    sessionId: trimOrNull(get("sessionId")),
  };
  return { state, warnings };
}

/* ─── Serializer ──────────────────────────────────────────────────── */

/**
 * Serialize a FilterState into URLSearchParams. Default values are
 * omitted (so the URL only carries non-default state).
 */
export function serializeFiltersToQuery(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.providers.length > 0) {
    params.set("providers", state.providers.join(","));
  }
  if (state.classes.length > 0) {
    params.set("classes", state.classes.join(","));
  }
  if (state.severities.length > 0) {
    params.set("severities", state.severities.join(","));
  }
  if (state.hideUnknown) params.set("hideUnknown", "1");
  if (state.showFixtures) params.set("showFixtures", "1");
  if (
    state.sortKey !== DEFAULT_SORT_KEY ||
    state.sortDir !== DEFAULT_SORT_DIR
  ) {
    params.set("sort", `${state.sortKey}:${state.sortDir}`);
  }
  if (state.jobId) params.set("jobId", state.jobId);
  if (state.taskId) params.set("taskId", state.taskId);
  if (state.sessionId) params.set("sessionId", state.sessionId);
  return params;
}

/** Convenience: serialize to a query string without leading `?`. */
export function serializeFiltersToString(state: FilterState): string {
  return serializeFiltersToQuery(state).toString();
}

/* ─── Equality + roundtrip helpers ────────────────────────────────── */

export function filtersEqual(a: FilterState, b: FilterState): boolean {
  return (
    sameStringList(a.providers, b.providers) &&
    sameStringList(a.classes, b.classes) &&
    sameStringList(a.severities, b.severities) &&
    a.hideUnknown === b.hideUnknown &&
    a.showFixtures === b.showFixtures &&
    a.sortKey === b.sortKey &&
    a.sortDir === b.sortDir &&
    a.jobId === b.jobId &&
    a.taskId === b.taskId &&
    a.sessionId === b.sessionId
  );
}

/* ─── Filter + sort summaries (post-classification) ───────────────── */

/**
 * Apply the post-classification slice of a FilterState to summary
 * rows. Single-value provider / status filters are applied at the
 * loader level for efficiency; this handles MULTI-select providers,
 * classes, severities, hideUnknown, and fixture-row filtering.
 */
export function applyEnhancedFilter(
  summaries: ReadonlyArray<ForensicsSummary>,
  state: FilterState,
): ForensicsSummary[] {
  const classSet = new Set(state.classes);
  const sevSet = new Set(state.severities);
  const providerSet = new Set(
    state.providers.map((p) => p.toLowerCase()),
  );
  return summaries.filter((s) => {
    if (state.hideUnknown && s.primaryClass === "unknown") return false;
    if (classSet.size > 0 && !classSet.has(s.primaryClass)) return false;
    if (sevSet.size > 0 && !sevSet.has(s.severity)) return false;
    if (providerSet.size > 0) {
      const sp = (s.provider ?? "").toLowerCase();
      if (!providerSet.has(sp)) return false;
    }
    return true;
  });
}

/** Stable sort summaries by the chosen key + direction. */
export function sortSummaries(
  summaries: ReadonlyArray<ForensicsSummary>,
  sortKey: SortKey,
  sortDir: SortDir,
): ForensicsSummary[] {
  const dir = sortDir === "asc" ? 1 : -1;
  // Stable sort: pre-tag with index, sort, drop tag.
  const tagged = summaries.map((s, i) => ({ s, i }));
  tagged.sort((a, b) => {
    const cmp = compareSummaries(a.s, b.s, sortKey);
    if (cmp !== 0) return cmp * dir;
    return a.i - b.i;
  });
  return tagged.map((x) => x.s);
}

const SEVERITY_ORDER: Record<ForensicsSeverity, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
  info: 4,
};

function compareSummaries(
  a: ForensicsSummary,
  b: ForensicsSummary,
  key: SortKey,
): number {
  switch (key) {
    case "severity": {
      const av = SEVERITY_ORDER[a.severity] ?? 99;
      const bv = SEVERITY_ORDER[b.severity] ?? 99;
      // Lower severity number = more severe. With dir=desc the caller
      // expects most-severe first; so invert here so descending puts
      // P0 first.
      if (av !== bv) return bv - av;
      return 0;
    }
    case "updatedAt": {
      const av = parseTimestamp(a.updatedAt);
      const bv = parseTimestamp(b.updatedAt);
      if (av === bv) return 0;
      // Newer = larger ms. Descending should put newest first, so we
      // emit the natural compare and let the dir multiplier flip it.
      return av < bv ? -1 : 1;
    }
    case "provider": {
      return safeCompare(a.provider, b.provider);
    }
    case "scenario": {
      return safeCompare(a.scenario, b.scenario);
    }
    default:
      return 0;
  }
}

function parseTimestamp(s: string | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function safeCompare(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Cross-reference for FAILURE_CLASS_SEVERITY (re-exported for tests). */
export function severityForClass(c: FailureClass): ForensicsSeverity {
  return FAILURE_CLASS_SEVERITY[c];
}

/* ─── Internal helpers ────────────────────────────────────────────── */

type Reader = (key: string) => string | null;

function makeReader(
  q:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
): Reader {
  if (q == null) return () => null;
  if (typeof URLSearchParams !== "undefined" && q instanceof URLSearchParams) {
    return (key: string) => {
      // URLSearchParams.get returns the first value if multiple.
      const all = q.getAll(key);
      if (all.length === 0) return null;
      // Treat repeated keys (?providers=resy&providers=opentable) as
      // implicit comma-list to match the canonical format.
      return all.join(",");
    };
  }
  const obj = q as Record<string, string | string[] | undefined>;
  return (key: string) => {
    const v = obj[key];
    if (Array.isArray(v)) {
      return v.filter((x) => typeof x === "string").join(",");
    }
    return typeof v === "string" ? v : null;
  };
}

function parseStringList(raw: string | null): string[] {
  if (raw === null) return [];
  if (raw.length > MAX_SCALAR_LEN * MAX_LIST_LEN) {
    raw = raw.slice(0, MAX_SCALAR_LEN * MAX_LIST_LEN);
  }
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_SCALAR_LEN) continue;
    if (out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function parseBoolFlag(raw: string | null): boolean {
  if (raw === null) return false;
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

function trimOrNull(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  if (t.length > MAX_SCALAR_LEN) return t.slice(0, MAX_SCALAR_LEN);
  return t;
}

function sameStringList(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function capList<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  return arr.slice(0, cap);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return s.slice(0, max - 3) + "...";
}
