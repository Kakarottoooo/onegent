/**
 * POST /api/booking-jobs/[id]/start
 *
 * Long-running endpoint (up to 5 min) that executes autopilot steps
 * sequentially. Every autonomous decision is:
 *   1. Controlled by the user's AgentAutonomySettings (stored in the job)
 *   2. Logged with an explanation that cites the relevant setting
 *
 * Recovery order per step:
 *   1. Try primary (up to 3 attempts, 2s/5s backoff on transient error)
 *   2. If restaurant + no_availability + timeWindowMinutes > 0:
 *      try filtered timeFallbacks, citing the window setting in each log entry
 *   3. If allowVenueSwitch (hotel/restaurant): try each fallbackCandidate
 *      — restaurant candidates also get their own time-filtered fallbacks
 *   4. All failed → actionItem + explanatory message, continue to next step
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getBookingJob,
  updateBookingJobStatus,
  updateBookingJobSteps,
  getPushSubscriptionsBySession,
  writeAgentLog,
  getBookingProfileById,
  getDefaultBookingProfile,
  incrementUsageCounter,
} from "@/lib/db";
import { canBookMore, buildQuotaExceededBody } from "@/lib/billing/quota";
import type { BookingJobStep, FallbackCandidate, DecisionLogEntry } from "@/lib/db";
import {
  DEFAULT_AUTONOMY,
  filterTimeFallbacks,
  Explain,
} from "@/lib/autonomy";
import type { AgentAutonomySettings } from "@/lib/autonomy";
import {
  computePolicyBias,
  sortCandidatesByPolicy,
  policyOrderExplanation,
  toleranceNote,
} from "@/lib/policy";
import type { PolicyBias } from "@/lib/policy";
import { getAgentFeedbackEvents } from "@/lib/db";
import {
  detectReplanTriggers,
  computeReplan,
  applyReplan,
} from "@/lib/replan";
import {
  buildFlightInventoryDriftManualMessage,
  isFlightInventoryDriftError,
} from "@/lib/booking-errors";
import { buildAutoMonitors } from "@/lib/monitors";
import { createBookingMonitor } from "@/lib/db";
import { sendPushNotification } from "@/lib/push";
import type { PushSubscription } from "web-push";
import type { AutopilotResult, BrowserTaskResult, BrowserTaskInput } from "@/lib/booking-autopilot/types";
import { runBrowserTask } from "@/lib/booking-autopilot/stagehand-executor";
import { buildDeepLinkEnrichmentForStep } from "@/lib/booking-autopilot/executors/enrich-failed-step";
import { liveLogClose, liveLogGet } from "@/lib/live-log-store";
import { buildPreferenceProfile } from "@/lib/policy";

// ── US-009: lib/core new-path types (for the USE_CORE_EXECUTOR branch) ─────
import type {
  ExecutionJobRequest,
  ExecutionParams,
  ExecutionScenario,
  ConsentPolicy,
} from "@/lib/core";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const inFlightJobStarts = new Set<string>();

function now() { return new Date().toISOString(); }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function resetStepForWorkerEnqueue(step: BookingJobStep): BookingJobStep {
  const nextBody = { ...(step.body as Record<string, unknown>) };
  delete nextBody.__lastExecutionStatus;

  return {
    ...step,
    body: nextBody,
    status: "pending",
    error: undefined,
    decisionLog: undefined,
    handoff_url: undefined,
    session_url: undefined,
    attemptCount: undefined,
    actionItem: undefined,
  };
}

function looksLikeSyntheticProfileValue(field: string, value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  if (field === "email") {
    return (
      normalized.endsWith("@onegent.test") ||
      normalized.endsWith("@example.com") ||
      normalized.includes("benchmark")
    );
  }

  if (field === "phone") {
    const digits = normalized.replace(/\D/g, "");
    return (
      digits === "1234567890" ||
      digits === "15555550100" ||
      digits === "5555550100" ||
      /^555\d{7}$/.test(digits)
    );
  }

  if (field === "first_name" || field === "last_name") {
    return normalized === "benchmark" || normalized === "user" || normalized === "john" || normalized === "doe";
  }

  return false;
}

function preferInlineProfileValue(
  field: string,
  inlineValue: string | undefined,
  dbValue: string | undefined,
  allowSyntheticInline: boolean,
): string | undefined {
  if (inlineValue && (!looksLikeSyntheticProfileValue(field, inlineValue) || allowSyntheticInline)) {
    return inlineValue;
  }
  return dbValue;
}

async function callEndpoint(
  endpoint: string,
  body: Record<string, unknown>
): Promise<AutopilotResult> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<AutopilotResult>;
}

// ── Core recovery engine ───────────────────────────────────────────────────

async function runStepWithRecovery(
  step: BookingJobStep,
  autonomy: AgentAutonomySettings,
  policy: PolicyBias,
  onProgress: (s: BookingJobStep) => Promise<void>
): Promise<BookingJobStep> {
  const log: DecisionLogEntry[] = [];
  const RETRY_DELAYS = [0, 2000, 5000];
  let current: BookingJobStep = { ...step, attemptCount: 0, decisionLog: log };

  const rst = autonomy.restaurant;
  const htl = autonomy.hotel;

  // ── Phase 1: primary, up to 3 attempts ──────────────────────────────────
  let primaryData: AutopilotResult | null = null;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS[attempt]);
      log.push({
        ts: now(), type: "retry",
        message: Explain.retry(attempt + 1, RETRY_DELAYS.length, current.error ?? "error"),
      });
    }

    current = { ...current, status: "loading", attemptCount: (current.attemptCount ?? 0) + 1 };
    await onProgress({ ...current, decisionLog: [...log] });

    try {
      const data = await callEndpoint(step.apiEndpoint, step.body);
      primaryData = data;

      if (data.status === "ready") {
        log.push({ ts: now(), type: "succeeded",
          message: Explain.timeTry(step.label, typeof step.body.time === "string" ? step.body.time : ""),
          outcome: "Booked ✓" });
        return { ...current, status: "done", handoff_url: data.handoff_url,
          selected_time: data.selected_time, usedFallback: false, timeAdjusted: false,
          decisionLog: [...log] };
      }

      if (data.status === "no_availability") {
        const baseTime = typeof step.body.time === "string" ? step.body.time : "";
        log.push({ ts: now(), type: "skipped",
          message: Explain.timeTry(step.label, baseTime),
          outcome: "No availability" });
        break; // don't retry no_availability — go to time fallbacks
      }

      log.push({ ts: now(), type: "attempt",
        message: Explain.timeTry(step.label, typeof step.body.time === "string" ? step.body.time : ""),
        outcome: data.error ?? "Error" });
      current = { ...current, error: data.error };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Network error";
      log.push({ ts: now(), type: "attempt",
        message: Explain.timeTry(step.label, ""),
        outcome: errMsg });
      current = { ...current, error: errMsg };
    }
  }

  if (primaryData && primaryData.status === "ready") {
    // Shouldn't reach here but type-safety guard
    return { ...current, status: "done", decisionLog: [...log] };
  }

  // ── Phase 2: time fallbacks (restaurants) ─────────────────────────────
  const baseTime = typeof step.body.time === "string" ? step.body.time : "";

  if (step.type === "restaurant" && primaryData?.status === "no_availability" && baseTime) {
    const rawFallbacks = step.timeFallbacks ?? [];

    // Personal tolerance note for time adjustments
    if (policy.personalTolerance && rst.timeWindowMinutes > 0) {
      const note = toleranceNote(policy.personalTolerance, "time_adjusted");
      if (note) log.push({ ts: now(), type: "attempt", message: note });
    }

    if (rst.timeWindowMinutes === 0) {
      log.push({ ts: now(), type: "skipped",
        message: Explain.noTimeAdjustmentAllowed(step.label, baseTime),
        outcome: "Time adjustment is off" });
    } else {
      const allowed = filterTimeFallbacks(baseTime, rawFallbacks, rst);

      // Log times that were filtered out by settings
      const blocked = rawFallbacks.filter((t) => !allowed.includes(t));
      for (const t of blocked) {
        const tMin = toMin(t);
        const baseMin = toMin(baseTime);
        const diff = Math.abs(tMin - baseMin);
        const reason: "window" | "latest" | "earliest" =
          diff > rst.timeWindowMinutes ? "window" :
          tMin > toMin(rst.latestTimeHHMM) ? "latest" : "earliest";
        log.push({ ts: now(), type: "skipped",
          message: Explain.timeAdjustedBlocked(step.label, baseTime, t, reason),
          outcome: `Blocked by your settings` });
      }

      for (const altTime of allowed) {
        current = { ...current, status: "loading" };
        await onProgress({ ...current, decisionLog: [...log] });

        log.push({ ts: now(), type: "time_adjusted",
          message: Explain.timeAdjusted(step.label, baseTime, altTime, rst.timeWindowMinutes) });

        try {
          const data = await callEndpoint(step.apiEndpoint, { ...step.body, time: altTime });
          const lastEntry = log[log.length - 1];
          lastEntry.outcome = data.status === "ready" ? "Booked ✓" : data.error ?? "No availability";
          lastEntry.type = data.status === "ready" ? "succeeded" : "time_adjusted";

          await onProgress({ ...current, decisionLog: [...log] });

          if (data.status === "ready") {
            return { ...current, status: "done", handoff_url: data.handoff_url,
              selected_time: data.selected_time, timeAdjusted: true, usedFallback: false,
              decisionLog: [...log] };
          }
        } catch (err) {
          log[log.length - 1].outcome = err instanceof Error ? err.message : "Error";
        }
      }
    }
  }

  // ── Phase 3: fallback candidates ──────────────────────────────────────
  let candidates: FallbackCandidate[] = step.fallbackCandidates ?? [];
  const venueAllowed = step.type === "restaurant" ? rst.allowVenueSwitch : htl.allowAreaSwitch;

  // Sort by policy score — best-trusted venue tried first
  if (candidates.length > 1 && policy.hasEnoughData) {
    candidates = sortCandidatesByPolicy(candidates, policy.venueScores);
    candidates.forEach((c, i) => {
      const score = policy.venueScores[c.label] ?? 0;
      const explanation = policyOrderExplanation(c.label, score, i + 1);
      if (score !== 0) {
        log.push({ ts: now(), type: "attempt", message: explanation });
      }
    });
  }

  // Personal tolerance note — warn if behavior diverges from settings
  if (policy.personalTolerance) {
    const note = toleranceNote(policy.personalTolerance, "venue_switched");
    if (note) log.push({ ts: now(), type: "attempt", message: note });
  }

  if (candidates.length > 0 && !venueAllowed) {
    log.push({ ts: now(), type: "skipped",
      message: Explain.venueSwitchBlocked(step.label),
      outcome: "Venue switching is off" });
  } else {
    for (const candidate of candidates) {
      current = { ...current, status: "loading" };
      log.push({ ts: now(), type: "venue_switched",
        message: Explain.venueSwitched(step.label, candidate.label) });
      await onProgress({ ...current, decisionLog: [...log] });

      try {
        const data = await callEndpoint(step.apiEndpoint, candidate.body);
        log[log.length - 1].outcome = data.status === "ready" ? "Booked ✓" :
          data.status === "no_availability" ? "No availability" : (data.error ?? "Error");

        await onProgress({ ...current, decisionLog: [...log] });

        if (data.status === "ready") {
          return { ...current, label: candidate.label, status: "done",
            handoff_url: data.handoff_url, selected_time: data.selected_time,
            usedFallback: true, decisionLog: [...log] };
        }

        // Also try time fallbacks for restaurant candidates
        if (step.type === "restaurant" && data.status === "no_availability" &&
            rst.timeWindowMinutes > 0) {
          const candTime = typeof candidate.body.time === "string" ? candidate.body.time : baseTime;
          const candFallbacks = filterTimeFallbacks(candTime, step.timeFallbacks ?? [], rst);

          for (const altTime of candFallbacks) {
            log.push({ ts: now(), type: "time_adjusted",
              message: Explain.timeAdjusted(candidate.label, candTime, altTime, rst.timeWindowMinutes) });

            try {
              const altData = await callEndpoint(step.apiEndpoint, { ...candidate.body, time: altTime });
              log[log.length - 1].outcome = altData.status === "ready" ? "Booked ✓" : (altData.error ?? "No availability");
              log[log.length - 1].type = altData.status === "ready" ? "succeeded" : "time_adjusted";

              await onProgress({ ...current, decisionLog: [...log] });

              if (altData.status === "ready") {
                return { ...current, label: candidate.label, status: "done",
                  handoff_url: altData.handoff_url, selected_time: altData.selected_time,
                  usedFallback: true, timeAdjusted: true, decisionLog: [...log] };
              }
            } catch { /* continue */ }
          }
        }
      } catch (err) {
        log[log.length - 1].outcome = err instanceof Error ? err.message : "Error";
      }
    }
  }

  // ── Phase 4: all failed — actionItem ──────────────────────────────────
  const triedCount = 1 + (step.timeFallbacks?.length ?? 0) + candidates.length;
  log.push({ ts: now(), type: "failed",
    message: Explain.allFailed(step.label, triedCount),
    outcome: "Needs your attention" });

  const manualOptions = [
    { label: step.label, url: step.fallbackUrl },
    ...candidates.map((c) => ({ label: c.label, url: c.fallbackUrl })),
  ].filter((o) => o.url);

  return {
    ...current,
    status: "error",
    handoff_url: step.fallbackUrl,
    actionItem: manualOptions.length > 0
      ? {
          message: manualOptions.length === 1
            ? "Auto-booking failed. Tap to complete manually:"
            : "Auto-booking failed. Choose one of these to book manually:",
          options: manualOptions,
        }
      : undefined,
    decisionLog: [...log],
  };
}

