/**
 * lib/core/consent/validator · validateConsent
 *
 * Pure function the executor calls at each decision point.
 * Returns `{ allowed: true }` OR `{ allowed: false, reason }`.
 *
 * No side effects, no DB, no network — safe to call from anywhere.
 * All 4 ConsentAction variants are handled via exhaustive switch so
 * adding a new action type to types.ts requires adding a branch here
 * (TS will surface the missing case at compile time).
 */

import type { ConsentAction, ConsentPolicy, ValidationResult } from "./types";

export function validateConsent(
  policy: ConsentPolicy,
  action: ConsentAction,
): ValidationResult {
  switch (action.type) {
    case "adjust_time": {
      if (!policy.allowTimeAdjustment) {
        return {
          allowed: false,
          reason: "Time adjustment not permitted by consent policy",
        };
      }
      const deltaMin = Math.abs(
        parseTimeToMinutes(action.toTime) - parseTimeToMinutes(action.fromTime),
      );
      const maxDelta = policy.maxTimeAdjustmentMinutes ?? Infinity;
      if (deltaMin > maxDelta) {
        return {
          allowed: false,
          reason: `Time shift ${deltaMin}min exceeds policy max of ${maxDelta}min`,
        };
      }
      return { allowed: true };
    }

    case "switch_venue": {
      if (!policy.allowVenueSwitch) {
        return {
          allowed: false,
          reason: "Venue switch not permitted by consent policy",
        };
      }
      return { allowed: true };
    }

    case "retry": {
      const maxRetries = policy.maxRetries ?? 3;
      if (action.attemptNumber > maxRetries) {
        return {
          allowed: false,
          reason: `Retry attempt ${action.attemptNumber} exceeds policy max of ${maxRetries}`,
        };
      }
      return { allowed: true };
    }

    case "use_provider": {
      // Block-list takes precedence (blocked > allowed).
      if (policy.blockedProviders?.includes(action.providerId)) {
        return {
          allowed: false,
          reason: `Provider "${action.providerId}" is in policy blocklist`,
        };
      }
      if (
        policy.allowedProviders &&
        !policy.allowedProviders.includes(action.providerId)
      ) {
        return {
          allowed: false,
          reason: `Provider "${action.providerId}" not in policy allowlist`,
        };
      }
      return { allowed: true };
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse an "HH:MM" (24h) time string to minutes since midnight.
 * Lenient: accepts "7:30", "07:30", "19:45". Returns 0 on unparseable input
 * so validator errs on the side of "small delta" (permissive) — the caller
 * should have already sanitized input upstream.
 */
function parseTimeToMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h * 60 + m;
}
