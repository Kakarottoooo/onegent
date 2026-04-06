/**
 * Policy Adaptation Engine
 *
 * Turns accumulated feedback signals into actionable strategy biases.
 * The agent's decisions get better with every booking.
 *
 * Signal weights (how strongly each outcome changes scores):
 *   satisfied       +3   strong positive — user explicitly happy
 *   ok              +1   weak positive — acceptable
 *   accepted        +1   weak positive — user used agent's link
 *   manual_override -2   strong negative — user rejected agent's choice
 *   unsatisfied     -3   strong negative — user explicitly unhappy
 *   failed          -3   strong negative — agent couldn't complete the task
 *
 * Three policy tiers:
 *   Global   — patterns across all users (provider reliability)
 *   Personal — patterns for this session/user (their specific tolerances)
 *
 * Bayesian smoothing prevents over-fitting on small sample sizes.
 * A venue needs MIN_EVENTS events before its score affects decisions.
 */

import type { AgentFeedbackEvent } from "./db";

// ── Signal weights ─────────────────────────────────────────────────────────

export const SIGNAL_WEIGHTS: Record<string, number> = {
  satisfied:       +3,
  ok:              +1,
  accepted:        +1,
  manual_override: -2,
  unsatisfied:     -3,
  failed:          -3,
} as const;

// Minimum events before we use the score in decisions
const MIN_EVENTS = 3;
// Bayesian smoothing — low-sample scores stay near 0
const SMOOTHING = 2;

// ── Core scoring ───────────────────────────────────────────────────────────

/** Compute a smoothed policy score from a set of feedback events. */
export function weightedScore(events: AgentFeedbackEvent[]): number {
  if (events.length === 0) return 0;
  const raw = events.reduce((sum, e) => sum + (SIGNAL_WEIGHTS[e.outcome] ?? 0), 0);
  return raw / (events.length + SMOOTHING);
}

/** Rate: fraction of events with the given outcome. */
function rate(events: AgentFeedbackEvent[], outcome: string): number {
  if (events.length === 0) return 0;
  return events.filter((e) => e.outcome === outcome).length / events.length;
}

// ── Policy types ───────────────────────────────────────────────────────────

export type Tolerance = "liberal" | "moderate" | "strict";

export interface VenuePolicy {
  venueName: string;
  score: number;      // smoothed policy score
  eventCount: number;
  interpretation: string; // human-readable
}

export interface ProviderPolicy {
  provider: string;
  score: number;
  acceptanceRate: number;
  eventCount: number;
  preferenceRank: number; // 1 = try first
}

export interface PersonalTolerance {
  /** How readily the agent should adjust time slots for this user. */
  timeAdjust: Tolerance;
  timeAdjustRate: number;   // 0–1, fraction of time_adjusted events accepted
  timeAdjustCount: number;

  /** How readily the agent should switch venues for this user. */
  venueSwitch: Tolerance;
  venueSwitchRate: number;
  venueSwitchCount: number;
}

export interface PolicyBias {
  /** Per-venue smoothed scores. Only venues with ≥MIN_EVENTS included. */
  venueScores: Record<string, number>;
  /** Sorted provider list — index 0 = highest policy score, try first. */
  providerRanking: ProviderPolicy[];
  /** Personal strategy tolerances derived from behavior (null = not enough data). */
  personalTolerance: PersonalTolerance | null;
  /** Raw stats for display. */
  topVenues: VenuePolicy[];  // sorted descending by score
  flaggedVenues: VenuePolicy[]; // venues with negative scores
  totalEvents: number;
  hasEnoughData: boolean;
}

// ── Main computation ───────────────────────────────────────────────────────