// ── US-009: lib/core new-path adapter ──────────────────────────────────────
// Invoked by runUniversalStep when USE_CORE_EXECUTOR=true AND the job's
// step.body carries the lib/core/execution marker. Reconstructs an
// ExecutionJobRequest from the body (body was serialized by
// lib/core/execution/job-manager.createJob so the shape is known),
// delegates to runExecutionJobWithRecovery, maps the result back to
// BookingJobStep so the surrounding runStepWithRecovery / /tasks UI
// sees no difference vs. the legacy path.
async function runUniversalStepViaCore(
  step: BookingJobStep,
  body: Record<string, unknown>,
  bookingJobId: string,
  jobUserId: string | null | undefined,
  onProgress: (s: BookingJobStep) => Promise<void>,
): Promise<BookingJobStep> {
  // Lazy import keeps the module load cost off the legacy hot path.
  const { runExecutionJobWithRecovery } = await import(
    "@/lib/core/execution/recovery"
  );

  const request: ExecutionJobRequest = {
    request: {
      scenario: body.scenario as ExecutionScenario,
      // Trust the __source marker — body.params was produced by
      // lib/core/execution/job-manager.buildStepFromRequest and carries
      // the right shape for this scenario.
      params: body.params,
    } as ExecutionParams,
    profileId: typeof body.profileId === "number" ? body.profileId : undefined,
    // Inline profile passthrough — required by anonymous benchmark cases
    // (userId=null + no profileId, only an inline profile in body).
    profile: body.profile as ExecutionJobRequest["profile"],
    consent: body.consent as ConsentPolicy | undefined,
  };

  const stepIndex = typeof body.stepIndex === "number" ? body.stepIndex : 0;

  await onProgress({ ...step, status: "loading" });

  const result = await runExecutionJobWithRecovery(request, {
    jobId: bookingJobId,
    userId: jobUserId ?? null,
    stepIndex,
  });

  // Map ExecutionJobStatus → BookingJobStep.status. Mirrors the mapping
  // in lib/core/execution/job-manager.mapJobStatusToStepStatus but kept
  // inline here to avoid pulling that internal helper onto route.ts's
  // import surface.
  const stepStatus: BookingJobStep["status"] =
    result.status === "paused_payment" ||
    result.status === "needs_otp" ||
    result.status === "needs_profile_data" ||
    result.status === "ready_for_confirmation"
      ? "awaiting_confirmation"
      : result.status === "completed"
      ? "done"
      : result.status === "no_availability"
      ? "no_availability"
      : "error";

  const stepError =
    result.status === "error" ||
    result.status === "captcha" ||
    result.status === "needs_login"
      ? result.error ?? step.error
      : result.status === "needs_profile_data"
      ? result.profileGap?.message ?? result.error
      : undefined;

  return {
    ...step,
    status: stepStatus,
    handoff_url: result.handoffUrl ?? step.handoff_url,
    session_url: result.sessionUrl ?? step.session_url,
    error: stepError,
    attemptCount: result.attemptCount ?? step.attemptCount,
    usedFallback: result.usedFallback ?? step.usedFallback,
    decisionLog: result.decisionLog,
  };
}

// ── Universal step via Stagehand browser executor ─────────────────────────

