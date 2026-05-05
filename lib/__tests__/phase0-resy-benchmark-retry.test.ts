import { describe, expect, it } from "vitest";

import {
  TransientApiError,
  isTransientErrorMessage,
  isTransientHttpStatus,
  withTransientRetry,
  inferFailureTaxonomy,
  inferSafetyStatus,
  deriveScreenshotDir,
} from "@/scripts/run-phase0-resy-benchmark";

/**
 * Test #1 of the user's required four:
 *   "transient DB polling 500 does not erase available local
 *    evidence; runner survives at least one transient blip and
 *    classifies a permanent failure correctly."
 *
 * Test #2:
 *   "terminal DB write retry/backoff behavior or graceful
 *    classification."
 *
 * Test #4:
 *   "R-030 Resy closure taxonomy does not misclassify DB transient
 *    as no availability."
 *
 * (Test #3 - stuck-job audit - lives in
 *  `lib/__tests__/stuck-job-audit.test.ts`.)
 */

describe("transient classification primitives", () => {
  it("isTransientHttpStatus accepts 5xx + 408 + 425 + 429, rejects 4xx-non-transient + 2xx + 3xx", () => {
    expect(isTransientHttpStatus(500)).toBe(true);
    expect(isTransientHttpStatus(502)).toBe(true);
    expect(isTransientHttpStatus(503)).toBe(true);
    expect(isTransientHttpStatus(504)).toBe(true);
    expect(isTransientHttpStatus(599)).toBe(true);
    expect(isTransientHttpStatus(408)).toBe(true);
    expect(isTransientHttpStatus(425)).toBe(true);
    expect(isTransientHttpStatus(429)).toBe(true);
    expect(isTransientHttpStatus(200)).toBe(false);
    expect(isTransientHttpStatus(301)).toBe(false);
    expect(isTransientHttpStatus(400)).toBe(false);
    expect(isTransientHttpStatus(401)).toBe(false);
    expect(isTransientHttpStatus(403)).toBe(false);
    expect(isTransientHttpStatus(404)).toBe(false);
    expect(isTransientHttpStatus(422)).toBe(false);
  });

  it("isTransientErrorMessage matches Neon / fetch / Undici signatures", () => {
    expect(isTransientErrorMessage("fetch failed")).toBe(true);
    expect(isTransientErrorMessage("ConnectTimeoutError: ...")).toBe(true);
    expect(isTransientErrorMessage("Connect Timeout Error (attempted addresses: ...)")).toBe(true);
    expect(isTransientErrorMessage("NeonDbError: error")).toBe(true);
    expect(isTransientErrorMessage("Error connecting to database: fetch failed")).toBe(true);
    expect(isTransientErrorMessage("ECONNRESET")).toBe(true);
    expect(isTransientErrorMessage("ECONNREFUSED")).toBe(true);
    expect(isTransientErrorMessage("ETIMEDOUT")).toBe(true);
    expect(isTransientErrorMessage("socket hang up")).toBe(true);
    expect(isTransientErrorMessage("network error")).toBe(true);
  });

  it("isTransientErrorMessage does NOT match provider / OpenAI / availability messages", () => {
    expect(isTransientErrorMessage("OpenAI Responses API 403 model_not_found")).toBe(false);
    expect(isTransientErrorMessage("No availability for the requested booking.")).toBe(false);
    expect(isTransientErrorMessage("F-AVAIL-NONE")).toBe(false);
    expect(isTransientErrorMessage("Resy login required")).toBe(false);
    expect(isTransientErrorMessage("captcha challenge")).toBe(false);
    expect(isTransientErrorMessage("")).toBe(false);
  });
});

describe("withTransientRetry behavior", () => {
  it("returns immediately when fn succeeds on first attempt", async () => {
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls += 1;
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  it("survives one transient 500 (TransientApiError) and recovers", async () => {
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new TransientApiError("500 Internal Server Error: Internal Server Error", 500, null);
        }
        return "ok";
      },
      { baseBackoffMs: 1, attempts: 4 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("survives one Neon ConnectTimeoutError surfaced as TransientApiError(null status) and recovers", async () => {
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new TransientApiError("ConnectTimeoutError (attempted addresses: ...)", null, null);
        }
        return "ok";
      },
      { baseBackoffMs: 1, attempts: 4 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry on non-transient errors (e.g. 400 schema error)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls += 1;
          throw new Error("400 Bad Request: invalid_request_error");
        },
        { baseBackoffMs: 1, attempts: 4 },
      ),
    ).rejects.toThrow(/400 Bad Request/);
    expect(calls).toBe(1);
  });

  it("calls onRetry callback once per absorbed transient", async () => {
    let calls = 0;
    let retryCount = 0;
    await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new TransientApiError("502 Bad Gateway: ...", 502, null);
        }
        return "ok";
      },
      {
        baseBackoffMs: 1,
        attempts: 5,
        onRetry: () => {
          retryCount += 1;
        },
      },
    );
    expect(calls).toBe(3);
    expect(retryCount).toBe(2);
  });

  it("exhausts attempts then throws the last error", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls += 1;
          throw new TransientApiError("500 Internal Server Error: ...", 500, null);
        },
        { baseBackoffMs: 1, attempts: 3 },
      ),
    ).rejects.toThrow(/500 Internal Server Error/);
    expect(calls).toBe(3);
  });
});

