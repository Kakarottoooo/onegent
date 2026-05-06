import { describe, expect, it, vi } from "vitest";
import type { BookingJobCalendarRow, BookingJobStep } from "@/lib/db";
import {
  CALENDAR_JOBS_HEAVY_FIELDS_EXCLUDED,
  buildCalendarJobItem,
} from "@/lib/calendar-read-model";

function step(overrides: Partial<BookingJobStep> = {}): BookingJobStep {
  return {
    type: "restaurant",
    emoji: "R",
    label: "Dinner",
    apiEndpoint: "/api/book",
    body: { date: "2026-05-14", time: "20:00", venue: "Sirrah" },
    fallbackUrl: "https://www.opentable.com/",
    status: "awaiting_confirmation",
    ...overrides,
  };
}

function row(overrides: Partial<BookingJobCalendarRow> = {}): BookingJobCalendarRow {
  return {
    id: "job-1",
    session_id: "session-1",
    user_id: "user-1",
    trip_label: "Dinner",
    status: "done",
    steps: [
      step({
        error: "large runtime error",
        actionItem: { message: "manual", options: [{ label: "Open", url: "https://example.com" }] },
        decisionLog: [{ ts: "2026-05-05T00:00:00.000Z", type: "info", message: "large log" }],
        fallbackCandidates: [{ label: "Backup", body: {}, fallbackUrl: "https://example.com" }],
      }),
    ],
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:01:00.000Z",
    ...overrides,
  };
}

describe("calendar compact jobs", () => {
  it("keeps only fields needed to draw calendar events", () => {
    const item = buildCalendarJobItem(row());

    expect(item).toMatchObject({
      id: "job-1",
      trip_label: "Dinner",
      status: "done",
      steps: [{ type: "restaurant", label: "Dinner", status: "awaiting_confirmation" }],
    });
    expect(JSON.stringify(item)).not.toContain("large runtime error");
    expect(JSON.stringify(item)).not.toContain("large log");
    expect(JSON.stringify(item)).not.toContain("fallbackCandidates");
    expect(item).not.toHaveProperty("autonomy_settings");
    expect(item).not.toHaveProperty("constraints");
    expect(CALENDAR_JOBS_HEAVY_FIELDS_EXCLUDED).toContain("decisionLog");
  });
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/calendar-db", () => ({
  getCalendarConnection: vi.fn(),
}));

describe("calendar Google compact status route", () => {
  it("returns connection metadata without event payloads", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    const { getCalendarConnection } = await import("@/lib/calendar-db");
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as Awaited<ReturnType<typeof auth>>);
    vi.mocked(getCalendarConnection).mockResolvedValue({
      id: "conn-1",
      user_id: "user-1",
      provider: "google",
      external_account_id: "primary",
      external_account_email: "user@example.com",
      calendar_timezone: "America/Chicago",
      access_token_enc: "token",
      refresh_token_enc: "refresh",
      access_token_expires_at: null,
      token_type: null,
      scope: null,
      last_synced_at: "2026-05-05T00:00:00.000Z",
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
    });

    const { GET } = await import("../../app/api/calendar/google/status/route");
    const res = await GET();
    const data = await res.json();

    expect(data).toMatchObject({
      connected: true,
      account_email: "user@example.com",
      meta: { shape: "calendar-google-status" },
    });
    expect(data).not.toHaveProperty("busy_counts");
    expect(data).not.toHaveProperty("events_by_day");
    expect(data.meta.heavy_fields_excluded).toContain("events_by_day");
  });
});
