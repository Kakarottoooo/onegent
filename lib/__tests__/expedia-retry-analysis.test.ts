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
});

async function readFixture(file: string): Promise<ExpediaRetryArtifactBundle> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, file), "utf8");
  return JSON.parse(raw) as ExpediaRetryArtifactBundle;
}
