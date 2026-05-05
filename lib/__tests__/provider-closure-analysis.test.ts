import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeProviderClosureArtifact,
  formatProviderClosureReportMarkdown,
} from "@/lib/provider-closure";

const ROOT = process.cwd();

describe("provider closure analysis", () => {
  it("classifies restaurant phone/OTP handoff as a safe provider boundary", () => {
    const analysis = analyzeProviderClosureArtifact(
      readJson(
        "lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/opentable-phone-otp-handoff.json",
      ),
      "restaurant",
    );

    expect(analysis.kind).toBe("restaurant");
    expect(analysis.terminalOutcome).toBe("login_otp_boundary");
    expect(analysis.providerAnalysis.state).toBe("opentable_phone_otp_handoff");
    expect(analysis.exactNextStep).toContain("must not bypass");
  });

  it("classifies Expedia checkout/manual review as a safe handoff", () => {
    const analysis = analyzeProviderClosureArtifact(
      readJson(
        "lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json",
      ),
      "expedia-flight",
    );

    expect(analysis.terminalOutcome).toBe("safe_handoff");
    expect(analysis.providerAnalysis.state).toBe(
      "checkout_manual_review_reached",
    );
    expect(analysis.recommendedControlledRun).toContain("No immediate");
  });

  it("classifies hotel room selection as safe partial progress", () => {
    const analysis = analyzeProviderClosureArtifact(
      readJson(
        "lib/runtime-forensics/__fixtures__/hotel-retry-analysis/booking-room-selection-reached.json",
      ),
      "hotel",
    );

    expect(analysis.terminalOutcome).toBe("safe_handoff");
    expect(analysis.providerAnalysis.state).toBe(
      "room_selection_manual_review_reached",
    );
    expect(analysis.exactNextStep).toContain("safe closure progress");
  });

  it("classifies hotel safety violations as unsafe/blocked", () => {
    const analysis = analyzeProviderClosureArtifact(
      readJson(
        "lib/runtime-forensics/__fixtures__/hotel-retry-analysis/hotel-safety-boundary-violation.json",
      ),
      "hotel",
    );

    expect(analysis.terminalOutcome).toBe("unsafe_blocked");
    expect(analysis.providerAnalysis.state).toBe("safety_boundary_violation");
    expect(analysis.exactNextStep).toContain("Stop");
  });

  it("keeps OpenAI Responses API 500 separate from provider degradation", () => {
    const analysis = analyzeProviderClosureArtifact(
      {
        schemaVersion: 1,
        kind: "expedia-flight",
        synthetic: true,
        fixtureId: "fixture-openai-responses-500",
        job: {
          id: "fixture-openai-responses-500",
          provider: "expedia",
          scenario: "flight",
          status: "failed",
        },
        workerLogExcerpt:
          "OpenAI Responses API 500: upstream model worker unavailable during Computer Use turn",
      },
      "expedia-flight",
    );

    expect(analysis.terminalOutcome).toBe("model_env_transient");
    expect(analysis.runtimeClass).toBe("model_or_env_blocked");
    expect(analysis.runtimeClassification.alternatives.map((alt) => alt.class)).not.toContain(
      "network_or_provider_5xx",
    );
  });

  it("renders an actionable markdown report", () => {
    const analysis = analyzeProviderClosureArtifact(
      readJson(
        "lib/runtime-forensics/__fixtures__/expedia-retry-analysis/fallback-matched-no-checkout.json",
      ),
      "expedia-flight",
    );
    const markdown = formatProviderClosureReportMarkdown(analysis);

    expect(markdown).toContain("# Provider Closure Report");
    expect(markdown).toContain("## Exact Next Step");
    expect(markdown).toContain("selector_drift");
    expect(markdown).toContain("No live provider run from this harness");
  });
});

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf8")) as unknown;
}