export function computePolicyBias(events: AgentFeedbackEvent[]): PolicyBias {
  const stepEvents = events.filter((e) => e.step_type !== "job");

  // ── Venue scores ──
  const byVenue = new Map<string, AgentFeedbackEvent[]>();
  for (const e of stepEvents) {
    if (!e.venue_name) continue;
    const arr = byVenue.get(e.venue_name) ?? [];
    arr.push(e);
    byVenue.set(e.venue_name, arr);
  }

  const venueScores: Record<string, number> = {};
  const allVenues: VenuePolicy[] = [];

  for (const [name, evts] of byVenue) {
    const score = weightedScore(evts);
    const policy: VenuePolicy = {
      venueName: name,
      score,
      eventCount: evts.length,
      interpretation:
        score > 1.5 ? "Agent's picks consistently trusted" :
        score > 0   ? "Generally accepted" :
        score === 0 ? "Mixed results" :
        score > -1  ? "Often overridden" :
                      "Frequently rejected — try alternatives first",
    };
    allVenues.push(policy);
    if (evts.length >= MIN_EVENTS) {
      venueScores[name] = score;
    }
  }

  allVenues.sort((a, b) => b.score - a.score);
  const topVenues = allVenues.filter((v) => v.score > 0).slice(0, 5);
  const flaggedVenues = allVenues.filter((v) => v.score < 0 && v.eventCount >= MIN_EVENTS).slice(0, 5);

  // ── Provider scores ──
  const byProvider = new Map<string, AgentFeedbackEvent[]>();
  for (const e of stepEvents) {
    if (!e.provider) continue;
    const arr = byProvider.get(e.provider) ?? [];
    arr.push(e);
    byProvider.set(e.provider, arr);
  }

  const providerRanking: ProviderPolicy[] = [];
  for (const [provider, evts] of byProvider) {
    providerRanking.push({
      provider,
      score: weightedScore(evts),
      acceptanceRate: rate(evts, "accepted"),
      eventCount: evts.length,
      preferenceRank: 0, // set after sort
    });
  }
  providerRanking.sort((a, b) => b.score - a.score);
  providerRanking.forEach((p, i) => { p.preferenceRank = i + 1; });

  // ── Personal tolerance ──
  const timeEvents = stepEvents.filter((e) => e.agent_decision === "time_adjusted");
  const venueEvents = stepEvents.filter((e) => e.agent_decision === "venue_switched");

  const hasTimeData = timeEvents.length >= MIN_EVENTS;
  const hasVenueData = venueEvents.length >= MIN_EVENTS;

  let personalTolerance: PersonalTolerance | null = null;

  if (hasTimeData || hasVenueData) {
    const timeRate = hasTimeData ? rate(timeEvents, "accepted") : 0.5;
    const venueRate = hasVenueData ? rate(venueEvents, "accepted") : 0.5;

    personalTolerance = {
      timeAdjust: timeRate >= 0.7 ? "liberal" : timeRate >= 0.4 ? "moderate" : "strict",
      timeAdjustRate: timeRate,
      timeAdjustCount: timeEvents.length,
      venueSwitch: venueRate >= 0.7 ? "liberal" : venueRate >= 0.4 ? "moderate" : "strict",
      venueSwitchRate: venueRate,
      venueSwitchCount: venueEvents.length,
    };
  }

  return {
    venueScores,
    providerRanking,
    personalTolerance,
    topVenues,
    flaggedVenues,
    totalEvents: events.length,
    hasEnoughData: events.length >= 5,
  };
}

// ── Preference profile (per-user memory) ──────────────────────────────────

/**
 * A negative signal: something the user consistently rejects / overrides.
 * The agent uses these to de-prioritize or skip flagged entities.
 */
export interface NegativeSignal {
  entity: string;
  entityType: "venue" | "provider" | "step_type";
  overrideCount: number;
  overrideRate: number;    // fraction of interactions that were overrides
  totalSeen: number;
  severity: "strong" | "moderate"; // strong ≥ 0.7, moderate ≥ 0.5
}

/**
 * Structured preference model derived from accumulated feedback.
 * Negative memory is often more actionable than positive memory:
 * users know what they don't want faster than what they do.
 */
export interface UserPreferenceProfile {
  /** Venues / providers / step types the user consistently rejects */
  negatives: NegativeSignal[];
  /** Providers ranked best-to-worst by acceptance rate */
  preferredProviders: string[];
  /** Providers the user most often overrides */
  avoidedProviders: string[];
  /** Time-adjustment tolerance derived from history */
  timeAdjustTolerance: Tolerance | null;
  /** Venue-switch tolerance derived from history */
  venueSwitchTolerance: Tolerance | null;
  /** How reliable the profile is */
  confidenceLevel: "high" | "medium" | "low" | "insufficient";
  totalInteractions: number;
}

