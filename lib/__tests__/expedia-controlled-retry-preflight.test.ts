import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXPEDIA_CONTROLLED_RETRY_PROMPT,
  EXPEDIA_CONTROLLED_RETRY_START_URL,
  EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS,
  EXPEDIA_FLIGHT_HARD_STOPS,
  validateExpediaFlightLiveReadiness,
} from "@/lib/runtime-forensics/expedia-flight-live-readiness";
import {
  analyzeExpediaRetryArtifactBundle,
  type ExpediaRetryArtifactBundle,
} from "@/lib/runtime-forensics/expedia-retry-analysis";

const EXPECTED_PARAMS = {
  origin: "MCO",
  dest: "BNA",
  date: "2026-06-01",
  passengers: 1,
};

describe("Expedia controlled retry no-live preflight", () => {
  it("documents the exact retry prompt and normalized Expedia params", async () => {
    const runbook = await fs.readFile(
      path.join(
        process.cwd(),
        "docs",
        "50-product-areas",
        "EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      ),
      "utf8",
    );

    expect(runbook).toContain(EXPEDIA_CONTROLLED_RETRY_PROMPT);
    expect(runbook).toContain('"origin": "MCO"');
    expect(runbook).toContain('"dest": "BNA"');
    expect(runbook).toContain('"date": "2026-06-01"');
    expect(runbook).toContain('"passengers": 1');
    expect(runbook).toContain("steps[0].body.__source");
    expect(runbook).toContain("step.__source");
  });

  it("keeps the controlled retry artifact template complete and fake-only", async () => {
    const raw = await fs.readFile(
      path.join(
        process.cwd(),
        "docs",
        "50-product-areas",
        "EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json",
      ),
      "utf8",
    );
    const template = JSON.parse(raw) as ExpediaRetryArtifactBundle & {
      dbRow?: { steps?: unknown[] };
    };

    expect(template.job?.params).toMatchObject(EXPECTED_PARAMS);
    expect(template.dbRow).toMatchObject({
      id: "fixture-expedia-retry-job",
      task_id: "fixture-expedia-retry-task",
      trip_label: "Synthetic Southwest MCO->BNA 2026-06-01",
      status: "failed",
    });
    expect(template.dbRow?.steps?.length).toBeGreaterThan(0);
    expect(template.workerLogExcerpt).toContain("Flight-card DOM scan failed");
    expect(template.workerLogPath).toBe(
      EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.workerLogPath,
    );
    expect(template.benchmarkReportPath).toBe(
      EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.benchmarkReportGlob,
    );
    expect(template.screenshotPaths).toContain(
      EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.screenshotGlob,
    );
    expect(template.liveSnapshotPaths).toContain(
      EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.liveSnapshotGlob,
    );
    expect(template.expectedClassificationTaxonomy).toEqual(
      expect.arrayContaining([
        "card_scan_failed_before_fallback",
        "checkout_manual_review_reached",
        "login_or_otp_boundary",
        "model_or_env_transient",
        "provider_no_availability",
      ]),
    );
    expect(raw).toContain("Synthetic template only");
    expect(raw).not.toContain("sk-");
  });

  it("validates env names, exact prompt, hard stops, and artifact paths without leaking env values", () => {
    const result = validateExpediaFlightLiveReadiness({
      env: {
        POSTGRES_URL: "postgres://super-secret",
        OPENAI_API_KEY: "sk-super-secret",
        USE_WORKER_FOR: "restaurant,hotel,flight,activity",
      },
      prompt: EXPEDIA_CONTROLLED_RETRY_PROMPT,
      startUrl: EXPEDIA_CONTROLLED_RETRY_START_URL,
      hardStops: [...EXPEDIA_FLIGHT_HARD_STOPS],
      artifactPaths: {
        workerLogPath: EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.workerLogPath,
        screenshotPaths: [
          EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.screenshotGlob,
        ],
        liveSnapshotPaths: [
          EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.liveSnapshotGlob,
        ],
        benchmarkReportPath:
          EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.benchmarkReportGlob,
      },
    });

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("postgres://super-secret");
    expect(serialized).not.toContain("sk-super-secret");
  });

  it("fails safely when required env names or hard-stop coverage are missing", () => {
    const result = validateExpediaFlightLiveReadiness({
      env: {
        POSTGRES_URL: "postgres://super-secret",
        USE_WORKER_FOR: "restaurant,hotel",
        BROWSERBASE_API_KEY: "bb-secret",
      },
      prompt: "wrong prompt",
      startUrl: "https://www.expedia.com/",
      hardStops: ["payment submission", "CVV"],
      artifactPaths: {
        workerLogPath: null,
        screenshotPaths: [],
        liveSnapshotPaths: [],
        benchmarkReportPath: null,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "env-required-names")).toMatchObject({
      ok: false,
      missingEnvNames: ["OPENAI_API_KEY"],
    });
    expect(result.checks.find((check) => check.id === "env-worker-routing")).toMatchObject({
      ok: false,
    });
    expect(result.checks.find((check) => check.id === "env-browserbase-pair")).toMatchObject({
      ok: false,
      missingEnvNames: ["BROWSERBASE_PROJECT_ID"],
    });
    expect(result.checks.find((check) => check.id === "hard-stops")).toMatchObject({
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain("postgres://super-secret");
    expect(JSON.stringify(result)).not.toContain("bb-secret");
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
    workerLogPath: EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.workerLogPath,
    screenshotPaths: [EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.screenshotGlob],
    liveSnapshotPaths: [
      EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.liveSnapshotGlob,
    ],
    benchmarkReportPath:
      EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.benchmarkReportGlob,
    expectedClassificationTaxonomy: [
      "card_scan_failed_before_fallback",
      "fallback_attempted_no_match",
      "fallback_matched_no_checkout",
      "checkout_manual_review_reached",
      "login_or_otp_boundary",
      "network_provider_failure",
      "model_or_env_transient",
      "provider_no_availability",
      "insufficient_evidence",
    ],
    notes: [
      "Synthetic no-live preflight fixture for the exact controlled Expedia retry prompt.",
    ],
  };
}
