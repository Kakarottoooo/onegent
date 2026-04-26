/**
 * lib/core/consent/default-policy · DEFAULT_CONSENT_POLICY
 *
 * The policy used when the caller omits a `consent` field on their
 * ExecutionJobRequest. Values are chosen so that behavior is
 * INDISTINGUISHABLE from today's C 端 flow — this is what makes the
 * Week 2 refactor a zero-regression change for existing users.
 *
 * When in doubt about what a default should be: look at the matching
 * code path in app/api/booking-jobs/[id]/start/route.ts or the
 * lib/booking-autopilot/core/ helpers and copy that behavior here.
 */

import type { ConsentPolicy } from "./types";

export const DEFAULT_CONSENT_POLICY: ConsentPolicy = {
  // Time adjustment — today's filterTimeFallbacks in lib/autonomy.ts
  // tries ±30/60/90min when no_availability is hit.
  allowTimeAdjustment: true,
  maxTimeAdjustmentMinutes: 90,

  // Venue switch — today's fallbackCandidates path in start/route.ts
  // tries each backup hotel/restaurant in order.
  allowVenueSwitch: true,

  // Retries — today's recovery.ts retries transient errors up to 3 times
  // with 2s/5s backoff before giving up on a step.
  maxRetries: 3,

  // Payment boundary — today's C 端 stops at the CVC iframe (PCI limit).
  paymentPolicy: "stop_before_cvc",

  // Provider allow/block — today C 端 doesn't restrict providers; the
  // fallback chain (e.g. OpenTable → Resy → Yelp → website) is free to run.
  // Leaving both undefined means "any provider OK, run the full chain".

  // Job duration — matches BROWSER_TASK_TIMEOUT_MS = 7 * 60 * 1000
  // in app/api/booking-jobs/[id]/start/route.ts (line ~626).
  maxJobDurationSeconds: 420,
};
