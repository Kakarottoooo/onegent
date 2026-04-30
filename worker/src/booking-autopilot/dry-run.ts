/**
 * dry_run boundary for the benchmark layer.
 *
 * Mirrored from lib/booking-autopilot/dry-run.ts per the dual-package rule
 * documented in CLAUDE.md (Booking-autopilot 双份代码规则). Keep the two
 * files byte-identical until USE_WORKER_FOR is expanded; any divergence
 * here means the dual-fork has actually started splitting.
 */

export interface DryRunAutonomy {
  /** When true, providers must stop before any reservation-committing click. */
  benchmark_dry_run?: boolean;
}

export interface DryRunCapableHelpers {
  autonomy?: DryRunAutonomy | null;
}

/**
 * Returns true when the caller has explicitly opted into dry_run mode.
 * Defaults to false on any malformed / missing input — no implicit dry_run.
 */
export function shouldStopForDryRun(helpers: unknown): boolean {
  if (helpers == null || typeof helpers !== "object") return false;
  const autonomy = (helpers as DryRunCapableHelpers).autonomy;
  if (autonomy == null || typeof autonomy !== "object") return false;
  return autonomy.benchmark_dry_run === true;
}

/**
 * Marker string written to the provider trace when a dry_run boundary fires.
 * Tests assert against this; production decisionLog parsing will too.
 */
export const DRY_RUN_BOUNDARY_MARKER = "dry_run_boundary";
