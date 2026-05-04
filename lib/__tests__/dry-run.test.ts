import { describe, it, expect, vi } from "vitest";
import {
  shouldStopForDryRun,
  DRY_RUN_BOUNDARY_MARKER,
} from "@/lib/booking-autopilot/dry-run";

// ─── shouldStopForDryRun: pure helper ───────────────────────────────────────
//
// This boundary is the ONE thing protecting against accidental real
// reservations during benchmark runs. It must err on the side of NOT
// triggering (default false on any malformed input), and it must trigger
// EXACTLY when the caller explicitly opts in.

describe("shouldStopForDryRun", () => {
  describe("returns false on missing / malformed input (default safe)", () => {
    it("undefined helpers", () => {
      expect(shouldStopForDryRun(undefined)).toBe(false);
    });

    it("null helpers", () => {
      expect(shouldStopForDryRun(null)).toBe(false);
    });

    it("primitive helpers (number)", () => {
      expect(shouldStopForDryRun(42)).toBe(false);
    });

    it("primitive helpers (string)", () => {
      expect(shouldStopForDryRun("benchmark_dry_run")).toBe(false);
    });

    it("array helpers", () => {
      expect(shouldStopForDryRun([{ benchmark_dry_run: true }])).toBe(false);
    });

    it("helpers without autonomy field", () => {
      expect(shouldStopForDryRun({ stagehand: {}, rawPage: {} })).toBe(false);
    });

    it("helpers.autonomy is null", () => {
      expect(shouldStopForDryRun({ autonomy: null })).toBe(false);
    });

    it("helpers.autonomy is undefined", () => {
      expect(shouldStopForDryRun({ autonomy: undefined })).toBe(false);
    });

    it("helpers.autonomy is a string", () => {
      expect(shouldStopForDryRun({ autonomy: "true" })).toBe(false);
    });

    it("helpers.autonomy.benchmark_dry_run is undefined", () => {
      expect(shouldStopForDryRun({ autonomy: {} })).toBe(false);
    });

    it("helpers.autonomy.benchmark_dry_run is false", () => {
      expect(shouldStopForDryRun({ autonomy: { benchmark_dry_run: false } })).toBe(false);
    });
  });

  describe("returns false on truthy-but-not-boolean values (no implicit dry_run)", () => {
    it("benchmark_dry_run = 1 (truthy number)", () => {
      expect(
        shouldStopForDryRun({ autonomy: { benchmark_dry_run: 1 as unknown as boolean } }),
      ).toBe(false);
    });

    it("benchmark_dry_run = 'true' (truthy string)", () => {
      expect(
        shouldStopForDryRun({
          autonomy: { benchmark_dry_run: "true" as unknown as boolean },
        }),
      ).toBe(false);
    });

    it("benchmark_dry_run = {} (truthy object)", () => {
      expect(
        shouldStopForDryRun({
          autonomy: { benchmark_dry_run: {} as unknown as boolean },
        }),
      ).toBe(false);
    });
  });

  describe("returns true ONLY when explicitly opted in", () => {
    it("autonomy.benchmark_dry_run = true", () => {
      expect(shouldStopForDryRun({ autonomy: { benchmark_dry_run: true } })).toBe(true);
    });

    it("autonomy with extra fields + benchmark_dry_run = true", () => {
      expect(
        shouldStopForDryRun({
          stagehand: {},
          rawPage: {},
          autonomy: {
            benchmark_dry_run: true,
            require_user_approval_before_payment: false,
          },
        }),
      ).toBe(true);
    });
  });
});

// ─── boundary marker constant ───────────────────────────────────────────────

describe("DRY_RUN_BOUNDARY_MARKER", () => {
  it("is a stable string used by providers + log parsers", () => {
    expect(DRY_RUN_BOUNDARY_MARKER).toBe("dry_run_boundary");
  });
});

