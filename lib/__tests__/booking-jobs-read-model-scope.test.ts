import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingJob, BookingJobSummary } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  getBookingJobsBySession: vi.fn(),
  getBookingJobsByUser: vi.fn(),
  getBookingJobSummariesBySession: vi.fn(),
  getBookingJobSummariesByUser: vi.fn(),
  getSharedArtifactsByRefs: vi.fn(),
}));

import {
  getBookingJobSummariesBySession,
  getBookingJobSummariesByUser,
  getBookingJobsBySession,
  getBookingJobsByUser,
} from "@/lib/db";
import {
  getVisibleBookingJobs,
  getVisibleBookingJobSummaries,
} from "@/lib/booking-jobs/read-model";

const sessionJobs = vi.mocked(getBookingJobsBySession);
const userJobs = vi.mocked(getBookingJobsByUser);
const sessionSummaries = vi.mocked(getBookingJobSummariesBySession);
const userSummaries = vi.mocked(getBookingJobSummariesByUser);

function job(id: string, sessionId: string): BookingJob {
  return {
    id,
    session_id: sessionId,
    user_id: "user-1",
    trip_label: id,
    status: "done",
    steps: [],
    autonomy_settings: null,
    created_at: `2026-05-05T00:00:0${id.endsWith("2") ? 2 : 1}.000Z`,
    updated_at: `2026-05-05T00:00:0${id.endsWith("2") ? 2 : 1}.000Z`,
    completed_at: null,
  } as BookingJob;
}

function summary(id: string, sessionId: string): BookingJobSummary {
  return {
    id,
    session_id: sessionId,
    user_id: "user-1",
    trip_label: id,
    status: "done",
    step_count: 1,
    action_count: 0,
    created_at: `2026-05-05T00:00:0${id.endsWith("2") ? 2 : 1}.000Z`,
    updated_at: `2026-05-05T00:00:0${id.endsWith("2") ? 2 : 1}.000Z`,
    completed_at: null,
  };
}

describe("booking job read-model session scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionJobs.mockResolvedValue([job("session-job", "session-a")]);
    userJobs.mockResolvedValue([job("user-job", "session-b")]);
    sessionSummaries.mockResolvedValue([summary("session-job", "session-a")]);
    userSummaries.mockResolvedValue([summary("user-job", "session-b")]);
  });

  it("can keep full job rows scoped to the active chat session", async () => {
    const rows = await getVisibleBookingJobs({
      sessionId: "session-a",
      userId: "user-1",
      includeUserJobs: false,
    });

    expect(rows.map((row) => row.id)).toEqual(["session-job"]);
    expect(userJobs).not.toHaveBeenCalled();
  });

  it("can keep compact summaries scoped to the active chat session", async () => {
    const rows = await getVisibleBookingJobSummaries({
      sessionId: "session-a",
      userId: "user-1",
      includeUserJobs: false,
    });

    expect(rows.map((row) => row.id)).toEqual(["session-job"]);
    expect(userSummaries).not.toHaveBeenCalled();
  });

  it("keeps workspace readers backward compatible by including user jobs by default", async () => {
    const rows = await getVisibleBookingJobSummaries({
      sessionId: "session-a",
      userId: "user-1",
    });

    expect(rows.map((row) => row.id)).toEqual(["session-job", "user-job"]);
    expect(userSummaries).toHaveBeenCalledWith("user-1", 20);
  });
});
