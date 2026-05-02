/**
 * lib/core/execution/recovery · runExecutionJobWithRecovery
 *
 * Orchestrates retry + fallback strategies on top of the single-attempt
 * executor (lib/core/execution/executor.ts#runExecutionJob).
 *
 * This is the "complete execution engine" layer B 端 callers interact with.
 * Internally it composes:
 *
 *   Phase 1 · primary retry (US-007a · this file)
 *     - up to policy.maxRetries attempts with [0, 2000, 5000]ms backoff
 *     - consent-gated via validateConsent({ type: "retry" })
 *     - audit via writeAudit({ type: "step_attempt" })
 *
 *   Phase 2 · time fallback (US-007a · this file · restaurant only)
 *     - tries ±30 / ±60 / ±90 min slots when base time unavailable
 *     - consent-gated via validateConsent({ type: "adjust_time" })
 *     - capped by policy.maxTimeAdjustmentMinutes
 *     - audit via writeAudit({ type: "time_adjusted" })
 *
 *   Phase 3 · venue switch (US-007b · TODO)
 *   Phase 4 · action item / all-failed (US-007b · TODO)
 *   Provider fallback chain (US-007c · TODO · lib/core/execution/recovery-providers.ts)
 *
 * Coexistence: this path runs PARALLEL to the legacy route.ts#runStepWithRecovery.
 * US-009 wires a feature flag (USE_CORE_EXECUTOR) to route new jobs here;
 * jobs created before the flag / without the __source marker stay on the
 * legacy path. Zero-regression by construction.
 */

import { writeAudit } from "@/lib/core/audit/audit-log";
import { DEFAULT_CONSENT_POLICY } from "@/lib/core/consent/default-policy";
import { validateConsent } from "@/lib/core/consent/validator";
import type { ConsentPolicy } from "@/lib/core/consent/types";
import { runExecutionJob, type ExecutionContext } from "./executor";
import { tryProviderFallbackChain } from "./recovery-providers";
import { shouldTryProviderFallback } from "./should-try-fallback";
import type {
  ExecutionJobRequest,
  ExecutionJobResult,
} from "./types";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Execute a booking request end-to-end, with the full retry + fallback stack.
 * On terminal success returns status="paused_payment" or "completed".
 * Exhausts all fallbacks before returning a non-success status.
 *
 * The `attemptCount` + `usedFallback` fields on the returned result reflect
 * the total work across phases (not just the last attempt).
 */
