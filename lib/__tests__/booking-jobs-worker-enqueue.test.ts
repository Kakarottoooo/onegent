import { describe, expect, it } from "vitest";
import type { BookingJobStep } from "@/lib/db";
import { isCoreExecutionSource, PENDING_QUEUE_STATUS } from "@/lib/core/cend-adapter";
import {
  parseWorkerScenarioList,
  prepareWorkerQueueSteps,
} from "@/lib/booking-jobs/worker-enqueue";

function flightStep(overrides: Partial<BookingJobStep> = {}): BookingJobStep {
  return {
    type: "flight",
    emoji: "✈️",
    label: "Southwest MCO→BNA 2026-06-01",
    apiEndpoint: "/api/booking-jobs/start",
    status: "pending",
    body: {
      origin: "MCO",
      dest: "BNA",
      date: "2026-06-01",
      passengers: 1,
      cabinClass: "economy",
      targetAirline: "Southwest",
      targetDepartureTime: "08:50",
      targetFlightNumber: "WN 3084",
      targetPrice: 152,
      profileId: 42,
    },
    ...overrides,
  };
}

describe("parseWorkerScenarioList", () => {
  it("uses all supported scenarios when USE_WORKER_FOR is unset", () => {
    expect(parseWorkerScenarioList(undefined)).toEqual([
      "restaurant",
      "hotel",
      "flight",
      "activity",
    ]);
  });

  it("normalizes explicit worker scenario allowlists", () => {
    expect(parseWorkerScenarioList(" flight, hotel, all, * ")).toEqual([
      "flight",
      "hotel",
    ]);
  });
});

describe("prepareWorkerQueueSteps", () => {
  it("marks direct flight jobs and returns pending_local before /start can race", () => {
    const prepared = prepareWorkerQueueSteps([flightStep()], "flight");

    expect(prepared.shouldUseWorkerQueue).toBe(true);
    expect(prepared.status).toBe(PENDING_QUEUE_STATUS);
    expect(prepared.stampedCount).toBe(1);
    expect(isCoreExecutionSource(prepared.steps[0].body.__source)).toBe(true);
    expect(prepared.steps[0].body).toMatchObject({
      scenario: "flight",
      params: {
        origin: "MCO",
        dest: "BNA",
        date: "2026-06-01",
        passengers: 1,
        cabin_class: "economy",
        targetAirline: "Southwest",
        targetDepartureTime: "08:50",
        targetFlightNumber: "WN 3084",
      },
      profileId: 42,
    });
  });

  it("does not route a flight job into a hotel-only worker queue", () => {
    const prepared = prepareWorkerQueueSteps([flightStep()], "hotel");

    expect(prepared.shouldUseWorkerQueue).toBe(false);
    expect(prepared.status).toBeUndefined();
    expect(prepared.steps[0].body.__source).toBeUndefined();
  });

  it("keeps malformed flight steps on the existing non-worker path", () => {
    const prepared = prepareWorkerQueueSteps([
      flightStep({ body: { origin: "MCO" } }),
    ], "flight");

    expect(prepared.shouldUseWorkerQueue).toBe(false);
    expect(prepared.status).toBeUndefined();
    expect(prepared.steps[0].body).toEqual({ origin: "MCO" });
  });
});
