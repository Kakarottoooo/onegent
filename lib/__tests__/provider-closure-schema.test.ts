import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  findProviderClosureSafetyFindings,
  normalizeProviderClosureArtifact,
  normalizeProviderClosureKind,
  ProviderClosureError,
} from "@/lib/provider-closure";

const ROOT = process.cwd();

describe("provider closure schema", () => {
  it("normalizes CLI aliases into provider closure kinds", () => {
    expect(normalizeProviderClosureKind("restaurant")).toBe("restaurant");
    expect(normalizeProviderClosureKind("flight")).toBe("expedia-flight");
    expect(normalizeProviderClosureKind("expedia")).toBe("expedia-flight");
    expect(normalizeProviderClosureKind("hotel")).toBe("hotel");
    expect(normalizeProviderClosureKind("activity")).toBeNull();
  });

  it("accepts existing analyzer fixtures as closure artifacts", () => {
    const fixture = readJson(
      "lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json",
    );

    const artifact = normalizeProviderClosureArtifact(
      fixture,
      "expedia-flight",
      {
        inputPath:
          "lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json",
      },
    );

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.kind).toBe("expedia-flight");
    expect(artifact.analyzerFixturePath).toContain(
      "checkout-manual-review-reached.json",
    );
  });

  it("accepts the typed closure artifact schema", () => {
    const artifact = normalizeProviderClosureArtifact({
      schemaVersion: 1,
      kind: "hotel",
      synthetic: true,
      fixtureId: "fixture-provider-closure-hotel",
      job: {
        id: "fixture-provider-closure-hotel",
        provider: "booking-com",
        scenario: "hotel",
        status: "manual_review",
      },
      workerLogExcerpt: "Booking.com room selection reached for manual review.",
    });

    expect(artifact.kind).toBe("hotel");
    expect(artifact.fixtureId).toBe("fixture-provider-closure-hotel");
  });

  it("rejects empty, mismatched, and unsupported artifacts", () => {
    expect(() => normalizeProviderClosureArtifact({}, "restaurant")).toThrow(
      ProviderClosureError,
    );
    expect(() =>
      normalizeProviderClosureArtifact({ schemaVersion: 2, kind: "hotel", job: {} }),
    ).toThrow(ProviderClosureError);
    expect(() =>
      normalizeProviderClosureArtifact(
        {
          schemaVersion: 1,
          kind: "restaurant",
          job: { id: "fixture-kind-mismatch" },
        },
        "hotel",
      ),
    ).toThrow(ProviderClosureError);
  });

  it("flags real PII and secret-like values", () => {
    const raw = JSON.stringify({
      job: { id: "fixture-unsafe", provider: "resy", scenario: "R-030", status: "failed" },
      workerLogExcerpt:
        "email jane.customer@gmail.com cvv: 123 otp: 654321 card 4242 4242 4242 4242",
    });

    const findings = findProviderClosureSafetyFindings(raw);
    expect(findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        "email",
        "payment_card",
        "cvv_secret",
        "otp_secret",
      ]),
    );
    expect(() =>
      normalizeProviderClosureArtifact(JSON.parse(raw), "restaurant", { rawText: raw }),
    ).toThrow(ProviderClosureError);
  });
});

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf8")) as unknown;
}
