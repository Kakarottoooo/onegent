import { describe, it, expect } from "vitest";
import {
  applyJobModification,
  deriveRestaurantConstraintsFromStep,
  ModifyForbiddenStateError,
  ModifyValidationError,
} from "@/lib/booking-jobs/modify";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import type { RestaurantConstraints } from "@/lib/booking-jobs/types";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<BookingJobStep> = {}): BookingJobStep {
  return {
    type: "restaurant",
    emoji: "🍽️",
    label: "L'Artusi",
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      restaurantName: "L'Artusi",
      city: "New York",
      date: "2026-05-12",
      time: "19:00",
      covers: 2,
      startUrl: "https://www.opentable.com/s?term=L%27Artusi&covers=2&dateTime=2026-05-12T19:00:00",
    },
    fallbackUrl: "https://www.opentable.com/lartusi",
    status: "failed",
    error: "no availability at 19:00",
    decisionLog: [
      { ts: "2026-05-12T19:00:00.000Z", type: "attempt", message: "tried 19:00", outcome: "no_availability" },
    ],
    ...overrides,
  };
}

function makeJob(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: "job-1",
    session_id: "session-1",
    user_id: "user-1",
    trip_label: "Dinner at L'Artusi",
    status: "failed",
    steps: [makeStep()],
    autonomy_settings: null,
    plan_version: 1,
    constraints: null,
    policy: null,
    created_at: "2026-05-12T18:00:00.000Z",
    updated_at: "2026-05-12T18:30:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

// ─── State guards ───────────────────────────────────────────────────────────

describe("applyJobModification — state guards", () => {
  it("rejects modification when job is running", () => {
    const job = makeJob({ status: "running" });
    expect(() =>
      applyJobModification(job, { constraints: { time: "20:00" } }),
    ).toThrow(ModifyForbiddenStateError);
  });

  it("rejects modification when job is done", () => {
    const job = makeJob({ status: "done" });
    expect(() =>
      applyJobModification(job, { constraints: { time: "20:00" } }),
    ).toThrow(ModifyForbiddenStateError);
  });

  it("allows modification when job is failed", () => {
    const job = makeJob({ status: "failed" });
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    expect(result.plan_version).toBe(2);
  });

  it("allows modification when job is pending", () => {
    const job = makeJob({ status: "pending" });
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    expect(result.plan_version).toBe(2);
  });
});

// ─── Patch validation ───────────────────────────────────────────────────────

describe("applyJobModification — patch validation", () => {
  const job = makeJob();

  it("rejects malformed time", () => {
    expect(() =>
      applyJobModification(job, { constraints: { time: "7pm" } }),
    ).toThrow(ModifyValidationError);
    expect(() =>
      applyJobModification(job, { constraints: { time: "25:00" } }),
    ).toThrow(ModifyValidationError);
  });

  it("rejects malformed date", () => {
    expect(() =>
      applyJobModification(job, { constraints: { date: "May 12" } }),
    ).toThrow(ModifyValidationError);
  });

  it("rejects party_size out of range", () => {
    expect(() =>
      applyJobModification(job, { constraints: { party_size: 0 } }),
    ).toThrow(ModifyValidationError);
    expect(() =>
      applyJobModification(job, { constraints: { party_size: 25 } }),
    ).toThrow(ModifyValidationError);
    expect(() =>
      applyJobModification(job, { constraints: { party_size: 2.5 } }),
    ).toThrow(ModifyValidationError);
  });

  it("rejects time_window not in {0,30,60,90}", () => {
    expect(() =>
      applyJobModification(job, { policy: { time_window_minutes: 45 as unknown as 0 } }),
    ).toThrow(ModifyValidationError);
  });

  it("accepts a no-op patch (empty)", () => {
    const result = applyJobModification(job, {});
    expect(result.plan_version).toBe(2);
    expect(result.summary).toBe("no-op patch");
  });
});

// ─── Constraint merging + step.body mirror (decision A: dual-write) ─────────

describe("applyJobModification — constraint merge + body mirror", () => {
  it("merges patched fields into existing constraints (preserves rest)", () => {
    const job = makeJob({
      constraints: {
        task_type: "restaurant_booking",
        city: "New York",
        date: "2026-05-12",
        time: "19:00",
        party_size: 2,
        restaurant_name: "L'Artusi",
        occasion: "date_night",
      },
    });
    const result = applyJobModification(job, {
      constraints: { time: "20:00" },
    });
    const c = result.constraints as RestaurantConstraints;
    expect(c.time).toBe("20:00");
    expect(c.party_size).toBe(2);                 // unchanged
    expect(c.restaurant_name).toBe("L'Artusi");   // unchanged
    expect(c.occasion).toBe("date_night");        // unchanged
  });

  it("mirrors patched constraints into step.body so executor reads new values", () => {
    const job = makeJob();
    const result = applyJobModification(job, {
      constraints: { time: "20:00", party_size: 4 },
    });
    const body = result.steps[0].body as Record<string, unknown>;
    expect(body.time).toBe("20:00");
    expect(body.covers).toBe(4); // body uses 'covers', constraint uses party_size
    expect(body.restaurantName).toBe("L'Artusi"); // unchanged
  });

  it("strips a stale URL-encoded startUrl when time/covers change", () => {
    const job = makeJob();
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    const body = result.steps[0].body as Record<string, unknown>;
    // Original startUrl encodes 19:00 — must be dropped so runUniversalStep
    // rebuilds the URL from the current body fields.
    expect(body.startUrl).toBeUndefined();
  });
});

// ─── Policy merging ─────────────────────────────────────────────────────────

describe("applyJobModification — policy merge", () => {
  it("seeds policy from autonomy_settings when null", () => {
    const job = makeJob({
      autonomy_settings: {
        autopilot: "smart",
        restaurant: { timeWindowMinutes: 90, allowVenueSwitch: true, latestTimeHHMM: "22:00", earliestTimeHHMM: "11:00", budgetFlexPct: 0, requireIndoor: false },
        hotel: { budgetFlexPct: 10, allowAreaSwitch: true, allowCrossRegion: false, minStarRating: 3, requireParking: false },
        flight: { departureFlexMinutes: 60, allowLayover: false, allowAlternateAirport: false },
        activity: { timeWindowMinutes: 60, allowVenueSwitch: true, requireIndoor: false },
      },
      policy: null,
    });
    const result = applyJobModification(job, {
      policy: { allow_platform_switch: true },
    });
    // Seeded from autonomy
    expect(result.policy.time_window_minutes).toBe(90);
    expect(result.policy.allow_venue_switch).toBe(true);
    // Patched
    expect(result.policy.allow_platform_switch).toBe(true);
  });

  it("merges into existing policy without losing other keys", () => {
    const job = makeJob({
      policy: {
        time_window_minutes: 60,
        allow_venue_switch: false,
        allow_platform_switch: false,
      },
    });
    const result = applyJobModification(job, {
      policy: { allow_venue_switch: true },
    });
    expect(result.policy.allow_venue_switch).toBe(true);
    expect(result.policy.allow_platform_switch).toBe(false); // unchanged
    expect(result.policy.time_window_minutes).toBe(60);      // unchanged
  });
});

// ─── Step reset (decision A: full reset) ────────────────────────────────────

describe("applyJobModification — step reset", () => {
  it("resets step.status to pending and clears transient fields", () => {
    const job = makeJob({
      status: "failed",
      steps: [
        makeStep({
          status: "error",
          error: "boom",
          handoff_url: "https://example.com/handoff",
          attemptCount: 3,
          usedFallback: true,
        }),
      ],
    });
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    const step = result.steps[0];
    expect(step.status).toBe("pending");
    expect(step.error).toBeUndefined();
    expect(step.handoff_url).toBeUndefined();
    expect(step.attemptCount).toBeUndefined();
    expect(step.usedFallback).toBeUndefined();
  });

  it("preserves prior decisionLog entries (history is kept, not erased)", () => {
    const job = makeJob();
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    const log = result.steps[0].decisionLog ?? [];
    // Prior 'attempt' entry must still be there (just appended, not replaced).
    expect(log.some((e) => e.type === "attempt" && e.message.includes("19:00"))).toBe(true);
  });
});

// ─── Audit log entry ────────────────────────────────────────────────────────

describe("applyJobModification — audit log", () => {
  it("appends a task_modified entry summarising the patch", () => {
    const job = makeJob();
    const result = applyJobModification(job, {
      constraints: { time: "20:00", party_size: 4 },
      policy: { time_window_minutes: 90 },
      message: "Pushed back an hour",
    });
    const entries = result.steps[0].decisionLog ?? [];
    const audit = entries.find((e) => e.type === "task_modified");
    expect(audit).toBeDefined();
    expect(audit?.message).toContain("time → 20:00");
    expect(audit?.message).toContain("party_size → 4");
    expect(audit?.message).toContain("time_window → 90m");
    expect(audit?.message).toContain("Pushed back an hour");
    expect(audit?.outcome).toBe("plan_version 1 → 2");
  });

  it("only appends to the FIRST step's decisionLog (not every step)", () => {
    const job = makeJob({
      steps: [
        makeStep({ decisionLog: [] }),
        makeStep({ decisionLog: [], type: "restaurant", label: "Step 2" }),
      ],
    });
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    const log0 = result.steps[0].decisionLog ?? [];
    const log1 = result.steps[1].decisionLog ?? [];
    expect(log0.some((e) => e.type === "task_modified")).toBe(true);
    expect(log1.some((e) => e.type === "task_modified")).toBe(false);
  });
});

// ─── Legacy job seeding (constraints=null) ──────────────────────────────────

describe("applyJobModification — legacy job seeding", () => {
  it("seeds constraints from step.body when job.constraints is null", () => {
    const job = makeJob({ constraints: null });
    const result = applyJobModification(job, { constraints: { time: "20:00" } });
    const c = result.constraints as RestaurantConstraints;
    expect(c.task_type).toBe("restaurant_booking");
    expect(c.restaurant_name).toBe("L'Artusi");
    expect(c.city).toBe("New York");
    expect(c.party_size).toBe(2);
    expect(c.time).toBe("20:00"); // from patch
  });
});

// ─── deriveRestaurantConstraintsFromStep ────────────────────────────────────

describe("deriveRestaurantConstraintsFromStep", () => {
  it("extracts known fields from step.body", () => {
    const c = deriveRestaurantConstraintsFromStep(makeStep());
    expect(c.task_type).toBe("restaurant_booking");
    expect(c.restaurant_name).toBe("L'Artusi");
    expect(c.party_size).toBe(2);
  });

  it("returns sane defaults when step.body is empty", () => {
    const c = deriveRestaurantConstraintsFromStep(makeStep({ body: {} }));
    expect(c.party_size).toBe(2);
    expect(c.restaurant_name).toBe("");
  });

  it("returns sane defaults when step is undefined", () => {
    const c = deriveRestaurantConstraintsFromStep(undefined);
    expect(c.task_type).toBe("restaurant_booking");
    expect(c.party_size).toBe(2);
  });
});
