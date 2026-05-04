import { describe, expect, it } from "vitest";

import {
  analyzeExpediaRetryArtifactBundle,
  type ExpediaRetryArtifactBundle,
} from "@/lib/runtime-forensics/expedia-retry-analysis";
import {
  analyzeHotelRetryArtifactBundle,
  type HotelRetryArtifactBundle,
} from "@/lib/runtime-forensics/hotel-retry-analysis";
import {
  analyzeRestaurantArtifactBundle,
  type RestaurantArtifactBundle,
} from "@/lib/runtime-forensics/restaurant-artifact-analysis";
import {
  ARTIFACT_BUNDLE_TEMPLATE_KINDS,
  ArtifactBundleTemplateCliError,
  createArtifactBundleTemplate,
  formatArtifactBundleTemplate,
  parseArtifactBundleTemplateCliArgs,
  runArtifactBundleTemplateCli,
  type ArtifactBundleTemplateKind,
} from "@/scripts/create-artifact-bundle-template";

describe("createArtifactBundleTemplate", () => {
  it.each(ARTIFACT_BUNDLE_TEMPLATE_KINDS)(
    "creates a normalized %s bridge template",
    (kind) => {
      const template = createArtifactBundleTemplate(kind);
      const job = getJob(template);
      const step = getFirstStep(job);

      expect(template.synthetic).toBe(true);
      expect(template.templateId).toBe(
        `synthetic-${kind}-artifact-bundle-template`,
      );
      expect(template.templateKind).toBe(kind);
      expect(job.id).toBe("<job-id>");
      expect(job.taskId).toBe("<task-id>");
      expect(job.provider).toContain("<provider:");
      expect(job.scenario).toBeTruthy();
      expect(job.status).toBe("<booking_jobs.status>");
      expect(job.params).toBeTruthy();
      expect(step.error).toBe("<steps[0].error>");
      expect(job.decisionLog).toEqual([
        {
          at: "<timestamp>",
          level: "<level>",
          event: "<event-name>",
          message: "<decision-log-message>",
        },
      ]);
      expect(template.workerLogExcerpt).toBe("<bounded-worker-log-excerpt>");
      expect(template.workerLogPath).toBe("<path-to-codex-worker.log>");
      expect(template.screenshotPaths).toEqual(["<path-to-provider-screenshot>"]);
      expect(template.liveSnapshotPaths).toEqual([
        "<path-to-live-snapshot-json>",
      ]);
      expect(template.notes).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Synthetic no-live bridge template"),
        ]),
      );
    },
  );

  it.each(ARTIFACT_BUNDLE_TEMPLATE_KINDS)(
    "contains no real PII or secret values for %s",
    (kind) => {
      const raw = formatArtifactBundleTemplate(kind);

      expect(findUnexpectedEmails(raw)).toEqual([]);
      expect(findUnexpectedPhones(raw)).toEqual([]);
      expect(findPaymentCards(raw)).toEqual([]);
      expect(findCvvSecretValues(raw)).toEqual([]);
      expect(findChallengeSecretValues(raw)).toEqual([]);
    },
  );

  it.each(ARTIFACT_BUNDLE_TEMPLATE_KINDS)(
    "is accepted by the %s analyzer as insufficient evidence",
    (kind) => {
      const template = createArtifactBundleTemplate(kind);

      expect(analyzeTemplate(kind, template).state).toBe("insufficient_evidence");
    },
  );
});

describe("artifact bundle template CLI", () => {
  it("parses --kind arguments", () => {
    expect(parseArtifactBundleTemplateCliArgs(["--kind", "restaurant"])).toEqual({
      kind: "restaurant",
    });
    expect(parseArtifactBundleTemplateCliArgs(["--kind=hotel"])).toEqual({
      kind: "hotel",
    });
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      parseArtifactBundleTemplateCliArgs(["--kind", "flight"]),
    ).toThrow(ArtifactBundleTemplateCliError);
  });

  it("prints JSON to stdout", async () => {
    const output: string[] = [];
    const exitCode = await runArtifactBundleTemplateCli(["--kind", "expedia"], {
      writeOutput: (text) => output.push(text),
      writeError: () => {
        throw new Error("should not write an error");
      },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output.join("\n")) as Record<string, unknown>;
    expect(parsed.templateKind).toBe("expedia");
    expect(getJob(parsed).provider).toBe("<provider: expedia>");
  });

  it("returns exit code 1 for missing kind", async () => {
    const errors: string[] = [];
    const exitCode = await runArtifactBundleTemplateCli([], {
      writeOutput: () => {
        throw new Error("should not write output");
      },
      writeError: (text) => errors.push(text),
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Usage:");
  });
});

function analyzeTemplate(
  kind: ArtifactBundleTemplateKind,
  template: Record<string, unknown>,
):
  | ReturnType<typeof analyzeRestaurantArtifactBundle>
  | ReturnType<typeof analyzeExpediaRetryArtifactBundle>
  | ReturnType<typeof analyzeHotelRetryArtifactBundle> {
  switch (kind) {
    case "restaurant":
      return analyzeRestaurantArtifactBundle(template as RestaurantArtifactBundle);
    case "expedia":
      return analyzeExpediaRetryArtifactBundle(template as ExpediaRetryArtifactBundle);
    case "hotel":
      return analyzeHotelRetryArtifactBundle(template as HotelRetryArtifactBundle);
  }
}

function getJob(value: Record<string, unknown>): Record<string, unknown> {
  const job = value.job;
  expect(isRecord(job)).toBe(true);
  return job as Record<string, unknown>;
}

function getFirstStep(job: Record<string, unknown>): Record<string, unknown> {
  const steps = job.steps;
  expect(Array.isArray(steps)).toBe(true);
  const [step] = steps as unknown[];
  expect(isRecord(step)).toBe(true);
  return step as Record<string, unknown>;
}

function findUnexpectedEmails(raw: string): string[] {
  const matches = raw.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  ) ?? [];
  return unique(
    matches.filter((email) => {
      const domain = email.split("@")[1]?.toLowerCase();
      return domain !== "example.com" && domain !== "example.test";
    }),
  );
}

function findUnexpectedPhones(raw: string): string[] {
  const matches = raw.match(/\+\d[\d().\-\s]{7,}\d/g) ?? [];
  return unique(
    matches.filter((phone) => {
      const normalized = phone.replace(/[^\d+]/g, "");
      return normalized !== "+10000000000";
    }),
  );
}

function findPaymentCards(raw: string): string[] {
  const matches = raw.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  return unique(
    matches.filter((candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits);
    }),
  );
}

function findCvvSecretValues(raw: string): string[] {
  const matches =
    raw.match(
      /\b(?:cvv|cvc|security code|security-code)\b[^"\n\r]{0,40}[:=]\s*"?\d{3,4}"?/gi,
    ) ?? [];
  return unique(matches);
}

function findChallengeSecretValues(raw: string): string[] {
  const matches =
    raw.match(
      /\b(?:otp|one[-\s]?time code|verification code|sms code|challenge-code)\b[^"\n\r]{0,40}[:=]\s*"?\d{4,8}"?/gi,
    ) ?? [];
  return unique(matches);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