export async function runExecutionJobWithRecovery(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
): Promise<ExecutionJobResult> {
  const policy: ConsentPolicy =
    (request.consent as ConsentPolicy | undefined) ?? DEFAULT_CONSENT_POLICY;

  // ── Phase 1: primary attempt with retry ──
  const phase1 = await tryPrimary(request, ctx, policy);

  if (isSuccessStatus(phase1.result.status)) {
    return {
      ...phase1.result,
      attemptCount: phase1.attemptCount,
      usedFallback: false,
    };
  }

  // ── Phase 2 vs Phase 3 branching ──
  //
  // Three distinct failure shapes drive two different fallback strategies:
  //
  //   A. "no_availability" due to NO AVAILABLE TIME SLOTS (venue exists, all
  //      slots are booked near the requested time)
  //      → Phase 2 time fallback (try ±30/60/90 min on SAME provider)
  //      → if time fallbacks also fail, FALL THROUGH to Phase 3 provider chain
  //
  //   B. "no_availability" due to VENUE NOT IN PROVIDER'S CATALOG ("not found
  //      on OpenTable" — venue doesn't list there at all)
  //      → skip time fallback (time doesn't help when venue isn't indexed)
  //      → jump directly to Phase 3 provider chain (try Resy / website)
  //
  //   C. "error" due to VENUE-USES-DIFFERENT-SYSTEM (Carbone / Le Bernardin /
  //      Osteria La Baia / Ci Siamo: appear in OpenTable search but the
  //      detail page has no embedded booking widget; final-outcome.ts then
  //      returns status="error" with summaries like "Stalled at listing" or
  //      "Unverified checkout field". Whitelist-matched in
  //      shouldTryProviderFallback.)
  //      → skip time fallback (different-platform issue, not slot issue)
  //      → jump directly to Phase 3 provider chain
  //
  // shouldTryProviderFallback() owns the trigger logic + a deny-list for
  // infra failures (HTTP 402 quota / bot block / page load failed) so we
  // don't burn 2-3 min on a Resy run that has no chance of success.
  if (
    phase1.result.status === "no_availability" ||
    shouldTryProviderFallback({
      scenario: request.request.scenario,
      status: phase1.result.status,
      summary: phase1.result.summary,
      error: phase1.result.error,
    })
  ) {
    // Phase 2 (time fallback) only fires for "true slot unavailable" cases
    // — i.e. status="no_availability" AND venue IS in OpenTable's catalog.
    // For "venue not in catalog" or "wrong-platform error" escalations, time
    // shifts won't help; jump straight to the provider chain.
    const isNoAvailability = phase1.result.status === "no_availability";
    const isNotFound =
      isNoAvailability &&
      /not found on (opentable|resy)/i.test(phase1.result.summary);
    // OpenTable's "no online availability within X hours of Y" copy means
    // the entire ±X-hour window around the requested time is sold out.
    // Trying 19:30 / 18:30 / 20:00 etc. when OT just told us nothing's
    // available within 3.5h of 19:00 burns a chromium session per attempt
    // (visible to the user as Chrome flickering open/close 5-7 times) and
    // never produces a hit. Skip the time ladder and jump straight to the
    // provider fallback chain in this case.
    const noAvailabilityText = `${phase1.result.summary ?? ""} ${phase1.result.error ?? ""}`;
    const isWindowFullySoldOut =
      isNoAvailability &&
      /no online availability within|within the requested time window/i.test(noAvailabilityText);
    const phase2Eligible = isNoAvailability && !isNotFound && !isWindowFullySoldOut;

    let attemptsAfter = phase1.attemptCount;

    if (phase2Eligible) {
      const phase2 = await tryTimeFallbacks(
        request,
        ctx,
        policy,
        phase1.attemptCount,
      );
      if (phase2) return phase2;
      // Note: tryTimeFallbacks returns null on exhaustion. We don't have its
      // exact attempt count from the outside, so approximate: add the number
      // of candidate times attempted. For Phase 3 counting we use a simple
      // lower bound — Phase 3 increments from here.
      attemptsAfter = phase1.attemptCount + 1;
    } else if (isWindowFullySoldOut) {
      await writeAudit({
        jobId: ctx.jobId,
        type: "provider_fallback",
        stepIndex: ctx.stepIndex,
        message: "Skipping nearby time retries because the provider reported the whole requested window unavailable",
        details: { summary: phase1.result.summary },
      });
    }

    // ── Phase 3: provider fallback chain (Resy → Google Places website) ──
    const phase3 = await tryProviderFallbackChain(
      request,
      ctx,
      policy,
      attemptsAfter,
    );
    if (phase3) return phase3;
  }

  // ── Phase 4 (all failed) ──
  // Venue switch + action-item are intentionally NOT implemented here —
  // they're C 端 UI concerns (BookingJobStep.fallbackCandidates + actionItem
  // field). The legacy route.ts#runStepWithRecovery retains them. New-path
  // callers that need those should pass USE_CORE_EXECUTOR=false in US-009.

  return {
    ...phase1.result,
    attemptCount: phase1.attemptCount,
    usedFallback: false,
  };
}

// ─── Phase 1: primary retry ──────────────────────────────────────────────────

const RETRY_BACKOFF_MS: readonly number[] = [0, 2000, 5000];

interface PhaseResult {
  result: ExecutionJobResult;
  /** How many times we called runExecutionJob during this phase. */
  attemptCount: number;
}

