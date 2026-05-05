import { describe, it, expect } from "vitest";
import { deepLinkExecutor } from "@/lib/booking-autopilot/executors/deep-link-executor";
import { mapBrowserStatus } from "@/lib/booking-autopilot/executors/stagehand-adapter";
import { buildDeepLinkEnrichmentForStep } from "@/lib/booking-autopilot/executors/enrich-failed-step";
import type { BookingJobStep } from "@/lib/db";
import type { RestaurantConstraints } from "@/lib/booking-jobs/types";

// ─── DeepLinkExecutor — canHandle ───────────────────────────────────────────

describe("deepLinkExecutor.canHandle", () => {
  const restaurantConstraints: RestaurantConstraints = {
    task_type: "restaurant_booking",
    city: "New York",
    date: "2026-05-12",
    time: "19:00",
    party_size: 2,
    restaurant_name: "L'Artusi",
  };

  it("can handle restaurant_booking constraints", async () => {
    const cap = await deepLinkExecutor.canHandle({
      constraints: restaurantConstraints,
    });
    expect(cap.can).toBe(true);
  });

  it("rejects when no constraints + no browserTask", async () => {
    const cap = await deepLinkExecutor.canHandle({});
    expect(cap.can).toBe(false);
    expect(cap.reason).toMatch(/constraints|browserTask/);
  });

  it("rejects non-restaurant task types in this phase", async () => {
    const cap = await deepLinkExecutor.canHandle({
      constraints: { task_type: "hotel_booking" },
    });
    expect(cap.can).toBe(false);
    expect(cap.reason).toContain("restaurant_booking");
  });

  it("rejects when only browserTask given (no constraints)", async () => {
    const cap = await deepLinkExecutor.canHandle({
      browserTask: {
        startUrl: "https://opentable.com/x",
        task: "Book it",
        profile: { first_name: "", last_name: "", email: "", phone: "" },
        jobId: "j",
        stepIndex: 0,
      },
    });
    expect(cap.can).toBe(false);
  });
});

// ─── DeepLinkExecutor — run ─────────────────────────────────────────────────

describe("deepLinkExecutor.run", () => {
  const constraints: RestaurantConstraints = {
    task_type: "restaurant_booking",
    city: "New York",
    date: "2026-05-12",
    time: "19:00",
    party_size: 2,
    restaurant_name: "L'Artusi",
  };

  it("returns handoff_ready with a deep-link URL", async () => {
    const result = await deepLinkExecutor.run({ constraints });
    expect(result.status).toBe("handoff_ready");
    expect(result.handoff_url).toContain("opentable.com");
    expect(result.handoff_url).toContain("covers=2");
    expect(result.reason).toBe("deep_link_handoff");
  });

  it("uses browserTask.startUrl as platform hint when present", async () => {
    const result = await deepLinkExecutor.run({
      constraints,
      browserTask: {
        startUrl: "https://resy.com/cities/ny/don-angie",
        task: "Book it",
        profile: { first_name: "", last_name: "", email: "", phone: "" },
        jobId: "j",
        stepIndex: 0,
      },
    });
    expect(result.handoff_url).toContain("resy.com/cities/ny/don-angie");
    expect(result.message).toContain("Resy");
  });

  it("returns error status when constraints are wrong shape", async () => {
    const result = await deepLinkExecutor.run({
      constraints: { task_type: "hotel_booking" },
    });
    expect(result.status).toBe("error");
  });
});

// ─── stagehand-adapter status mapping ───────────────────────────────────────

describe("mapBrowserStatus", () => {
  it("maps known browser statuses 1:1 onto executor statuses", () => {
    expect(mapBrowserStatus("completed")).toBe("completed");
    expect(mapBrowserStatus("paused_payment")).toBe("paused_payment");
    expect(mapBrowserStatus("needs_login")).toBe("needs_login");
    expect(mapBrowserStatus("captcha")).toBe("captcha");
    expect(mapBrowserStatus("no_availability")).toBe("no_availability");
    expect(mapBrowserStatus("error")).toBe("error");
  });
});

// ─── buildDeepLinkEnrichmentForStep ─────────────────────────────────────────

describe("buildDeepLinkEnrichmentForStep", () => {
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
      },
      fallbackUrl: "https://www.opentable.com/lartusi",
      status: "error",
      ...overrides,
    };
  }

  it("returns null for non-restaurant steps", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({ type: "hotel" }),
      "msg",
    );
    expect(out).toBeNull();
  });

  it("returns null when restaurant_name is missing", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { date: "2026-05-12", time: "19:00", covers: 2 } }),
      "msg",
    );
    expect(out).toBeNull();
  });

  it("returns null when date or time is missing", () => {
    const noDate = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { restaurantName: "X", time: "19:00", covers: 2 } }),
      "msg",
    );
    expect(noDate).toBeNull();
    const noTime = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { restaurantName: "X", date: "2026-05-12", covers: 2 } }),
      "msg",
    );
    expect(noTime).toBeNull();
  });

  it("returns deep-link enrichment when all fields present", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { ...makeStep().body, startUrl: "https://www.opentable.com/lartusi" } }),
      "Auto-booking failed. Tap to continue manually:",
    );
    expect(out).not.toBeNull();
    expect(out!.handoff_url).toContain("opentable.com/lartusi");
    expect(out!.handoff_url).toContain("covers=2");
    expect(out!.actionItem.message).toBe("Auto-booking failed. Tap to continue manually:");
    expect(out!.actionItem.options).toHaveLength(1);
    expect(out!.actionItem.options[0].label).toBe("Continue on OpenTable");
  });

  it("uses platform-specific label (Resy)", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { ...makeStep().body, startUrl: "https://resy.com/cities/ny/don-angie" } }),
      "msg",
    );
    expect(out!.actionItem.options[0].label).toBe("Continue on Resy");
  });

  it("preserves Resy venue detail links with Resy time query format", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { ...makeStep().body, startUrl: "https://resy.com/cities/new-york-ny/venues/charlie-bird" } }),
      "msg",
    );

    expect(out!.handoff_url).toContain("resy.com/cities/new-york-ny/venues/charlie-bird");
    expect(out!.handoff_url).toContain("date=2026-05-12");
    expect(out!.handoff_url).toContain("seats=2");
    expect(out!.handoff_url).toContain("time=1900");
  });

  it("uses a current Resy city search fallback with date seats and time", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({ body: { ...makeStep().body, startUrl: "https://resy.com/cities/new-york-ny" } }),
      "msg",
    );

    expect(out!.handoff_url).toContain("resy.com/cities/new-york-ny?");
    expect(out!.handoff_url).toContain("date=2026-05-12");
    expect(out!.handoff_url).toContain("seats=2");
    expect(out!.handoff_url).toContain("time=1900");
    expect(out!.handoff_url).toContain("query=L%27Artusi");
  });

  it("defaults party_size to 2 when covers is not a number", () => {
    const out = buildDeepLinkEnrichmentForStep(
      makeStep({
        body: {
          restaurantName: "X",
          city: "New York",
          date: "2026-05-12",
          time: "19:00",
          covers: "two" as unknown as number,
        },
      }),
      "msg",
    );
    expect(out!.handoff_url).toContain("covers=2");
  });
});
