/**
 * Tests for runtime-forensics URL filter serialization.
 *
 * Covers:
 *  - empty / missing query produces DEFAULT_FILTER_STATE
 *  - comma-list parser drops empties + dedups + caps length
 *  - unknown enum values are dropped with warnings (never throws)
 *  - sort key/dir validation + default fallback
 *  - bool flag synonyms ("1" / "true" / "yes" / "on")
 *  - ?examples=1 alias for showFixtures
 *  - serialize -> parse roundtrip preserves state
 *  - serializer omits defaults
 *  - filtersEqual semantics
 *  - applyEnhancedFilter against ForensicsSummary[]
 *  - sortSummaries: severity / updatedAt / provider / scenario
 *  - tolerant parsing on garbage input
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTER_STATE,
  applyEnhancedFilter,
  filtersEqual,
  parseFiltersFromQuery,
  serializeFiltersToQuery,
  serializeFiltersToString,
  severityForClass,
  sortSummaries,
  type FilterState,
} from "@/lib/runtime-forensics/url-filter";
import type {
  FailureClass,
  ForensicsSeverity,
  ForensicsSummary,
} from "@/lib/runtime-forensics/types";

function makeSummary(overrides: Partial<ForensicsSummary> = {}): ForensicsSummary {
  return {
    jobId: "job-1",
    taskId: null,
    provider: "resy",
    scenario: "R-001",
    status: "failed",
    primaryClass: "unknown",
    severity: "p2",
    hasLegacyShapeBug: false,
    ageSeconds: null,
    updatedAt: null,
    inputSource: "benchmark-run:fake.json",
    isFixture: false,
    ...overrides,
  };
}

describe("parseFiltersFromQuery — defaults", () => {
  it("returns DEFAULT_FILTER_STATE for null input", () => {
    const { state, warnings } = parseFiltersFromQuery(null);
    expect(state).toEqual(DEFAULT_FILTER_STATE);
    expect(warnings).toEqual([]);
  });

  it("returns DEFAULT_FILTER_STATE for undefined input", () => {
    const { state } = parseFiltersFromQuery(undefined);
    expect(state).toEqual(DEFAULT_FILTER_STATE);
  });

  it("returns DEFAULT_FILTER_STATE for empty URLSearchParams", () => {
    const { state, warnings } = parseFiltersFromQuery(new URLSearchParams());
    expect(state).toEqual(DEFAULT_FILTER_STATE);
    expect(warnings).toEqual([]);
  });

  it("returns DEFAULT_FILTER_STATE for empty record", () => {
    const { state } = parseFiltersFromQuery({});
    expect(state).toEqual(DEFAULT_FILTER_STATE);
  });
});

describe("parseFiltersFromQuery — providers (free-text)", () => {
  it("parses comma-separated list", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("providers=resy,opentable"));
    expect(state.providers).toEqual(["resy", "opentable"]);
  });

  it("drops empty segments", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("providers=,,resy,,"));
    expect(state.providers).toEqual(["resy"]);
  });

  it("dedupes preserving insertion order", () => {
    const { state } = parseFiltersFromQuery(
      new URLSearchParams("providers=resy,opentable,resy,opentable"),
    );
    expect(state.providers).toEqual(["resy", "opentable"]);
  });

  it("trims whitespace around segments", () => {
    const { state } = parseFiltersFromQuery(
      new URLSearchParams("providers= resy , opentable "),
    );
    expect(state.providers).toEqual(["resy", "opentable"]);
  });

  it("does not validate provider names against a whitelist", () => {
    // Free-text on purpose — provider names evolve and the loader does
    // case-insensitive matching itself.
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams("providers=resy,booking-com,acme-fake"),
    );
    expect(state.providers).toEqual(["resy", "booking-com", "acme-fake"]);
    expect(warnings).toEqual([]);
  });

  it("caps the list length", () => {
    const big = Array.from({ length: 64 }, (_, i) => `p${i}`).join(",");
    const { state } = parseFiltersFromQuery(new URLSearchParams(`providers=${big}`));
    expect(state.providers.length).toBe(32);
    expect(state.providers[0]).toBe("p0");
  });
});

describe("parseFiltersFromQuery — classes (enum)", () => {
  it("accepts known classes", () => {
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams(
        "classes=otp_or_login_required,unknown,legacy_shape_missing_source",
      ),
    );
    expect(state.classes).toEqual([
      "otp_or_login_required",
      "unknown",
      "legacy_shape_missing_source",
    ]);
    expect(warnings).toEqual([]);
  });

  it("drops unknown values with warnings", () => {
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams("classes=unknown,foobar,otp_or_login_required"),
    );
    expect(state.classes).toEqual(["unknown", "otp_or_login_required"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/foobar/);
  });

  it("drops empty enum input gracefully", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("classes="));
    expect(state.classes).toEqual([]);
  });

  it("dedupes valid + invalid mixed", () => {
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams("classes=unknown,unknown,foo,bar,foo"),
    );
    expect(state.classes).toEqual(["unknown"]);
    // Two unknown enum warnings (foo and bar). foo dedup'd before warning,
    // so we see only `foo` once and `bar` once.
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseFiltersFromQuery — severities", () => {
  it("accepts known severities", () => {
    const { state } = parseFiltersFromQuery(
      new URLSearchParams("severities=p0,p1,info"),
    );
    expect(state.severities).toEqual(["p0", "p1", "info"]);
  });

  it("drops unknown severities with warnings", () => {
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams("severities=p0,critical,p2"),
    );
    expect(state.severities).toEqual(["p0", "p2"]);
    expect(warnings.some((w) => w.includes("critical"))).toBe(true);
  });
});

describe("parseFiltersFromQuery — sort", () => {
  it("parses key:dir form", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("sort=updatedAt:asc"));
    expect(state.sortKey).toBe("updatedAt");
    expect(state.sortDir).toBe("asc");
  });

  it("falls back on unknown key", () => {
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams("sort=foobar:desc"),
    );
    expect(state.sortKey).toBe("severity");
    expect(state.sortDir).toBe("desc");
    expect(warnings.some((w) => w.toLowerCase().includes("foobar"))).toBe(true);
  });

  it("falls back on unknown direction", () => {
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams("sort=severity:upwards"),
    );
    expect(state.sortKey).toBe("severity");
    expect(state.sortDir).toBe("desc");
    expect(warnings.some((w) => w.toLowerCase().includes("upwards"))).toBe(true);
  });

  it("accepts key only", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("sort=provider"));
    expect(state.sortKey).toBe("provider");
    expect(state.sortDir).toBe("desc");
  });

  it("accepts dir only", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("sort=:asc"));
    expect(state.sortKey).toBe("severity");
    expect(state.sortDir).toBe("asc");
  });
});

describe("parseFiltersFromQuery — bool flags", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["yes", true],
    ["on", true],
    ["0", false],
    ["false", false],
    ["random", false],
    ["", false],
  ])('hideUnknown="%s" -> %s', (raw, expected) => {
    const params = new URLSearchParams();
    if (raw !== "") params.set("hideUnknown", raw);
    const { state } = parseFiltersFromQuery(params);
    expect(state.hideUnknown).toBe(expected);
  });

  it("?examples=1 aliases showFixtures", () => {
    const { state } = parseFiltersFromQuery(new URLSearchParams("examples=1"));
    expect(state.showFixtures).toBe(true);
  });

  it("explicit showFixtures overrides examples=0", () => {
    const { state } = parseFiltersFromQuery(
      new URLSearchParams("showFixtures=1&examples=0"),
    );
    expect(state.showFixtures).toBe(true);
  });

  it("either flag enables fixtures", () => {
    const a = parseFiltersFromQuery(new URLSearchParams("showFixtures=1")).state;
    const b = parseFiltersFromQuery(new URLSearchParams("examples=true")).state;
    expect(a.showFixtures).toBe(true);
    expect(b.showFixtures).toBe(true);
  });
});

describe("parseFiltersFromQuery — single-value scalars", () => {
  it("captures jobId / taskId / sessionId", () => {
    const { state } = parseFiltersFromQuery(
      new URLSearchParams("jobId=job-abc&taskId=task-1&sessionId=sess-9"),
    );
    expect(state.jobId).toBe("job-abc");
    expect(state.taskId).toBe("task-1");
    expect(state.sessionId).toBe("sess-9");
  });

  it("nullifies empty / whitespace scalars", () => {
    const { state } = parseFiltersFromQuery(
      new URLSearchParams("jobId=   &taskId=&sessionId=keep"),
    );
    expect(state.jobId).toBeNull();
    expect(state.taskId).toBeNull();
    expect(state.sessionId).toBe("keep");
  });
});

describe("parseFiltersFromQuery — record + repeated keys", () => {
  it("accepts plain record input", () => {
    const { state } = parseFiltersFromQuery({
      providers: "resy,opentable",
      classes: "otp_or_login_required",
      hideUnknown: "1",
    });
    expect(state.providers).toEqual(["resy", "opentable"]);
    expect(state.classes).toEqual(["otp_or_login_required"]);
    expect(state.hideUnknown).toBe(true);
  });

  it("joins repeated keys (?providers=resy&providers=opentable)", () => {
    const params = new URLSearchParams();
    params.append("providers", "resy");
    params.append("providers", "opentable");
    const { state } = parseFiltersFromQuery(params);
    expect(state.providers).toEqual(["resy", "opentable"]);
  });

  it("accepts string[] in record form", () => {
    const { state } = parseFiltersFromQuery({
      providers: ["resy", "opentable"],
    });
    expect(state.providers).toEqual(["resy", "opentable"]);
  });
});

describe("serializeFiltersToQuery — defaults omitted", () => {
  it("default state serializes to empty string", () => {
    const params = serializeFiltersToQuery(DEFAULT_FILTER_STATE);
    expect(params.toString()).toBe("");
  });

  it("only includes set fields", () => {
    const state: FilterState = {
      ...DEFAULT_FILTER_STATE,
      providers: ["resy"],
      hideUnknown: true,
    };
    const params = serializeFiltersToQuery(state);
    expect(params.get("providers")).toBe("resy");
    expect(params.get("hideUnknown")).toBe("1");
    expect(params.get("classes")).toBeNull();
    expect(params.get("severities")).toBeNull();
    expect(params.get("sort")).toBeNull();
  });

  it("serializer omits sort when at default", () => {
    const state: FilterState = {
      ...DEFAULT_FILTER_STATE,
      sortKey: "severity",
      sortDir: "desc",
      providers: ["resy"],
    };
    const params = serializeFiltersToQuery(state);
    expect(params.get("sort")).toBeNull();
  });

  it("serializer includes sort when non-default", () => {
    const state: FilterState = {
      ...DEFAULT_FILTER_STATE,
      sortKey: "updatedAt",
      sortDir: "asc",
    };
    expect(serializeFiltersToQuery(state).get("sort")).toBe("updatedAt:asc");
  });
});

describe("serialize -> parse roundtrip", () => {
  it("preserves a fully populated state", () => {
    const original: FilterState = {
      providers: ["resy", "opentable", "expedia"],
      classes: ["otp_or_login_required", "legacy_shape_missing_source"],
      severities: ["p0", "p1"],
      hideUnknown: true,
      showFixtures: true,
      sortKey: "updatedAt",
      sortDir: "asc",
      jobId: "job-abc",
      taskId: "task-1",
      sessionId: "sess-9",
    };
    const params = serializeFiltersToQuery(original);
    const { state, warnings } = parseFiltersFromQuery(params);
    expect(state).toEqual(original);
    expect(warnings).toEqual([]);
  });

  it("preserves a partial state", () => {
    const original: FilterState = {
      ...DEFAULT_FILTER_STATE,
      providers: ["resy"],
      hideUnknown: true,
    };
    const params = serializeFiltersToQuery(original);
    const { state } = parseFiltersFromQuery(params);
    expect(state).toEqual(original);
  });

  it("string roundtrip via serializeFiltersToString", () => {
    const original: FilterState = {
      ...DEFAULT_FILTER_STATE,
      providers: ["resy"],
      classes: ["unknown"],
    };
    const s = serializeFiltersToString(original);
    expect(s).toBeTypeOf("string");
    const { state } = parseFiltersFromQuery(new URLSearchParams(s));
    expect(state).toEqual(original);
  });
});

describe("filtersEqual", () => {
  it("equals for two default states", () => {
    expect(filtersEqual(DEFAULT_FILTER_STATE, { ...DEFAULT_FILTER_STATE })).toBe(true);
  });

  it("differs when providers differ", () => {
    const a = { ...DEFAULT_FILTER_STATE, providers: ["resy"] };
    const b = { ...DEFAULT_FILTER_STATE, providers: ["opentable"] };
    expect(filtersEqual(a, b)).toBe(false);
  });

  it("differs on order of providers (order-significant)", () => {
    const a = { ...DEFAULT_FILTER_STATE, providers: ["resy", "opentable"] };
    const b = { ...DEFAULT_FILTER_STATE, providers: ["opentable", "resy"] };
    expect(filtersEqual(a, b)).toBe(false);
  });

  it("differs on bool flags", () => {
    const a = { ...DEFAULT_FILTER_STATE, hideUnknown: true };
    const b = { ...DEFAULT_FILTER_STATE, hideUnknown: false };
    expect(filtersEqual(a, b)).toBe(false);
  });
});

describe("applyEnhancedFilter", () => {
  const summaries: ForensicsSummary[] = [
    makeSummary({ jobId: "a", primaryClass: "unknown", severity: "p2" }),
    makeSummary({ jobId: "b", primaryClass: "legacy_shape_missing_source", severity: "p0" }),
    makeSummary({ jobId: "c", primaryClass: "otp_or_login_required", severity: "info" }),
    makeSummary({ jobId: "d", primaryClass: "checkout_reached_manual_review", severity: "info" }),
  ];

  it("hideUnknown drops only unknown rows", () => {
    const out = applyEnhancedFilter(summaries, {
      ...DEFAULT_FILTER_STATE,
      hideUnknown: true,
    });
    expect(out.map((s) => s.jobId)).toEqual(["b", "c", "d"]);
  });

  it("classes filter restricts rows", () => {
    const out = applyEnhancedFilter(summaries, {
      ...DEFAULT_FILTER_STATE,
      classes: ["legacy_shape_missing_source", "checkout_reached_manual_review"],
    });
    expect(out.map((s) => s.jobId)).toEqual(["b", "d"]);
  });

  it("severities filter restricts rows", () => {
    const out = applyEnhancedFilter(summaries, {
      ...DEFAULT_FILTER_STATE,
      severities: ["p0"],
    });
    expect(out.map((s) => s.jobId)).toEqual(["b"]);
  });

  it("composes class + severity + hideUnknown filters", () => {
    const out = applyEnhancedFilter(summaries, {
      ...DEFAULT_FILTER_STATE,
      hideUnknown: true,
      severities: ["info"],
    });
    expect(out.map((s) => s.jobId)).toEqual(["c", "d"]);
  });

  it("empty filter is identity (apart from hideUnknown)", () => {
    const out = applyEnhancedFilter(summaries, DEFAULT_FILTER_STATE);
    expect(out).toEqual(summaries);
  });
});

describe("sortSummaries", () => {
  const summaries: ForensicsSummary[] = [
    makeSummary({ jobId: "a", severity: "p2", updatedAt: "2026-05-01T00:00:00Z", provider: "resy" }),
    makeSummary({ jobId: "b", severity: "p0", updatedAt: "2026-05-03T00:00:00Z", provider: "opentable" }),
    makeSummary({ jobId: "c", severity: "info", updatedAt: "2026-05-04T00:00:00Z", provider: "expedia" }),
    makeSummary({ jobId: "d", severity: "p1", updatedAt: null, provider: "booking-com" }),
  ];

  it("severity desc puts P0 first", () => {
    const out = sortSummaries(summaries, "severity", "desc");
    expect(out[0]?.jobId).toBe("b");
    expect(out[out.length - 1]?.jobId).toBe("c");
  });

  it("severity asc puts info first", () => {
    const out = sortSummaries(summaries, "severity", "asc");
    expect(out[0]?.jobId).toBe("c");
  });

  it("updatedAt desc puts newest first", () => {
    const out = sortSummaries(summaries, "updatedAt", "desc");
    expect(out[0]?.jobId).toBe("c");
  });

  it("updatedAt with null treated as 0", () => {
    const out = sortSummaries(summaries, "updatedAt", "asc");
    expect(out[0]?.jobId).toBe("d");
  });

  it("provider asc sorts alphabetically", () => {
    const out = sortSummaries(summaries, "provider", "asc");
    expect(out.map((s) => s.provider)).toEqual([
      "booking-com",
      "expedia",
      "opentable",
      "resy",
    ]);
  });

  it("scenario keeps stable order for ties", () => {
    const tied: ForensicsSummary[] = [
      makeSummary({ jobId: "a", scenario: "X" }),
      makeSummary({ jobId: "b", scenario: "X" }),
      makeSummary({ jobId: "c", scenario: "Y" }),
    ];
    const out = sortSummaries(tied, "scenario", "asc");
    // Tied a + b keep their original insertion order.
    expect(out.map((s) => s.jobId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate input", () => {
    const before = summaries.map((s) => s.jobId);
    sortSummaries(summaries, "severity", "asc");
    const after = summaries.map((s) => s.jobId);
    expect(after).toEqual(before);
  });
});

describe("severityForClass", () => {
  it("legacy_shape_missing_source is P0", () => {
    expect(severityForClass("legacy_shape_missing_source")).toBe("p0");
  });

  it("provider_no_availability is info", () => {
    expect(severityForClass("provider_no_availability")).toBe("info");
  });

  it.each<[FailureClass, ForensicsSeverity]>([
    ["legacy_shape_missing_source", "p0"],
    ["provider_form_incomplete", "p1"],
    ["model_or_env_blocked", "p1"],
    ["network_or_provider_5xx", "p2"],
    ["unknown", "p2"],
    ["otp_or_login_required", "info"],
    ["checkout_reached_manual_review", "info"],
    ["provider_no_availability", "info"],
  ])("severity for %s is %s", (c, sev) => {
    expect(severityForClass(c)).toBe(sev);
  });
});

describe("tolerant parsing — never throws", () => {
  it("survives garbage scalar", () => {
    const params = new URLSearchParams("sort=" + "x".repeat(2000));
    expect(() => parseFiltersFromQuery(params)).not.toThrow();
  });

  it("survives malformed comma list", () => {
    const params = new URLSearchParams("providers=,,,,,");
    const { state } = parseFiltersFromQuery(params);
    expect(state.providers).toEqual([]);
  });

  it("survives extremely long list", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `p${i}`).join(",");
    expect(() => parseFiltersFromQuery(new URLSearchParams(`providers=${big}`)))
      .not.toThrow();
  });

  it("survives unknown enum spam", () => {
    const big = Array.from({ length: 50 }, (_, i) => `garbage${i}`).join(",");
    const { state, warnings } = parseFiltersFromQuery(
      new URLSearchParams(`classes=${big}`),
    );
    expect(state.classes).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