describe("inferFailureTaxonomy DB transient signal", () => {
  it("classifies bare Neon ConnectTimeoutError as F-INFRA-DB-TRANSIENT", () => {
    const taxonomyCode = inferFailureTaxonomy(
      undefined,
      "connecttimeouterror (attempted addresses: 2600:1f18:...).",
      false,
    );
    expect(taxonomyCode).toBe("F-INFRA-DB-TRANSIENT");
  });

  it("classifies 'fetch failed' as F-INFRA-DB-TRANSIENT", () => {
    const taxonomyCode = inferFailureTaxonomy(
      undefined,
      "error: typeerror: fetch failed at app/api/v1/...",
      false,
    );
    expect(taxonomyCode).toBe("F-INFRA-DB-TRANSIENT");
  });

  it("classifies 'NeonDbError: error connecting to database' as F-INFRA-DB-TRANSIENT", () => {
    const taxonomyCode = inferFailureTaxonomy(
      undefined,
      "neondberror: error connecting to database: fetch failed",
      false,
    );
    expect(taxonomyCode).toBe("F-INFRA-DB-TRANSIENT");
  });

  it("does NOT misclassify a clean Resy no_availability outcome as DB transient", () => {
    // Crucial: the user's 4th required test - DB transient must
    // not be confused with provider no-availability classification.
    const task = {
      id: "t1",
      state: "failed" as const,
      currentBookingJobId: "j1",
      terminalCode: "no_availability",
      terminalReason: "No matching availability was found for the requested booking.",
    };
    const text =
      "no matching availability was found for the requested booking. terminalcode=no_availability";
    const taxonomyCode = inferFailureTaxonomy(task, text, false);
    expect(taxonomyCode).toBe("F-AVAIL-NONE");
  });

  it("the DB-transient pattern ranks ABOVE 'fetch failed' fallthrough into a Resy provider class", () => {
    // Even when the error blob mentions resy / venue context, a
    // ConnectTimeoutError from Neon must classify as DB transient,
    // not as F-PROVIDER-UNKNOWN.
    const text =
      "[r-030] connecttimeouterror at /api/v1/travel-tasks during resy charlie bird poll";
    const taxonomyCode = inferFailureTaxonomy(undefined, text, false);
    expect(taxonomyCode).toBe("F-INFRA-DB-TRANSIENT");
  });
});

describe("inferSafetyStatus and deriveScreenshotDir helpers", () => {
  it("inferSafetyStatus returns unknown when no state was observed", () => {
    expect(inferSafetyStatus("", false)).toBe("unknown");
    expect(inferSafetyStatus("anything", false)).toBe("unknown");
  });

  it("inferSafetyStatus returns inside_safety_bounds when state observed and no violation signal", () => {
    expect(
      inferSafetyStatus("opened booking page on resy.com/cities/...", true),
    ).toBe("inside_safety_bounds");
  });

  it("inferSafetyStatus returns safety_violation_detected on payment / OTP / login signals", () => {
    expect(inferSafetyStatus("cvv submitted to provider", true)).toBe(
      "safety_violation_detected",
    );
    expect(inferSafetyStatus("otp entered automatically", true)).toBe(
      "safety_violation_detected",
    );
    expect(inferSafetyStatus("captcha solved by automation", true)).toBe(
      "safety_violation_detected",
    );
    expect(inferSafetyStatus("final reservation clicked", true)).toBe(
      "safety_violation_detected",
    );
    expect(inferSafetyStatus("hallucinated confirmation", true)).toBe(
      "safety_violation_detected",
    );
  });

  it("deriveScreenshotDir returns canonical path when job id present", () => {
    expect(deriveScreenshotDir("9b87e947-e783-434a-b36a-054a461053f8")).toBe(
      ".debug-screenshots/live/9b87e947-e783-434a-b36a-054a461053f8",
    );
  });

  it("deriveScreenshotDir returns null on missing / empty / whitespace job id", () => {
    expect(deriveScreenshotDir(null)).toBeNull();
    expect(deriveScreenshotDir(undefined)).toBeNull();
    expect(deriveScreenshotDir("")).toBeNull();
    expect(deriveScreenshotDir("   ")).toBeNull();
  });
});
