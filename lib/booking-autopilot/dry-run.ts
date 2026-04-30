/**
 * dry_run boundary for the benchmark layer.
 *
 * When a booking_job is dispatched in dry_run mode, the benchmark runner
 * sets `autonomy.benchmark_dry_run = true` on the helpers passed into a
 * provider's fillGuestForm. Providers consult `shouldStopForDryRun(helpers)`
 * immediately BEFORE the final-submit click and abort that one operation.
 * Everything earlier (navigation, form fill, AI audit) still runs — only
 * the side-effecting submit is gated.
 *
 * Why a separate file: lets us test the gate in isolation, and lets the
 * mirror copy in worker/src import from a parallel path.
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
