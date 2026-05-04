import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeExpediaRetryArtifactBundle,
  type ExpediaRetryArtifactBundle,
} from "@/lib/runtime-forensics/expedia-retry-analysis";

const EXACT_CONTROLLED_RETRY_PROMPT =
  "帮我订一个6月1号从奥兰多飞 Nashville 的机票，一个人";

const EXPECTED_PARAMS = {
  origin: "MCO",
  dest: "BNA",
  date: "2026-06-01",
  passengers: 1,
};

describe("Expedia controlled retry no-live preflight", () => {
  it("documents the exact Chinese retry prompt and normalized Expedia params", async () => {
    const runbook = await fs.readFile(
      path.join(
        process.cwd(),
        "docs",
        "50-product-areas",
        "EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      ),
      "utf8",
    );

    expect(runbook).toContain(EXACT_CONTROLLED_RETRY_PROMPT);
    expect(runbook).toContain('"origin": "MCO"');
    expect(runbook).toContain('"dest": "BNA"');
    expect(runbook).toContain('"date": "2026-06-01"');
    expect(runbook).toContain('"passengers": 1');
    expect(runbook).toContain("steps[0].body.__source");
    expect(runbook).toContain("step.__source");
  });

  it("checks expected params, source marker, and fallback signal classification", () => {
    const bundle = makeControlledRetryBundle({
      workerLogExcerpt:
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught\n" +
        "[flight-rpa] Trying locator fallback for flight-card scan\n" +
        '[flight-rpa] No matching flight button found (tried airline="Southwest" price=$152)',
    });

    expect(bundle.job?.params).toMatchObject(EXPECTED_PARAMS);
    expect(bundle.job?.steps?.[0]?.__source).toMatch(/^lib\/core\/execution/);

    const analysis = analyzeExpediaRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("fallback_attempted_no_match");
    expect(analysis.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "card_scan_failed",
        "fallback_attempted",
        "no_match",
      ]),
    );
  });

  it("lets checkout/manual-review evidence win over diagnostic fallback signals", () => {
    const bundle = makeControlledRetryBundle({
      status: "ready_for_confirmation",
      terminalReason: "checkout_reached_manual_review",
      workerLogExcerpt:
        "[flight-rpa] Flight-card DOM scan failed: StagehandEvalError: Uncaught\n" +
        "[flight-rpa] Trying locator fallback for flight-card scan\n" +
        "[flight-rpa] Locator fallback matched flight card: Southwest 8:50am MCO to BNA $152\n" +
        "[flight-rpa] flight checkout was not reached during an earlier diagnostic probe\n" +
        "[flight-rpa] Checkout reached: traveler review page visible\n" +
        "[flight-rpa] safe handoff for manual review before payment",
    });

    const analysis = analyzeExpediaRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("checkout_manual_review_reached");
    expect(analysis.signals[0]?.kind).toBe("checkout_reached");
    expect(analysis.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining([
        "checkout_reached",
        "fallback_matched",
        "fallback_attempted",
        "card_scan_failed",
      ]),
    );
  });
});

function makeControlledRetryBundle(
  overrides: Pick<
    ExpediaRetryArtifactBundle,
    "workerLogExcerpt"
  > & {
    status?: string;
    terminalReason?: string;
  },
): ExpediaRetryArtifactBundle {
  return {
    job: {
      id: "fixture-expedia-controlled-retry-preflight",
      taskId: "fixture-task-expedia-controlled-retry-preflight",
      provider: "expedia",
      scenario: "flight",
      status: overrides.status ?? "failed",
      terminalReason: overrides.terminalReason,
      steps: [
        {
          name: "book-flight",
          type: "flight",
          __source: "lib/core/execution-local-fixture",
          error: null,
        },
      ],
      params: {
        ...EXPECTED_PARAMS,
        cabin_class: "economy",
        targetAirline: "Southwest",
        targetDepartureTime: "08:50",
        targetFlightNumber: "WN 3084",
        targetPrice: 152,
      },
    },
    workerLogExcerpt: overrides.workerLogExcerpt,
    workerLogPath:
      "C:\\Users\\Gzw19\\onegent-integrated-20260504\\codex-worker.log",
    screenshotPaths: [
      "C:\\Users\\Gzw19\\onegent-integrated-20260504\\worker\\.debug-screenshots\\flight-rpa-fixture\\01-search-results.jpg",
    ],
    liveSnapshotPaths: [
      "C:\\Users\\Gzw19\\onegent-integrated-20260504\\.debug-screenshots\\live\\fixture-expedia-controlled-retry-preflight\\snapshot.json",
    ],
    notes: [
      "Synthetic no-live preflight fixture for the exact controlled Expedia retry prompt.",
    ],
  };
}
