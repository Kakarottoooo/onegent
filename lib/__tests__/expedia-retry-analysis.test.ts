import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeExpediaRetryArtifactBundle,
  formatExpediaRetryAnalysisMarkdown,
  formatExpediaRetryArtifactBundleMarkdown,
  type ExpediaRetryArtifactBundle,
  type ExpediaRetryState,
} from "@/lib/runtime-forensics/expedia-retry-analysis";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "lib",
  "runtime-forensics",
  "__fixtures__",
  "expedia-retry-analysis",
);

const CASES: Array<{ file: string; state: ExpediaRetryState }> = [
  {
    file: "card-scan-failed-before-fallback.json",
    state: "card_scan_failed_before_fallback",
  },
  {
    file: "fallback-attempted-no-match.json",
    state: "fallback_attempted_no_match",
  },
  {
    file: "fallback-matched-no-checkout.json",
    state: "fallback_matched_no_checkout",
  },
  {
    file: "checkout-manual-review-reached.json",
    state: "checkout_manual_review_reached",
  },
  {
    file: "network-provider-failure.json",
    state: "network_provider_failure",
  },
];

describe("analyzeExpediaRetryArtifactBundle", () => {
  it.each(CASES)("classifies $file", async ({ file, state }) => {
    const bundle = await readFixture(file);
    const analysis = analyzeExpediaRetryArtifactBundle(bundle);

    expect(analysis.state).toBe(state);
    expect(analysis.jobId).toMatch(/^fixture-expedia-/);
    expect(analysis.provider).toBe("expedia");
    expect(analysis.scenario).toBe("flight");
    expect(analysis.signals.length).toBeGreaterThan(0);
  });

  it("prioritizes checkout/manual-review over earlier fallback signals", async () => {
    const bundle = await readFixture("checkout-manual-review-reached.json");
    const analysis = analyzeExpediaRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("checkout_manual_review_reached");
    expect(analysis.signals.map((s) => s.kind)).toContain("fallback_matched");
    expect(analysis.signals[0]?.kind).toBe("checkout_reached");
  });

  it("does not classify checkout success from mixed worker instances", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "11111111-1111-1111-1111-111111111111",
        provider: "expedia",
        scenario: "flight",
        status: "running",
      },
      workerLogExcerpt: [
        "[2026-05-07T03:30:00.000Z] [expedia-flight-only-20260507-033000] claimed job 11111111-1111-1111-1111-111111111111 (active=1/1)",
        "[flight-rpa] Checkout reached - running AI form fill",
        "[2026-05-07T03:31:00.000Z] [expedia-flight-only-20260507-033100] claimed job 11111111-1111-1111-1111-111111111111 (active=1/1)",
      ].join("\n"),
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.signals[0]?.kind).toBe("mixed_or_stale_worker_evidence");
    expect(analysis.signals.map((signal) => signal.kind)).toContain("checkout_reached");
    expect(analysis.nextAction).toContain("do not mark the flight lane closed");
  });

  it("does not use a different claimed job as Expedia closure evidence", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "11111111-1111-1111-1111-111111111111",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[2026-05-07T03:30:00.000Z] [expedia-flight-only-20260507-033000] claimed job 22222222-2222-2222-2222-222222222222 (active=1/1)",
        "[flight-rpa] Locator fallback matched flight card: Southwest 8:50am $152",
        "[flight-rpa] Checkout reached - running AI form fill",
      ].join("\n"),
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.signals[0]?.kind).toBe("mixed_or_stale_worker_evidence");
    expect(analysis.signals[0]?.excerpt).toContain("claimedJobMismatch=true");
  });

  it("does not classify checkout reached as success when required traveler fields are still missing", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-checkout-incomplete",
        provider: "expedia",
        scenario: "flight",
        status: "paused_payment",
      },
      workerLogExcerpt: [
        "[flight-rpa] Checkout reached - running AI form fill",
        "[flight-rpa] Traveler form state: filled=none missing=first name,last name,email address,phone number,birth month,birth day,birth year,gender",
        "Flight checkout reached but required traveler details are still missing: first name, last name, email address.",
      ].join("\n"),
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.signals[0]?.kind).toBe("checkout_form_incomplete");
    expect(analysis.signals.map((signal) => signal.kind)).toContain("checkout_reached");
    expect(analysis.label).toBe("Insufficient evidence");
  });

  it("classifies explicit wrong-card rejection as protected no-match evidence", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-wrong-card-rejected",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Flight candidate evidence dump: airline=Frontier departure=8:50am arrival=9:55am route=MCO to BNA price=$152 flightNumber=hidden score=9 fallbackScore=0 timeDelta=0 priceDelta=0 differentAirline=yes",
        "[flight-rpa] Flight candidate rejection reason: locator fallback rejected candidates: wrong_airline_candidate_rejected timeDelta=0 priceDelta=0 differentAirline=yes selected candidate absent",
        "[flight-rpa] No matching flight button found (tried airline=\"Southwest\" price=$152)",
      ].join("\n"),
    });

    expect(analysis.state).toBe("candidate_rejected_no_match");
    expect(analysis.confidence).toBe("high");
    expect(analysis.signals[0]?.kind).toBe("candidate_rejected");
    expect(analysis.signals.map((signal) => signal.label)).toContain("wrong airline candidate rejected");
    expect(analysis.nextAction).toContain("protected wrong-card rejection");
  });

  it("classifies explicit wrong-time rejection as protected no-match evidence", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-wrong-time-rejected",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Flight candidate evidence dump: airline=Southwest departure=9:55pm arrival=11:00pm route=MCO to BNA price=$152 flightNumber=WN 2515 score=8 fallbackScore=0 timeDelta=785 priceDelta=0 differentAirline=no",
        "[flight-rpa] Flight candidate rejection reason: locator fallback rejected candidates: wrong_time_candidate_rejected timeDelta=785 priceDelta=0 differentAirline=no selected candidate absent",
        "[flight-rpa] No matching flight button found (tried airline=\"Southwest\" departure=\"08:50\" price=$152)",
      ].join("\n"),
    });

    expect(analysis.state).toBe("candidate_rejected_no_match");
    expect(analysis.confidence).toBe("high");
    expect(analysis.signals[0]?.kind).toBe("candidate_rejected");
    expect(analysis.signals.map((signal) => signal.label)).toContain("wrong time candidate rejected");
  });

  it("classifies price-only rejection as insufficient evidence even with a stale checkout marker", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-price-only-rejected",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Flight candidate rejection reason: DOM scan rejected candidates: price_only_fallback_rejected timeDelta=unknown priceDelta=0 differentAirline=no selected candidate absent",
        "[flight-rpa] Checkout reached - running AI form fill",
      ].join("\n"),
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.signals.map((signal) => signal.kind)).toContain("checkout_reached");
    expect(analysis.signals[0]?.kind).toBe("price_only_candidate_rejected");
    expect(analysis.nextAction).toContain("price-only fallback evidence");
  });

  it("returns insufficient evidence for bundles without known signals", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-no-signals",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.confidence).toBe("low");
    expect(analysis.signals).toEqual([]);
  });

  it("classifies OpenAI Responses API 500 as model/env transient without dropping provider signals", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-openai-500",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught",
        "[flight-rpa] OpenAI Responses API returned 500 while filling traveler details",
      ].join("\n"),
    });

    expect(analysis.state).toBe("model_or_env_transient");
    expect(analysis.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "model_or_env_transient",
        "card_scan_failed",
      ]),
    );
  });

  it("classifies OpenAI 403 model_not_found as env/project mismatch, not Expedia runtime evidence", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-openai-model-not-found",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Starting programmatic flight booking",
        "OpenAI Responses API error 403 model_not_found: project does not have access to model gpt-5.5",
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught",
      ].join("\n"),
    });

    expect(analysis.state).toBe("model_or_env_transient");
    expect(analysis.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "model_or_env_transient",
        "card_scan_failed",
      ]),
    );
  });

  it("classifies login/OTP/CAPTCHA boundaries ahead of selector drift", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-otp-boundary",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Flight candidate evidence dump: airline=Southwest departure=8:50am price=$152",
        "[flight-rpa] Login/OTP/CAPTCHA boundary detected before checkout: OTP boundary",
        "Expedia flight OTP boundary reached. Stop for manual intervention; do not bypass login, OTP, or CAPTCHA.",
      ].join("\n"),
    });

    expect(analysis.state).toBe("login_or_otp_boundary");
    expect(analysis.confidence).toBe("high");
    expect(analysis.signals[0]?.kind).toBe("login_or_otp_boundary");
  });

  it("does not treat hard-stop checklist notes as observed login/OTP/CAPTCHA boundaries", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-hard-stop-note",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught",
        "[flight-rpa] Trying locator fallback for flight-card scan",
        "[flight-rpa] Unexpected error: item.evaluate is not a function",
      ].join("\n"),
      notes: [
        "Stopped before any payment, CVV, login/OTP/CAPTCHA bypass, or final purchase.",
      ],
    });

    expect(analysis.state).toBe("fallback_attempted_no_match");
    expect(analysis.signals.map((signal) => signal.kind)).not.toContain(
      "login_or_otp_boundary",
    );
  });

  it("separates dismissable promo overlays from account-required boundaries", () => {
    const promo = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-dismissable-promo-overlay",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] dismissable_member_price_overlay visible: Sign in for member prices or continue as guest.",
        "[flight-rpa] Bundle & Save up to $974 with flight + car package deals. No thanks button visible.",
      ].join("\n"),
    });

    expect(promo.state).toBe("insufficient_evidence");
    expect(promo.signals.map((signal) => signal.kind)).toContain("dismissable_promo_overlay");
    expect(promo.signals.map((signal) => signal.kind)).not.toContain("login_or_otp_boundary");

    const account = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-account-required-boundary",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
      },
      workerLogExcerpt: [
        "[flight-rpa] Account checkpoint: sign in or create an account to continue.",
      ].join("\n"),
    });

    expect(account.state).toBe("login_or_otp_boundary");
    expect(account.signals[0]?.kind).toBe("login_or_otp_boundary");
  });

  it("classifies provider no-availability only when explicit availability evidence is present", () => {
    const analysis = analyzeExpediaRetryArtifactBundle({
      job: {
        id: "fixture-expedia-no-availability",
        provider: "expedia",
        scenario: "flight",
        status: "failed",
        errorMessage: "Provider inventory changed; target Southwest card is not visible.",
      },
    });

    expect(analysis.state).toBe("provider_no_availability");
    expect(analysis.signals.map((signal) => signal.kind)).toContain(
      "provider_no_availability",
    );
  });
});

