import { describe, it, expect } from "vitest";
import {
  decisionLogHitDryRunBoundary,
  classifyStepResult,
  classifyError,
} from "@/lib/benchmark/parse-decision-log";

// ─── decisionLogHitDryRunBoundary ───────────────────────────────────────────

describe("decisionLogHitDryRunBoundary", () => {
  it("returns false on null / undefined / empty", () => {
    expect(decisionLogHitDryRunBoundary(null)).toBe(false);
    expect(decisionLogHitDryRunBoundary(undefined)).toBe(false);
    expect(decisionLogHitDryRunBoundary([])).toBe(false);
  });

  it("returns false when no entry contains the marker", () => {
    expect(
      decisionLogHitDryRunBoundary([
        { type: "attempt", message: "form filled" },
        { type: "succeeded", message: "Done" },
      ]),
    ).toBe(false);
  });

  it("returns true when the OpenTable boundary trace is present", () => {
    expect(
      decisionLogHitDryRunBoundary([
        { type: "attempt", message: "form filled" },
        { type: "attempt", message: "[opentable] dry_run_boundary - submit click skipped (benchmark_dry_run=true)" },
      ]),
    ).toBe(true);
  });

  it("returns true when the Resy boundary trace is present", () => {
    expect(
      decisionLogHitDryRunBoundary([
        { type: "attempt", message: "[resy] dry_run_boundary - submit click skipped (benchmark_dry_run=true)" },
      ]),
    ).toBe(true);
  });

  it("ignores entries with malformed message", () => {
    expect(
      decisionLogHitDryRunBoundary([
        { type: "attempt", message: "" },
        // @ts-expect-error — testing defensive behaviour
        { type: "attempt", message: null },
      ]),
    ).toBe(false);
  });
});

// ─── classifyStepResult ─────────────────────────────────────────────────────

describe("classifyStepResult", () => {
  it("succeeded when boundary marker present (regardless of step.status)", () => {
    const result = classifyStepResult({
      status: "awaiting_confirmation",
      decisionLog: [
        { type: "attempt", message: "[opentable] dry_run_boundary - submit click skipped" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.failure_reason).toBeNull();
  });

  it("no_availability without boundary → failed/no_availability", () => {
    const result = classifyStepResult({ status: "no_availability", decisionLog: [] });
    expect(result.success).toBe(false);
    expect(result.failure_reason).toBe("no_availability");
  });

  it("awaiting_confirmation without boundary → payment_stop", () => {
    const result = classifyStepResult({ status: "awaiting_confirmation", decisionLog: [] });
    expect(result.failure_reason).toBe("payment_stop");
    expect(result.payment_stop_triggered).toBe(true);
    expect(result.human_handoff_required).toBe(true);
  });

  it("error with login phrase → login_required", () => {
    const result = classifyStepResult({
      status: "error",
      error: "Site requires sign in to continue",
      decisionLog: [],
    });
    expect(result.failure_reason).toBe("login_required");
  });

  it("error with timeout phrase → provider_timeout", () => {
    const result = classifyStepResult({
      status: "error",
      error: "Browser task timed out after 7 minutes",
      decisionLog: [],
    });
    expect(result.failure_reason).toBe("provider_timeout");
  });

  it("error with captcha phrase → captcha_or_bot_detection", () => {
    const result = classifyStepResult({
      status: "error",
      error: "CAPTCHA challenge detected",
      decisionLog: [],
    });
    expect(result.failure_reason).toBe("captcha_or_bot_detection");
  });

  it("done without boundary → executor_error (unexpected real submit)", () => {
    // If a step lands on 'done' but the boundary marker isn't in the log,
    // that means the executor proceeded to a real confirmation page —
    // a critical safety violation in dry_run benchmarks. Mark as failed
    // so it can never be silently counted as a success.
    const result = classifyStepResult({ status: "done", decisionLog: [] });
    expect(result.success).toBe(false);
    expect(result.failure_reason).toBe("executor_error");
  });

  it("unknown status → unknown_error", () => {
    const result = classifyStepResult({
      status: "wat" as unknown as string,
      decisionLog: [],
    });
    expect(result.failure_reason).toBe("unknown_error");
  });
});

// ─── classifyError ──────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("empty string → unknown_error", () => {
    expect(classifyError("")).toBe("unknown_error");
  });

  it("captcha keywords map to captcha_or_bot_detection", () => {
    expect(classifyError("CAPTCHA challenge")).toBe("captcha_or_bot_detection");
    expect(classifyError("bot detection triggered")).toBe("captcha_or_bot_detection");
  });

  it("login keywords map to login_required", () => {
    expect(classifyError("Please sign in")).toBe("login_required");
    expect(classifyError("Login required to proceed")).toBe("login_required");
  });

  it("timeout keywords map to provider_timeout", () => {
    expect(classifyError("timed out after 7 minutes")).toBe("provider_timeout");
    expect(classifyError("Page timeout")).toBe("provider_timeout");
  });

  it("availability keywords map to no_availability", () => {
    expect(classifyError("No availability for selected time")).toBe("no_availability");
    expect(classifyError("not available")).toBe("no_availability");
  });

  it("other error → executor_error", () => {
    expect(classifyError("DOM mutation observed")).toBe("executor_error");
  });
});
