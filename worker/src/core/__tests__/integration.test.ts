/**
 * lib/core integration smoke tests.
 *
 * Exercises runExecutionJobWithRecovery end-to-end with runBrowserTask
 * stubbed. Covers the main failure/recovery paths that US-007a and
 * US-007b introduced: time fallback, provider chain, consent deny.
 *
 * Mocking strategy:
 *   - @/lib/booking-autopilot/stagehand-executor.runBrowserTask is the
 *     ONLY browser-touching function we mock, so every `vi.fn()` call
 *     represents one actual automation attempt.
 *   - @/lib/db audit + profile helpers are mocked with no-op / fixtures
 *     so tests don't touch Postgres.
 *
 * These are smoke tests, not exhaustive coverage — they verify the
 * control flow (who calls runBrowserTask with what, how many times)
 * rather than every branch. Exhaustive per-phase coverage lives in
 * validator.test.ts and belongs in future test files if we grow a
 * recovery.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

vi.mock("@/lib/booking-autopilot/stagehand-executor", () => ({
  runBrowserTask: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    writeAgentLog: vi.fn().mockResolvedValue(undefined),
    getAgentLogs: vi.fn().mockResolvedValue([]),
    getBookingProfileById: vi.fn().mockResolvedValue(null),
    getDefaultBookingProfile: vi.fn().mockResolvedValue(null),
  };
});

// Mock Resy slug helper (used by provider fallback chain)
vi.mock("@/lib/booking-autopilot/providers/resy-com", () => ({
  cityToResySlug: (city: string) =>
    city.toLowerCase().replace(/\s+/g, "-") || "nyc",
}));

// Mock Google Places tool (used by website fallback)
vi.mock("@/lib/tools", () => ({
  googlePlacesSearch: vi.fn().mockResolvedValue([]),
}));

import { runExecutionJobWithRecovery } from "../execution/recovery";
import type { ExecutionJobRequest } from "../execution/types";
import { runBrowserTask } from "@/lib/booking-autopilot/stagehand-executor";
import type {
  BookingProfile,
  BrowserTaskResult,
} from "@/lib/booking-autopilot/types";

const mockedRunBrowserTask = runBrowserTask as unknown as ReturnType<
  typeof vi.fn
>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROFILE: BookingProfile = {
  first_name: "Test",
  last_name: "User",
  email: "test@example.com",
  phone: "+15551234567",
};

const RESTAURANT_REQUEST: ExecutionJobRequest = {
  request: {
    scenario: "restaurant",
    params: {
      restaurant_name: "Le Bernardin",
      city: "New York",
      date: "2026-05-01",
      time: "19:00",
      covers: 2,
    },
  },
  profile: PROFILE,
};

function makeTaskResult(
  overrides: Partial<BrowserTaskResult> & Pick<BrowserTaskResult, "status">,
): BrowserTaskResult {
  return {
    handoffUrl: "https://opentable.com/confirmation/123",
    summary: "Mock result",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runExecutionJobWithRecovery · integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("single attempt success — paused_payment on first try", async () => {
    mockedRunBrowserTask.mockResolvedValueOnce(
      makeTaskResult({
        status: "paused_payment",
        summary: "Reached OpenTable payment page",
      }),
    );

    const result = await runExecutionJobWithRecovery(RESTAURANT_REQUEST, {
      jobId: "test-001",
      userId: null,
      stepIndex: 0,
    });

    expect(result.status).toBe("paused_payment");
    expect(result.attemptCount).toBe(1);
    expect(result.usedFallback).toBe(false);
    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(1);
  });

  it("transient error triggers retry, second attempt succeeds", async () => {
    mockedRunBrowserTask
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "error",
          summary: "Network glitch",
          error: "ECONNRESET",
        }),
      )
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "paused_payment",
          summary: "Reached payment page after retry",
        }),
      );

    const result = await runExecutionJobWithRecovery(RESTAURANT_REQUEST, {
      jobId: "test-002",
      userId: null,
      stepIndex: 0,
    });

    expect(result.status).toBe("paused_payment");
    expect(result.attemptCount).toBe(2);
    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(2);
  });

  it("consent.maxRetries=1 stops after first failure (no retry)", async () => {
    mockedRunBrowserTask.mockResolvedValue(
      makeTaskResult({
        status: "error",
        summary: "Always fails",
        error: "Persistent",
      }),
    );

    const result = await runExecutionJobWithRecovery(
      { ...RESTAURANT_REQUEST, consent: { maxRetries: 1 } },
      { jobId: "test-003", userId: null, stepIndex: 0 },
    );

    expect(result.status).toBe("error");
    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(1);
  });

  it("no_availability triggers time fallback (Phase 2)", async () => {
    // First attempt: no slot at 19:00
    // Second attempt: found slot at 19:30
    mockedRunBrowserTask
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "no_availability",
          summary: "No slots near 7:00 PM at Le Bernardin",
        }),
      )
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "paused_payment",
          summary: "Booked at 7:30 PM",
        }),
      );

    const result = await runExecutionJobWithRecovery(RESTAURANT_REQUEST, {
      jobId: "test-004",
      userId: null,
      stepIndex: 0,
    });

    expect(result.status).toBe("paused_payment");
    expect(result.usedFallback).toBe(true);
    expect(mockedRunBrowserTask.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The second call must have a different time in its BrowserTaskInput.task
    // (verifying Phase 2 actually mutated the request).
    const firstCallTask = mockedRunBrowserTask.mock.calls[0][0].task as string;
    const secondCallTask = mockedRunBrowserTask.mock.calls[1][0].task as string;
    expect(firstCallTask).not.toBe(secondCallTask);
  });

  it("allowTimeAdjustment=false skips Phase 2 but Phase 3 provider chain still runs", async () => {
    // Phase 2 and Phase 3 are INDEPENDENT consent dimensions — disabling
    // time adjustment shouldn't auto-disable provider fallback. To disable
    // both, callers set allowTimeAdjustment=false AND blockedProviders=[...].
    //
    // Here:
    //   Phase 1: OpenTable returns no_availability (no slots near 7pm)
    //   Phase 2: SKIPPED by allowTimeAdjustment=false
    //   Phase 3: Resy attempted (not blocked), also fails
    //   → result: no_availability, 2 runBrowserTask calls (OpenTable + Resy)
    mockedRunBrowserTask
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "no_availability",
          summary: "No slots near 7:00 PM at Le Bernardin",
        }),
      )
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "no_availability",
          summary: "Not found on Resy",
        }),
      );

    const result = await runExecutionJobWithRecovery(
      { ...RESTAURANT_REQUEST, consent: { allowTimeAdjustment: false } },
      { jobId: "test-005", userId: null, stepIndex: 0 },
    );

    expect(result.status).toBe("no_availability");
    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(2);
    // First call = OpenTable (primary), second = Resy (Phase 3 fallback)
    const firstUrl = mockedRunBrowserTask.mock.calls[0][0].startUrl as string;
    const secondUrl = mockedRunBrowserTask.mock.calls[1][0].startUrl as string;
    expect(firstUrl).toContain("opentable.com");
    expect(secondUrl).toContain("resy.com");
  });

  it("allowTimeAdjustment=false AND blockedProviders blocks everything past Phase 1", async () => {
    // To truly skip all fallback, caller must pin both dimensions.
    mockedRunBrowserTask.mockResolvedValueOnce(
      makeTaskResult({
        status: "no_availability",
        summary: "No slots near 7:00 PM",
      }),
    );

    const result = await runExecutionJobWithRecovery(
      {
        ...RESTAURANT_REQUEST,
        consent: {
          allowTimeAdjustment: false,
          blockedProviders: ["resy-com", "website-generic"],
        },
      },
      { jobId: "test-005b", userId: null, stepIndex: 0 },
    );

    expect(result.status).toBe("no_availability");
    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(1);
  });

  it('"not found on OpenTable" skips Phase 2, enters Phase 3 provider chain', async () => {
    // Phase 1: OpenTable reports venue not indexed.
    // Phase 3: Resy also fails to find it. Website fallback has no Places data.
    mockedRunBrowserTask
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "no_availability",
          summary: "Not found on OpenTable — venue not indexed",
        }),
      )
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "no_availability",
          summary: "Not found on Resy",
        }),
      );

    const result = await runExecutionJobWithRecovery(RESTAURANT_REQUEST, {
      jobId: "test-006",
      userId: null,
      stepIndex: 0,
    });

    // Phase 3 tried (Resy call visible) but failed, so we return phase1 result.
    expect(mockedRunBrowserTask.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The second call should be to Resy (different startUrl)
    const firstUrl = mockedRunBrowserTask.mock.calls[0][0].startUrl as string;
    const secondUrl = mockedRunBrowserTask.mock.calls[1][0].startUrl as string;
    expect(firstUrl).toContain("opentable.com");
    expect(secondUrl).toContain("resy.com");
    expect(result.status).toBe("no_availability");
  });

  // ── US-W5: error-status escalation to Phase 3 ──────────────────────────────
  // Carbone / Le Bernardin / Osteria La Baia / Ci Siamo class of failures:
  // venue appears in OpenTable search but uses a non-OpenTable booking system,
  // so the executor returns status="error" (not "no_availability") with summaries
  // matching shouldTryProviderFallback's whitelist. Without US-W5 these would
  // never have triggered the Resy fallback.

  it('status="error" + "Stalled at listing" triggers Phase 3 (US-W5 fix)', async () => {
    // Phase 1: OpenTable agent gets stuck at the venue's detail page because
    // the booking widget is missing (venue uses its own platform).
    // Phase 3: Resy succeeds.
    // maxRetries=1 keeps Phase 1 to a single attempt — status="error" would
    // otherwise retry per RETRY_BACKOFF_MS table.
    mockedRunBrowserTask
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "error",
          summary: "The agent stopped before reaching the checkout form.",
          error: "Stalled at listing — couldn't advance past detail page",
        }),
      )
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "paused_payment",
          summary: "Reached payment page on Resy",
          handoffUrl: "https://resy.com/cities/ny/some-venue?payment=1",
        }),
      );

    const result = await runExecutionJobWithRecovery(
      { ...RESTAURANT_REQUEST, consent: { maxRetries: 1 } },
      { jobId: "test-w5-stalled", userId: null, stepIndex: 0 },
    );

    expect(mockedRunBrowserTask.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondUrl = mockedRunBrowserTask.mock.calls[1][0].startUrl as string;
    expect(secondUrl).toContain("resy.com");
    expect(result.status).toBe("paused_payment");
    expect(result.usedFallback).toBe(true);
  });

  it('status="error" + "Unverified checkout field" triggers Phase 3 (US-W5 fix)', async () => {
    // Phase 1: OpenTable agent landed on what looked like a payment page but
    // fields were not actually populated — final-outcome.ts:391-398's path.
    // Phase 3: Resy fails too; we return phase1 result.
    mockedRunBrowserTask
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "error",
          summary:
            "The agent appeared to finish, but guest/contact/card values were not verified in distinct checkout fields.",
          error: "Unverified checkout field values on final state.",
        }),
      )
      .mockResolvedValueOnce(
        makeTaskResult({
          status: "no_availability",
          summary: "Not found on Resy",
        }),
      );

    const result = await runExecutionJobWithRecovery(
      { ...RESTAURANT_REQUEST, consent: { maxRetries: 1 } },
      { jobId: "test-w5-unverified", userId: null, stepIndex: 0 },
    );

    expect(mockedRunBrowserTask.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondUrl = mockedRunBrowserTask.mock.calls[1][0].startUrl as string;
    expect(secondUrl).toContain("resy.com");
  });

  it('status="error" + HTTP 402 quota does NOT trigger Phase 3 (US-W5 fast-fail)', async () => {
    // Phase 1: LLM provider rejected the run for billing/quota reasons.
    // Phase 3 must NOT fire — Resy would hit the same quota wall and burn 2-3min
    // for nothing. shouldTryProviderFallback's blocklist catches this.
    mockedRunBrowserTask.mockResolvedValueOnce(
      makeTaskResult({
        status: "error",
        summary: "The automation provider rejected this run before the booking flow could finish.",
        error: "Quota/billing issue (HTTP 402) from anthropic. Check credits and retry.",
      }),
    );

    const result = await runExecutionJobWithRecovery(
      { ...RESTAURANT_REQUEST, consent: { maxRetries: 1 } },
      { jobId: "test-w5-quota", userId: null, stepIndex: 0 },
    );

    // Exactly ONE browser call — primary only, no Phase 3.
    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    expect(result.usedFallback).toBe(false);
  });

  it("does not retry provider quota/billing failures even when retry policy allows it", async () => {
    mockedRunBrowserTask.mockResolvedValueOnce(
      makeTaskResult({
        status: "error",
        summary: "The automation provider rejected this run before the booking flow could finish.",
        error:
          "Provider quota/billing issue (HTTP 402) from OpenAI (openai/gpt-4o-mini) via Stagehand.",
      }),
    );

    const result = await runExecutionJobWithRecovery(
      { ...RESTAURANT_REQUEST, consent: { maxRetries: 3 } },
      { jobId: "test-provider-quota-no-retry", userId: null, stepIndex: 0 },
    );

    expect(mockedRunBrowserTask).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    expect(result.attemptCount).toBe(1);
  });
});
