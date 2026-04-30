import { describe, it, expect } from "vitest";
import { aggregateFromCases, summarise } from "@/lib/site-skills/aggregate";
import type { BenchmarkCaseRow, RestaurantBenchmarkCase } from "@/lib/benchmark/types";
import type { ProviderSkillRow } from "@/lib/site-skills/types";

const FIXTURE_PAYLOAD: RestaurantBenchmarkCase = {
  case_id: "fixture",
  city: "New York",
  restaurant_name: "L'Artusi",
  expected_provider: "OpenTable",
  date: "2026-05-12",
  time: "19:00",
  party_size: 2,
};

function makeCase(overrides: Partial<BenchmarkCaseRow> = {}): BenchmarkCaseRow {
  return {
    id: "case-1",
    run_id: "run-1",
    case_id: "fixture",
    task_payload: FIXTURE_PAYLOAD,
    mode: "dry_run",
    booking_job_id: null,
    provider: "OpenTable",
    executor: "stagehand",
    status: "succeeded",
    success: true,
    failure_reason: null,
    fallback_attempted: false,
    fallback_success: false,
    payment_stop_triggered: false,
    human_handoff_required: false,
    duration_seconds: 30,
    audit: null,
    created_at: "2026-05-12T19:00:00.000Z",
    completed_at: "2026-05-12T19:00:30.000Z",
    ...overrides,
  };
}

// ─── aggregateFromCases ─────────────────────────────────────────────────────

describe("aggregateFromCases", () => {
  it("returns empty map when input is empty", () => {
    const out = aggregateFromCases([]);
    expect(out.size).toBe(0);
  });

  it("groups by (provider, task_type) and counts samples + successes", () => {
    const cases = [
      makeCase({ provider: "OpenTable", success: true, status: "succeeded" }),
      makeCase({ provider: "OpenTable", success: false, status: "failed", failure_reason: "no_availability" }),
      makeCase({ provider: "OpenTable", success: true, status: "succeeded" }),
      makeCase({ provider: "Resy", success: false, status: "failed", failure_reason: "captcha_or_bot_detection" }),
    ];
    const out = aggregateFromCases(cases);
    expect(out.size).toBe(2);
    const ot = out.get("OpenTable::restaurant_booking")!;
    expect(ot.sample_count).toBe(3);
    expect(ot.success_count).toBe(2);
    expect(ot.failure_buckets.no_availability).toBe(1);
    const resy = out.get("Resy::restaurant_booking")!;
    expect(resy.sample_count).toBe(1);
    expect(resy.success_count).toBe(0);
    expect(resy.failure_buckets.captcha_or_bot_detection).toBe(1);
  });

  it("drops cases without a provider (would skew success_rate)", () => {
    const out = aggregateFromCases([
      makeCase({ provider: null, status: "succeeded" }),
      makeCase({ provider: "OpenTable", status: "succeeded" }),
    ]);
    expect(out.size).toBe(1);
    expect(out.get("OpenTable::restaurant_booking")?.sample_count).toBe(1);
  });

  it("drops non-finalised cases (pending / running / skipped)", () => {
    const out = aggregateFromCases([
      makeCase({ status: "pending" }),
      makeCase({ status: "running" }),
      makeCase({ status: "skipped" }),
      makeCase({ status: "succeeded" }),
    ]);
    expect(out.get("OpenTable::restaurant_booking")?.sample_count).toBe(1);
  });

  it("computes duration sum + count only over cases that have duration", () => {
    const out = aggregateFromCases([
      makeCase({ duration_seconds: 10 }),
      makeCase({ duration_seconds: 20 }),
      makeCase({ duration_seconds: null }),
    ]);
    const b = out.get("OpenTable::restaurant_booking")!;
    expect(b.duration_count).toBe(2);
    expect(b.duration_sum).toBe(30);
  });

  it("tracks the LATEST timestamp across the group's samples", () => {
    const out = aggregateFromCases([
      makeCase({ completed_at: "2026-05-10T00:00:00.000Z" }),
      makeCase({ completed_at: "2026-05-15T00:00:00.000Z" }),
      makeCase({ completed_at: "2026-05-12T00:00:00.000Z" }),
    ]);
    const b = out.get("OpenTable::restaurant_booking")!;
    expect(b.last_seen_at).toBe("2026-05-15T00:00:00.000Z");
  });

  it("handles multiple distinct failure_reasons in the same bucket", () => {
    const out = aggregateFromCases([
      makeCase({ status: "failed", success: false, failure_reason: "no_availability" }),
      makeCase({ status: "failed", success: false, failure_reason: "no_availability" }),
      makeCase({ status: "failed", success: false, failure_reason: "captcha_or_bot_detection" }),
    ]);
    const b = out.get("OpenTable::restaurant_booking")!;
    expect(b.failure_buckets.no_availability).toBe(2);
    expect(b.failure_buckets.captcha_or_bot_detection).toBe(1);
  });
});

// ─── summarise ──────────────────────────────────────────────────────────────

describe("summarise", () => {
  function makeRow(overrides: Partial<ProviderSkillRow> = {}): ProviderSkillRow {
    return {
      provider: "OpenTable",
      task_type: "restaurant_booking",
      sample_count: 0,
      success_count: 0,
      failure_buckets: {},
      avg_duration_s: null,
      last_seen_at: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it("returns success_rate=null when sample_count=0 (avoid 0/0)", () => {
    const out = summarise(makeRow());
    expect(out.success_rate).toBeNull();
  });

  it("computes success_rate = success_count / sample_count", () => {
    const out = summarise(
      makeRow({ sample_count: 5, success_count: 3 }),
    );
    expect(out.success_rate).toBeCloseTo(0.6, 5);
  });

  it("picks top_failure_reason by count", () => {
    const out = summarise(
      makeRow({
        sample_count: 10,
        success_count: 6,
        failure_buckets: {
          no_availability: 3,
          captcha_or_bot_detection: 1,
        },
      }),
    );
    expect(out.top_failure_reason).toBe("no_availability");
  });

  it("returns null top_failure_reason when no failures recorded", () => {
    const out = summarise(makeRow({ sample_count: 5, success_count: 5 }));
    expect(out.top_failure_reason).toBeNull();
  });
});
