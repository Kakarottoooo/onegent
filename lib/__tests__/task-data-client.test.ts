import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetTaskDataClientCachesForTests,
  fetchTaskDetail,
  fetchTaskList,
  invalidateTaskDetail,
  invalidateTaskList,
} from "@/app/tasks/task-data-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __resetTaskDataClientCachesForTests();
});

describe("task data client cache", () => {
  it("dedupes inflight compact list requests", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        jobs: [
          {
            id: "job-1",
            session_id: "session-1",
            user_id: null,
            trip_label: "Compact task",
            status: "running",
            created_at: "2026-05-06T00:00:00.000Z",
            updated_at: "2026-05-06T00:00:00.000Z",
            completed_at: null,
            step_count: 1,
            action_count: 0,
            done_count: 0,
            awaiting_confirmation_count: 0,
            adjusted_count: 0,
            replan_count: 0,
            active: true,
            completed: false,
            failed: false,
            workspace: "live",
            latest_status_label: "Agent working...",
            primary_step_type: "restaurant",
            primary_step_label: "Book",
            primary_step_status: "pending",
            provider: "opentable",
            scenario: "restaurant",
            own_share: null,
          },
        ],
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      fetchTaskList("session-1", { includeShare: true }),
      fetchTaskList("session-1", { includeShare: true }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a[0].id).toBe("job-1");
  });

  it("supports force refresh after mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [{ id: "old" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [{ id: "new" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchTaskList("session-1");
    invalidateTaskList("session-1");
    const second = await fetchTaskList("session-1", { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first[0].id).toBe("old");
    expect(second[0].id).toBe("new");
  });

  it("dedupes task detail by job id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        job: {
          id: "job-1",
          session_id: "session-1",
          user_id: null,
          trip_label: "Full detail",
          status: "done",
          steps: [{ status: "done", decisionLog: [{ type: "succeeded" }] }],
          autonomy_settings: null,
          plan_version: 1,
          constraints: null,
          policy: null,
          created_at: "2026-05-06T00:00:00.000Z",
          updated_at: "2026-05-06T00:00:00.000Z",
          completed_at: "2026-05-06T00:01:00.000Z",
        },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      fetchTaskDetail("job-1"),
      fetchTaskDetail("job-1"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.steps[0].decisionLog).toHaveLength(1);

    invalidateTaskDetail("job-1");
  });
});