async function tryPrimary(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
  policy: ConsentPolicy,
): Promise<PhaseResult> {
  const maxTotalAttempts = Math.min(
    policy.maxRetries ?? RETRY_BACKOFF_MS.length,
    RETRY_BACKOFF_MS.length,
  );

  let lastResult: ExecutionJobResult | null = null;
  let attemptCount = 0;

  for (let attempt = 0; attempt < maxTotalAttempts; attempt++) {
    if (attempt > 0) {
      // Gate every retry through consent — a policy with maxRetries=1
      // stops us after the first failure even though the loop could
      // continue per backoff table length.
      const validation = validateConsent(policy, {
        type: "retry",
        attemptNumber: attempt + 1,
      });
      if (!validation.allowed) {
        await writeAudit({
          jobId: ctx.jobId,
          type: "action_denied",
          stepIndex: ctx.stepIndex,
          message: `Retry attempt ${attempt + 1} blocked by consent policy`,
          details: { reason: validation.reason, attemptNumber: attempt + 1 },
        });
        break;
      }

      await sleep(RETRY_BACKOFF_MS[attempt]);
      await writeAudit({
        jobId: ctx.jobId,
        type: "step_attempt",
        stepIndex: ctx.stepIndex,
        message: `Retry ${attempt + 1}/${maxTotalAttempts} after ${
          RETRY_BACKOFF_MS[attempt]
        }ms backoff`,
        details: { attemptNumber: attempt + 1 },
      });
    }

    attemptCount++;
    lastResult = await runExecutionJob(request, ctx);

    // Terminal success → stop retrying immediately.
    if (isSuccessStatus(lastResult.status)) break;

    // no_availability is terminal-for-this-phase — Phase 2/3 may still try.
    // Hard-blocks (captcha / needs_login) don't help with retry.
    if (
      lastResult.status === "no_availability" ||
      lastResult.status === "captcha" ||
      lastResult.status === "needs_login" ||
      isProviderAuthOrBillingFailure(lastResult)
    ) {
      if (isProviderAuthOrBillingFailure(lastResult)) {
        await writeAudit({
          jobId: ctx.jobId,
          type: "action_denied",
          stepIndex: ctx.stepIndex,
          message: "Not retrying provider quota/billing failure",
          details: {
            status: lastResult.status,
            summary: lastResult.summary,
            error: lastResult.error,
          },
        });
      }
      break;
    }

    // Only transient errors fall through to the next retry iteration.
  }

  return {
    result:
      lastResult ??
      makeErrorResult(ctx.jobId, "No primary attempt executed"),
    attemptCount,
  };
}

// ─── Phase 2: time fallback (restaurant only) ────────────────────────────────

/**
 * Returns a success result when any alternate time works, or `null` when
 * all tried times fail (caller falls through to Phase 3).
 *
 * Difference vs. route.ts filterTimeFallbacks: this version only consults
 * policy.maxTimeAdjustmentMinutes. The legacy earliestTimeHHMM /
 * latestTimeHHMM of-day clamps are NOT carried over — those were C 端
 * user-setting knobs that map to a ConsentPolicy extension later if B 端
 * callers ask for them.
 */
