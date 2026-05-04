import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeHotelRetryArtifactBundle,
  formatHotelRetryAnalysisMarkdown,
  formatHotelRetryArtifactBundleMarkdown,
  type HotelRetryArtifactBundle,
  type HotelRetryState,
} from "@/lib/runtime-forensics/hotel-retry-analysis";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "lib",
  "runtime-forensics",
  "__fixtures__",
  "hotel-retry-analysis",
);

const CASES: Array<{ file: string; state: HotelRetryState; provider: string }> = [
  {
    file: "booking-room-selection-drift.json",
    state: "room_selection_drift",
    provider: "booking-com",
  },
  {
    file: "booking-room-selection-reached.json",
    state: "room_selection_manual_review_reached",
    provider: "booking-com",
  },
  {
    file: "booking-guest-details-reached.json",
    state: "guest_details_manual_review_reached",
    provider: "booking-com",
  },
  {
    file: "hotels-payment-manual-review-reached.json",
    state: "payment_manual_review_reached",
    provider: "hotels-com",
  },
  {
    file: "booking-login-captcha-boundary.json",
    state: "login_or_captcha_boundary",
    provider: "booking-com",
  },
  {
    file: "booking-profile-gating.json",
    state: "profile_gating",
    provider: "booking-com",
  },
  {
    file: "booking-network-provider-failure.json",
    state: "network_provider_failure",
    provider: "booking-com",
  },
  {
    file: "hotel-safety-boundary-violation.json",
    state: "safety_boundary_violation",
    provider: "booking-com",
  },
];

describe("analyzeHotelRetryArtifactBundle", () => {
  it.each(CASES)("classifies $file", async ({ file, state, provider }) => {
    const bundle = await readFixture(file);
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe(state);
    expect(analysis.jobId).toMatch(/^fixture-hotel-/);
    expect(analysis.provider).toBe(provider);
    expect(analysis.scenario).toBe("hotel");
    expect(analysis.signals.length).toBeGreaterThan(0);
  });

  it("prioritizes safety violations over otherwise successful checkout signals", async () => {
    const bundle = await readFixture("hotel-safety-boundary-violation.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("safety_boundary_violation");
    expect(analysis.signals.map((s) => s.kind)).toContain("payment_boundary");
    expect(analysis.signals[0]?.kind).toBe("safety_boundary_violation");
  });

  it("does not treat runbook safety notes as a login/CAPTCHA boundary", async () => {
    const bundle = await readFixture("booking-guest-details-reached.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("guest_details_manual_review_reached");
    expect(analysis.signals.map((s) => s.kind)).not.toContain("login_or_captcha");
  });

  it("covers safe hotel boundary classifications without invoking live providers", async () => {
    const safeBoundaryCases: Array<{ file: string; state: HotelRetryState }> = [
      {
        file: "booking-room-selection-reached.json",
        state: "room_selection_manual_review_reached",
      },
      {
        file: "booking-guest-details-reached.json",
        state: "guest_details_manual_review_reached",
      },
      {
        file: "hotels-payment-manual-review-reached.json",
        state: "payment_manual_review_reached",
      },
      {
        file: "booking-login-captcha-boundary.json",
        state: "login_or_captcha_boundary",
      },
      {
        file: "booking-network-provider-failure.json",
        state: "network_provider_failure",
      },
    ];

    for (const { file, state } of safeBoundaryCases) {
      const bundle = await readFixture(file);
      const analysis = analyzeHotelRetryArtifactBundle(bundle);

      expect(analysis.state, file).toBe(state);
      expect(analysis.nextAction, file).not.toMatch(
        /\b(click|press|submit|enter|fill)\s+(final|cvv|cvc|payment|otp|captcha|login)\b/i,
      );
    }
  });

  it("returns insufficient evidence for bundles without known signals", () => {
    const analysis = analyzeHotelRetryArtifactBundle({
      job: {
        id: "fixture-hotel-no-signals",
        provider: "booking-com",
        scenario: "hotel",
        status: "failed",
      },
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.confidence).toBe("low");
    expect(analysis.signals).toEqual([]);
  });
});

describe("Hotel retry markdown helpers", () => {
  it("formats a paste-ready summary from an analysis", async () => {
    const bundle = await readFixture("booking-room-selection-drift.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);
    const markdown = formatHotelRetryAnalysisMarkdown(analysis);

    expect(markdown).toContain("## Hotel Retry Artifact Analysis");
    expect(markdown).toContain("room_selection_drift");
    expect(markdown).toContain("worker/.debug-screenshots/booking-com-fixture-room-drift");
    expect(markdown).toContain("### Next Action");
  });

  it("formats a paste-ready summary directly from an artifact bundle", async () => {
    const bundle = await readFixture("hotels-payment-manual-review-reached.json");
    const markdown = formatHotelRetryArtifactBundleMarkdown(bundle);

    expect(markdown).toContain("payment_manual_review_reached");
    expect(markdown).toContain("Hotel Retry Artifact Analysis");
    expect(markdown).toContain("codex-worker.log");
  });
});

async function readFixture(file: string): Promise<HotelRetryArtifactBundle> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, file), "utf8");
  return JSON.parse(raw) as HotelRetryArtifactBundle;
}
