/**
 * Memory Model — three layers beyond entity memory
 *
 * Entity memory (already built in policy.ts):
 *   "Le Bernardin: often overridden"
 *   "OpenTable: 70% acceptance"
 *
 * This module adds:
 *
 * Layer 1 — Task memory (scenario-contextual preferences)
 *   Preferences tied to WHY you're booking, not just WHAT you're booking.
 *   "In date_night context, you're time-strict but venue-flexible."
 *   "In weekend_trip, you override hotel area switches half the time."
 *   The same user behaves differently across scenarios — this captures that.
 *
 * Layer 2 — Pattern memory (stated vs actual; satisfaction predictors)
 *   "You set ±60min but only accept ~30min shifts in practice."
 *   "Your satisfaction peaks when the agent succeeds first try — drops 40% on venue switches."
 *   "You override 80% of venue switches in date_night context."
 *   These are the behavioral fingerprints that make the agent genuinely personal.
 *
 * Layer 3 — Relationship memory (group / shared history)
 *   Named profiles: couple / friends / family.
 *   Shared constraints: "needs parking", "vegetarian", "quiet venue".
 *   Negative history: things the group has rejected before.
 *   This builds the moat — no general LLM has this across-session group memory.
 */

import type { AgentFeedbackEvent } from "./db";
// ── Scenario inference ────────────────────────────────────────────────────

const SCENARIO_PATTERNS: Array<{ pattern: RegExp; scenario: string; label: string }> = [
  { pattern: /date|romantic|anniversary|valentine|proposal/i, scenario: "date_night",    label: "Date night"     },
  { pattern: /weekend|vacation|holiday|getaway|escape/i,      scenario: "weekend_trip",  label: "Weekend trip"   },
  { pattern: /business|work|conference|corporate|meeting/i,   scenario: "business",      label: "Business travel"},
  { pattern: /family|kid|child|parent|grandparent/i,          scenario: "family",        label: "Family trip"    },
  { pattern: /friend|group|crew|gang|bachelor|bachelorette/i, scenario: "friends",       label: "Friends outing" },
  { pattern: /city|urban|downtown|explore/i,                  scenario: "city_trip",     label: "City trip"      },
];

export function inferScenario(tripLabel: string): { scenario: string; label: string } {
  for (const { pattern, scenario, label } of SCENARIO_PATTERNS) {
    if (pattern.test(tripLabel)) return { scenario, label };
  }
  return { scenario: "general", label: "General" };
}

// ── Types ──────────────────────────────────────────────────────────────────

export type Tolerance = "liberal" | "moderate" | "strict";

export interface ScenarioMemory {
  scenario: string;
  scenarioLabel: string;
  stepType: string;
  totalEvents: number;
  overrideRate: number;
  acceptanceRate: number;
  timeAdjustAcceptance: number | null;  // fraction of time_adjusted events accepted
  venueSwitchAcceptance: number | null; // fraction of venue_switched events accepted
  keyInsight: string;
}

export interface StatedVsActual {
  statedTimeWindowMinutes: number | null;
  actualAcceptanceRate: number | null;  // 0–1
  conclusion: "matches" | "more_strict" | "more_liberal" | "unknown";
  insight: string;
}

export interface SatisfactionPredictor {
  agentDecision: string;
  avgScore: number | null;  // 0.0–1.0 (0=unsatisfied, 0.5=ok, 1=satisfied)
  count: number;
  insight: string;
}

export interface OverrideTrigger {
  context: string;
  trigger: string;
  overrideRate: number;
  eventCount: number;
  description: string;
}

export interface PatternMemory {
  statedVsActual: StatedVsActual;
  satisfactionPredictors: SatisfactionPredictor[];
  overrideTriggers: OverrideTrigger[];
}

// ── Relationship profile ───────────────────────────────────────────────────

export type RelationshipType = "solo" | "couple" | "friends" | "family";

export interface RelationshipProfile {
  id: string;
  name: string;
  type: RelationshipType;
  session_ids: string[];
  constraints: string[];    // "vegetarian", "needs parking", "quiet venue", "early check-in"
  avoid_types: string[];    // "chain hotels", "outdoor in rain", "loud restaurants"
  notes: string;            // free text memory
  created_at: string;
  updated_at: string;
}

// ── Task memory computation ───────────────────────────────────────────────

/**
 * Build per-scenario preference profiles.
 * We group feedback events by (inferred_scenario, step_type) and compute
 * acceptance/override rates in each context. This surfaces context-dependent
 * behaviors that a flat entity model misses.
 */