async function tryTimeFallbacks(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
  policy: ConsentPolicy,
  attemptsBefore: number,
): Promise<ExecutionJobResult | null> {
  // Only restaurant has a meaningful "try a nearby time" semantic.
  if (request.request.scenario !== "restaurant") return null;

  if (!policy.allowTimeAdjustment) {
    await writeAudit({
      jobId: ctx.jobId,
      type: "action_denied",
      stepIndex: ctx.stepIndex,
      message: "Time adjustment disabled by consent policy — skipping fallbacks",
    });
    return null;
  }

  const baseTime = request.request.params.time;
  const maxShift = policy.maxTimeAdjustmentMinutes ?? 90;
  const candidateTimes = buildTimeFallbackCandidates(baseTime, maxShift);

  let attempts = attemptsBefore;
  let lastResult: ExecutionJobResult | null = null;

  for (const altTime of candidateTimes) {
    // Per-candidate consent check — redundant with the up-front
    // allowTimeAdjustment gate in the common case, but the delta check
    // in validateConsent covers edge cases (e.g. if maxShift is stricter
    // than our candidate generator).
    const validation = validateConsent(policy, {
      type: "adjust_time",
      fromTime: baseTime,
      toTime: altTime,
    });
    if (!validation.allowed) {
      await writeAudit({
        jobId: ctx.jobId,
        type: "action_denied",
        stepIndex: ctx.stepIndex,
        message: `Time ${altTime} blocked: ${validation.reason}`,
        details: { fromTime: baseTime, toTime: altTime },
      });
      continue;
    }

    await writeAudit({
      jobId: ctx.jobId,
      type: "time_adjusted",
      stepIndex: ctx.stepIndex,
      message: `Trying ${altTime} (original slot ${baseTime} unavailable)`,
      details: { fromTime: baseTime, toTime: altTime },
    });

    // Build a modified request with the new time. Everything else
    // (profile, consent, etc.) is preserved by spread.
    const altRequest: ExecutionJobRequest = {
      ...request,
      request: {
        ...request.request,
        params: { ...request.request.params, time: altTime },
      },
    };

    attempts++;
    lastResult = await runExecutionJob(altRequest, ctx);

    if (isSuccessStatus(lastResult.status)) {
      return {
        ...lastResult,
        attemptCount: attempts,
        usedFallback: true,
      };
    }

    // Hard-block → bail out (further time tries won't help).
    if (lastResult.status === "captcha" || lastResult.status === "needs_login") {
      return { ...lastResult, attemptCount: attempts, usedFallback: true };
    }

    // no_availability / error → try next candidate.
  }

  // All candidates exhausted.
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate candidate times near baseTime, constrained by maxShift minutes.
 * Emits in "nearest first" order: ±30, ±60, ±90 etc. Later times within
 * a tier come before earlier (dinner-biased: a 7:30 slot when 7:00 is
 * unavailable is usually preferred over 6:30 for the same |shift|).
 *
 * Pure function — unit-testable without DB / network.
 */
function buildTimeFallbackCandidates(
  baseTime: string,
  maxShiftMinutes: number,
): string[] {
  const base = parseTimeToMinutes(baseTime);
  if (base < 0) return []; // unparseable — bail

  const shifts: number[] = [];
  for (let m = 30; m <= maxShiftMinutes; m += 30) {
    shifts.push(m, -m); // later first, then earlier
  }

  return shifts
    .map((shift) => base + shift)
    .filter((total) => total >= 0 && total < 24 * 60)
    .map(formatMinutesToTime);
}

function parseTimeToMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isSuccessStatus(
  s: ExecutionJobResult["status"],
): s is
  | "paused_payment"
  | "needs_otp"
  | "needs_profile_data"
  | "ready_for_confirmation"
  | "completed" {
  return (
    s === "paused_payment" ||
    s === "needs_otp" ||
    s === "needs_profile_data" ||
    s === "ready_for_confirmation" ||
    s === "completed"
  );
}

function isProviderAuthOrBillingFailure(result: ExecutionJobResult): boolean {
  if (result.status !== "error") return false;
  const text = `${result.summary ?? ""} ${result.error ?? ""}`.toLowerCase();
  return (
    text.includes("http 402") ||
    text.includes("payment required") ||
    text.includes("quota/billing") ||
    text.includes("quota") ||
    text.includes("billing") ||
    text.includes("credits") ||
    text.includes("insufficient_quota") ||
    text.includes("invalid api key") ||
    text.includes("invalid_api_key")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeErrorResult(jobId: string, message: string): ExecutionJobResult {
  const now = new Date().toISOString();
  return {
    jobId,
    status: "error",
    summary: message,
    decisionLog: [],
    error: message,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    attemptCount: 0,
    usedFallback: false,
  };
}
