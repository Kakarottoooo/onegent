import { describe, expect, it } from "vitest";
import type { AgentFeedbackEvent, BookingJobSummary } from "@/lib/db";
import type { RelationshipProfile } from "@/lib/memory";
import { buildCompactMemoryResponse } from "@/lib/memory-read-model";

const baseEvent = {
  session_id: "session-1",
  job_id: "job-1",
  step_index: 0,
  step_type: "restaurant",
  venue_name: "Sirrah",
  provider: "opentable",
} satisfies Partial<AgentFeedbackEvent>;

function event(
  id: string,
  patch: Partial<AgentFeedbackEvent> = {},
): AgentFeedbackEvent {
  return {
    ...baseEvent,
    id,
    agent_decision: "time_adjusted",
    outcome: "accepted",
    metadata: {
      rawLog: "do-not-return-log",
      screenshot: "do-not-return-screenshot",
    },
    ...patch,
  } as AgentFeedbackEvent;
}

const jobs: BookingJobSummary[] = [
  {
    id: "job-1",
    session_id: "session-1",
    user_id: null,
    trip_label: "date night dinner in New York",
    status: "done",
    step_count: 1,
    action_count: 0,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    completed_at: "2026-05-01T01:00:00.000Z",
  },
];

const relationship: RelationshipProfile = {
  id: "rel-1",
  name: "Date night",
  type: "couple",
  session_ids: ["session-1", "session-2"],
  constraints: ["quiet table"],
  avoid_types: ["outdoor in rain"],
  notes: "do-not-return-relationship-notes",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
};

describe("compact memory read model", () => {
  it("returns bounded shell-safe memory summaries without raw detail payloads", () => {
    const response = buildCompactMemoryResponse({
      events: [
        event("e1"),
        event("e2"),
        event("e3"),
        event("e4", { outcome: "manual_override" }),
        event("e5", { provider: "resy", agent_decision: "venue_switched" }),
        event("j1", { step_type: "job", agent_decision: "n/a", outcome: "satisfied" }),
      ],
      jobs,
      relationship,
      eventLimit: 200,
      jobLimit: 50,
    });

    expect(response.meta.shape).toBe("memory-compact");
    expect(response.totalEvents).toBe(6);
    expect(response.stepEvents).toBe(5);
    expect(response.jobEvents).toBe(1);
    expect(response.confidenceLevel).toBe("low");
    expect(response.providers[0]).toMatchObject({
      provider: "opentable",
      eventCount: 4,
      acceptanceRate: 0.75,
      manualOverrideRate: 0.25,
    });
    expect(response.scenarios.top[0]).toMatchObject({
      scenario: "date_night",
      stepType: "restaurant",
      totalEvents: 5,
    });
    expect(response.relationship).toMatchObject({
      hasRelationship: true,
      id: "rel-1",
      name: "Date night",
      type: "couple",
      constraintCount: 1,
      avoidTypeCount: 1,
      sessionCount: 2,
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("do-not-return-log");
    expect(serialized).not.toContain("do-not-return-screenshot");
    expect(serialized).not.toContain("do-not-return-relationship-notes");
    expect(serialized).not.toContain("\"metadata\"");
    expect(serialized).not.toContain("\"notes\"");
  });

  it("keeps relationship summary empty when no relationship exists", () => {
    const response = buildCompactMemoryResponse({
      events: [],
      jobs: [],
      relationship: null,
    });

    expect(response.hasEnoughData).toBe(false);
    expect(response.relationship).toEqual({
      hasRelationship: false,
      id: null,
      name: null,
      type: null,
      constraintCount: 0,
      avoidTypeCount: 0,
      sessionCount: 0,
    });
  });
});
