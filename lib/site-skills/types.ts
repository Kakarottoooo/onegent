/**
 * Site Skill Registry types (Phase 4).
 *
 * provider_skills is an aggregate view: every row summarises what we've
 * learned about one (provider, task_type) pair from running benchmarks and
 * (eventually) production booking_jobs. Pure data — no recovery strategies
 * yet. Add those after the registry has accumulated enough samples to
 * surface real failure patterns.
 */

import type { FailureReason } from "@/lib/benchmark/types";

/** All task types we track aggregates for. Restaurant is the only populated one today. */
export type TrackedTaskType =
  | "restaurant_booking"
  | "hotel_booking"
  | "flight_booking"
  | "activity_booking";

/** Failure-reason → count map. Buckets follow the canonical FAILURE_REASONS list. */
export type FailureBuckets = Partial<Record<FailureReason, number>>;

export interface ProviderSkillRow {
  provider: string;
  task_type: TrackedTaskType;
  sample_count: number;
  success_count: number;
  failure_buckets: FailureBuckets;
  avg_duration_s: number | null;
  last_seen_at: string | null;
  updated_at: string;
}

export interface ProviderSkillSummary extends ProviderSkillRow {
  /** sample_count > 0 ? success_count / sample_count : null */
  success_rate: number | null;
  /** Top-1 failure_reason by count (null when no failures recorded). */
  top_failure_reason: FailureReason | null;
}
