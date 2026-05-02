/**
 * Public surface for the benchmark dashboard package.
 *
 * Consumed by `/dev/benchmark-runs` (and eventually any internal status
 * page). Backend types live in `lib/benchmark/phase0-report.ts`; UI-only
 * helpers (labels, tones, formatters, group helpers) live in `./types.ts`.
 */

export { default as MetricCard } from "./MetricCard";
export { default as BucketDistribution } from "./BucketDistribution";
export { default as FailureTaxonomyChart } from "./FailureTaxonomyChart";
export { default as CaseTable } from "./CaseTable";
export { default as CaseDetailDrawer } from "./CaseDetailDrawer";

export {
  // Constants
  OUTCOME_BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_TONE,
  TAXONOMY_LABEL,
  UNCATEGORIZED_TAXONOMY,
  SEVERE_TAXONOMY_PREFIX,
  // Predicates
  isSevereTaxonomy,
  // Group helpers
  groupByOutcome,
  groupByTaxonomy,
  // Formatters
  formatRate,
  formatDuration,
  formatTimestamp,
} from "./types";

export type {
  Phase0BenchmarkCaseResult,
  Phase0BenchmarkMetrics,
  Phase0BenchmarkReport,
  Phase0BenchmarkRunSummary,
  Phase0OutcomeBucket,
  BenchmarkRunsListResponse,
  BenchmarkRunFileResponse,
} from "./types";
