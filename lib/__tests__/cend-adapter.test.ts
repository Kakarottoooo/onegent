import { describe, expect, it } from "vitest";
import type { BookingJobStep } from "@/lib/db";
import {
  isCoreExecutionSource,
  markStepForCore,
  PENDING_QUEUE_STATUS,
} from "@/lib/core/cend-adapter";
import { prepareWorkerQueueSteps } from "@/lib/booking-jobs/worker-enqueue";

const ticketmasterArtistUrl =
  "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV";

function activityStep(body: Record<string, unknown>): BookingJobStep {
  return {
    type: "activity",
    emoji: "ticket",
    label: "Activity",
    apiEndpoint: "/api/booking-jobs/start",
    status: "pending",
    body,
  };
}

describe("markStepForCore activity provider-start conversion", () => {
  it("allows Ticketmaster artist pages to start without city or event_date", () => {
    const marked = markStepForCore(
      activityStep({
        activity_name: "Lil Wayne",
        activity_id: "712214",
        num_tickets: 1,
        provider: "ticketmaster",
        provider_page_type: "artist",
        startUrl: ticketmasterArtistUrl,
        fallbackUrl: ticketmasterArtistUrl,
        task: "Start from this exact Ticketmaster artist page URL.",
      }),
    );

    expect(isCoreExecutionSource(marked.body.__source)).toBe(true);
    expect(marked.body).toMatchObject({
      scenario: "activity",
      startUrl: ticketmasterArtistUrl,
      params: {
        event_name: "Lil Wayne",
        city: "",
        event_date: "",
        num_tickets: 1,
        booking_link: ticketmasterArtistUrl,
        task: "Start from this exact Ticketmaster artist page URL.",
      },
    });
  });

  it("allows Ticketmaster event pages to use the provider page as source of city/date truth", () => {
    const eventUrl =
      "https://www.ticketmaster.com/nashville-sc-v-dc-united/event/1B0063739937BB85";
    const marked = markStepForCore(
      activityStep({
        activity_name: "Nashville SC v DC United",
        activity_id: "1B0063739937BB85",
        num_tickets: 1,
        provider: "ticketmaster",
        provider_page_type: "event",
        startUrl: eventUrl,
        task: "Use this exact Ticketmaster event URL.",
      }),
    );

    expect(marked.body).toMatchObject({
      scenario: "activity",
      params: {
        event_name: "Nashville SC v DC United",
        city: "",
        event_date: "",
        num_tickets: 1,
        booking_link: eventUrl,
      },
    });
  });

  it("keeps ordinary activity steps strict when city is missing", () => {
    expect(() =>
      markStepForCore(
        activityStep({
          activity_name: "Hamilton",
          event_date: "2026-05-30",
          num_tickets: 1,
          startUrl: "https://example.com/activity/hamilton",
        }),
      ),
    ).toThrow('markStepForCore: missing required string field "city"');
  });

  it("keeps ordinary activity steps strict when event_date is missing", () => {
    expect(() =>
      markStepForCore(
        activityStep({
          activity_name: "Hamilton",
          city: "New York",
          num_tickets: 1,
          startUrl: "https://example.com/activity/hamilton",
        }),
      ),
    ).toThrow('markStepForCore: missing required string field "event_date"');
  });
});

describe("prepareWorkerQueueSteps activity provider-start conversion", () => {
  it("queues Ticketmaster artist provider-start jobs instead of falling back to a 500-prone route path", () => {
    const prepared = prepareWorkerQueueSteps(
      [
        activityStep({
          activity_name: "Lil Wayne",
          activity_id: "712214",
          num_tickets: 1,
          provider: "ticketmaster",
          provider_page_type: "artist",
          startUrl: ticketmasterArtistUrl,
          task: "Start from this exact Ticketmaster artist page URL.",
        }),
      ],
      "activity",
    );

    expect(prepared.shouldUseWorkerQueue).toBe(true);
    expect(prepared.status).toBe(PENDING_QUEUE_STATUS);
    expect(prepared.stampedCount).toBe(1);
    expect(isCoreExecutionSource(prepared.steps[0].body.__source)).toBe(true);
    expect(prepared.steps[0].body).toMatchObject({
      scenario: "activity",
      params: {
        event_name: "Lil Wayne",
        city: "",
        event_date: "",
        booking_link: ticketmasterArtistUrl,
      },
    });
  });
});
