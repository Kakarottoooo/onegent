import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingJobSummary } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  getUserProfile: vi.fn(),
  listMyChatSessionRows: vi.fn(),
  listMyDecisionRoomSidebarRows: vi.fn(),
}));

vi.mock("@/lib/booking-jobs/read-model", async () => {
  const actual = await vi.importActual<typeof import("@/lib/booking-jobs/read-model")>(
    "@/lib/booking-jobs/read-model",
  );
  return {
    ...actual,
    getVisibleBookingJobSummaries: vi.fn(),
  };
});

import { getUserProfile, listMyChatSessionRows, listMyDecisionRoomSidebarRows } from "@/lib/db";
import { getVisibleBookingJobSummaries } from "@/lib/booking-jobs/read-model";
import { emptyAppBootstrapData, getAppBootstrapData } from "@/lib/app-bootstrap";

const mockedRooms = vi.mocked(listMyDecisionRoomSidebarRows);
const mockedSessions = vi.mocked(listMyChatSessionRows);
const mockedProfile = vi.mocked(getUserProfile);
const mockedJobs = vi.mocked(getVisibleBookingJobSummaries);

function job(overrides: Partial<BookingJobSummary> = {}): BookingJobSummary {
  return {
    id: "job-1",
    session_id: "session-1",
    user_id: "user-1",
    trip_label: "Test job",
    status: "pending",
    step_count: 1,
    action_count: 0,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("app bootstrap read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRooms.mockResolvedValue([]);
    mockedSessions.mockResolvedValue([]);
    mockedProfile.mockResolvedValue(null);
    mockedJobs.mockResolvedValue([]);
  });

  it("loads compact sidebar rows and recent booking job summaries in one payload", async () => {
    mockedRooms.mockResolvedValue([
      {
        id: "room-1",
        type: "restaurant",
        title: "Dinner",
        status: "collecting",
        creator_id: "user-1",
        flow: "chat",
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z",
        member_status: "joined",
      },
    ]);
    mockedSessions.mockResolvedValue([
      {
        id: "session-1",
        user_id: "user-1",
        title: "Nashville",
        upgraded_room_id: null,
        upgraded_plan_id: null,
        upgraded_trip_id: null,
        destination: "Nashville",
        scenario: "flight",
        completed_at: null,
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z",
      },
    ]);
    mockedJobs.mockResolvedValue([
      job({ id: "job-1", status: "running" }),
      job({ id: "job-2", trip_label: "Done", status: "done" }),
      job({ id: "job-3", trip_label: "Failed", status: "failed" }),
      job({ id: "job-4", trip_label: "Overflow", status: "pending" }),
    ]);
    mockedProfile.mockResolvedValue({
      user_id: "user-1",
      profile_code: "ABC123",
      username: "onegent",
      display_name: "Onegent User",
      avatar_url: null,
      bio: null,
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
    });

    const data = await getAppBootstrapData({ userId: "user-1", sessionId: "session-1" });

    expect(mockedRooms).toHaveBeenCalledWith("user-1", { includeInvited: true, limit: 40 });
    expect(mockedSessions).toHaveBeenCalledWith("user-1", 60);
    expect(mockedJobs).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      limit: 30,
      includeUserJobs: false,
    });
    expect(data.sidebar.rooms).toHaveLength(1);
    expect(data.sidebar.sessions).toHaveLength(1);
    expect(data.account_profile).toMatchObject({
      user_id: "user-1",
      profile_code: "ABC123",
      username: "onegent",
    });
    expect(data.recent_jobs.map((row) => row.id)).toEqual(["job-1", "job-2", "job-3"]);
    expect(data.booking_jobs_summary).toMatchObject({
      total: 4,
      active_count: 2,
      completed_count: 1,
      failed_count: 1,
    });
  });

  it("skips signed-in sidebar reads when no user is available", async () => {
    await getAppBootstrapData({ userId: null, sessionId: "session-1" });

    expect(mockedRooms).not.toHaveBeenCalled();
    expect(mockedSessions).not.toHaveBeenCalled();
    expect(mockedProfile).not.toHaveBeenCalled();
    expect(mockedJobs).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: null,
      limit: 30,
      includeUserJobs: false,
    });
  });

  it("keeps the bootstrap best effort when one source fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedRooms.mockRejectedValue(new Error("rooms unavailable"));
    mockedJobs.mockResolvedValue([job({ id: "job-1", status: "done" })]);

    const data = await getAppBootstrapData({ userId: "user-1", sessionId: "session-1" });

    expect(data.sidebar.rooms).toEqual([]);
    expect(data.recent_jobs).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("has a stable empty bootstrap shape", () => {
    expect(emptyAppBootstrapData()).toMatchObject({
      sidebar: { rooms: [], sessions: [] },
      account_profile: null,
      recent_jobs: [],
      booking_jobs_summary: { total: 0 },
    });
  });
});
