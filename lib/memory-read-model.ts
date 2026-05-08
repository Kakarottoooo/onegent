import type { AgentFeedbackEvent, BookingJobSummary } from "@/lib/db";
import {
  buildPatternMemory,
  buildTaskMemory,
  type RelationshipProfile,
} from "@/lib/memory";

export type CompactMemoryProvider = {
  provider: string;
  eventCount: number;
  acceptanceRate: number;
  manualOverrideRate: number;
};

export type CompactMemoryScenario = {
  scenario: string;
  scenarioLabel: string;
  stepType: string;
  totalEvents: number;
  acceptanceRate: number;
  overrideRate: number;
  keyInsight: string;
};

export type CompactMemoryRelationship = {
  hasRelationship: boolean;
  id: string | null;
  name: string | null;
  type: RelationshipProfile["type"] | null;
  constraintCount: number;
  avoidTypeCount: number;
  sessionCount: number;
};

export type CompactMemoryResponse = {
  totalEvents: number;
  stepEvents: number;
  jobEvents: number;
  hasEnoughData: boolean;
  confidenceLevel: "high" | "medium" | "low" | "insufficient";
  providers: CompactMemoryProvider[];
  tolerances: {
    timeAdjust: "liberal" | "moderate" | "strict" | null;
    venueSwitch: "liberal" | "moderate" | "strict" | null;
  };
  scenarios: {
    count: number;
    top: CompactMemoryScenario[];
  };
  patterns: {
    statedVsActual: {
      conclusion: "matches" | "more_strict" | "more_liberal" | "unknown";
      actualAcceptanceRate: number | null;
    };
    satisfactionPredictorCount: number;
    overrideTriggerCount: number;
    topOverrideTriggers: Array<{
      context: string;
      trigger: string;
      overrideRate: number;
      eventCount: number;
      description: string;
    }>;
  };
  relationship: CompactMemoryRelationship;
  meta: {
    shape: "memory-compact";
    source_event_limit: number;
    source_job_limit: number;
    heavy_fields_excluded: string[];
  };
};

export const MEMORY_COMPACT_HEAVY_FIELDS_EXCLUDED = [
  "raw_feedback_metadata",
  "steps",
  "autonomy_settings",
  "relationship_notes",
  "scenario_memory_rows",
  "pattern_memory_rows",
  "preference_profile",
  "venue_score_maps",
];

export const DEFAULT_MEMORY_COMPACT_EVENT_LIMIT = 200;
export const DEFAULT_MEMORY_COMPACT_JOB_LIMIT = 50;

export function buildCompactMemoryResponse(params: {
  events: AgentFeedbackEvent[];
  jobs: Pick<BookingJobSummary, "id" | "trip_label">[];
  relationship: RelationshipProfile | null;
  eventLimit?: number;
  jobLimit?: number;
}): CompactMemoryResponse {
  const stepEvents = params.events.filter((event) => event.step_type !== "job");
  const jobEvents = params.events.length - stepEvents.length;
  const jobLabels = new Map(params.jobs.map((job) => [job.id, job.trip_label]));
  const taskMemory = buildTaskMemory(params.events, jobLabels);
  const patternMemory = buildPatternMemory(params.events, new Map(), jobLabels);

  return {
    totalEvents: params.events.length,
    stepEvents: stepEvents.length,
    jobEvents,
    hasEnoughData: stepEvents.length >= 5,
    confidenceLevel: confidenceFor(stepEvents.length),
    providers: summarizeProviders(stepEvents),
    tolerances: summarizeTolerances(stepEvents),
    scenarios: {
      count: taskMemory.length,
      top: taskMemory.slice(0, 5).map((memory) => ({
        scenario: memory.scenario,
        scenarioLabel: memory.scenarioLabel,
        stepType: memory.stepType,
        totalEvents: memory.totalEvents,
        acceptanceRate: memory.acceptanceRate,
        overrideRate: memory.overrideRate,
        keyInsight: memory.keyInsight,
      })),
    },
    patterns: {
      statedVsActual: {
        conclusion: patternMemory.statedVsActual.conclusion,
        actualAcceptanceRate: patternMemory.statedVsActual.actualAcceptanceRate,
      },
      satisfactionPredictorCount: patternMemory.satisfactionPredictors.length,
      overrideTriggerCount: patternMemory.overrideTriggers.length,
      topOverrideTriggers: patternMemory.overrideTriggers.slice(0, 5).map((trigger) => ({
        context: trigger.context,
        trigger: trigger.trigger,
        overrideRate: trigger.overrideRate,
        eventCount: trigger.eventCount,
        description: trigger.description,
      })),
    },
    relationship: compactRelationship(params.relationship),
    meta: {
      shape: "memory-compact",
      source_event_limit: params.eventLimit ?? DEFAULT_MEMORY_COMPACT_EVENT_LIMIT,
      source_job_limit: params.jobLimit ?? DEFAULT_MEMORY_COMPACT_JOB_LIMIT,
      heavy_fields_excluded: MEMORY_COMPACT_HEAVY_FIELDS_EXCLUDED,
    },
  };
}

function confidenceFor(stepEventCount: number): CompactMemoryResponse["confidenceLevel"] {
  if (stepEventCount >= 20) return "high";
  if (stepEventCount >= 10) return "medium";
  if (stepEventCount >= 5) return "low";
  return "insufficient";
}

function summarizeProviders(events: AgentFeedbackEvent[]): CompactMemoryProvider[] {
  const byProvider = new Map<string, { total: number; accepted: number; manual: number }>();
  for (const event of events) {
    if (!event.provider) continue;
    const current = byProvider.get(event.provider) ?? { total: 0, accepted: 0, manual: 0 };
    current.total += 1;
    if (event.outcome === "accepted") current.accepted += 1;
    if (event.outcome === "manual_override") current.manual += 1;
    byProvider.set(event.provider, current);
  }

  return [...byProvider.entries()]
    .map(([provider, stats]) => ({
      provider,
      eventCount: stats.total,
      acceptanceRate: stats.total > 0 ? stats.accepted / stats.total : 0,
      manualOverrideRate: stats.total > 0 ? stats.manual / stats.total : 0,
    }))
    .sort((a, b) => b.eventCount - a.eventCount || b.acceptanceRate - a.acceptanceRate)
    .slice(0, 5);
}

function summarizeTolerances(events: AgentFeedbackEvent[]): CompactMemoryResponse["tolerances"] {
  return {
    timeAdjust: toleranceFor(events.filter((event) => event.agent_decision === "time_adjusted")),
    venueSwitch: toleranceFor(events.filter((event) => event.agent_decision === "venue_switched")),
  };
}

function toleranceFor(events: AgentFeedbackEvent[]): "liberal" | "moderate" | "strict" | null {
  if (events.length < 3) return null;
  const acceptanceRate = events.filter((event) => event.outcome === "accepted").length / events.length;
  if (acceptanceRate >= 0.7) return "liberal";
  if (acceptanceRate >= 0.4) return "moderate";
  return "strict";
}

function compactRelationship(relationship: RelationshipProfile | null): CompactMemoryRelationship {
  if (!relationship) {
    return {
      hasRelationship: false,
      id: null,
      name: null,
      type: null,
      constraintCount: 0,
      avoidTypeCount: 0,
      sessionCount: 0,
    };
  }

  return {
    hasRelationship: true,
    id: relationship.id,
    name: relationship.name,
    type: relationship.type,
    constraintCount: relationship.constraints.length,
    avoidTypeCount: relationship.avoid_types.length,
    sessionCount: relationship.session_ids.length,
  };
}