/** Build a structured preference profile from raw feedback events. */
export function buildPreferenceProfile(events: AgentFeedbackEvent[]): UserPreferenceProfile {
  const stepEvents = events.filter((e) => e.step_type !== "job");
  const total = stepEvents.length;

  // ── Venue override tracking ──
  const venueMap = new Map<string, { overrides: number; total: number }>();
  const providerMap = new Map<string, { overrides: number; total: number }>();
  const typeMap = new Map<string, { overrides: number; total: number }>();

  for (const e of stepEvents) {
    const isOverride = e.outcome === "manual_override";

    if (e.venue_name) {
      const v = venueMap.get(e.venue_name) ?? { overrides: 0, total: 0 };
      v.total++;
      if (isOverride) v.overrides++;
      venueMap.set(e.venue_name, v);
    }
    if (e.provider) {
      const p = providerMap.get(e.provider) ?? { overrides: 0, total: 0 };
      p.total++;
      if (isOverride) p.overrides++;
      providerMap.set(e.provider, p);
    }
    const st = typeMap.get(e.step_type) ?? { overrides: 0, total: 0 };
    st.total++;
    if (isOverride) st.overrides++;
    typeMap.set(e.step_type, st);
  }

  // ── Negative signals: entities with high override rates ──
  const negatives: NegativeSignal[] = [];
  const NEGATIVE_MIN_EVENTS = 2;

  for (const [name, { overrides, total: t }] of venueMap) {
    const rate = overrides / t;
    if (t >= NEGATIVE_MIN_EVENTS && rate >= 0.5) {
      negatives.push({ entity: name, entityType: "venue", overrideCount: overrides,
        overrideRate: rate, totalSeen: t, severity: rate >= 0.7 ? "strong" : "moderate" });
    }
  }
  for (const [name, { overrides, total: t }] of typeMap) {
    const rate = overrides / t;
    if (t >= 3 && rate >= 0.5) {
      negatives.push({ entity: name, entityType: "step_type", overrideCount: overrides,
        overrideRate: rate, totalSeen: t, severity: rate >= 0.7 ? "strong" : "moderate" });
    }
  }
  negatives.sort((a, b) => b.overrideRate - a.overrideRate);

  // ── Provider preference order ──
  const providerEntries = [...providerMap.entries()]
    .map(([provider, { overrides, total: t }]) => ({
      provider,
      overrideRate: overrides / t,
      acceptanceRate: (t - overrides) / t,
      total: t,
    }))
    .filter((p) => p.total >= 2);

  providerEntries.sort((a, b) => a.overrideRate - b.overrideRate);
  const preferredProviders = providerEntries.filter((p) => p.acceptanceRate >= 0.5).map((p) => p.provider);
  const avoidedProviders = providerEntries.filter((p) => p.overrideRate >= 0.5).map((p) => p.provider);

  // ── Tolerance ──
  const timeEvents = stepEvents.filter((e) => e.agent_decision === "time_adjusted");
  const venueEvents = stepEvents.filter((e) => e.agent_decision === "venue_switched");
  const timeAccept = timeEvents.filter((e) => e.outcome === "accepted").length;
  const venueAccept = venueEvents.filter((e) => e.outcome === "accepted").length;
  const timeRate = timeEvents.length > 0 ? timeAccept / timeEvents.length : 0;
  const venueRate = venueEvents.length > 0 ? venueAccept / venueEvents.length : 0;

  const timeAdjustTolerance: Tolerance | null = timeEvents.length >= MIN_EVENTS
    ? timeRate >= 0.7 ? "liberal" : timeRate >= 0.4 ? "moderate" : "strict"
    : null;
  const venueSwitchTolerance: Tolerance | null = venueEvents.length >= MIN_EVENTS
    ? venueRate >= 0.7 ? "liberal" : venueRate >= 0.4 ? "moderate" : "strict"
    : null;

  const confidenceLevel: UserPreferenceProfile["confidenceLevel"] =
    total >= 20 ? "high" : total >= 10 ? "medium" : total >= 5 ? "low" : "insufficient";

  return {
    negatives,
    preferredProviders,
    avoidedProviders,
    timeAdjustTolerance,
    venueSwitchTolerance,
    confidenceLevel,
    totalInteractions: total,
  };
}

// ── Helpers for the execution engine ──────────────────────────────────────

/**
 * Sort fallback candidates by policy score (best-trusted venue first).
 * Candidates without a score keep their original order.
 */
export function sortCandidatesByPolicy<T extends { label: string }>(
  candidates: T[],
  venueScores: Record<string, number>
): T[] {
  return [...candidates].sort((a, b) => {
    const sa = venueScores[a.label] ?? 0;
    const sb = venueScores[b.label] ?? 0;
    return sb - sa; // descending
  });
}

/**
 * Generate a log message explaining why a venue is being tried in a
 * particular order based on policy score.
 */
export function policyOrderExplanation(
  label: string,
  score: number,
  rank: number
): string {
  if (rank === 1 && score > 0) {
    return `Trying ${label} first — your history shows you trust the agent's picks here (score ${score.toFixed(1)})`;
  }
  if (score < 0) {
    return `Trying ${label} (lower priority — you've often chosen differently here, score ${score.toFixed(1)})`;
  }
  return `Trying ${label}`;
}

/**
 * Generate a tolerance note for the decision log — tells the user when
 * their observed behavior diverges from their settings.
 */
export function toleranceNote(
  tolerance: PersonalTolerance,
  decisionType: "time_adjusted" | "venue_switched"
): string | null {
  if (decisionType === "time_adjusted") {
    if (tolerance.timeAdjust === "strict" && tolerance.timeAdjustCount >= MIN_EVENTS) {
      return `Note: you override time adjustments often (${Math.round(tolerance.timeAdjustRate * 100)}% acceptance). Making extra attempts at your exact time before adjusting.`;
    }
    if (tolerance.timeAdjust === "liberal" && tolerance.timeAdjustCount >= MIN_EVENTS) {
      return `Adjusting time — your history shows you're comfortable with this (${Math.round(tolerance.timeAdjustRate * 100)}% acceptance).`;
    }
  }
  if (decisionType === "venue_switched") {
    if (tolerance.venueSwitch === "strict" && tolerance.venueSwitchCount >= MIN_EVENTS) {
      return `Note: you often override venue switches (${Math.round(tolerance.venueSwitchRate * 100)}% acceptance). Will try harder on the primary before switching.`;
    }
    if (tolerance.venueSwitch === "liberal" && tolerance.venueSwitchCount >= MIN_EVENTS) {
      return `Switching venue — your history shows you're flexible with alternatives (${Math.round(tolerance.venueSwitchRate * 100)}% acceptance).`;
    }
  }
  return null;
}
