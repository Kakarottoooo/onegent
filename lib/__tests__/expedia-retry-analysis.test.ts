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
