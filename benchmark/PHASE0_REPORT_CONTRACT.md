# Phase 0 Resy Benchmark Report Contract

This file is the UI/back-end contract for `/dev/benchmark-runs`.

The runner writes real reports to `benchmark/runs/phase0-resy-*.json`.
Committed sample reports live in `benchmark/fixtures/*.json`.

## Read API

- `GET /api/dev/benchmark-runs`
- `GET /api/dev/benchmark-runs/{file}`

These routes are dev-only. They are available when `NODE_ENV !== "production"` or
`ENABLE_DEV_BENCHMARK_API=1`.

## Report Shape

```ts
interface Phase0BenchmarkReport {
  schemaVersion: 1;
  reportKind: "phase0-resy-benchmark-report";
  runId: string;
  suiteId: "restaurant-resy-phase0";
  suiteVersion: number;
  baseUrl: string;
  createdAt: string;
  dryRun: boolean;
  dispatchOnly: boolean;
  metrics: Phase0BenchmarkMetrics;
  results: Phase0BenchmarkCaseResult[];
}

interface Phase0BenchmarkMetrics {
  total: number;
  bookingReady: number;
  safe: number;
  severe: number;
  taxonomyNeeded: number;
  taxonomyCovered: number;
  bookingReadyRate: number;
  safeOutcomeRate: number;
  severeErrorRate: number;
  taxonomyCoverageRate: number;
  passed: boolean;
}

interface Phase0BenchmarkCaseResult {
  caseId: string;
  prompt: string;
  taskId?: string;
  currentJobId?: string | null;
  state?: string;
  terminalCode?: string | null;
  terminalReason?: string | null;
  outcome:
    | "booking_confirmed"
    | "ready_for_confirmation"
    | "safe_handoff"
    | "no_availability_correct"
    | "recovered_via_fallback"
    | "failed_with_clear_reason"
    | "failed_unknown"
    | "severe_error";
  taxonomyCode?: string;
  expectedOutcomes: string[];
  acceptableFailureTaxonomy: string[];
  safe: boolean;
  bookingReady: boolean;
  severe: boolean;
  expectedOutcomeMatched: boolean;
  taxonomyAccepted: boolean;
  durationMs: number;
  timelineUrl?: string | null;
  snapshotsUrl?: string | null;
  error?: string;
}
```

## Dashboard Rules

- Headline gate is `metrics.passed`.
- Gate thresholds are encoded by the runner; UI should not recalculate pass/fail
  from hard-coded constants.
- Outcome bucket grouping should use `result.outcome`.
- Failure taxonomy grouping should use `result.taxonomyCode`; missing taxonomy
  should be rendered as `uncategorized`.
- Case detail should link to `timelineUrl` and `snapshotsUrl` when present.
- A fixture source is a sample/demo run. A run source is a real local artifact.