async function runUniversalStep(
  step: BookingJobStep,
  onProgress: (s: BookingJobStep) => Promise<void>,
  bookingJobId: string,
  jobUserId?: string | null,
  autonomy?: AgentAutonomySettings,
): Promise<BookingJobStep> {
  console.log("[start] runUniversalStep invoked", {
    jobId: bookingJobId,
    stepType: step.type,
    hasCoreMarker: false,
    useCoreFlag: process.env.USE_CORE_EXECUTOR === "true",
  });
  // ── US-009: Dispatch to lib/core new path when flag + marker match ──
  // Requires BOTH:
  //   1. env USE_CORE_EXECUTOR === "true" (global kill-switch)
  //   2. step.body.__source === "lib/core/execution" (per-job marker, set
  //      by lib/core/execution/job-manager.createJob when the job was
  //      created via the new path — e.g. from a B 端 REST caller)
  // This way legacy C 端 flows (chat-commit / trip-packaging / DR
  // synthesis) which don't write the marker always continue on the old
  // path regardless of the flag. Zero-regression by construction.
  const bodyAny = step.body as Record<string, unknown>;
  const { isCoreExecutionSource } = await import("@/lib/core/cend-adapter");
  console.log("[start] runUniversalStep marker", {
    jobId: bookingJobId,
    source: bodyAny.__source,
    hasCoreMarker: isCoreExecutionSource(bodyAny.__source),
  });
  if (
    process.env.USE_CORE_EXECUTOR === "true" &&
    isCoreExecutionSource(bodyAny.__source)
  ) {
    console.log("[start] dual-gate HIT — routing via lib/core.runExecutionJobWithRecovery", {
      jobId: bookingJobId,
      scenario: bodyAny.scenario,
    });
    return runUniversalStepViaCore(
      step,
      bodyAny,
      bookingJobId,
      jobUserId,
      onProgress,
    );
  }

  const log: DecisionLogEntry[] = [];
  await onProgress({ ...step, status: "loading", decisionLog: log });

  // Resolve profile from DB server-side using the job's userId.
  // The internal fetch has no Clerk session, so auth() returns null in the
  // universal endpoint. Fetching here and injecting inline solves that.
  let resolvedBody: Record<string, unknown> = { ...(step.body as Record<string, unknown>) };

  // ── Restaurant steps: build OpenTable startUrl + task if not already set ──
  // step.body for restaurant steps contains: restaurantName, date (YYYY-MM-DD),
  // time (HH:MM 24h), covers (number), and optionally city.
  //
  // startUrl and task are filled INDEPENDENTLY — a caller (e.g. the benchmark
  // runner) may pre-supply startUrl pointing at a known restaurant detail
  // page while leaving task for us to generate. Previously the task-build
  // branch was nested under the startUrl-build branch, which left task
  // undefined for those callers and crashed runBrowserTask downstream with
  // `Cannot read properties of undefined (reading 'match')`.
  if (step.type === "restaurant") {
    const rName = resolvedBody.restaurantName as string | undefined;
    const rDate = resolvedBody.date as string | undefined;
    const rTime = resolvedBody.time as string | undefined;
    const rCovers = (resolvedBody.covers as number | undefined) ?? 2;
    const rCity = (resolvedBody.city as string | undefined) ?? "";

    if (rName && rDate && rTime) {
      // (1) Synthesize startUrl when missing.
      // Build OpenTable search URL: dateTime must be ISO format YYYY-MM-DDTHH:MM:00.
      //
      // Include the city in the `term` query so OpenTable's search isn't
      // scoped to whatever metro the headless browser last saw (we
      // consistently got Nashville results when searching for NY restaurants
      // because Nashville is our DEFAULT_CITY, and OpenTable carries forward
      // the most-recent-viewed metro via session cookie).
      //
      // `term=Restaurant+Name City+Name` reliably biases the match to the
      // right metro while still matching the restaurant by name.
      const existingStartUrl =
        typeof resolvedBody.startUrl === "string" ? resolvedBody.startUrl : "";
      const {
        buildOpenTableUrl,
        buildOpenTableCanonicalUrl,
        shouldUseCanonicalRestaurantSearchUrl,
      } = await import("@/lib/agent/planners/booking-links");

      // Official venue websites frequently drop the case date/time and can
      // bounce into unrelated OpenTable experience flows (e.g. brunch pages on
      // the wrong day). For structured restaurant bookings, prefer a canonical
      // booking surface unless the caller already supplied a real restaurant
      // booking URL (OpenTable / Resy / Yelp).
      if (shouldUseCanonicalRestaurantSearchUrl(existingStartUrl)) {
        // Prefer the canonical /r/<slug> URL when we have name+city — this
        // skips OT search entirely and lands directly on the venue's detail
        // page. Avoids the Nashville-sticky-dropdown bug that the term-only
        // search hits when the chromium profile picks up a non-NYC location.
        // If the slug guess is wrong (404), the stagehand executor's
        // listing-page detection triggers the recovery loop and the term-
        // based search runs anyway — but with metroId scoping now baked in.
        const canonicalUrl =
          rName && rCity ? buildOpenTableCanonicalUrl(rName, rCity) : null;
        const termRaw = rCity ? `${rName} ${rCity}` : rName;
        resolvedBody = {
          ...resolvedBody,
          startUrl:
            canonicalUrl ??
            buildOpenTableUrl({
              restaurantName: termRaw,
              city: rCity,
              date: rDate,
              time: rTime,
              covers: rCovers,
            }),
        };
      }

      // (2) Synthesize task NL when missing — independent of startUrl.
      if (!resolvedBody.task) {
        const { buildRestaurantTask } = await import("@/lib/booking-autopilot/core/task-builders");
        const { task } = buildRestaurantTask({
          restaurantName: rName,
          city: rCity,
          date: rDate,
          time: rTime,
          covers: rCovers,
          profile: (resolvedBody.profile ?? { first_name: "", last_name: "", email: "", phone: "" }) as Parameters<typeof buildRestaurantTask>[0]["profile"],
        });
        resolvedBody = { ...resolvedBody, task };
      }
    }
  }

  // ── Hotel steps: build Booking.com startUrl + task if not already set ──
  // step.body for hotel steps contains: hotel_name, city, checkin, checkout, adults.
  if (step.type === "hotel" && !resolvedBody.startUrl) {
    const hName = resolvedBody.hotel_name as string | undefined;
    const hCity = (resolvedBody.city as string | undefined) ?? "";
    const hCheckin = resolvedBody.checkin as string | undefined;
    const hCheckout = resolvedBody.checkout as string | undefined;
    const hAdults = (resolvedBody.adults as number | undefined) ?? 2;

    if (hName) {
      // Use the canonical URL builder so checkin/checkout/group_adults are
      // embedded as Booking.com-native params (checkin_year/month/monthday).
      // A bare ?ss= search URL defaults to "tonight/tomorrow" and the executor's
      // selectedDatesMatch check then fails with "Selected dates mismatched the requested stay."
      const { buildBookingComUrl } = await import("@/lib/agent/planners/booking-links");
      resolvedBody = {
        ...resolvedBody,
        startUrl: buildBookingComUrl({
          hotelName: hName,
          city: hCity,
          checkin: hCheckin,
          checkout: hCheckout,
          adults: hAdults,
          rooms: 1,
        }),
      };

      if (!resolvedBody.task) {
        const checkinStr = hCheckin ? ` Check in ${hCheckin}.` : "";
        const checkoutStr = hCheckout ? ` Check out ${hCheckout}.` : "";
        resolvedBody = {
          ...resolvedBody,
          task: `Find ${hName}${hCity ? ` in ${hCity}` : ""} on Booking.com.${checkinStr}${checkoutStr} Select the cheapest available room for ${hAdults} adult${hAdults !== 1 ? "s" : ""}. Fill in all guest details and payment information. Stop before entering CVV or clicking the final payment confirmation button.`,
        };
      }
    }
  }

  // ── Flight steps: build Expedia startUrl + task if not already set ──
  // step.body for flight steps contains: origin, dest, date, returnDate, passengers, cabinClass.
  if (step.type === "flight" && !resolvedBody.startUrl) {
    const fOrigin = resolvedBody.origin as string | undefined;
    const fDest = resolvedBody.dest as string | undefined;
    const fDate = resolvedBody.date as string | undefined;
    const fReturn = resolvedBody.returnDate as string | undefined;
    const fPax = (resolvedBody.passengers as number | undefined) ?? 1;
    const fCabin = (resolvedBody.cabinClass as string | undefined) ?? "economy";
    const fPreferNonstop = (resolvedBody.preferNonstop as boolean | undefined) ?? false;

    if (fOrigin && fDest && fDate) {
      // Use Expedia for flight booking — shares same guest/payment form logic as hotel booking
      const tripType = fReturn ? "roundtrip" : "oneway";
      const cabinMap: Record<string, string> = { economy: "coach", business: "business", first: "first", premium_economy: "premiumcoach" };
      const expediaCabin = cabinMap[fCabin] ?? "coach";
      const expediaUrl = `https://www.expedia.com/Flights-Search?trip=${tripType}&leg1=from:${fOrigin},to:${fDest},departure:${fDate}TANYT${fReturn ? `&leg2=from:${fDest},to:${fOrigin},departure:${fReturn}TANYT` : ""}&passengers=adults:${fPax}&options=cabinclass:${expediaCabin}&mode=search`;
      resolvedBody = { ...resolvedBody, startUrl: expediaUrl };

      if (!resolvedBody.task) {
        const returnStr = fReturn ? ` Return on ${fReturn}.` : "";
        const targetAirline = resolvedBody.targetAirline as string | undefined;
        const targetPrice = resolvedBody.targetPrice as number | undefined;
        const targetDepartureTime = resolvedBody.targetDepartureTime as string | undefined;
        const targetFlightNumber = resolvedBody.targetFlightNumber as string | undefined;
        // Build a specific flight identifier so the agent targets the right flight card
        const flightId = [
          targetAirline,
          targetDepartureTime ? `departing ${targetDepartureTime}` : "",
          targetPrice ? `priced at $${targetPrice}` : "",
          targetFlightNumber ? `flight number ${targetFlightNumber}` : "",
        ].filter(Boolean).join(", ");
        const flightDesc = flightId
          ? `the ${flightId}`
          : `a ${fCabin} class flight from ${fOrigin} to ${fDest}`;

        resolvedBody = {
          ...resolvedBody,
          _flightTaskBase: [
            `This is a FLIGHT BOOKING task on Expedia. You are on the Expedia flight search results page.`,
            `EXACT STEPS — follow in order:`,
            `1. FIND FLIGHT: Locate ${flightDesc} departing ${fDate}${returnStr}. Scroll through the list to find a flight card that matches the airline name and price.`,
            `2. CLICK FLIGHT: Click that flight card to open the fare selection panel/popup.`,
            `3. SELECT FARE: In the fare popup that appears, choose the cheapest/first option (e.g. "Blue Basic", "Basic Economy", or the lowest-priced fare shown). Click the "Select" button on that fare.`,
            `4. DISMISS BUNDLE POPUP: If a "Bundle & Save" or car rental popup appears, click "No thanks" to dismiss it.`,
            `5. REVIEW PAGE: You will land on a "Review your trip" page. Click "Skip to Checkout" (NOT "Next: Seats"). If only "Next: Seats" is visible, click it — but then on the Seats page click "Next: Checkout" to proceed without selecting a seat.`,
            `6. FILL PASSENGER INFO: On the checkout/traveler info page, fill in all required fields (first name, last name, email, phone, date of birth, passport number if required).`,
            `7. STOP before entering the CVV or clicking the final "Complete booking" / "Purchase" button.`,
            `Do NOT navigate to hotels, do NOT use hotel booking steps.`,
          ].join(" "),
        };
      }
    }
  }

  // Accept profileId as number OR string (JSONB round-trips preserve numbers, but be defensive)
  const rawProfileId = resolvedBody.profileId;
  const profileId: number | null =
    typeof rawProfileId === "number" ? rawProfileId :
    typeof rawProfileId === "string" && rawProfileId ? parseInt(rawProfileId) :
    null;

  // Fetch card number from DB and merge into inline profile (card never stored in step body).
  // Also serves as fallback if inline profile is missing.
  if (jobUserId) {
    try {
      const dbProfile = profileId
        ? await getBookingProfileById(profileId, jobUserId, true)
        : await getDefaultBookingProfile(jobUserId, true);

      if (dbProfile) {
        log.push({
          ts: now(),
          type: "info" as const,
          message: `[profile-load] dbProfile.id=${dbProfile.id} cardNumLen=${dbProfile.card_number?.length ?? 0} cardExpiry=${!!dbProfile.card_expiry} zip=${!!dbProfile.zip} cardName=${!!dbProfile.card_name}`,
        });
        // Prefer inline profile for contact info (always up-to-date from picker),
        // but add card data + travel docs from DB (sensitive fields never stored inline).
        const inline = (resolvedBody.profile ?? {}) as Record<string, string | undefined>;
        const allowSyntheticInline = resolvedBody.benchmark_dry_run === true;
        resolvedBody = {
          ...resolvedBody,
          profile: {
            first_name: preferInlineProfileValue("first_name", inline.first_name, dbProfile.first_name, allowSyntheticInline),
            last_name: preferInlineProfileValue("last_name", inline.last_name, dbProfile.last_name, allowSyntheticInline),
            email: preferInlineProfileValue("email", inline.email, dbProfile.email, allowSyntheticInline),
            phone: preferInlineProfileValue("phone", inline.phone, dbProfile.phone, allowSyntheticInline),
            address_line1: inline.address_line1 || dbProfile.address_line1,
            city: inline.city || dbProfile.city,
            state: inline.state || dbProfile.state,
            zip: inline.zip || dbProfile.zip,
            country: inline.country || dbProfile.country,
            card_name: dbProfile.card_name,
            card_number: dbProfile.card_number,
            card_expiry: dbProfile.card_expiry,
            // Travel documents — from DB only (encrypted, never in inline body)
            date_of_birth: dbProfile.date_of_birth,
            nationality: dbProfile.nationality,
            passport_number: dbProfile.passport_number,
            passport_expiry: dbProfile.passport_expiry,
            passport_country: dbProfile.passport_country,
            known_traveler_number: dbProfile.known_traveler_number,
            driver_license_number: dbProfile.driver_license_number,
            driver_license_state: dbProfile.driver_license_state,
          },
        };

        // ── Flight travel doc check ─────────────────────────────────────────
        // DOB is universally required (domestic + international). Passport is
        // optional — domestic US routes (e.g. JFK→LAX) don't require it.
        // Stagehand AI fills passport when the form requires it; if missing
        // on an international route, the form-filling layer surfaces a clear
        // error there.
        if (step.type === "flight" && !dbProfile.date_of_birth) {
          const missingMsg = `Missing travel documents: date of birth required for flight booking. Please add it in Settings → My Profile → Travel Documents, then try booking again.`;
          return {
            ...step,
            status: "error",
            error: missingMsg,
            decisionLog: [...log, { type: "error" as const, message: `[travel-doc-check] Missing: date of birth` }],
          } as unknown as BookingJobStep;
        }

        // ── Payment field check ─────────────────────────────────────────────
        // Hotel / flight / activity all reach a payment page. If card or billing
        // address is missing, fail early so the RPA doesn't burn minutes getting
        // to checkout just to stall on an empty card number field.
        // Restaurant is excluded — OpenTable/Resy usually book without payment.
        if (step.type !== "restaurant") {
          const missingPayment: string[] = [];
          if (!dbProfile.card_number) missingPayment.push("card number");
          if (!dbProfile.card_expiry) missingPayment.push("card expiry");
          if (!dbProfile.address_line1) missingPayment.push("billing address");
          if (missingPayment.length > 0) {
            const missingMsg = `Missing payment profile: ${missingPayment.join(", ")}. Please add these in Settings → My Profile, then try booking again.`;
            return {
              ...step,
              status: "error",
              error: missingMsg,
              decisionLog: [...log, { type: "error" as const, message: `[payment-check] Missing: ${missingPayment.join(", ")}` }],
            } as unknown as BookingJobStep;
          }
        }

        // ── Finalize flight task with travel doc info (now that DB profile is merged) ──
        if (step.type === "flight" && resolvedBody._flightTaskBase) {
          const mergedProfile = resolvedBody.profile as Record<string, string | undefined> | undefined;
          const docStr = mergedProfile?.passport_number
            ? ` Passenger passport: ${mergedProfile.passport_number}, expires ${mergedProfile.passport_expiry ?? "unknown"}${mergedProfile.passport_country ? `, issued by ${mergedProfile.passport_country}` : ""}.`
            : "";
          const dobStr = mergedProfile?.date_of_birth ? ` Date of birth: ${mergedProfile.date_of_birth}.` : "";
          const ktnStr = mergedProfile?.known_traveler_number ? ` Known Traveler Number (TSA PreCheck): ${mergedProfile.known_traveler_number}.` : "";
          resolvedBody = {
            ...resolvedBody,
            task: `${resolvedBody._flightTaskBase as string}${docStr}${dobStr}${ktnStr} Stop before entering payment card information.`,
          };
          delete resolvedBody._flightTaskBase;
        }
      } else {
        // Log for debugging — profile not found by id or default
        await writeAgentLog({
          session_id: "",
          job_id: step.label,
          level: "warn",
          source: "runUniversalStep",
          message: `Profile not found in DB (profileId=${profileId}, userId=${jobUserId})`,
          details: { profileId, jobUserId },
        });
      }
    } catch (err) {
      await writeAgentLog({
        session_id: "",
        job_id: step.label,
        level: "error",
        source: "runUniversalStep",
        message: `Profile DB fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        details: { profileId, jobUserId },
      });
    }
  }

  try {
    const input: BrowserTaskInput = {
      startUrl: resolvedBody.startUrl as string,
      task: resolvedBody.task as string,
      profile: (resolvedBody.profile ?? { first_name: "", last_name: "", email: "", phone: "" }) as BrowserTaskInput["profile"],
      jobId: bookingJobId,
      stepIndex: (resolvedBody.stepIndex as number | undefined) ?? 0,
      agentModel: resolvedBody.agentModel as BrowserTaskInput["agentModel"] | undefined,
      // Flight targeting hints — passed through to programmatic RPA
      targetAirline: resolvedBody.targetAirline as string | undefined,
      targetPrice: resolvedBody.targetPrice as number | undefined,
      targetDepartureTime: resolvedBody.targetDepartureTime as string | undefined,
      // Autonomy / dry_run boundary signal for the provider layer
      autonomySettings: autonomy
        ? { benchmark_dry_run: autonomy.benchmark_dry_run === true }
        : undefined,
      // Per-case fallback policy (e.g. restaurant time-window minutes).
      // Threaded from caseToBookingStep through step.body so stagehand
      // time-slot selectors can use case-specific limits instead of the
      // hardcoded ±90 min default.
      fallbackPolicy: resolvedBody.fallback_policy as BrowserTaskInput["fallbackPolicy"] | undefined,
    };

    // Call runBrowserTask directly — avoids the self-HTTP fetch that fails when
    // NEXT_PUBLIC_APP_URL is not set (or the loopback is unavailable in serverless).
    // For debugging, keep browser execution to a single attempt so the log shows one clean trace.
    // Non-retryable outcomes (captcha, no_availability, completed) still break immediately.
    const MAX_BROWSER_RETRIES = 0; // 1 total attempt
    let data: BrowserTaskResult | null = null;
    let browserTaskErr: Error | null = null;

    for (let attempt = 0; attempt <= MAX_BROWSER_RETRIES; attempt++) {
      if (attempt > 0) {
        const reason = data?.error ?? data?.summary ?? browserTaskErr?.message ?? "error";
        log.push({
          ts: now(), type: "retry",
          message: `Browser retry ${attempt + 1}/${MAX_BROWSER_RETRIES + 1} — ${reason.slice(0, 120)}`,
        });
        await onProgress({ ...step, status: "loading", decisionLog: [...log] });
        await sleep(3000);
      }

      try {
        // Hard timeout: if runBrowserTask hangs (stagehand.act() CDP lock, networkidle wait, etc.)
        // kill the attempt after 7 minutes so the retry loop can proceed or fail cleanly.
        const BROWSER_TASK_TIMEOUT_MS = 7 * 60 * 1000;
        data = await Promise.race([
          runBrowserTask(input),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Browser task timed out after 7 minutes")), BROWSER_TASK_TIMEOUT_MS)
          ),
        ]);
        liveLogClose(input.jobId);
        browserTaskErr = null;
        // Non-retryable: stop immediately
        if (
          data.status === "completed" ||
          data.status === "paused_payment" ||
          data.status === "no_availability" ||
          data.status === "captcha"
        ) break;
        // Retryable error: log attempt and continue loop
        if (attempt < MAX_BROWSER_RETRIES) {
          log.push({
            ts: now(), type: "attempt",
            message: `Attempt ${attempt + 1}: ${(data.error ?? data.summary ?? `status=${data.status}`).slice(0, 120)}`,
            outcome: "retrying",
          });
        }
      } catch (err) {
        liveLogClose(input.jobId);
        browserTaskErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_BROWSER_RETRIES) {
          log.push({
            ts: now(), type: "attempt",
            message: `Attempt ${attempt + 1}: ${browserTaskErr.message.slice(0, 120)}`,
            outcome: "retrying",
          });
        }
      }
    }

    // If the attempt timed out or threw before producing a BrowserTaskResult,
    // persist whatever live executor trace we already captured so the tasks UI
    // doesn't collapse to a single generic timeout line.
    if (!data) {
      const terminalError = browserTaskErr ?? new Error("Browser task failed before returning a result");
      const traceLines = input.jobId ? liveLogGet(input.jobId, 0) : [];
      for (const entry of traceLines) {
        log.push({
          ts: now(),
          type: "attempt",
          message: entry.line,
          outcome: "Executor trace",
        });
      }
      log.push({
        ts: now(),
        type: "failed",
        message: terminalError.message,
        outcome: "Error",
      });
      // Phase 2: try a deep-link override so the user lands on the booking
      // page with date / time / party-size pre-filled instead of a bare
      // search URL. Falls back to the legacy fallbackUrl for non-restaurant
      // steps or when constraint fields are missing.
      const stepWithBody = { ...step, body: resolvedBody };
      const deepLinkEnrich = buildDeepLinkEnrichmentForStep(
        stepWithBody,
        "Auto-booking stalled. Tap to continue manually:",
      );
      return {
        ...step,
        status: "error",
        error: terminalError.message,
        handoff_url:
          deepLinkEnrich?.handoff_url ??
          (typeof resolvedBody.startUrl === "string" ? resolvedBody.startUrl : step.fallbackUrl),
        actionItem:
          deepLinkEnrich?.actionItem ??
          (step.fallbackUrl
            ? {
                message: "Auto-booking stalled. Tap to continue manually:",
                options: [{ label: step.label, url: step.fallbackUrl }],
              }
            : undefined),
        decisionLog: log,
      };
    }

    // ── Persist result immediately after runBrowserTask returns ──────────────
    // Vercel's 5-min maxDuration can kill the function at any moment. Writing
    // the agent's debugTrace + summary/error to DB right here ensures the tasks
    // UI shows what happened even if the process is killed before we return.
    const earlyLog: typeof log = [...log];
    for (const entry of data.debugTrace ?? []) {
      earlyLog.push({ ts: now(), type: "attempt", message: entry, outcome: "Executor trace" });
    }
    const earlyOutcome =
      data.status === "completed" || data.status === "paused_payment" ? "succeeded" :
      data.status === "no_availability" ? "skipped" : "failed";
    earlyLog.push({
      ts: now(),
      type: earlyOutcome,
      message: data.summary || data.error || `Agent status: ${data.status}`,
      outcome: data.status,
    });
    // Fire-and-forget — we don't await so the main path isn't delayed
    onProgress({ ...step, status: "loading", decisionLog: earlyLog }).catch(() => {});

    for (const entry of data.debugTrace ?? []) {
      log.push({
        ts: now(),
        type: "attempt",
        message: entry,
        outcome: "Executor fallback",
      });
    }

    if (data.status === "completed" || data.status === "paused_payment") {
      log.push({ ts: now(), type: "succeeded", message: data.summary, outcome: "Done ✓" });
      return {
        ...step,
        status: data.status === "paused_payment" ? "awaiting_confirmation" : "done",
        handoff_url: data.handoffUrl,
        decisionLog: log,
      };
    }

    if (data.status === "no_availability") {
      // ── Multi-platform fallback for restaurants ───────────────────────────
      // If restaurant wasn't found on the current platform, automatically try the next one.
      const isNotFoundError = (summary: string) =>
        summary.toLowerCase().includes("not found on opentable") ||
        summary.toLowerCase().includes("not found on resy");

      // ── C2: time fallback ladder (restaurant) ─────────────────────────────
      // Before bailing to multi-platform / handoff, try ±15/30/60 min around
      // the requested time on the SAME platform. Reasoning: the most common
      // no_availability is "no slot at exactly 7:30 PM" — the venue often has
      // a slot 15-60 min later. Skipped for:
      //   1. not-found errors (venue doesn't exist on this platform — let
      //      multi-platform fallback handle it)
      //   2. non-restaurant steps
      //   3. summaries indicating the venue itself is not bookable
      //      ("not on the booking network", "permanently closed", etc).
      //      Run 6 case 001 L'Artusi proved this: fast path returned
      //      "not available on opentable", ladder retried 5× same fast path,
      //      wasted 1m+. The same summaries in `data.summary` are the
      //      VENUE_NOT_ON_PLATFORM signals we just refactored — let
      //      multi-platform fallback handle these.
      const dataSummaryLower = (data.summary ?? "").toLowerCase();
      const isVenueNotOnPlatform =
        dataSummaryLower.includes("not on the opentable booking network") ||
        dataSummaryLower.includes("not available on opentable") ||
        dataSummaryLower.includes("permanently closed") ||
        dataSummaryLower.includes("may not be on the opentable") ||
        dataSummaryLower.includes("may not accept reservations through resy");
      if (
        step.type === "restaurant" &&
        !isNotFoundError(data.summary) &&
        !isVenueNotOnPlatform &&
        typeof resolvedBody.startUrl === "string"
      ) {
        const body = step.body as Record<string, unknown>;
        const rDate = body.date as string | undefined;
        const rTime = body.time as string | undefined;
        const rCovers = (body.covers as number | undefined) ?? 2;
        const rName = body.restaurantName as string | undefined;

        if (rDate && rTime && rName && /^\d{2}:\d{2}$/.test(rTime)) {
          const startMinutes = parseInt(rTime.slice(0, 2), 10) * 60 + parseInt(rTime.slice(3, 5), 10);
          // Ladder ordered by likelihood of success: small forward offsets
          // first (most slot-pickers fill in 15-min increments), then larger,
          // then symmetric backward.
          const offsets = [15, 30, 60, -30, -60];

          const ladderInput: import("@/lib/booking-autopilot/types").BrowserTaskInput = { ...input };
          let ladderHit = false;

          for (const offsetMin of offsets) {
            const altMinutes = startMinutes + offsetMin;
            if (altMinutes < 0 || altMinutes >= 24 * 60) continue;
            const altHH = Math.floor(altMinutes / 60).toString().padStart(2, "0");
            const altMM = (altMinutes % 60).toString().padStart(2, "0");
            const altTime = `${altHH}:${altMM}`;

            const sign = offsetMin > 0 ? "+" : "";
            log.push({
              ts: now(),
              type: "time_adjusted",
              message: `No availability at ${rTime} — trying ${altTime} (${sign}${offsetMin} min)`,
            });
            await onProgress({ ...step, status: "loading", decisionLog: [...log] });

            // Build alt startUrl: OT carries dateTime in the query string;
            // Resy doesn't carry time in the URL (slot is clicked on the
            // listing) — but the executor's listing-stage time picker uses
            // body.time as the target slot, so we re-run runBrowserTask with
            // an updated input.task that mentions the new time too.
            const currentStart = resolvedBody.startUrl as string;
            let altStartUrl = currentStart;
            if (/opentable\.com/i.test(currentStart)) {
              const newDateTimeQuery = `dateTime=${rDate}T${altTime}:00`;
              if (currentStart.includes("dateTime=")) {
                altStartUrl = currentStart.replace(/dateTime=[^&]+/, newDateTimeQuery);
              } else {
                altStartUrl =
                  currentStart + (currentStart.includes("?") ? "&" : "?") +
                  `${newDateTimeQuery}&covers=${rCovers}`;
              }
            }
            const altTask = typeof input.task === "string" && input.task.includes(rTime)
              ? input.task.replace(rTime, altTime)
              : input.task;

            try {
              const altData = await Promise.race([
                runBrowserTask({ ...ladderInput, startUrl: altStartUrl, task: altTask }),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error("Time-fallback attempt timed out after 4 min")), 4 * 60 * 1000),
                ),
              ]);
              liveLogClose(input.jobId);

              for (const e of altData.debugTrace ?? []) {
                log.push({ ts: now(), type: "attempt", message: e, outcome: "Executor trace (time-fallback)" });
              }

              if (altData.status === "completed" || altData.status === "paused_payment") {
                log.push({
                  ts: now(),
                  type: "succeeded",
                  message: `Booked at ${altTime} (${sign}${offsetMin} min): ${altData.summary}`,
                  outcome: "Done ✓",
                });
                ladderHit = true;
                return {
                  ...step,
                  status: altData.status === "paused_payment" ? "awaiting_confirmation" : "done",
                  handoff_url: altData.handoffUrl,
                  timeAdjusted: true,
                  decisionLog: log,
                };
              }
              log.push({
                ts: now(),
                type: "skipped",
                message: `${altTime}: ${altData.error ?? altData.summary?.slice(0, 80) ?? altData.status}`,
                outcome: "No availability",
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              log.push({
                ts: now(),
                type: "skipped",
                message: `${altTime}: ${errMsg.slice(0, 80)}`,
                outcome: "Error",
              });
            }
          }

          if (!ladderHit) {
            log.push({
              ts: now(),
              type: "failed",
              message: `Time-fallback exhausted — no availability at ±15/30/60 min around ${rTime}`,
              outcome: "All times no_availability",
            });
          }
        }
      }

      if (step.type === "restaurant" && isNotFoundError(data.summary)) {
        const body = step.body as Record<string, unknown>;
        const rName = body.restaurantName as string | undefined;
        const rDate = body.date as string | undefined;
        const rTime = body.time as string | undefined;
        const rCovers = (body.covers as number | undefined) ?? 2;
        const rCity = (body.city as string | undefined) ?? "";
        const platformsTried = (body.platformsTried as string[] | undefined) ?? [];

        if (rName && rDate && rTime) {
          const { cityToResySlug } = await import("@/lib/booking-autopilot/providers/resy-com");
          const { buildRestaurantTask } = await import("@/lib/booking-autopilot/core/task-builders");
          const { task } = buildRestaurantTask({ restaurantName: rName, city: rCity, date: rDate, time: rTime, covers: rCovers, profile: resolvedBody.profile as Parameters<typeof buildRestaurantTask>[0]["profile"] });

          // A result is a genuine booking success only when:
          // 1. Status is completed/paused_payment
          // 2. The handoff URL actually moved beyond the original search page
          // 3. The summary doesn't say "Skipped initial agent run" (= executor fallthrough with no action)
          // This prevents the final-outcome.ts fallback from returning paused_payment as fake "success".
          const isGenuineBooking = (d: import("@/lib/booking-autopilot/types").BrowserTaskResult, searchUrl: string) => {
            if (d.status === "no_availability" || d.status === "error" || d.status === "captcha" || d.status === "needs_login") return false;
            const s = d.summary.toLowerCase();
            if (s.includes("skipped initial agent run")) return false;
            if (s.includes("not found") || s.includes("no availability") || s.includes("didn't find")) return false;
            if (d.handoffUrl === searchUrl) return false; // never left search page
            return true;
          };

          // Try Resy if not already tried
          if (!platformsTried.includes("resy")) {
            const resySlug = cityToResySlug(rCity || "nashville");
            const resyTime = rTime.replace(":", "");
            const resyUrl = `https://resy.com/cities/${resySlug}?date=${rDate}&seats=${rCovers}&time=${resyTime}&query=${encodeURIComponent(rName)}`;
            log.push({ ts: now(), type: "attempt", message: `Not found on OpenTable — trying Resy`, outcome: "Retrying" });
            await onProgress({ ...step, status: "loading", decisionLog: [...log] });

            const resyInput: import("@/lib/booking-autopilot/types").BrowserTaskInput = {
              startUrl: resyUrl, task,
              profile: resolvedBody.profile as import("@/lib/booking-autopilot/types").BrowserTaskInput["profile"],
              jobId: bookingJobId,
              stepIndex: (resolvedBody.stepIndex as number | undefined) ?? 0,
            };
            try {
              const resyData = await runBrowserTask(resyInput);
              if (isGenuineBooking(resyData, resyUrl)) {
                log.push({ ts: now(), type: "succeeded", message: `Booked via Resy: ${resyData.summary}`, outcome: "Done ✓" });
                return { ...step, status: resyData.status === "paused_payment" ? "awaiting_confirmation" : "done", handoff_url: resyData.handoffUrl, decisionLog: log };
              }
              if (resyData.availableSlots?.length) {
                const bodyWithSlots = { ...body, availableSlots: resyData.availableSlots, platformsTried: [...platformsTried, "resy"] };
                // Phase 2: deep-link override so the user lands on Resy with
                // their date / party / time pre-filled and can pick a slot.
                const stepWithSlots = { ...step, body: bodyWithSlots };
                const deepLinkEnrich = buildDeepLinkEnrichmentForStep(
                  stepWithSlots,
                  "No exact match — tap to pick a different time:",
                );
                return {
                  ...step,
                  body: bodyWithSlots,
                  status: "no_availability",
                  error: resyData.summary,
                  handoff_url: deepLinkEnrich?.handoff_url,
                  actionItem: deepLinkEnrich?.actionItem,
                  decisionLog: log,
                };
              }
              log.push({ ts: now(), type: "attempt", message: `Not found on Resy — looking up official website via Google Places`, outcome: "Retrying" });
            } catch { /* fall through to Google Places lookup */ }

            // Final fallback: use Google Places to find the restaurant's official website
            let officialWebsite: string | undefined;
            let googlePlacesError = false;
            try {
              const { googlePlacesSearch } = await import("@/lib/booking-autopilot/../tools");
              const results = await googlePlacesSearch({
                query: rName,
                location: rCity || "Nashville, TN",
                maxResults: 3,
              });
              // Find the best match by name
              const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
              const targetNorm = normalize(rName);
              const match = results.find(r => {
                const nameNorm = normalize(r.name);
                return nameNorm.includes(targetNorm.slice(0, 8)) || targetNorm.includes(nameNorm.slice(0, 8));
              }) ?? results[0];
              officialWebsite = match?.url;
            } catch {
              googlePlacesError = true;
            }

            if (officialWebsite) {
              log.push({ ts: now(), type: "attempt", message: `Found official website via Google Places: ${officialWebsite.slice(0, 60)} — navigating to find reservation link`, outcome: "Retrying" });
              await onProgress({ ...step, status: "loading", decisionLog: [...log] });

              // Navigate to the official website and look for a reservation/booking page
              let reservationUrl = officialWebsite;
              try {
                const websiteInput: import("@/lib/booking-autopilot/types").BrowserTaskInput = {
                  startUrl: officialWebsite,
                  task: `On the restaurant website for "${rName}", find and click a "Reservations", "Book a Table", "Book Now", or "Reserve" link or button. Navigate to the reservation page. Do not fill any forms — just navigate to where reservations can be made.`,
                  profile: resolvedBody.profile as import("@/lib/booking-autopilot/types").BrowserTaskInput["profile"],
                  jobId: bookingJobId,
                  stepIndex: (resolvedBody.stepIndex as number | undefined) ?? 0,
                };
                const websiteData = await runBrowserTask(websiteInput);

                // If the agent navigated somewhere meaningful, use that URL
                if (
                  websiteData.handoffUrl &&
                  websiteData.handoffUrl !== officialWebsite &&
                  websiteData.handoffUrl.startsWith("http")
                ) {
                  reservationUrl = websiteData.handoffUrl;
                  log.push({ ts: now(), type: "attempt", message: `Found reservation page on official website: ${reservationUrl.slice(0, 60)}`, outcome: "Handoff" });
                } else {
                  log.push({ ts: now(), type: "attempt", message: `No dedicated reservation page found — using homepage: ${officialWebsite.slice(0, 60)}`, outcome: "Handoff" });
                }
              } catch {
                log.push({ ts: now(), type: "attempt", message: `Could not browse official website — using homepage`, outcome: "Handoff" });
              }

              const allTriedBody = { ...body, platformsTried: [...platformsTried, "opentable", "resy"], officialWebsite, reservationUrl };
              // If we found a proper reservation page (e.g. Resy for Eleven
              // Madison Park, SevenRooms for Carbone), that's actually a
              // "ready for you to book manually" state — not a failure. The
              // restaurant just uses a non-OpenTable booking system. Reword
              // so the user doesn't see "not found" when we did find their
              // reservation page.
              const foundReservationPage = reservationUrl !== officialWebsite;
              const errorMessage = foundReservationPage
                ? `"${rName}" books through their own system (not OpenTable or Resy). We found their reservation page — tap below to finish booking there.`
                : `"${rName}" is not on OpenTable or Resy, and we couldn't locate a reservation widget on their website. Tap below to try booking on their homepage.`;
              return {
                ...step,
                body: allTriedBody,
                status: "no_availability",
                error: errorMessage,
                handoff_url: reservationUrl,
                decisionLog: log,
              };
            } else {
              log.push({ ts: now(), type: "failed", message: googlePlacesError ? `Google Places lookup failed` : `No website found for "${rName}"`, outcome: "No availability" });
            }

            const allTriedBody = { ...body, platformsTried: [...platformsTried, "opentable", "resy"] };
            return {
              ...step,
              body: allTriedBody,
              status: "no_availability",
              error: `"${rName}" was not found on OpenTable or Resy. The restaurant may only accept walk-in reservations or phone bookings.`,
              handoff_url: step.fallbackUrl,
              decisionLog: log,
            };
          }
        }
      }

      log.push({ ts: now(), type: "skipped", message: "No availability found", outcome: "No availability" });
      // For restaurant steps: persist available time slots so the UI can offer alternatives
      const bodyWithSlots = data.availableSlots?.length
        ? { ...(step.body as Record<string, unknown>), availableSlots: data.availableSlots }
        : step.body;
      // Phase 2: deep-link override for restaurant steps so the user lands on
      // OT/Resy with their constraints pre-filled even when our agent couldn't
      // find a slot. Returns null for non-restaurant steps → existing
      // behaviour preserved.
      const stepWithSlots = { ...step, body: bodyWithSlots };
      const deepLinkEnrich = buildDeepLinkEnrichmentForStep(
        stepWithSlots,
        "No exact match — tap to pick a different time:",
      );
      return {
        ...step,
        body: bodyWithSlots,
        status: "no_availability",
        error: data.summary,
        handoff_url: deepLinkEnrich?.handoff_url,
        actionItem: deepLinkEnrich?.actionItem,
        decisionLog: log,
      };
    }

    // error path — also capture available slots for restaurants
    const bodyWithSlots = data.availableSlots?.length
      ? { ...(step.body as Record<string, unknown>), availableSlots: data.availableSlots }
      : step.body;
    const manualHandoffUrl = data.handoffUrl ?? step.fallbackUrl;
    const actionMessage = isFlightInventoryDriftError(data.error ?? data.summary)
      ? buildFlightInventoryDriftManualMessage()
      : "Auto-booking failed. Tap to complete manually:";
    log.push({ ts: now(), type: "failed", message: data.error ?? data.summary, outcome: "Failed" });

    // Phase 2: deep-link override for restaurant steps so the user lands
    // pre-filled. Skipped when flight-inventory drift is detected — that
    // error message has its own opinionated guidance.
    const stepWithBody = { ...step, body: bodyWithSlots };
    const deepLinkEnrich = isFlightInventoryDriftError(data.error ?? data.summary)
      ? null
      : buildDeepLinkEnrichmentForStep(stepWithBody, actionMessage);

    return {
      ...step,
      body: bodyWithSlots,
      status: "error",
      error: data.error ?? data.summary,
      handoff_url: deepLinkEnrich?.handoff_url ?? manualHandoffUrl,
      actionItem:
        deepLinkEnrich?.actionItem ??
        { message: actionMessage, options: [{ label: step.label, url: manualHandoffUrl }] },
      decisionLog: log,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    log.push({ ts: now(), type: "failed", message: errMsg, outcome: "Error" });
    return { ...step, status: "error", error: errMsg, decisionLog: log };
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  console.log(`[start] POST /api/booking-jobs/${id}/start invoked at ${new Date().toISOString()}`);

  if (inFlightJobStarts.has(id)) {
    const existingJob = await getBookingJob(id);
    return NextResponse.json(
      {
        jobId: id,
        status: existingJob?.status ?? "running",
        steps: existingJob?.steps ?? [],
        duplicateStartIgnored: true,
      },
      { status: 202 }
    );
  }

  inFlightJobStarts.add(id);

  try {

  const job = await getBookingJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // ── Billing quota gate ──────────────────────────────────────────────────
  // Free tier: 3 bookings/calendar month. Pro: unlimited. We gate at /start
  // (not at job creation) so a user who exceeded quota and creates a draft
  // can still see their plan in the UI; they just can't run it without
  // upgrading. The actual usage counter is incremented per-step-completed
  // below — multi-step trip jobs from a free user with 0 used will start,
  // but only complete the steps that fit under the limit before being
  // gated mid-job at increment time (handled there with a soft skip).
  //
  // Anonymous jobs (job.user_id null) bypass — that path is for legacy
  // pre-auth flows where there's no Stripe relationship to consult.
  if (job.user_id) {
    const quota = await canBookMore(job.user_id);
    if (!quota.allowed) {
      console.log(
        `[start] ${id} blocked by quota (user=${job.user_id}, used=${quota.used}/${quota.limit})`,
      );
      return NextResponse.json(buildQuotaExceededBody(quota), { status: 402 });
    }
  }

  // Allow re-running failed jobs (e.g. after a scheduled retry or user-triggered retry).
  // Also allow re-running a "running" job that has been stuck for > 7 minutes — this
  // happens when the Vercel function hit its 5-min maxDuration and was killed before the
  // final updateBookingJobStatus() call could write "failed" to the DB.
  if (job.status === "running") {
    const updatedAt = new Date(job.updated_at).getTime();
    const stuckThresholdMs = 7 * 60 * 1000; // 7 minutes
    const isStuck = Date.now() - updatedAt > stuckThresholdMs;
    if (!isStuck) {
      return NextResponse.json({ error: "Job already running" }, { status: 409 });
    }
    // Reset stuck job so the run below can proceed.
    // Round-3 phantom isolation: use PENDING_QUEUE_STATUS in dev so the
    // reset row is invisible to phantom's `WHERE status='pending'` filter.
    const { PENDING_QUEUE_STATUS: _ps } = await import("@/lib/core/cend-adapter");
    await updateBookingJobStatus(id, _ps as "pending");
  }

  // ── Worker dispatch (B+B2) ─────────────────────────────────────────────
  // Booking automation runs in the worker (worker/src/) — Vercel's role
  // is to enqueue. Leave booking_jobs.status='pending', return 202, and
  // the worker claims via FOR UPDATE SKIP LOCKED on its next poll.
  //
  // Auto-stamps the lib/core "__source" marker on any restaurant /
  // hotel / flight / activity step that's missing it (older callers
  // that didn't go through markStepForCore). The worker's SQL claim
  // filter requires the marker, so without auto-stamp those jobs
  // would sit pending indefinitely.
  //
  // USE_WORKER_FOR is still honored for legacy unstamped jobs. Once a job
  // already carries the lib/core marker, never fall back to the old in-process
  // executor: the worker claim SQL and timeline code both expect that path.
  const workerScenarios = (process.env.USE_WORKER_FOR ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveWorkerScenarios = workerScenarios.length > 0
    ? workerScenarios
    : ["restaurant", "hotel", "flight", "activity"];
  const {
    CORE_EXECUTION_SOURCE,
    isCoreExecutionSource,
    markStepForCore,
    isCoreSupported: _isCoreSupported,
    PENDING_QUEUE_STATUS,
  } = await import(
    "@/lib/core/cend-adapter"
  );
  const routeDecision = job.steps.map((step) => {
    const body = step.body as Record<string, unknown> | undefined;
    return {
      type: step.type,
      source: body?.__source,
      supported: _isCoreSupported(step.type),
      workerEnabled: effectiveWorkerScenarios.includes(step.type),
    };
  });
  const allCoreMarked = job.steps.length > 0 && routeDecision.every((step) =>
    isCoreExecutionSource(step.source),
  );
  const allRoutable = job.steps.length > 0 && routeDecision.every((step) =>
    step.supported && step.workerEnabled,
  );
  console.log(`[start] ${id} worker route decision`, {
    status: job.status,
    effectiveWorkerScenarios,
    allCoreMarked,
    allRoutable,
    steps: routeDecision,
  });
  if (allCoreMarked || allRoutable) {
    let stampedCount = 0;
    const stampedSteps = job.steps.map((step) => {
      const body = step.body as Record<string, unknown> | undefined;
      if (isCoreExecutionSource(body?.__source)) {
        const restampedStep =
          body?.__source === CORE_EXECUTION_SOURCE
            ? step
            : {
                ...step,
                body: {
                  ...body,
                  __source: CORE_EXECUTION_SOURCE,
                },
              };
        if (body?.__source !== CORE_EXECUTION_SOURCE) stampedCount += 1;
        return resetStepForWorkerEnqueue(restampedStep);
      }
      if (!_isCoreSupported(step.type)) return step;
      try {
        stampedCount += 1;
        return resetStepForWorkerEnqueue(markStepForCore(step));
      } catch {
        return step;
      }
    });
    await updateBookingJobSteps(id, stampedSteps);
    // Round-3 phantom isolation: enqueue with `pending_local` (in dev) so
    // phantom's hardcoded `WHERE status='pending'` claimOne SQL cannot
    // see this row. Local worker filters on PENDING_QUEUE_STATUS.
    if (job.status !== PENDING_QUEUE_STATUS) {
      await updateBookingJobStatus(id, PENDING_QUEUE_STATUS as "pending");
    }
    console.log(
      `[start] ${id} routed to worker (auto-stamped ${stampedCount}/${job.steps.length}, status=${PENDING_QUEUE_STATUS})`,
    );
    return NextResponse.json(
      {
        jobId: id,
        status: PENDING_QUEUE_STATUS,
        steps: stampedSteps,
        routedToWorker: true,
      },
      { status: 202 },
    );
  }

  // Use the autonomy settings saved at job-creation time, fall back to defaults
  const autonomy: AgentAutonomySettings = job.autonomy_settings ?? DEFAULT_AUTONOMY;

  // Load policy bias + preference profile for this session
  let policy: PolicyBias;
  let events: Awaited<ReturnType<typeof getAgentFeedbackEvents>> = [];
  try {
    events = await getAgentFeedbackEvents(job.session_id, 500);
    policy = computePolicyBias(events);
  } catch {
    policy = computePolicyBias([]); // safe fallback — no bias applied
  }
  const profile = buildPreferenceProfile(events);

  await updateBookingJobStatus(id, "running");

  // policy + autonomy + profile (loaded above) are consumed by
  // runStepWithRecovery for legacy non-universal steps. Universal steps
  // (restaurant/hotel/flight/activity → runUniversalStep) read consent from
  // step.body.consent when routing through lib/core; UI-side preference
  // bias is currently only applied in the legacy recovery loop.
  void profile;

  const steps: BookingJobStep[] = [...job.steps];

  // Serialize DB writes from concurrent onProgress callbacks. Each step has
  // its own browser context running in parallel; their progress callbacks would
  // otherwise issue overlapping UPDATEs to the same booking_jobs row and the
  // last-to-finish-writing could clobber a newer serialization. Chaining via a
  // single promise guarantees writes commit in the order they were requested.
  let dbWriteChain: Promise<void> = Promise.resolve();
  const writeSteps = () => {
    const p = dbWriteChain.then(() => updateBookingJobSteps(id, steps)).then(() => {});
    dbWriteChain = p.catch(() => {});
    return p;
  };

  // Execute a single step at index `i`. Catches any throws so one step's
  // failure never sinks a sibling in parallel mode (Promise.allSettled would
  // hide it, but we still want a clean error status on the step card).
  const runStepAt = async (i: number) => {
    // Skip steps that already succeeded — supports partial retry (cron/manual)
    if (steps[i].status === "done") return;

    // Snapshot whether the step was already in a terminal-success state
    // before this run. We only bump the billing counter when a step
    // *transitions* into success — re-running an awaiting_confirmation
    // step (e.g. payment retry) shouldn't double-charge the quota.
    // (status === "done" is unreachable here — early-returned above.)
    const wasTerminalSuccess = steps[i].status === "awaiting_confirmation";

    const onProgress = async (updated: BookingJobStep) => {
      steps[i] = updated;
      await writeSteps();
    };

    // ── Dispatch ──────────────────────────────────────────────────────────
    // universal / restaurant / hotel / flight / activity all go through
    // runUniversalStep → runBrowserTask (Stagehand AI). When the step body
    // carries the lib/core marker (__source="lib/core/execution"),
    // runUniversalStep dispatches to runExecutionJobWithRecovery instead.
    //
    // The legacy runStepWithRecovery (HTTP-via-callEndpoint, autonomy +
    // policy aware) is kept as a default branch for any future step.type
    // that wants to opt out of Stagehand — none today.
    try {
      if (
        steps[i].type === "universal" ||
        steps[i].type === "restaurant" ||
        steps[i].type === "hotel" ||
        steps[i].type === "flight" ||
        steps[i].type === "activity"
      ) {
        steps[i] = await runUniversalStep(steps[i], onProgress, id, job.user_id, autonomy);
      } else {
        steps[i] = await runStepWithRecovery(steps[i], autonomy, policy, onProgress);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unhandled step error";
      steps[i] = { ...steps[i], status: "error", error: errMsg };
    }
    await writeSteps();

    // ── Billing counter increment ───────────────────────────────────────
    // Bump the user's monthly bookings_used when the step transitions into
    // success. Wrapped so a counter-write failure never tanks the booking.
    const isTerminalSuccess =
      steps[i].status === "done" || steps[i].status === "awaiting_confirmation";
    if (!wasTerminalSuccess && isTerminalSuccess && job.user_id) {
      try {
        await incrementUsageCounter(job.user_id, "booking");
      } catch (err) {
        console.error(`[start] usage counter increment failed for ${job.user_id}`, err);
      }
    }
  };

  // Execution mode:
  //   - steps.length >= 2 → run all steps in parallel via Promise.allSettled
  //     (trip packaging assumption: hotel / flight / restaurant / activity are
  //     independent; user wants "one shot, concurrent"). Replan is skipped in
  //     this mode — there is no sequential hand-off to cascade through.
  //   - steps.length < 2 → keep the historical sequential loop that supports
  //     scene-level replan for single-step retries and non-trip jobs.
  if (steps.length >= 2) {
    await Promise.allSettled(steps.map((_, i) => runStepAt(i)));
  } else {
    for (let i = 0; i < steps.length; i++) {
      const stepBefore = { ...steps[i] };
      await runStepAt(i);

      // ── Scene-level replan ─────────────────────────────────────────────
      // Check if this step's outcome should cascade to downstream steps.
      const triggers = detectReplanTriggers(stepBefore, steps[i], i);
      for (const trigger of triggers) {
        const replan = computeReplan(steps, trigger, autonomy);
        if (replan && replan.affectedCount > 0) {
          // Reconstruct steps array with mutations applied
          const replanned = applyReplan(steps, replan);
          for (let j = 0; j < replanned.length; j++) {
            steps[j] = replanned[j];
          }
          await writeSteps();
        }
      }
    }
  }

  // Make sure every queued DB write has committed before we compute final status.
  await dbWriteChain.catch(() => {});

  const doneCount = steps.filter((s) => s.status === "done").length;
  const awaitingPaymentCount = steps.filter((s) => s.status === "awaiting_confirmation").length;
  // Treat "awaiting_confirmation" as a success for job final status — agent did its job,
  // user just needs to enter CVC.
  const completedCount = doneCount + awaitingPaymentCount;
  const finalStatus = completedCount > 0 ? "done" : "failed";
  await updateBookingJobStatus(id, finalStatus, new Date());

  // ── Auto-create monitors ──────────────────────────────────────────────
  // Availability watches for failed steps, reservation checks for booked ones,
  // weather alerts for trips within 14 days. Fire-and-forget.
  try {
    const monitors = buildAutoMonitors(
      { id, session_id: job.session_id, trip_label: job.trip_label },
      steps
    );
    await Promise.allSettled(monitors.map((m) => createBookingMonitor(m)));
  } catch { /* monitor setup never blocks the job response */ }

  // ── Push notification ────────────────────────────────────────────────
  try {
    const subscriptions = await getPushSubscriptionsBySession(job.session_id);
    const needsAttention = steps.filter((s) => s.actionItem).length;
    const adjusted = steps.filter((s) => s.timeAdjusted || s.usedFallback).length;

    let title: string, body: string;
    if (awaitingPaymentCount > 0 && doneCount + awaitingPaymentCount === steps.length) {
      // All steps at payment gate — ready for CVC
      title = "💳 Ready for payment — enter CVC";
      body = awaitingPaymentCount === 1
        ? "Card details pre-filled — tap to open and enter CVC to complete."
        : `${awaitingPaymentCount} bookings pre-filled — tap to open each and enter CVC.`;
    } else if (awaitingPaymentCount > 0) {
      title = `💳 ${awaitingPaymentCount} booking${awaitingPaymentCount > 1 ? "s" : ""} ready for payment`;
      body = `Enter CVC to complete. ${steps.length - awaitingPaymentCount - doneCount} step${steps.length - awaitingPaymentCount - doneCount !== 1 ? "s" : ""} still in progress.`;
    } else if (doneCount === steps.length) {
      const note = adjusted > 0 ? ` (${adjusted} smart adjustment${adjusted > 1 ? "s" : ""})` : "";
      title = "✈ Your trip is ready to book!";
      body = `All ${steps.length} bookings pre-filled${note} — tap to open and pay.`;
    } else if (doneCount > 0 && needsAttention > 0) {
      const emojis = steps.filter((s) => s.status === "done").map((s) => s.emoji).join(" ");
      title = `${emojis} Partially booked — action needed`;
      body = `${doneCount}/${steps.length} ready. ${needsAttention} step${needsAttention > 1 ? "s need" : " needs"} your decision.`;
    } else if (doneCount > 0) {
      title = "Trip booking update";
      body = `${doneCount}/${steps.length} bookings pre-filled — tap to see.`;
    } else {
      title = "Trip booking needs attention";
      body = "Autopilot couldn't complete any steps. Tap to book manually.";
    }

    await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushNotification(sub.push_subscription as PushSubscription, { title, body, url: "/tasks" })
      )
    );
  } catch { /* push failure never blocks */ }

  return NextResponse.json({ jobId: id, status: finalStatus, steps });
  } finally {
    inFlightJobStarts.delete(id);
  }
}

// ── Utility ────────────────────────────────────────────────────────────────

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
