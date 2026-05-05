import { describe, expect, it } from "vitest";

import { extractEvents } from "@/components/task-timeline/use-timeline-events";
import { describeSnapshotDiagnostics } from "@/components/task-timeline/use-snapshots";

describe("task timeline snapshot diagnostics", () => {
  it("explains a job/server mismatch when canonical snapshots 404 and compat is empty", () => {
    const message = describeSnapshotDiagnostics("job-123", {
      source: "compat",
      canonicalStatus: 404,
      compatStatus: 200,
      usedFallback: true,
    });

    expect(message).toContain("cannot find job job-123");
    expect(message).toContain("different local port, worktree, or database environment");
  });

  it("explains an attached job with no saved screenshots", () => {
    const message = describeSnapshotDiagnostics("job-123", {
      source: "canonical",
      canonicalStatus: 200,
      usedFallback: false,
    });

    expect(message).toContain("job is attached");
    expect(message).toContain("no browser screenshots");
  });

  it("does not show diagnostics when no job is selected", () => {
    const message = describeSnapshotDiagnostics(null, {
      source: "compat",
      canonicalStatus: 404,
      compatStatus: 200,
      usedFallback: true,
    });

    expect(message).toBeUndefined();
  });

  it("maps slim server task-timeline events without requiring full job payloads", () => {
    const events = extractEvents({
      events: [
        {
          id: "job-started",
          ts: "2026-05-05T07:17:02.795Z",
          kind: "job_started",
          title: "Task created",
          detail: "Navigating to opentable.com",
        },
        {
          id: "payment-required",
          ts: "2026-05-05T07:17:14.351Z",
          kind: "payment_required",
          title: "Waiting for final confirmation",
        },
      ],
      closed: true,
    });

    expect(events.map((event) => event.kind)).toEqual([
      "opened_site",
      "ready_for_confirmation",
    ]);
  });

  it("falls back to the job adapter when server timeline events are unknown", () => {
    const events = extractEvents({
      events: [
        {
          id: "job-started",
          ts: "2026-05-05T07:17:02.795Z",
          kind: "future_backend_kind",
          title: "Task created",
        },
      ],
      job: {
        status: "done",
        steps: [
          {
            type: "restaurant",
            status: "awaiting_confirmation",
            decisionLog: [
              {
                ts: "2026-05-05T07:17:14.351Z",
                type: "info",
                message: "Navigating to opentable.com",
              },
            ],
          },
        ],
      },
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.map((event) => event.kind)).toContain("ready_for_confirmation");
  });
});