export function buildTaskMemory(
  events: AgentFeedbackEvent[],
  jobLabels: Map<string, string>  // jobId → tripLabel
): ScenarioMemory[] {
  // Group step events by (scenario, step_type)
  const groups = new Map<string, AgentFeedbackEvent[]>();

  for (const e of events) {
    if (e.step_type === "job") continue;
    const tripLabel = jobLabels.get(e.job_id) ?? "";
    const { scenario } = inferScenario(tripLabel);
    const key = `${scenario}::${e.step_type}`;
    const group = groups.get(key) ?? [];
    group.push(e);
    groups.set(key, group);
  }

  const memories: ScenarioMemory[] = [];

  for (const [key, evts] of groups) {
    if (evts.length < 3) continue; // minimum data threshold

    const [scenario, stepType] = key.split("::");
    const scenarioLabel = SCENARIO_PATTERNS.find((p) => p.scenario === scenario)?.label ?? "General";

    const total = evts.length;
    const overrides = evts.filter((e) => e.outcome === "manual_override").length;
    const accepted = evts.filter((e) => e.outcome === "accepted").length;
    const overrideRate = overrides / total;
    const acceptanceRate = accepted / total;

    const timeEvts  = evts.filter((e) => e.agent_decision === "time_adjusted");
    const venueEvts = evts.filter((e) => e.agent_decision === "venue_switched");

    const timeAdjustAcceptance = timeEvts.length >= 2
      ? timeEvts.filter((e) => e.outcome === "accepted").length / timeEvts.length
      : null;
    const venueSwitchAcceptance = venueEvts.length >= 2
      ? venueEvts.filter((e) => e.outcome === "accepted").length / venueEvts.length
      : null;

    // Build the most informative single insight
    const keyInsight = deriveScenarioInsight({
      scenarioLabel, stepType: stepType!, overrideRate, acceptanceRate,
      timeAdjustAcceptance, venueSwitchAcceptance, total,
    });

    memories.push({
      scenario: scenario!,
      scenarioLabel,
      stepType: stepType!,
      totalEvents: total,
      overrideRate,
      acceptanceRate,
      timeAdjustAcceptance,
      venueSwitchAcceptance,
      keyInsight,
    });
  }

  return memories.sort((a, b) => b.totalEvents - a.totalEvents);
}

function deriveScenarioInsight(params: {
  scenarioLabel: string;
  stepType: string;
  overrideRate: number;
  acceptanceRate: number;
  timeAdjustAcceptance: number | null;
  venueSwitchAcceptance: number | null;
  total: number;
}): string {
  const { scenarioLabel, stepType, overrideRate, acceptanceRate, timeAdjustAcceptance, venueSwitchAcceptance } = params;
  const ctx = `${scenarioLabel} ${stepType}`;

  // Specific behavioral divergence — most informative
  if (timeAdjustAcceptance !== null && venueSwitchAcceptance !== null) {
    if (timeAdjustAcceptance >= 0.7 && venueSwitchAcceptance <= 0.3) {
      return `${ctx}: accepts time adjustments but rejects venue switches`;
    }
    if (timeAdjustAcceptance <= 0.3 && venueSwitchAcceptance >= 0.7) {
      return `${ctx}: prefers venue switch over time adjustments`;
    }
  }
  if (timeAdjustAcceptance !== null && timeAdjustAcceptance <= 0.25) {
    return `${ctx}: very time-sensitive — rarely accepts time changes`;
  }
  if (venueSwitchAcceptance !== null && venueSwitchAcceptance <= 0.2) {
    return `${ctx}: venue-loyal — dislikes alternatives`;
  }
  if (overrideRate >= 0.65) {
    return `${ctx}: frequently overrides agent — prefers manual control`;
  }
  if (acceptanceRate >= 0.85) {
    return `${ctx}: highly trusts agent's decisions`;
  }
  return `${ctx}: moderate trust (${Math.round(acceptanceRate * 100)}% acceptance)`;
}

// ── Pattern memory computation ─────────────────────────────────────────────

/**
 * Derive higher-order behavioral patterns from the feedback history.
 * These are the most actionable signals: they tell the agent HOW to calibrate,
 * not just what entities to favor.
 */