// ─── provider integration: OpenTable + Resy honour the boundary ─────────────
//
// We don't drive a real Page here — providers do enough other work that a
// faithful mock would be a maintenance hazard. Instead we assert the
// integration property: when shouldStopForDryRun returns true, the trace
// records the boundary marker AND no submit click ever happens.
//
// Strategy: stub a Page whose `evaluate` records every call. Drive only the
// minimum path that reaches the boundary (CC section absent) and assert:
//   - trace has the boundary marker
//   - none of the recorded evaluate() bodies reference a submit-button click

describe("provider boundary integration (OpenTable)", () => {
  it("does NOT click submit when helpers carries autonomy.benchmark_dry_run = true", async () => {
    const evaluateCalls: string[] = [];
    const traceLines: string[] = [];
    const trace = (m: string) => traceLines.push(m);

    const page = {
      url: vi.fn(() => "https://www.opentable.com/booking/details"),
      evaluate: vi.fn(async (fnOrArg: unknown) => {
        const src = typeof fnOrArg === "function" ? fnOrArg.toString() : "";
        evaluateCalls.push(src);
        // No OpenTable intermediate modal is present in this minimal dry-run mock.
        if (src.includes("available seating options")) return null;
        // OpenTable form-state reader expects the full shape.
        if (src.includes("verificationGate") && src.includes("submitVisible")) {
          return {
            present: [],
            filled: [],
            empty: [],
            verificationGate: false,
            submitVisible: false,
          };
        }
        // Make hasCreditCardSection return false so we proceed past CC gate.
        if (src.includes("credit card required")) return false;
        // Make all form-fill steps return synthetic empty success.
        return {};
      }),
    } as unknown as import("playwright").Page;

    // Lazy-import the provider (registers itself on import; that's fine for tests).
    const { openTableProvider } = await import("@/lib/booking-autopilot/providers/opentable-com");

    // Profile must have at least one field so the provider doesn't bail early.
    const profile = { first_name: "Test", last_name: "User", email: "t@example.com", phone: "5551234567" };

    await openTableProvider.fillGuestForm!(
      page,
      profile,
      { autonomy: { benchmark_dry_run: true } },
      trace,
    );

    // Assert: the boundary marker appeared in the trace.
    const boundaryHit = traceLines.some((l) => l.includes(DRY_RUN_BOUNDARY_MARKER));
    expect(boundaryHit).toBe(true);

    // Assert: no evaluate() body references the submit-button click pattern.
    // (The boundary fires BEFORE that page.evaluate is reached.)
    const submitClickInvoked = evaluateCalls.some(
      (src) =>
        src.includes("complete reservation") &&
        src.includes("btn.click()"),
    );
    expect(submitClickInvoked).toBe(false);
  });
});

describe("provider boundary integration (Resy)", () => {
  it("does NOT click submit when helpers carries autonomy.benchmark_dry_run = true", async () => {
    const evaluateCalls: string[] = [];
    const traceLines: string[] = [];
    const trace = (m: string) => traceLines.push(m);

    const page = {
      evaluate: vi.fn(async (fnOrArg: unknown) => {
        const src = typeof fnOrArg === "function" ? fnOrArg.toString() : "";
        evaluateCalls.push(src);
        return {};
      }),
    } as unknown as import("playwright").Page;

    const { resyProvider } = await import("@/lib/booking-autopilot/providers/resy-com");

    const profile = { first_name: "Test", last_name: "User", email: "t@example.com", phone: "5551234567" };

    await resyProvider.fillGuestForm!(
      page,
      profile,
      { autonomy: { benchmark_dry_run: true } },
      trace,
    );

    const boundaryHit = traceLines.some((l) => l.includes(DRY_RUN_BOUNDARY_MARKER));
    expect(boundaryHit).toBe(true);

    const submitClickInvoked = evaluateCalls.some(
      (src) =>
        (src.includes("complete reservation") ||
          src.includes("find a table")) &&
        src.includes("btn.click()"),
    );
    expect(submitClickInvoked).toBe(false);
  });
});
