import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BookingJob } from "@/lib/db";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// We mock both lib/db and lib/benchmark/store so the runner can be exercised
// without touching real Postgres. The integration test asserts the runner
// builds the right BookingJob shape, sets the dry_run flag, and dispatches
// /start via the injected fetch.

const mockCreateBookingJob = vi.fn();
const mockGetBookingJob = vi.fn();

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    createBookingJob: (...args: Parameters<typeof actual.createBookingJob>) =>
      mockCreateBookingJob(...args),
    getBookingJob: (...args: Parameters<typeof actual.getBookingJob>) =>
      mockGetBookingJob(...args),
  };
});

const mockCreateRun = vi.fn();
const mockCreateCase = vi.fn();
const mockUpdateCase = vi.fn();
const mockSetRunStatus = vi.fn();
const mockSummarize = vi.fn();
const mockGetCases = vi.fn();
const mockGetRun = vi.fn();

vi.mock("@/lib/benchmark/store", () => ({
  createBenchmarkRun: (...args: unknown[]) => mockCreateRun(...args),
  createBenchmarkCase: (...args: unknown[]) => mockCreateCase(...args),
  updateBenchmarkCase: (...args: unknown[]) => mockUpdateCase(...args),
  setBenchmarkRunStatus: (...args: unknown[]) => mockSetRunStatus(...args),
  summarizeBenchmarkRun: (...args: unknown[]) => mockSummarize(...args),
  getBenchmarkCases: (...args: unknown[]) => mockGetCases(...args),
  getBenchmarkRun: (...args: unknown[]) => mockGetRun(...args),
}));

// Import AFTER mocks so the module pulls the mocked dependencies.
import {
  caseToBookingStep,
  dispatchBenchmarkCase,
  resolveBenchmarkCase,
  runRestaurantBenchmark,
} from "@/lib/benchmark/run-restaurant-benchmark";
import type {
  BenchmarkCaseRow,
  RestaurantBenchmarkCase,
} from "@/lib/benchmark/types";

const FIXTURE_CASE: RestaurantBenchmarkCase = {
  case_id: "test_case_001",
  city: "New York",
  restaurant_name: "L'Artusi",
  restaurant_url: "https://www.opentable.com/lartusi",
  expected_provider: "OpenTable",
  date: "2026-05-12",
  time: "19:00",
  party_size: 2,
};

