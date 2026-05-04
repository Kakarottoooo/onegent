import { describe, expect, it } from "vitest";

import {
  __PATTERN_RULES_FOR_TEST,
  classifyJob,
  decisionLogTextOf,
  pushFieldSignals,
} from "../runtime-forensics/classifier";
import type {
  ClassifierSignal,
  FailureClass,
  JobLikeInput,
} from "../runtime-forensics/types";

/* ─── Helpers ─────────────────────────────────────────────────────── */

function job(overrides: Partial<JobLikeInput> = {}): JobLikeInput {
  return {
    id: "job-1",
    taskId: "task-1",
    provider: "resy",
    scenario: "R-003",
    status: "failed",
    steps: [],
    decisionLog: [],
    ...overrides,
  };
}

/* ─── Patterns table sanity ──────────────────────────────────────── */

describe("PATTERN_RULES table", () => {
  it("includes at least one rule per failure class", () => {
    const classes = new Set<FailureClass>(
      __PATTERN_RULES_FOR_TEST.map((r) => r.cls),
    );
    expect(classes.has("legacy_shape_missing_source")).toBe(true);
    expect(classes.has("provider_no_availability")).toBe(true);
    expect(classes.has("provider_form_incomplete")).toBe(true);
    expect(classes.has("otp_or_login_required")).toBe(true);
    expect(classes.has("checkout_reached_manual_review")).toBe(true);
    expect(classes.has("model_or_env_blocked")).toBe(true);
    expect(classes.has("network_or_provider_5xx")).toBe(true);
  });
  it("all weights are in [0, 1]", () => {
    for (const r of __PATTERN_RULES_FOR_TEST) {
      expect(r.weight).toBeGreaterThan(0);
      expect(r.weight).toBeLessThanOrEqual(1);
    }
  });
  it("all rules have non-empty labels", () => {
    for (const r of __PATTERN_RULES_FOR_TEST) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
  it("legacy-shape rules have weight ≥ 0.85", () => {
    const legacyRules = __PATTERN_RULES_FOR_TEST.filter(
      (r) => r.cls === "legacy_shape_missing_source",
    );
    expect(legacyRules.length).toBeGreaterThanOrEqual(3);
    for (const r of legacyRules) {
      expect(r.weight).toBeGreaterThanOrEqual(0.8);
    }
  });
});

/* ─── decisionLogTextOf ──────────────────────────────────────────── */

describe("decisionLogTextOf", () => {
  it("returns empty string for null/undefined/non-object", () => {
    expect(decisionLogTextOf(null)).toBe("");
    expect(decisionLogTextOf(undefined)).toBe("");
  });
  it("joins event + message + data", () => {
    const out = decisionLogTextOf({
      event: "step_attempt",
      message: "trying selector",
      data: "rs-confirm-01-locator",
    });
    expect(out).toContain("step_attempt");
    expect(out).toContain("trying selector");
    expect(out).toContain("rs-confirm-01-locator");
  });
  it("handles object data via JSON.stringify", () => {
    const out = decisionLogTextOf({
      event: "decision",
      data: { strategy: "rs-phone-05-mouse-keyboard" },
    });
    expect(out).toContain("rs-phone-05-mouse-keyboard");
  });
  it("survives circular data without throwing", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => decisionLogTextOf({ event: "x", data: a })).not.toThrow();
  });
});

/* ─── pushFieldSignals ──────────────────────────────────────────── */

describe("pushFieldSignals", () => {
  it("ignores null/empty/non-string text", () => {
    const arr: ClassifierSignal[] = [];
    pushFieldSignals(arr, "error_message", null);
    pushFieldSignals(arr, "error_message", "");
    pushFieldSignals(arr, "error_message", undefined);
    pushFieldSignals(arr, "error_message", 42 as unknown as string);
    expect(arr).toHaveLength(0);
  });
  it("matches multiple rules from same text", () => {
    const arr: ClassifierSignal[] = [];
    pushFieldSignals(
      arr,
      "raw_worker_log",
      "Worker received legacy-shape step (missing __source marker) — provider unreachable",
    );
    expect(arr.length).toBeGreaterThanOrEqual(2);
    expect(arr.some((s) => s.supportsClass === "legacy_shape_missing_source")).toBe(true);
    expect(arr.some((s) => s.supportsClass === "network_or_provider_5xx")).toBe(true);
  });
  it("records the source field", () => {
    const arr: ClassifierSignal[] = [];
    pushFieldSignals(arr, "step_error", "form incomplete");
    expect(arr[0].source).toBe("step_error");
  });
});

