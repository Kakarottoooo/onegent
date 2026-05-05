import { describe, expect, it, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return {
    ...actual,
    createApiKey: vi.fn(),
  };
});

import {
  classifyResult,
  inferFailureTaxonomy,
} from "../../scripts/run-phase0-resy-benchmark";

const testCase = {
  id: "R-030",
  prompt: "Charlie Bird next Friday 8pm 2",
  restaurantName: "Charlie Bird",
  city: "New York",
  resySlug: "charlie-bird",
  date: "2026-05-08",
  time: "20:00",
  covers: 2,
  fallbackPolicy: { time_window_minutes: 60 },
  expectedOutcomes: ["ready_for_confirmation"],
  acceptableFailureTaxonomy: ["F-AVAIL-NONE"],
  severeTripwires: [],
};

describe("Phase 0 Resy benchmark classifier", () => {
  it("classifies API-key backend failures as infra auth, not availability", () => {
    expect(
      inferFailureTaxonomy(
        undefined,
        '503 Service Unavailable: {"error":{"code":"auth_backend_unavailable","message":"Unable to verify API key right now."}}',
        false,
      ),
    ).toBe("F-INFRA-AUTH");
  });

  it("classifies listing/date-selection stalls as DOM/data failures before no_availability", () => {
    const result = classifyResult(
      testCase as never,
      {
        task: {
          id: "task-r030",
          state: "failed",
          currentBookingJobId: "job-r030",
          terminalCode: "no_availability",
          terminalReason: "No matching availability was found for the requested booking.",
        },
      },
      {
        events: [
          {
            type: "execution_finished",
            data: {
              summary:
                "Final state check concluded the run was still on a listing/date-selection page. slot clicked - yielding to stage reassessment",
            },
          },
        ],
      },
      Date.now(),
      false,
    );

    expect(result.outcome).toBe("failed_with_clear_reason");
    expect(result.taxonomyCode).toBe("F-DATA-DOM");
  });

  it("keeps true provider no-availability in the no_availability_correct bucket", () => {
    const result = classifyResult(
      testCase as never,
      {
        task: {
          id: "task-sold-out",
          state: "failed",
          currentBookingJobId: "job-sold-out",
          terminalCode: "no_availability",
          terminalReason: "No availability slots were returned by the provider.",
        },
      },
      { events: [] },
      Date.now(),
      false,
    );

    expect(result.outcome).toBe("no_availability_correct");
    expect(result.taxonomyCode).toBe("F-AVAIL-NONE");
  });
});