describe("Expedia retry markdown helpers", () => {
  it("formats a paste-ready summary from an analysis", async () => {
    const bundle = await readFixture("fallback-matched-no-checkout.json");
    const analysis = analyzeExpediaRetryArtifactBundle(bundle);
    const markdown = formatExpediaRetryAnalysisMarkdown(analysis);

    expect(markdown).toContain("## Expedia Retry Artifact Analysis");
    expect(markdown).toContain("fallback_matched_no_checkout");
    expect(markdown).toContain("worker/.debug-screenshots/flight-rpa-fixture-fallback-matched");
    expect(markdown).toContain("### Next Action");
  });

  it("formats a paste-ready summary directly from an artifact bundle", async () => {
    const bundle = await readFixture("network-provider-failure.json");
    const markdown = formatExpediaRetryArtifactBundleMarkdown(bundle);

    expect(markdown).toContain("network_provider_failure");
    expect(markdown).toContain("Expedia Retry Artifact Analysis");
    expect(markdown).toContain("codex-worker.log");
  });

  it("includes benchmark report paths when present", async () => {
    const bundle = await readFixture("fallback-attempted-no-match.json");
    const markdown = formatExpediaRetryArtifactBundleMarkdown({
      ...bundle,
      benchmarkReportPath:
        "C:\\Users\\Gzw19\\onegent-integrated-20260504\\benchmark\\runs\\expedia-controlled-retry.json",
    });

    expect(markdown).toContain("Benchmark report");
    expect(markdown).toContain("expedia-controlled-retry.json");
  });
});

async function readFixture(file: string): Promise<ExpediaRetryArtifactBundle> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, file), "utf8");
  return JSON.parse(raw) as ExpediaRetryArtifactBundle;
}
