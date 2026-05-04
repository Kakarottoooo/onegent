import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatArtifactFixtureSummary,
  listArtifactFixtures,
  type ArtifactFixtureRecord,
} from "@/scripts/list-artifact-fixtures";

describe("artifact fixture corpus inventory", () => {
  it("lists every no-live restaurant, Expedia, and hotel fixture", async () => {
    const fixtures = await listArtifactFixtures();

    expect(fixtures).toHaveLength(27);
    expect(countDomain(fixtures, "restaurant")).toBe(10);
    expect(countDomain(fixtures, "expedia")).toBe(8);
    expect(countDomain(fixtures, "hotel")).toBe(9);
    expect(new Set(fixtures.map((fixture) => fixture.relativePath)).size).toBe(
      fixtures.length,
    );
  });

  it("prints counts by domain and class", async () => {
    const output = formatArtifactFixtureSummary(await listArtifactFixtures());

    expect(output).toContain("Artifact fixture corpus");
    expect(output).toContain("restaurant: 10");
    expect(output).toContain("expedia: 8");
    expect(output).toContain("hotel: 9");
    expect(output).toContain("resy_otp_login_boundary: 1");
    expect(output).toContain("checkout_manual_review_reached: 1");
    expect(output).toContain("payment_manual_review_reached: 1");
  });

  it("requires synthetic markers, fixture metadata, and no secret values", async () => {
    const fixtures = await listArtifactFixtures();

    for (const fixture of fixtures) {
      const { payload, raw } = await readFixture(fixture);
      const job = getJobRecord(payload);

      expect(
        hasFixtureId(job) || /\bsynthetic\b/i.test(raw),
        fixture.relativePath,
      ).toBe(true);
      expect(readNonEmptyString(job, "provider"), fixture.relativePath).toBe(
        fixture.provider,
      );
      expect(readNonEmptyString(job, "scenario"), fixture.relativePath).toBe(
        fixture.scenario,
      );
      expect(readNonEmptyString(job, "status"), fixture.relativePath).toBe(
        fixture.status,
      );

      expect(findUnexpectedEmails(raw), fixture.relativePath).toEqual([]);
      expect(findUnexpectedPhones(raw), fixture.relativePath).toEqual([]);
      expect(findPaymentCards(raw), fixture.relativePath).toEqual([]);
      expect(findCvvSecretValues(raw), fixture.relativePath).toEqual([]);
      expect(findOtpSecretValues(raw), fixture.relativePath).toEqual([]);
    }
  });
});

async function readFixture(
  fixture: ArtifactFixtureRecord,
): Promise<{ payload: unknown; raw: string }> {
  const raw = await fs.readFile(
    path.join(process.cwd(), fixture.relativePath),
    "utf8",
  );
  return { payload: JSON.parse(raw) as unknown, raw };
}

function countDomain(
  fixtures: readonly ArtifactFixtureRecord[],
  domain: ArtifactFixtureRecord["domain"],
): number {
  return fixtures.filter((fixture) => fixture.domain === domain).length;
}

function getJobRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const job = value.job;
  return isRecord(job) ? job : value;
}

function hasFixtureId(job: Record<string, unknown>): boolean {
  return ["id", "taskId", "task_id", "sessionId", "session_id"].some((key) => {
    const value = job[key];
    return typeof value === "string" && /\bfixture[-_]/i.test(value);
  });
}

function readNonEmptyString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
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
      /\b(?:cvv|cvc|security code)\b[^"\n\r]{0,40}[:=]\s*"?\d{3,4}"?/gi,
    ) ?? [];
  return unique(matches);
}

function findOtpSecretValues(raw: string): string[] {
  const matches =
    raw.match(
      /\b(?:otp|one[-\s]?time code|verification code|sms code)\b[^"\n\r]{0,40}[:=]\s*"?\d{4,8}"?/gi,
    ) ?? [];
  return unique(matches);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