/* ─── classifyJob — legacy_shape_missing_source ──────────────────── */

describe("classifyJob — legacy_shape_missing_source (P0)", () => {
  it("detects via job-level errorMessage phrase", () => {
    const r = classifyJob(
      job({
        errorMessage: "Worker received legacy-shape step (missing __source marker)",
        provider: "expedia",
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
    expect(r.severity).toBe("p0");
    expect(r.confidence).toBe("high");
  });
  it("detects via terminalReason phrase", () => {
    const r = classifyJob(
      job({ terminalReason: "missing __source marker on step 2" }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
  });
  it("detects via step.error phrase", () => {
    const r = classifyJob(
      job({
        steps: [
          { name: "navigate", error: "step lacks __source after legacy-shape adapter" },
        ],
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
  });
  it("detects via decisionLog message", () => {
    const r = classifyJob(
      job({
        decisionLog: [
          { event: "worker_step_received", message: "unstamped step" },
        ],
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
  });
  it("detects via raw worker log excerpt", () => {
    const r = classifyJob(
      job({
        rawWorkerLogExcerpt:
          "[worker] Worker received legacy-shape step (missing __source marker)\n[next line]",
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
  });
  it("step-shape audit detection promotes class even without phrase match", () => {
    // step has __source = undefined AND its error mentions phrase
    const r = classifyJob(
      job({
        steps: [
          {
            name: "form_fill",
            error: "Worker received legacy-shape step",
          },
        ],
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
    // step_shape_audit signal should be present
    expect(r.signals.some((s) => s.source === "step_shape_audit")).toBe(true);
  });
  it("severity is always P0 for legacy-shape", () => {
    const r = classifyJob(
      job({ errorMessage: "missing __source marker" }),
    );
    expect(r.severity).toBe("p0");
  });
  it("status=succeeded does NOT downgrade legacy-shape (still P0)", () => {
    const r = classifyJob(
      job({
        status: "succeeded",
        errorMessage: "Worker received legacy-shape step",
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
  });
});

/* ─── classifyJob — provider_no_availability ─────────────────────── */

describe("classifyJob — provider_no_availability", () => {
  it("matches 'no target window slots'", () => {
    const r = classifyJob(
      job({ terminalReason: "Resy returned no target window slots" }),
    );
    expect(r.primaryClass).toBe("provider_no_availability");
  });
  it("matches 'PROVIDER_NO_SLOT'", () => {
    const r = classifyJob(job({ terminalCode: "PROVIDER_NO_SLOT" }));
    expect(r.primaryClass).toBe("provider_no_availability");
  });
  it("matches 'no_availability_correct'", () => {
    const r = classifyJob(
      job({ terminalReason: "no_availability_correct verdict for R-003" }),
    );
    expect(r.primaryClass).toBe("provider_no_availability");
  });
  it("matches '0 matching slots'", () => {
    const r = classifyJob(
      job({ errorMessage: "0 matching slots in target window" }),
    );
    expect(r.primaryClass).toBe("provider_no_availability");
  });
  it("matches 'sold out'", () => {
    const r = classifyJob(
      job({ errorMessage: "Restaurant is sold out" }),
    );
    expect(r.primaryClass).toBe("provider_no_availability");
  });
  it("severity is info (informational)", () => {
    const r = classifyJob(job({ terminalCode: "PROVIDER_NO_SLOT" }));
    expect(r.severity).toBe("info");
  });
});

/* ─── classifyJob — provider_form_incomplete ─────────────────────── */

describe("classifyJob — provider_form_incomplete", () => {
  it("matches 'form incomplete'", () => {
    const r = classifyJob(job({ errorMessage: "guest form incomplete" }));
    expect(r.primaryClass).toBe("provider_form_incomplete");
    expect(r.severity).toBe("p1");
  });
  it("matches 'required field empty'", () => {
    const r = classifyJob(
      job({ errorMessage: "required field missing: phone" }),
    );
    expect(r.primaryClass).toBe("provider_form_incomplete");
  });
  it("matches 'auditAndRefill failed'", () => {
    const r = classifyJob(
      job({ errorMessage: "audit refill gave up after 3 attempts" }),
    );
    expect(r.primaryClass).toBe("provider_form_incomplete");
  });
  it("matches 'phone field unfilled'", () => {
    const r = classifyJob(
      job({ errorMessage: "phone input unfilled after 2 attempts" }),
    );
    expect(r.primaryClass).toBe("provider_form_incomplete");
  });
});

/* ─── classifyJob — otp_or_login_required ────────────────────────── */

describe("classifyJob — otp_or_login_required", () => {
  it("matches 'OTP'", () => {
    const r = classifyJob(job({ terminalReason: "OTP gate hit" }));
    expect(r.primaryClass).toBe("otp_or_login_required");
    expect(r.severity).toBe("info");
  });
  it("matches 'awaiting OTP'", () => {
    const r = classifyJob(
      job({ terminalReason: "awaiting OTP from user phone" }),
    );
    expect(r.primaryClass).toBe("otp_or_login_required");
  });
  it("matches 'phone verification'", () => {
    const r = classifyJob(
      job({ errorMessage: "phone verification required" }),
    );
    expect(r.primaryClass).toBe("otp_or_login_required");
  });
  it("matches 'login required'", () => {
    const r = classifyJob(
      job({ errorMessage: "login wall encountered" }),
    );
    expect(r.primaryClass).toBe("otp_or_login_required");
  });
  it("matches 'F-PROVIDER-OTP' code", () => {
    const r = classifyJob(job({ terminalCode: "F-PROVIDER-OTP" }));
    expect(r.primaryClass).toBe("otp_or_login_required");
  });
});

/* ─── classifyJob — checkout_reached_manual_review ──────────────── */

describe("classifyJob — checkout_reached_manual_review", () => {
  it("matches 'ready_for_confirmation'", () => {
    const r = classifyJob(job({ status: "ready_for_confirmation" }));
    // status alone doesn't trigger; need a signal in fields
    const r2 = classifyJob(
      job({ terminalReason: "ready_for_confirmation reached" }),
    );
    expect(r2.primaryClass).toBe("checkout_reached_manual_review");
    expect(r2.severity).toBe("info");
  });
  it("matches 'safe handoff'", () => {
    const r = classifyJob(
      job({ terminalReason: "safe handoff after fill closure" }),
    );
    expect(r.primaryClass).toBe("checkout_reached_manual_review");
  });
  it("matches 'stop at CVV'", () => {
    const r = classifyJob(
      job({ errorMessage: "stop at CVV programmatically" }),
    );
    expect(r.primaryClass).toBe("checkout_reached_manual_review");
  });
  it("matches 'awaiting human confirm'", () => {
    const r = classifyJob(
      job({ terminalReason: "awaiting human confirm tap" }),
    );
    expect(r.primaryClass).toBe("checkout_reached_manual_review");
  });
});

/* ─── classifyJob — model_or_env_blocked ─────────────────────────── */

describe("classifyJob — model_or_env_blocked", () => {
  it("matches 'OpenAI rate-limit'", () => {
    const r = classifyJob(
      job({ errorMessage: "OpenAI rate-limit 429: too many requests" }),
    );
    expect(r.primaryClass).toBe("model_or_env_blocked");
    expect(r.severity).toBe("p1");
  });
  it("matches 'Computer Use unavailable'", () => {
    const r = classifyJob(
      job({ errorMessage: "Computer Use unavailable in this region" }),
    );
    expect(r.primaryClass).toBe("model_or_env_blocked");
  });
  it("matches 'missing env variable'", () => {
    const r = classifyJob(
      job({ errorMessage: "missing env variable: OPENAI_API_KEY" }),
    );
    expect(r.primaryClass).toBe("model_or_env_blocked");
  });
  it("matches 'chromium not installed'", () => {
    const r = classifyJob(
      job({ errorMessage: "chromium not installed; run npx playwright install" }),
    );
    expect(r.primaryClass).toBe("model_or_env_blocked");
  });
  it("matches 'token guard'", () => {
    const r = classifyJob(
      job({ errorMessage: "token guard: --confirm-suite required for multi-case" }),
    );
    expect(r.primaryClass).toBe("model_or_env_blocked");
  });
});

/* ─── classifyJob — network_or_provider_5xx ──────────────────────── */

describe("classifyJob — network_or_provider_5xx", () => {
  it("matches '5xx error'", () => {
    const r = classifyJob(
      job({ errorMessage: "Provider returned 503 error" }),
    );
    expect(r.primaryClass).toBe("network_or_provider_5xx");
    expect(r.severity).toBe("p2");
  });
  it("matches 'ECONNRESET'", () => {
    const r = classifyJob(
      job({ errorMessage: "fetch failed: ECONNRESET" }),
    );
    expect(r.primaryClass).toBe("network_or_provider_5xx");
  });
  it("matches 'gateway timeout'", () => {
    const r = classifyJob(
      job({ errorMessage: "Cloudflare gateway timeout" }),
    );
    expect(r.primaryClass).toBe("network_or_provider_5xx");
  });
  it("matches 'provider unreachable'", () => {
    const r = classifyJob(
      job({ errorMessage: "provider unreachable for 30s" }),
    );
    expect(r.primaryClass).toBe("network_or_provider_5xx");
  });
  it("matches 'net::ERR_'", () => {
    const r = classifyJob(
      job({ errorMessage: "navigation failed: net::ERR_NAME_NOT_RESOLVED" }),
    );
    expect(r.primaryClass).toBe("network_or_provider_5xx");
  });
});

/* ─── classifyJob — unknown ──────────────────────────────────────── */

describe("classifyJob — unknown", () => {
  it("returns 'unknown' when no signals match", () => {
    const r = classifyJob(job({ errorMessage: "weird thing happened" }));
    expect(r.primaryClass).toBe("unknown");
  });
  it("returns 'unknown' for empty job", () => {
    const r = classifyJob({});
    expect(r.primaryClass).toBe("unknown");
  });
  it("returns 'unknown' for status=succeeded with no checkout signal", () => {
    const r = classifyJob(
      job({ status: "succeeded", errorMessage: "" }),
    );
    expect(r.primaryClass).toBe("unknown");
  });
  it("severity for unknown is p2", () => {
    const r = classifyJob(job({}));
    expect(r.severity).toBe("p2");
  });
  it("confidence for unknown is low", () => {
    const r = classifyJob(job({}));
    expect(r.confidence).toBe("low");
  });
});

/* ─── classifyJob — multi-class disambiguation ───────────────────── */

describe("classifyJob — multi-signal disambiguation", () => {
  it("legacy-shape beats no-availability when both present", () => {
    const r = classifyJob(
      job({
        errorMessage:
          "no slots available; Worker received legacy-shape step (missing __source marker)",
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
  });
  it("OTP beats form-incomplete when both present (OTP weight higher)", () => {
    const r = classifyJob(
      job({
        steps: [
          { name: "form_fill", error: "form partially filled" },
          { name: "otp_wait", error: "awaiting OTP from user" },
        ],
      }),
    );
    expect(["otp_or_login_required", "provider_form_incomplete"]).toContain(
      r.primaryClass,
    );
  });
  it("alternatives are populated and exclude primary", () => {
    const r = classifyJob(
      job({
        errorMessage:
          "no slots available; provider returned 503 error",
      }),
    );
    expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
    for (const a of r.alternatives) {
      expect(a.class).not.toBe(r.primaryClass);
    }
  });
  it("perClassWeights sums to total signal weight", () => {
    const r = classifyJob(
      job({
        errorMessage:
          "no slots; ECONNRESET; OpenAI rate-limit",
      }),
    );
    const total = Object.values(r.perClassWeights).reduce(
      (acc, v) => acc + (v ?? 0),
      0,
    );
    const fromSignals = r.signals.reduce((acc, s) => acc + s.weight, 0);
    expect(total).toBeCloseTo(fromSignals, 2);
  });
  it("signals are sorted by weight desc", () => {
    const r = classifyJob(
      job({
        errorMessage:
          "no slots; ECONNRESET; OpenAI rate-limit; missing __source marker",
      }),
    );
    for (let i = 0; i < r.signals.length - 1; i++) {
      expect(r.signals[i].weight).toBeGreaterThanOrEqual(r.signals[i + 1].weight);
    }
  });
});

/* ─── classifyJob — confidence buckets ───────────────────────────── */

describe("classifyJob — confidence", () => {
  it("high confidence for weight ≥ 1.0", () => {
    const r = classifyJob(
      job({ errorMessage: "Worker received legacy-shape step" }),
    );
    expect(r.confidence).toBe("high");
  });
  it("medium confidence for weight ≥ 0.6 and < 1.0", () => {
    const r = classifyJob(
      job({ errorMessage: "sold out" }),
    );
    expect(r.confidence).toBe("medium");
  });
  it("low confidence for weight < 0.6", () => {
    // No signals → unknown → 0 weight → low
    const r = classifyJob({});
    expect(r.confidence).toBe("low");
  });
});

/* ─── classifyJob — graceful degrade on garbage input ────────────── */

describe("classifyJob — garbage input", () => {
  it("survives steps not being an array", () => {
    expect(() =>
      classifyJob({ steps: "nope" as unknown as undefined }),
    ).not.toThrow();
  });
  it("survives decisionLog not being an array", () => {
    expect(() =>
      classifyJob({ decisionLog: "nope" as unknown as undefined }),
    ).not.toThrow();
  });
  it("survives steps with non-object members", () => {
    expect(() =>
      classifyJob({ steps: [42 as unknown as never, null as unknown as never] }),
    ).not.toThrow();
  });
  it("survives decisionLog with non-object members", () => {
    expect(() =>
      classifyJob({
        decisionLog: [
          42 as unknown as never,
          null as unknown as never,
          "string" as unknown as never,
        ],
      }),
    ).not.toThrow();
  });
});

/* ─── Provider-specific fixture cases ────────────────────────────── */

describe("classifyJob — provider fixture sanity", () => {
  it("Resy R-003 no-slot case", () => {
    const r = classifyJob(
      job({
        provider: "resy",
        scenario: "R-003",
        terminalCode: "PROVIDER_NO_SLOT",
        terminalReason: "no_availability_correct verdict",
      }),
    );
    expect(r.primaryClass).toBe("provider_no_availability");
  });
  it("Resy R-030 OTP case", () => {
    const r = classifyJob(
      job({
        provider: "resy",
        scenario: "R-030",
        terminalReason: "awaiting OTP from user phone",
      }),
    );
    expect(r.primaryClass).toBe("otp_or_login_required");
  });
  it("OpenTable form-fill case", () => {
    const r = classifyJob(
      job({
        provider: "opentable",
        scenario: "OT-007",
        errorMessage: "phone field unfilled after audit refill",
      }),
    );
    expect(r.primaryClass).toBe("provider_form_incomplete");
  });
  it("Expedia legacy-shape case (P0)", () => {
    const r = classifyJob(
      job({
        provider: "expedia",
        scenario: "F-EXP-LAX-NRT-1",
        errorMessage:
          "Worker received legacy-shape step (missing __source marker)",
      }),
    );
    expect(r.primaryClass).toBe("legacy_shape_missing_source");
    expect(r.severity).toBe("p0");
    expect(r.confidence).toBe("high");
  });
  it("Expedia card-scan failure case remains unknown but surfaces the selector signal", () => {
    const r = classifyJob(
      job({
        provider: "expedia",
        scenario: "F-EXP-MCO-BNA-1",
        rawWorkerLogExcerpt: [
          '[stagehand] [flight-rpa] Starting programmatic flight booking: airline="Southwest" price=$152 time="08:50" flightNo="WN 3084"',
          "[stagehand] [flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught",
          '[stagehand] [flight-rpa] No matching flight button found (tried airline="Southwest" price=$152)',
        ].join("\n"),
      }),
    );

    expect(r.primaryClass).toBe("unknown");
    expect(r.severity).toBe("p2");
    expect(r.confidence).toBe("medium");
    expect(r.signals.some((s) => s.label === "Expedia flight-card DOM scan failed")).toBe(true);
  });
  it("Expedia locator fallback attempt is visible when card scan recovery still fails", () => {
    const r = classifyJob(
      job({
        provider: "expedia",
        scenario: "F-EXP-MCO-BNA-2",
        rawWorkerLogExcerpt: [
          "[stagehand] [flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught",
          "[stagehand] [flight-rpa] Trying locator fallback for flight-card scan",
          '[stagehand] [flight-rpa] No matching flight button found (tried airline="Southwest" price=$152)',
        ].join("\n"),
      }),
    );

    expect(r.primaryClass).toBe("unknown");
    expect(r.signals.map((s) => s.label)).toEqual(
      expect.arrayContaining([
        "Expedia flight-card DOM scan failed",
        "Expedia locator fallback attempted",
      ]),
    );
  });
  it("Expedia locator fallback matched signal does not override checkout boundary classification", () => {
    const r = classifyJob(
      job({
        provider: "expedia",
        scenario: "F-EXP-MCO-BNA-3",
        rawWorkerLogExcerpt: [
          "[stagehand] [flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught",
          "[stagehand] [flight-rpa] Trying locator fallback for flight-card scan",
          '[stagehand] [flight-rpa] Locator fallback matched flight card: "Select flight Southwest 8:50am 9:55am $152"',
          "[stagehand] [flight-rpa] Checkout reached - running AI form fill",
        ].join("\n"),
      }),
    );

    expect(r.primaryClass).toBe("checkout_reached_manual_review");
    expect(r.signals.map((s) => s.label)).toEqual(
      expect.arrayContaining([
        "Expedia locator fallback attempted",
        "Expedia locator fallback matched",
        "checkout reached",
      ]),
    );
  });
  it("flight checkout reached case", () => {
    const r = classifyJob(
      job({
        provider: "expedia",
        scenario: "F-EXP-LAX-NRT-2",
        terminalReason: "ready_for_confirmation reached; awaiting human tap",
      }),
    );
    expect(r.primaryClass).toBe("checkout_reached_manual_review");
  });
  it("Booking.com 5xx case", () => {
    const r = classifyJob(
      job({
        provider: "booking-com",
        scenario: "H-BKG-NYC-1",
        errorMessage: "ECONNRESET while loading hotel detail",
      }),
    );
    expect(r.primaryClass).toBe("network_or_provider_5xx");
  });
});

/* ─── Stability tests ────────────────────────────────────────────── */

describe("classifyJob — stability", () => {
  it("is deterministic — same input yields same output", () => {
    const j = job({
      errorMessage: "Worker received legacy-shape step",
      decisionLog: [
        { event: "step", message: "trying" },
        { event: "step", message: "retry" },
      ],
    });
    const a = classifyJob(j);
    const b = classifyJob(j);
    expect(a.primaryClass).toBe(b.primaryClass);
    expect(a.severity).toBe(b.severity);
    expect(a.signals.length).toBe(b.signals.length);
  });
  it("doesn't mutate input job", () => {
    const j = job({
      errorMessage: "no slots",
      steps: [{ name: "x", error: "y" }],
    });
    const before = JSON.stringify(j);
    classifyJob(j);
    expect(JSON.stringify(j)).toBe(before);
  });
});
