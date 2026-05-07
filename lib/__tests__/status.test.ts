import { describe, expect, it } from "vitest";
import type { BookingJob } from "@/lib/db";
import {
  computeJobSemanticStatus,
  isActiveJobStatus,
  isQueuedJobStatus,
} from "@/lib/status";

function job(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: "job-1",
    session_id: "session-1",
    user_id: null,
    trip_label: "Frontier MCO→BNA 2026-06-01",
    status: "pending",
    steps: [
      {
        type: "flight",
        emoji: "✈️",
        label: "Frontier MCO→BNA 2026-06-01",
        apiEndpoint: "/api/booking-jobs/start",
        status: "pending",
        body: {},
      },
    ],
    autonomy_settings: null,
    plan_version: 1,
    constraints: null,
    policy: null,
    created_at: "2026-05-05T07:18:29.000Z",
    updated_at: "2026-05-05T07:18:29.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("job status helpers", () => {
  it("treats local worker queue rows as queued, not failed", () => {
    const queuedLocalJob = job({
      status: "pending_local" as BookingJob["status"],
    });

    expect(isQueuedJobStatus(queuedLocalJob.status)).toBe(true);
    expect(isActiveJobStatus(queuedLocalJob.status)).toBe(true);
    expect(computeJobSemanticStatus(queuedLocalJob)).toBe("pending");
  });

  it("does not collapse provider event-choice pauses into payment-ready status", () => {
    const needsChoice = job({
      status: "done",
      steps: [
        {
          type: "activity",
          emoji: "ticket",
          label: "Disney On Ice",
          apiEndpoint: "/api/booking-jobs/start",
          fallbackUrl: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
          status: "awaiting_confirmation",
          handoff_url: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
          body: {},
          actionItem: {
            message: "Which event date, city, and showtime should I use from this Ticketmaster page?",
            options: [],
          },
        },
      ],
    });

    expect(computeJobSemanticStatus(needsChoice)).toBe("blocked_needs_user_input");
  });
});
