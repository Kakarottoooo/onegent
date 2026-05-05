import { describe, expect, it } from "vitest";

import {
  canUseNoDatabaseBookingJobsFallback,
  isMissingPostgresConnectionString,
} from "@/lib/booking-jobs/db-errors";

describe("booking job database error helpers", () => {
  it("detects Vercel Postgres missing connection string errors", () => {
    expect(isMissingPostgresConnectionString({ code: "missing_connection_string" })).toBe(
      true,
    );
    expect(
      isMissingPostgresConnectionString({
        message: "You did not supply a connectionString and no POSTGRES_URL env var was found.",
      }),
    ).toBe(true);
  });

  it("does not classify unrelated database errors as missing config", () => {
    expect(isMissingPostgresConnectionString({ code: "23505", message: "duplicate key" })).toBe(
      false,
    );
    expect(isMissingPostgresConnectionString(new Error("timeout"))).toBe(false);
    expect(isMissingPostgresConnectionString(null)).toBe(false);
  });

  it("allows the no-database fallback only outside production", () => {
    const err = { code: "missing_connection_string" };

    expect(canUseNoDatabaseBookingJobsFallback(err, "development")).toBe(true);
    expect(canUseNoDatabaseBookingJobsFallback(err, "test")).toBe(true);
    expect(canUseNoDatabaseBookingJobsFallback(err, "production")).toBe(false);
  });
});