export function buildPatternMemory(
  events: AgentFeedbackEvent[],
  jobAutonomy: Map<string, number>,    // jobId → timeWindowMinutes (from autonomy_settings)
  jobLabels: Map<string, string>
): PatternMemory {
  const stepEvents = events.filter((e) => e.step_type !== "job");
  const jobEvents  = events.filter((e) => e.step_type === "job");

  // ── Stated vs actual time tolerance ──
  const statedValues = [...jobAutonomy.values()].filter((v) => v > 0);
  const avgStated = statedValues.length > 0
    ? Math.round(statedValues.reduce((a, b) => a + b, 0) / statedValues.length)
    : null;

  const timeEvents = stepEvents.filter((e) => e.agent_decision === "time_adjusted");
  const timeAcceptRate = timeEvents.length >= 3
    ? timeEvents.filter((e) => e.outcome === "accepted").length / timeEvents.length
    : null;

  let conclusion: StatedVsActual["conclusion"] = "unknown";
  let statedVsInsight = "Not enough data yet to compare stated settings with actual behavior.";

  if (avgStated !== null && timeAcceptRate !== null) {
    // Expected acceptance rate given the stated window size
    const expected = avgStated >= 60 ? 0.65 : avgStated >= 30 ? 0.45 : 0.3;
    const actual = timeAcceptRate;

    if (actual < expected - 0.2) {
      conclusion = "more_strict";
      statedVsInsight = `You set ±${avgStated}min but accept only ${Math.round(actual * 100)}% of time adjustments — you're more time-strict in practice. Consider tightening your window to ±${Math.max(30, avgStated - 30)}min.`;
    } else if (actual > expected + 0.2) {
      conclusion = "more_liberal";
      statedVsInsight = `You set ±${avgStated}min but accept ${Math.round(actual * 100)}% of adjustments — you're more flexible than your settings. Consider widening to ±${Math.min(90, avgStated + 30)}min for better first-try success.`;
    } else {
      conclusion = "matches";
      statedVsInsight = `Your ±${avgStated}min window matches your actual behavior well (${Math.round(actual * 100)}% acceptance rate).`;
    }
  }

  const statedVsActual: StatedVsActual = {
    statedTimeWindowMinutes: avgStated,
    actualAcceptanceRate: timeAcceptRate,
    conclusion,
    insight: statedVsInsight,
  };

  // ── Satisfaction predictors ──
  // Map job-level satisfaction to the dominant agent decision for that job
  const scoreMap = new Map<string, { sum: number; count: number }>();

  for (const jobEvt of jobEvents) {
    const score = satisfactionScore(jobEvt.outcome);
    if (score === null) continue;

    const jobSteps = stepEvents.filter((e) => e.job_id === jobEvt.job_id);
    if (jobSteps.length === 0) continue;

    // Dominant decision = the most common non-primary one, or "primary" if all first-try
    const decisionCounts = new Map<string, number>();
    for (const e of jobSteps) {
      decisionCounts.set(e.agent_decision, (decisionCounts.get(e.agent_decision) ?? 0) + 1);
    }
    const sorted = [...decisionCounts.entries()].sort((a, b) => b[1] - a[1]);
    const dominant = sorted[0]?.[0] ?? "primary";

    const existing = scoreMap.get(dominant) ?? { sum: 0, count: 0 };
    existing.sum += score;
    existing.count++;
    scoreMap.set(dominant, existing);
  }

  const DECISION_INSIGHTS: Record<string, string> = {
    primary:        "First-try success — highest satisfaction in this category",
    time_adjusted:  "Time slot adjusted — satisfaction depends on shift size",
    venue_switched: "Venue changed — tends to lower satisfaction",
    failed:         "Agent failed, manual booking required",
    "n/a":          "Mixed outcomes across steps",
  };

  const satisfactionPredictors: SatisfactionPredictor[] = [...scoreMap.entries()]
    .map(([decision, { sum, count }]) => ({
      agentDecision: decision,
      avgScore: count > 0 ? sum / count : null,
      count,
      insight: DECISION_INSIGHTS[decision] ?? decision,
    }))
    .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

  // ── Override triggers ──
  // (scenario, agent_decision) pairs with disproportionately high override rates
  const triggerMap = new Map<string, { overrides: number; total: number }>();

  for (const e of stepEvents) {
    const tripLabel = jobLabels.get(e.job_id) ?? "";
    const { label } = inferScenario(tripLabel);
    const key = `${label}::${e.agent_decision}`;
    const existing = triggerMap.get(key) ?? { overrides: 0, total: 0 };
    existing.total++;
    if (e.outcome === "manual_override") existing.overrides++;
    triggerMap.set(key, existing);
  }

  const TRIGGER_LABELS: Record<string, string> = {
    time_adjusted:  "adjusts time",
    venue_switched: "switches venue",
    primary:        "picks primary option",
    failed:         "fails and hands off",
    "n/a":          "makes any change",
  };

  const overrideTriggers: OverrideTrigger[] = [...triggerMap.entries()]
    .filter(([, { total }]) => total >= 3)
    .map(([key, { overrides, total }]) => {
      const [context, trigger] = key.split("::");
      const rate = overrides / total;
      return {
        context: context!,
        trigger: trigger!,
        overrideRate: rate,
        eventCount: total,
        description: `${Math.round(rate * 100)}% override when agent ${TRIGGER_LABELS[trigger!] ?? trigger} in ${context} context`,
      };
    })
    .filter(({ overrideRate }) => overrideRate >= 0.5)
    .sort((a, b) => b.overrideRate - a.overrideRate);

  return { statedVsActual, satisfactionPredictors, overrideTriggers };
}

// ── Utility ────────────────────────────────────────────────────────────────

function satisfactionScore(outcome: string): number | null {
  if (outcome === "satisfied")  return 1.0;
  if (outcome === "ok")         return 0.5;
  if (outcome === "unsatisfied") return 0.0;
  return null;
}

export const SCENARIO_LABELS: Record<string, string> = {
  date_night:   "Date night",
  weekend_trip: "Weekend trip",
  business:     "Business travel",
  family:       "Family trip",
  friends:      "Friends outing",
  city_trip:    "City trip",
  general:      "General",
};

export const STEP_TYPE_LABELS: Record<string, string> = {
  restaurant: "Restaurant",
  hotel:      "Hotel",
  flight:     "Flight",
};
