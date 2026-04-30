import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BookingJob } from "@/lib/db";

// ─── Mocks ──────────────────────────────────────────────────────────────────
// Mock both the API-key auth gate (always allow in tests) and the DB layer
// so the route handlers can be exercised without a real Postgres / API key.

const mockRequireApiKey = vi.fn();
vi.mock("@/lib/api-auth/require-api-key", () => ({
  requireApiKey: (...args: unknown[]) => mockRequireApiKey(...args),
}));

const mockGetBookingJob = vi.fn();
const mockApplyBookingJobModification = vi.fn();
const mockDeleteBookingJob = vi.fn();
const mockDeleteMonitorsByJobId = vi.fn();
const mockClearDecisionRoom = vi.fn();

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    getBookingJob: (...args: unknown[]) => mockGetBookingJob(...args),
    applyBookingJobModification: (...args: unknown[]) => mockApplyBookingJobModification(...args),
    deleteBookingJob: (...args: unknown[]) => mockDeleteBookingJob(...args),
    deleteMonitorsByJobId: (...args: unknown[]) => mockDeleteMonitorsByJobId(...args),
    clearDecisionRoomBookingJobByJobId: (...args: unknown[]) => mockClearDecisionRoom(...args),
  };
});

// Mock global fetch for the continue route's fire-and-forget
const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
vi.stubGlobal("fetch", fetchMock);

import { POST as modifyPOST } from "@/app/api/v1/execution-jobs/[jobId]/modify/route";
import { POST as cancelPOST } from "@/app/api/v1/execution-jobs/[jobId]/cancel/route";
import { POST as continuePOST } from "@/app/api/v1/execution-jobs/[jobId]/continue/route";

function fakeJob(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: "job-x",
    session_id: "sess-x",
    user_id: "user-x",
    trip_label: "Dinner",
    status: "failed",
    steps: [
      {
        type: "restaurant",
        emoji: "🍽️",
        label: "L'Artusi",
        apiEndpoint: "/api/booking-autopilot/universal",
        body: {
          restaurantName: "L'Artusi",
          city: "New York",
          date: "2026-05-12",
          time: "19:00",
          covers: 2,
        },
        fallbackUrl: "https://www.opentable.com/lartusi",
        status: "failed",
        decisionLog: [],
      },
    ],
    autonomy_settings: null,
    plan_version: 1,
    constraints: null,
    policy: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function fakeReq(body?: unknown): import("next/server").NextRequest {
  return {
    json: async () => body ?? {},
    nextUrl: new URL("http://localhost/api/v1/execution-jobs/job-x"),
  } as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiKey.mockResolvedValue({ ok: true, context: { allowedJobTypes: null } });
});

// ─── modify ─────────────────────────────────────────────────────────────────

describe("POST /api/v1/execution-jobs/[jobId]/modify", () => {
  it("returns 200 with planVersion bump for a valid patch", async () => {
    mockGetBookingJob.mockResolvedValue(fakeJob());
    mockApplyBookingJobModification.mockResolvedValue({ ...fakeJob(), status: "pending", plan_version: 2 });

    const res = await modifyPOST(
      fakeReq({ patch: { constraints: { time: "20:00" } } }),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.planVersion).toBe(2);
    expect(data.summary).toContain("time → 20:00");
  });

  it("returns 404 when job is not found", async () => {
    mockGetBookingJob.mockResolvedValue(null);
    const res = await modifyPOST(
      fakeReq({ patch: { constraints: { time: "20:00" } } }),
      { params: Promise.resolve({ jobId: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 when job is currently running", async () => {
    mockGetBookingJob.mockResolvedValue(fakeJob({ status: "running" }));
    const res = await modifyPOST(
      fakeReq({ patch: { constraints: { time: "20:00" } } }),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 on a malformed time", async () => {
    mockGetBookingJob.mockResolvedValue(fakeJob());
    const res = await modifyPOST(
      fakeReq({ patch: { constraints: { time: "8pm" } } }),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("invalid_patch");
  });

  it("returns 401-shaped response when API-key auth fails", async () => {
    mockRequireApiKey.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    });
    const res = await modifyPOST(
      fakeReq({}),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(401);
  });
});

// ─── cancel ─────────────────────────────────────────────────────────────────

describe("POST /api/v1/execution-jobs/[jobId]/cancel", () => {
  it("returns 200 + cascade-deletes monitors and DR links", async () => {
    mockGetBookingJob.mockResolvedValue(fakeJob({ status: "pending" }));
    mockDeleteBookingJob.mockResolvedValue(undefined);
    mockDeleteMonitorsByJobId.mockResolvedValue(undefined);
    mockClearDecisionRoom.mockResolvedValue(undefined);

    const res = await cancelPOST(
      fakeReq(),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cancelled).toBe(true);
    expect(data.priorStatus).toBe("pending");
    expect(mockDeleteMonitorsByJobId).toHaveBeenCalledWith("job-x");
    expect(mockClearDecisionRoom).toHaveBeenCalledWith("job-x");
    expect(mockDeleteBookingJob).toHaveBeenCalledWith("job-x");
  });

  it("returns 404 when job missing", async () => {
    mockGetBookingJob.mockResolvedValue(null);
    const res = await cancelPOST(
      fakeReq(),
      { params: Promise.resolve({ jobId: "missing" }) },
    );
    expect(res.status).toBe(404);
    expect(mockDeleteBookingJob).not.toHaveBeenCalled();
  });
});

// ─── continue ───────────────────────────────────────────────────────────────

describe("POST /api/v1/execution-jobs/[jobId]/continue", () => {
  it("returns 202 + fires fire-and-forget /start on a paused/failed job", async () => {
    mockGetBookingJob.mockResolvedValue(fakeJob({ status: "failed" }));
    fetchMock.mockClear();

    const res = await continuePOST(
      fakeReq(),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.triggered).toBe(true);
    expect(data.priorStatus).toBe("failed");

    // /start fetch must be initiated; we don't await it.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/booking-jobs/job-x/start");
  });

  it("returns 409 when job is already running (would be a duplicate trigger)", async () => {
    mockGetBookingJob.mockResolvedValue(fakeJob({ status: "running" }));
    fetchMock.mockClear();

    const res = await continuePOST(
      fakeReq(),
      { params: Promise.resolve({ jobId: "job-x" }) },
    );
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when job missing", async () => {
    mockGetBookingJob.mockResolvedValue(null);
    const res = await continuePOST(
      fakeReq(),
      { params: Promise.resolve({ jobId: "missing" }) },
    );
    expect(res.status).toBe(404);
  });
});