function makeCaseRow(overrides: Partial<BenchmarkCaseRow> = {}): BenchmarkCaseRow {
  return {
    id: "case-row-id-1",
    run_id: "run-id-1",
    case_id: "test_case_001",
    task_payload: FIXTURE_CASE,
    mode: "dry_run",
    booking_job_id: null,
    provider: null,
    executor: null,
    status: "pending",
    success: false,
    failure_reason: null,
    fallback_attempted: false,
    fallback_success: false,
    payment_stop_triggered: false,
    human_handoff_required: false,
    duration_seconds: null,
    audit: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── caseToBookingStep ──────────────────────────────────────────────────────

describe("caseToBookingStep", () => {
  it("maps a restaurant case to a BookingJobStep with all required body fields", () => {
    const step = caseToBookingStep(FIXTURE_CASE);
    expect(step.type).toBe("restaurant");
    expect(step.apiEndpoint).toBe("/api/booking-autopilot/universal");
    expect(step.status).toBe("pending");

    const body = step.body as Record<string, unknown>;
    expect(body.restaurantName).toBe("L'Artusi");
    expect(body.city).toBe("New York");
    expect(body.date).toBe("2026-05-12");
    expect(body.time).toBe("19:00");
    expect(body.covers).toBe(2);
    expect(body.startUrl).toBe("https://www.opentable.com/lartusi");
  });

  it("falls back to an OpenTable search URL when restaurant_url is missing", () => {
    const step = caseToBookingStep({
      ...FIXTURE_CASE,
      restaurant_url: undefined,
    });
    const body = step.body as Record<string, unknown>;
    expect(body.startUrl).toBeUndefined();
    expect(step.fallbackUrl).toContain("opentable.com/s?term=");
    expect(step.fallbackUrl).toContain(encodeURIComponent("L'Artusi"));
  });
});

// ─── dispatchBenchmarkCase ──────────────────────────────────────────────────

describe("dispatchBenchmarkCase", () => {
  it("creates booking_job with benchmark_dry_run=true autonomy and fires /start", async () => {
    mockCreateBookingJob.mockResolvedValue({} as BookingJob);
    mockUpdateCase.mockResolvedValue(makeCaseRow());

    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    const caseRow = makeCaseRow();
    await dispatchBenchmarkCase({
      caseRow,
      mode: "dry_run",
      baseUrl: "http://localhost:3000",
      fetchFn,
    });

    // Booking job created with the right autonomy flag
    expect(mockCreateBookingJob).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateBookingJob.mock.calls[0][0];
    expect(createArgs.userId).toBeNull(); // anonymous → bypass quota
    expect(createArgs.tripLabel).toContain("Benchmark");
    expect(createArgs.steps).toHaveLength(1);
    expect(createArgs.steps[0].type).toBe("restaurant");
    expect(createArgs.autonomySettings.benchmark_dry_run).toBe(true);

    // benchmark_case row was updated with the booking_job_id + provider
    expect(mockUpdateCase).toHaveBeenCalledWith(
      caseRow.id,
      expect.objectContaining({
        status: "running",
        bookingJobId: createArgs.id,
        provider: "OpenTable",
        executor: "stagehand",
      }),
    );

    // /start was fired (we don't await it)
    // Give the fire-and-forget time to land in fetchFn:
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(
      `http://localhost:3000/api/booking-jobs/${createArgs.id}/start`,
    );
    expect(fetchFn.mock.calls[0][1]?.method).toBe("POST");
  });

  it("sets benchmark_dry_run=false when mode is full_commit", async () => {
    // (full_commit is rejected at runRestaurantBenchmark level, but
    // dispatchBenchmarkCase itself doesn't reject — it's a lower-level
    // primitive. Verify the flag flows correctly anyway.)
    mockCreateBookingJob.mockResolvedValue({} as BookingJob);
    mockUpdateCase.mockResolvedValue(makeCaseRow());
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await dispatchBenchmarkCase({
      caseRow: makeCaseRow(),
      mode: "full_commit",
      baseUrl: "http://localhost:3000",
      fetchFn,
    });

    const args = mockCreateBookingJob.mock.calls[0][0];
    expect(args.autonomySettings.benchmark_dry_run).toBe(false);
  });
});

// ─── resolveBenchmarkCase ───────────────────────────────────────────────────

describe("resolveBenchmarkCase", () => {
  it("classifies as succeeded when booking_job step has the boundary marker", async () => {
    mockGetBookingJob.mockResolvedValue({
      id: "job-1",
      session_id: "benchmark_run-1",
      user_id: null,
      trip_label: "Benchmark",
      status: "done",
      steps: [
        {
          type: "restaurant",
          status: "awaiting_confirmation",
          decisionLog: [
            { ts: "2026-05-12", type: "attempt", message: "[opentable] dry_run_boundary - submit click skipped (benchmark_dry_run=true)", outcome: "Executor trace" },
          ],
        },
      ],
      autonomy_settings: null,
      created_at: "2026-05-12T19:00:00.000Z",
      updated_at: "2026-05-12T19:00:30.000Z",
      completed_at: "2026-05-12T19:00:30.000Z",
    } as unknown as BookingJob);
    const finalised = makeCaseRow({ status: "succeeded", success: true });
    mockUpdateCase.mockResolvedValue(finalised);

    const caseRow = makeCaseRow({
      booking_job_id: "job-1",
      status: "running",
    });
    const result = await resolveBenchmarkCase(caseRow);

    expect(mockUpdateCase).toHaveBeenCalledTimes(1);
    const patch = mockUpdateCase.mock.calls[0][1];
    expect(patch.status).toBe("succeeded");
    expect(patch.success).toBe(true);
    expect(patch.finalize).toBe(true);
    expect(patch.durationSeconds).toBe(30); // 19:00:00 → 19:00:30
    expect(result.status).toBe("succeeded");
  });

  it("classifies as failed/no_availability when step.status=no_availability", async () => {
    mockGetBookingJob.mockResolvedValue({
      id: "job-2",
      session_id: "benchmark_run-1",
      user_id: null,
      trip_label: "Benchmark",
      status: "failed",
      steps: [
        {
          type: "restaurant",
          status: "no_availability",
          decisionLog: [],
        },
      ],
      autonomy_settings: null,
      created_at: "2026-05-12T19:00:00.000Z",
      updated_at: "2026-05-12T19:00:10.000Z",
      completed_at: "2026-05-12T19:00:10.000Z",
    } as unknown as BookingJob);
    mockUpdateCase.mockResolvedValue(makeCaseRow({ status: "failed" }));

    await resolveBenchmarkCase(
      makeCaseRow({ booking_job_id: "job-2", status: "running" }),
    );

    const patch = mockUpdateCase.mock.calls[0][1];
    expect(patch.status).toBe("failed");
    expect(patch.success).toBe(false);
    expect(patch.failureReason).toBe("no_availability");
  });

  it("is a no-op for already-finalised cases (idempotent)", async () => {
    const already = makeCaseRow({ status: "succeeded", success: true });
    const result = await resolveBenchmarkCase(already);
    expect(mockGetBookingJob).not.toHaveBeenCalled();
    expect(mockUpdateCase).not.toHaveBeenCalled();
    expect(result).toBe(already);
  });

  it("leaves a still-running job in 'running' state", async () => {
    mockGetBookingJob.mockResolvedValue({
      id: "job-3",
      status: "running",
      steps: [],
      session_id: "benchmark_run-1",
      user_id: null,
      trip_label: "Benchmark",
      autonomy_settings: null,
      created_at: "2026-05-12T19:00:00.000Z",
      updated_at: "2026-05-12T19:00:00.000Z",
      completed_at: null,
    } as unknown as BookingJob);

    const caseRow = makeCaseRow({ booking_job_id: "job-3", status: "running" });
    const result = await resolveBenchmarkCase(caseRow);
    expect(mockUpdateCase).not.toHaveBeenCalled();
    expect(result.status).toBe("running");
  });
});

// ─── runRestaurantBenchmark (top-level, integration) ────────────────────────

describe("runRestaurantBenchmark", () => {
  it("rejects full_commit mode", async () => {
    await expect(
      runRestaurantBenchmark({ name: "x", mode: "full_commit" }),
    ).rejects.toThrow(/full_commit/);
  });

  it("dispatches one case by default and returns run_id immediately", async () => {
    mockCreateRun.mockResolvedValue({
      id: "run-xyz",
      name: "x",
      city: "New York",
      scenario: "restaurant_booking",
      mode: "dry_run",
      total_cases: 0,
      success_cases: 0,
      status: "pending",
      notes: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    });
    mockCreateCase.mockResolvedValue(makeCaseRow());
    mockSetRunStatus.mockResolvedValue(undefined);
    mockUpdateCase.mockResolvedValue(makeCaseRow({ status: "running" }));
    mockSummarize.mockResolvedValue({
      run_id: "run-xyz",
      total: 1,
      by_status: { pending: 0, running: 1, succeeded: 0, failed: 0, skipped: 0, timed_out: 0 },
      by_failure_reason: {},
      success_rate: 0,
      avg_duration_seconds: null,
    });
    mockCreateBookingJob.mockResolvedValue({} as BookingJob);

    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    const result = await runRestaurantBenchmark({
      name: "smoke",
      mode: "dry_run",
      fetchFn,
      baseUrl: "http://localhost:3000",
    });

    expect(result.run_id).toBe("run-xyz");
    expect(result.dispatched).toBe(1);
    expect(result.status).toBe("running");
    expect(mockCreateCase).toHaveBeenCalledTimes(1);
    expect(mockCreateBookingJob).toHaveBeenCalledTimes(1);
  });
});
