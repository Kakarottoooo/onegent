import { describe, expect, it } from "vitest";
import {
  buildActivityEventChoicePatch,
  parseActivityEventChoiceReply,
} from "@/lib/booking-jobs/activity-choice";
import { applyJobModification } from "@/lib/booking-jobs/modify";
import { ticketmasterProviderListingDecision } from "@/lib/booking-autopilot/providers/ticketmaster-rpa";
import type { BookingJob, BookingJobStep } from "@/lib/db";

const NOW = new Date("2026-05-07T12:00:00.000Z");

function makeActivityStep(overrides: Partial<BookingJobStep> = {}): BookingJobStep {
  return {
    type: "activity",
    emoji: "ticket",
    label: "Disney On Ice (Ticketmaster)",
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      activity_name: "Disney On Ice Presents",
      city: "",
      event_date: "",
      num_tickets: 1,
      provider: "ticketmaster",
      provider_page_type: "artist",
      startUrl: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
      task: "Start from this exact Ticketmaster artist page URL.",
    },
    fallbackUrl: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    status: "awaiting_confirmation",
    handoff_url: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    actionItem: {
      message: "Which event date, city, and showtime should I use from this provider page?",
      options: [],
    },
    decisionLog: [
      {
        ts: "2026-05-07T12:00:00.000Z",
        type: "succeeded",
        message: "Provider-start task has no target date/time; pausing for user event choice",
        outcome: "user_event_choice_required",
      },
    ],
    ...overrides,
  };
}

function makeActivityJob(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: "job-activity-choice",
    session_id: "session-1",
    user_id: "user-1",
    trip_label: "Disney On Ice Presents",
    status: "done",
    steps: [makeActivityStep()],
    autonomy_settings: null,
    plan_version: 3,
    constraints: null,
    policy: null,
    created_at: "2026-05-07T12:00:00.000Z",
    updated_at: "2026-05-07T12:01:00.000Z",
    completed_at: "2026-05-07T12:01:00.000Z",
    ...overrides,
  };
}

describe("parseActivityEventChoiceReply", () => {
  it("parses English date, time, and city replies", () => {
    expect(parseActivityEventChoiceReply("Sep 17 7pm Detroit", NOW)).toEqual({
      event_date: "2026-09-17",
      event_time: "19:00",
      city: "Detroit",
      missing_fields: [],
    });
  });

  it("parses Chinese month/day and evening time replies", () => {
    expect(parseActivityEventChoiceReply("9月17号 晚上7点 Detroit", NOW)).toEqual({
      event_date: "2026-09-17",
      event_time: "19:00",
      city: "Detroit",
      missing_fields: [],
    });
  });

  it("asks for a date when the reply only gives a city", () => {
    expect(parseActivityEventChoiceReply("Detroit please", NOW).missing_fields).toEqual([
      "event_date",
    ]);
  });
});

describe("activity provider-choice continuation", () => {
  it("keeps visible Ticketmaster choices when provider-start pages lack a target date", () => {
    const decision = ticketmasterProviderListingDecision([
      "Thu 7:00 PM Disney On Ice presents Find Your Hero Detroit, MI Little Caesars Arena Find Tickets",
      "Fri 11:00 AM Disney On Ice presents Find Your Hero Detroit, MI Little Caesars Arena Find Tickets",
    ], null);

    expect(decision.kind).toBe("no_target");
    expect(decision.question).toBe("Ticketmaster shows multiple visible events. Which one should I use?");
    expect(decision.matches).toHaveLength(2);
  });

  it("builds a modification patch from the user choice reply", () => {
    const result = buildActivityEventChoicePatch("Sep 17 7pm Detroit", makeActivityStep(), NOW);
    expect(result.ok).toBe(true);
    expect(result.patch?.constraints).toMatchObject({
      task_type: "activity_booking",
      event_date: "2026-09-17",
      event_time: "19:00",
      city: "Detroit",
    });
  });

  it("builds a modification patch from a clicked visible provider candidate", () => {
    const result = buildActivityEventChoicePatch(
      "Sep 17 7:00 PM Disney On Ice presents Find Your Hero Detroit, MI Little Caesars Arena",
      makeActivityStep(),
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(result.patch?.constraints).toMatchObject({
      task_type: "activity_booking",
      event_date: "2026-09-17",
      event_time: "19:00",
      city: "Detroit",
    });
  });

  it("allows a done provider-choice activity job to be updated and re-queued", () => {
    const job = makeActivityJob();
    const patch = buildActivityEventChoicePatch("Sep 17 7pm Detroit", job.steps[0], NOW).patch;
    expect(patch).toBeDefined();
    const result = applyJobModification(job, patch!);
    const step = result.steps[0];
    const body = step.body as Record<string, unknown>;

    expect(result.plan_version).toBe(4);
    expect(step.status).toBe("pending");
    expect(step.actionItem).toBeUndefined();
    expect(body.event_date).toBe("2026-09-17");
    expect(body.event_time).toBe("19:00");
    expect(body.time).toBe("19:00");
    expect(body.city).toBe("Detroit");
    expect(String(body.task)).toContain("The user selected date 2026-09-17, time 19:00, city Detroit");
  });
});
