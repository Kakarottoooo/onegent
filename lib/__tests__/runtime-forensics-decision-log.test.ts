import { describe, expect, it } from "vitest";

import { pickExcerpts, summarizeDecisionLog } from "../runtime-forensics/decision-log";
import type { DecisionLogEntryLike } from "../runtime-forensics/types";

const entry = (overrides: Partial<DecisionLogEntryLike> = {}): DecisionLogEntryLike => ({
  at: "2026-05-04T08:00:00.000Z",
  level: "info",
  event: "step",
  message: "step ok",
  ...overrides,
});

describe("summarizeDecisionLog — empty / garbage", () => {
  it("returns zeros for null log", () => {
    const r = summarizeDecisionLog(null);
    expect(r.totalEntries).toBe(0);
    expect(r.byLevel).toEqual({});
    expect(r.topEvents).toEqual([]);
    expect(r.excerpts).toEqual([]);
    expect(r.notableSignals).toEqual([]);
  });
  it("returns zeros for undefined log", () => {
    const r = summarizeDecisionLog(undefined);
    expect(r.totalEntries).toBe(0);
  });
  it("returns zeros for non-array", () => {
    const r = summarizeDecisionLog("nope" as unknown as undefined);
    expect(r.totalEntries).toBe(0);
  });
  it("filters non-object entries", () => {
    const r = summarizeDecisionLog([
      42 as unknown as never,
      "string" as unknown as never,
      null as unknown as never,
      entry(),
    ]);
    expect(r.totalEntries).toBe(1);
  });
});

describe("summarizeDecisionLog — counts", () => {
  it("counts by level", () => {
    const r = summarizeDecisionLog([
      entry({ level: "info" }),
      entry({ level: "info" }),
      entry({ level: "error" }),
      entry({ level: "warn" }),
    ]);
    expect(r.byLevel.info).toBe(2);
    expect(r.byLevel.error).toBe(1);
    expect(r.byLevel.warn).toBe(1);
  });
  it("defaults missing level to 'info'", () => {
    const r = summarizeDecisionLog([
      entry({ level: undefined }),
      entry({ level: "" as unknown as null }),
    ]);
    expect(r.byLevel.info).toBe(2);
  });
  it("counts by event with sort + limit 8", () => {
    const log: DecisionLogEntryLike[] = [];
    for (let i = 0; i < 15; i++) {
      log.push(entry({ event: `event_${i % 5}` }));
    }
    const r = summarizeDecisionLog(log);
    expect(r.topEvents.length).toBeLessThanOrEqual(8);
    // Top 5 events should each appear 3 times
    expect(r.topEvents[0].count).toBe(3);
  });
  it("groups missing event as '(unnamed)'", () => {
    const r = summarizeDecisionLog([entry({ event: undefined })]);
    expect(r.topEvents[0].event).toBe("(unnamed)");
  });
});

describe("summarizeDecisionLog — notableSignals", () => {
  it("detects probe-first phrase", () => {
    const r = summarizeDecisionLog([
      entry({ event: "probe", message: "use_for_live_fill_test verdict" }),
    ]);
    expect(r.notableSignals).toContain("probe-first protocol");
  });
  it("detects strategy ladder", () => {
    const r = summarizeDecisionLog([
      entry({ event: "strategy", message: "strategy ladder rs-confirm-01" }),
    ]);
    expect(r.notableSignals).toContain("strategy ladder invocation");
  });
  it("detects fallback", () => {
    const r = summarizeDecisionLog([
      entry({ message: "fall back to mouse keyboard" }),
    ]);
    expect(r.notableSignals).toContain("fallback path taken");
  });
  it("detects retry exhausted", () => {
    const r = summarizeDecisionLog([
      entry({ message: "retry exhausted after 3 attempts" }),
    ]);
    expect(r.notableSignals).toContain("retry scheduled / exhausted");
  });
  it("detects timeout reached", () => {
    const r = summarizeDecisionLog([
      entry({ message: "timeout reached at 30s" }),
    ]);
    expect(r.notableSignals).toContain("timeout reached");
  });
  it("detects captcha", () => {
    const r = summarizeDecisionLog([
      entry({ message: "captcha detected mid-flow" }),
    ]);
    expect(r.notableSignals).toContain("captcha encountered");
  });
  it("detects 2FA", () => {
    const r = summarizeDecisionLog([
      entry({ message: "two-factor auth required" }),
    ]);
    expect(r.notableSignals).toContain("two-factor auth");
  });
  it("detects selector not found", () => {
    const r = summarizeDecisionLog([
      entry({ message: "selector missing for confirm modal" }),
    ]);
    expect(r.notableSignals).toContain("selector not found");
  });
  it("dedupes notableSignals", () => {
    const r = summarizeDecisionLog([
      entry({ message: "fall back" }),
      entry({ message: "fallback" }),
    ]);
    expect(
      r.notableSignals.filter((s) => s === "fallback path taken").length,
    ).toBe(1);
  });
});

describe("pickExcerpts", () => {
  it("returns all entries when total ≤ 12", () => {
    const log = Array.from({ length: 5 }, () => entry());
    const out = pickExcerpts(log);
    expect(out.length).toBe(5);
  });
  it("picks first 6 + last 6 when total > 12", () => {
    const log = Array.from({ length: 20 }, (_, i) =>
      entry({ event: `event_${i}` }),
    );
    const out = pickExcerpts(log);
    expect(out.length).toBe(12);
    expect(out[0].event).toBe("event_0");
    expect(out[5].event).toBe("event_5");
    expect(out[6].event).toBe("event_14");
    expect(out[11].event).toBe("event_19");
  });
  it("returns [] for empty input", () => {
    expect(pickExcerpts([])).toEqual([]);
  });
  it("sanitizes entries — truncates message", () => {
    const longMsg = "x".repeat(500);
    const out = pickExcerpts([entry({ message: longMsg })]);
    expect(out[0].message!.length).toBeLessThanOrEqual(240);
  });
  it("sanitizes entries — keeps null fields null", () => {
    const out = pickExcerpts([entry({ at: undefined, level: undefined, event: undefined })]);
    expect(out[0].at).toBeNull();
  });
});

describe("summarizeDecisionLog — integration with excerpts", () => {
  it("stable order for top events", () => {
    const log = [
      entry({ event: "alpha" }),
      entry({ event: "alpha" }),
      entry({ event: "beta" }),
      entry({ event: "beta" }),
      entry({ event: "gamma" }),
    ];
    const r1 = summarizeDecisionLog(log);
    const r2 = summarizeDecisionLog(log);
    expect(r1.topEvents).toEqual(r2.topEvents);
  });
});
