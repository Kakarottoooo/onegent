import { describe, expect, it } from "vitest";
import type { NluScenario } from "@/lib/agent/nlu-v2";
import type { NluCategory } from "@/lib/agent/nlu-v2/types";
import type { CaptureTravelObject } from "@/lib/capture/travel-object";
import { buildCaptureTaskBoundary } from "@/lib/capture/task-boundary";

const capturedAt = "2026-05-07T15:00:00.000Z";

function capture(overrides: Partial<CaptureTravelObject>): CaptureTravelObject {
  return {
    source: {
      type: "request",
      raw_text: "book this",
      captured_at: capturedAt,
    },
    classification: {
      scenario: "restaurant",
      categories: ["restaurant"],
      confidence: 0.92,
      direct_booking: false,
    },
    entities: {},
    constraints: {},
    missing_fields: [],
    possible_actions: [{ type: "create_task", label: "Create pending task" }],
    task_readiness: {
      ready: true,
      reason: "ready",
      next_missing_fields: [],
    },
    provenance: {
      parser: "nlu-v2",
    },
    ...overrides,
  };
}

describe("Capture -> task boundary", () => {
  it.each([
    {
      scenario: "restaurant",
      categories: ["restaurant"],
      entities: {
        restaurant: {
          city: "New York",
          date: "2026-06-01",
          time: "19:00",
          party_size: 2,
          cuisine: "Sichuan",
        },
      },
      expectedKind: "plan",
      expectedConstraint: ["party_size", 2],
    },
    {
      scenario: "hotel",
      categories: ["hotel"],
      entities: {
        hotel: {
          city: "New York",
          check_in: "2026-06-01",
          check_out: "2026-06-03",
          guests: 2,
          star_rating: 4,
        },
      },
      expectedKind: "plan",
      expectedConstraint: ["stars", 4],
    },
    {
      scenario: "flight",
      categories: ["flight"],
      entities: {
        flight: {
          origin: "MCO",
          dest: "BNA",
          date: "2026-06-01",
          passengers: 1,
          cabin_class: "economy",
        },
      },
      expectedKind: "plan",
      expectedConstraint: ["departure_date", "2026-06-01"],
    },
    {
      scenario: "activity",
      categories: ["activity"],
      entities: {
        activity: {
          event_name: "The Lion King",
          event_type: "theater",
          city: "New York",
          event_date: "2026-06-01",
          num_tickets: 1,
        },
      },
      expectedKind: "plan",
      expectedConstraint: ["num_tickets", 1],
    },
    {
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      entities: {
        trip: {
          destination_city: "Nashville",
          departure_city: "Orlando",
          start_date: "2026-06-01",
          end_date: "2026-06-04",
          travelers: 1,
          activities: [],
          cuisine_preferences: [],
          vibe: "mixed",
          planning_assumptions: [],
        },
      },
      expectedKind: "trip",
      expectedConstraint: ["destination_city", "Nashville"],
    },
  ] as Array<{
    scenario: NluScenario;
    categories: NluCategory[];
    entities: CaptureTravelObject["entities"];
    expectedKind: string;
    expectedConstraint: [string, unknown];
  }>)("builds a confirmation payload for complete $scenario captures", (row) => {
    const result = buildCaptureTaskBoundary(
      capture({
        source: {
          type: "request",
          raw_text: `complete ${row.scenario}`,
          captured_at: capturedAt,
        },
        classification: {
          scenario: row.scenario,
          categories: row.categories,
          confidence: 0.93,
          direct_booking: false,
        },
        entities: row.entities,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.nextAction).toBe("show_confirmation");
    expect(result.payload?.kind).toBe(row.expectedKind);
    expect(result.payload?.message).toBe(`complete ${row.scenario}`);
    expect(result.payload?.nlu.confirm_ready).toBe(true);
    expect(result.payload?.nlu.collected_constraints[row.expectedConstraint[0]]).toEqual(row.expectedConstraint[1]);
    expect(result.payload?.nlu.collected_constraints._capture_source).toMatchObject({
      original_input: `complete ${row.scenario}`,
      extraction_confidence: 0.93,
    });
  });

  it("does not build a task payload when required fields are missing", () => {
    const result = buildCaptureTaskBoundary(
      capture({
        classification: {
          scenario: "flight",
          categories: ["flight"],
          confidence: 0.9,
          direct_booking: false,
        },
        entities: {
          flight: {
            origin: "MCO",
            passengers: 1,
          },
        },
        missing_fields: ["dest", "date"],
        task_readiness: {
          ready: false,
          reason: "missing_fields",
          next_missing_fields: ["dest", "date"],
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.payload).toBeUndefined();
    expect(result.nextAction).toBe("ask_clarification");
    expect(result.missingFields).toEqual(expect.arrayContaining(["dest", "date"]));
  });

  it("keeps ambiguous multi-entity captures in review instead of creating a payload", () => {
    const result = buildCaptureTaskBoundary(
      capture({
        classification: {
          scenario: "restaurant",
          categories: ["restaurant", "activity"],
          confidence: 0.74,
          direct_booking: false,
        },
        entities: {
          restaurant: {
            city: "New York",
            date: "2026-06-01",
            time: "19:00",
            party_size: 2,
          },
          activity: {
            event_name: "Hamilton",
            city: "New York",
            event_date: "2026-06-01",
            num_tickets: 2,
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.nextAction).toBe("review_capture");
    expect(result.reason).toBe("multiple_capture_entities");
    expect(result.missingFields).toContain("scenario");
    expect(result.payload).toBeUndefined();
  });

  it("preserves URL, confidence, session id, and chat id in the confirmation payload", () => {
    const result = buildCaptureTaskBoundary(
      capture({
        source: {
          type: "url",
          raw_text: "https://www.booking.com/hotel/us/example.html",
          url: "https://www.booking.com/hotel/us/example.html",
          host: "www.booking.com",
          captured_at: capturedAt,
        },
        classification: {
          scenario: "hotel",
          categories: ["hotel"],
          confidence: 0.81,
          direct_booking: true,
        },
        entities: {
          hotel: {
            hotel_name: "Example Hotel",
            city: "New York",
            check_in: "2026-06-01",
            check_out: "2026-06-02",
            guests: 1,
          },
        },
        provenance: {
          parser: "url-parser",
          session_id: "sess_capture",
          chat_id: "chat_capture",
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.payload?.nlu.direct_booking).toBe(true);
    expect(result.payload?.capture_metadata).toEqual({
      original_input: "https://www.booking.com/hotel/us/example.html",
      source_type: "url",
      captured_at: capturedAt,
      extraction_confidence: 0.81,
      parser: "url-parser",
      url: "https://www.booking.com/hotel/us/example.html",
      host: "www.booking.com",
      source_session_id: "sess_capture",
      source_chat_id: "chat_capture",
    });
    expect(result.payload?.nlu.collected_constraints._capture_source).toEqual(result.payload?.capture_metadata);
  });

  it("runs a direct activity booking when the capture includes an exact Ticketmaster event URL", () => {
    const url = "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85";
    const result = buildCaptureTaskBoundary(
      capture({
        source: {
          type: "url",
          raw_text: `${url},帮我预定一下这个`,
          url,
          host: "www.ticketmaster.com",
          captured_at: capturedAt,
        },
        classification: {
          scenario: "activity",
          categories: ["activity"],
          confidence: 0.9,
          direct_booking: false,
        },
        entities: {
          activity: {
            event_name: "Nashville SC v DC United",
            event_type: "sports",
            city: "Nashville",
            event_date: "2026-05-09",
            num_tickets: 1,
          },
        },
        constraints: {
          source_url: url,
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.nextAction).toBe("run_direct_booking");
    expect(result.payload?.kind).toBe("plan");
    expect(result.payload?.nlu.direct_booking).toBe(true);
    expect(result.payload?.nlu.__v2_action).toMatchObject({
      type: "show_confirm_card",
      directBooking: true,
    });
    expect(result.payload?.nlu.collected_constraints).toMatchObject({
      event_name: "Nashville SC v DC United",
      event_date: "2026-05-09",
      source_url: url,
    });
  });

  it("allows exact Ticketmaster event URLs to run even when the extractor misses display fields", () => {
    const result = buildCaptureTaskBoundary(
      capture({
        source: {
          type: "url",
          raw_text: "https://www.ticketmaster.com/example/event/1B0063739937BB85",
          url: "https://www.ticketmaster.com/example/event/1B0063739937BB85",
          host: "www.ticketmaster.com",
          captured_at: capturedAt,
        },
        classification: {
          scenario: "activity",
          categories: ["activity"],
          confidence: 0.72,
          direct_booking: false,
        },
        entities: {
          activity: {
            event_name: "Ticketmaster event",
          },
        },
        constraints: {
          source_url: "https://www.ticketmaster.com/example/event/1B0063739937BB85",
        },
        missing_fields: ["city", "event_date", "num_tickets"],
        task_readiness: {
          ready: false,
          reason: "missing_fields",
          next_missing_fields: ["city", "event_date", "num_tickets"],
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.nextAction).toBe("run_direct_booking");
    expect(result.missingFields).toEqual([]);
  });
});
