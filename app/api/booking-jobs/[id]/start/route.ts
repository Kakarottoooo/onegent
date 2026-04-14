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
} from "@/lib/db";
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
import { buildAutoMonitors } from "@/lib/monitors";
import { createBookingMonitor } from "@/lib/db";
import { sendPushNotification } from "@/lib/push";
import type { PushSubscription } from "web-push";
import type { AutopilotResult, BrowserTaskResult, BrowserTaskInput } from "@/lib/booking-autopilot/types";
import { runBrowserTask } from "@/lib/booking-autopilot/stagehand-executor";
import { liveLogClose } from "@/lib/live-log-store";
import { buildPreferenceProfile } from "@/lib/policy";

// ── Agent-runtime: activity skill dispatch ─────────────────────────────────
// Restaurant / hotel / flight use the 4-phase recovery loop below.
// Activity steps (and future new types) are dispatched through the agent-runtime.
import { findActivitySkill } from "@/lib/agent-runtime/skills/find-activity";
import type { SkillContext } from "@/lib/agent-runtime/types";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const inFlightJobStarts = new Set<string>();

function now() { return new Date().toISOString(); }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

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

// ── Universal step via Stagehand browser executor ─────────────────────────

async function runUniversalStep(
  step: BookingJobStep,
  onProgress: (s: BookingJobStep) => Promise<void>,
  bookingJobId: string,
  jobUserId?: string | null,
): Promise<BookingJobStep> {
  const log: DecisionLogEntry[] = [];
  await onProgress({ ...step, status: "loading", decisionLog: log });

  // Resolve profile from DB server-side using the job's userId.
  // The internal fetch has no Clerk session, so auth() returns null in the
  // universal endpoint. Fetching here and injecting inline solves that.
  let resolvedBody: Record<string, unknown> = { ...(step.body as Record<string, unknown>) };

  // ── Restaurant steps: build OpenTable startUrl + task if not already set ──
  // step.body for restaurant steps contains: restaurantName, date (YYYY-MM-DD),
  // time (HH:MM 24h), covers (number), and optionally city.
  if (step.type === "restaurant" && !resolvedBody.startUrl) {
    const rName = resolvedBody.restaurantName as string | undefined;
    const rDate = resolvedBody.date as string | undefined;
    const rTime = resolvedBody.time as string | undefined;
    const rCovers = (resolvedBody.covers as number | undefined) ?? 2;
    const rCity = (resolvedBody.city as string | undefined) ?? "";

    if (rName && rDate && rTime) {
      // Build OpenTable search URL: dateTime must be ISO format YYYY-MM-DDTHH:MM:00
      const otUrl = `https://www.opentable.com/s?term=${encodeURIComponent(rName)}&covers=${rCovers}&dateTime=${rDate}T${rTime}:00`;
      resolvedBody = { ...resolvedBody, startUrl: otUrl };

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
        // Prefer inline profile for contact info (always up-to-date from picker),
        // but add card data from DB (card number never stored inline).
        const inline = (resolvedBody.profile ?? {}) as Record<string, string | undefined>;
        resolvedBody = {
          ...resolvedBody,
          profile: {
            first_name: inline.first_name || dbProfile.first_name,
            last_name: inline.last_name || dbProfile.last_name,
            email: inline.email || dbProfile.email,
            phone: inline.phone || dbProfile.phone,
            address_line1: inline.address_line1 || dbProfile.address_line1,
            city: inline.city || dbProfile.city,
            state: inline.state || dbProfile.state,
            zip: inline.zip || dbProfile.zip,
            country: inline.country || dbProfile.country,
            card_name: dbProfile.card_name,
            card_number: dbProfile.card_number,
            card_expiry: dbProfile.card_expiry,
          },
        };
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
      // Keep the live-browser session key aligned with the Tasks UI, which
      // connects to /api/browser-live/<job.id>/... for inline interaction.
      jobId: bookingJobId,
      stepIndex: (resolvedBody.stepIndex as number | undefined) ?? 0,
      agentModel: resolvedBody.agentModel as BrowserTaskInput["agentModel"] | undefined,
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

    // If the single attempt threw before producing a BrowserTaskResult, re-throw to outer catch.
    if (!data) throw browserTaskErr ?? new Error("Browser task failed before returning a result");

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
            const resyUrl = `https://resy.com/cities/${resySlug}?date=${rDate}&seats=${rCovers}&query=${encodeURIComponent(rName)}`;
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
                return { ...step, body: bodyWithSlots, status: "no_availability", error: resyData.summary, decisionLog: log };
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
              return {
                ...step,
                body: allTriedBody,
                status: "no_availability",
                error: `"${rName}" is not on OpenTable or Resy. ${reservationUrl !== officialWebsite ? "Found their reservation page — tap to book directly." : "Visit their official website to book directly."}`,
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
      return { ...step, body: bodyWithSlots, status: "no_availability", error: data.summary, decisionLog: log };
    }

    // error path — also capture available slots for restaurants
    const bodyWithSlots = data.availableSlots?.length
      ? { ...(step.body as Record<string, unknown>), availableSlots: data.availableSlots }
      : step.body;
    log.push({ ts: now(), type: "failed", message: data.error ?? data.summary, outcome: "Failed" });
    return {
      ...step,
      body: bodyWithSlots,
      status: "error",
      error: data.error ?? data.summary,
      handoff_url: step.fallbackUrl,
      actionItem: { message: "Auto-booking failed. Tap to complete manually:", options: [{ label: step.label, url: step.fallbackUrl }] },
      decisionLog: log,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    log.push({ ts: now(), type: "failed", message: errMsg, outcome: "Error" });
    return { ...step, status: "error", error: errMsg, decisionLog: log };
  }
}

// ── Activity step via agent-runtime skill ─────────────────────────────────

async function runActivityStep(
  step: BookingJobStep,
  ctx: SkillContext,
  onProgress: (s: BookingJobStep) => Promise<void>
): Promise<BookingJobStep> {
  const log: DecisionLogEntry[] = [];
  const withLog = { ...ctx, log: (e: Omit<DecisionLogEntry, "ts">) => log.push({ ...e, ts: new Date().toISOString() } as DecisionLogEntry) };

  await onProgress({ ...step, status: "loading", decisionLog: log });

  const outcome = await findActivitySkill.execute(
    step.body as Parameters<typeof findActivitySkill.execute>[0],
    withLog
  );

  if (outcome.status === "succeeded" || outcome.status === "adjusted" || outcome.status === "fallback") {
    log.push({ ts: new Date().toISOString(), type: "succeeded",
      message: `Found ${outcome.result.entityLabel}`, outcome: "Ready ✓" });
    return {
      ...step, status: "done",
      handoff_url: outcome.result.handoffUrl,
      selected_time: outcome.result.scheduledAt,
      usedFallback: outcome.status === "fallback",
      decisionLog: log,
    };
  }

  if (outcome.status === "blocked") {
    log.push({ ts: new Date().toISOString(), type: "skipped",
      message: outcome.reason, outcome: "No availability" });
    return {
      ...step, status: "no_availability", error: outcome.reason,
      actionItem: { message: outcome.actionItem ?? outcome.reason, options: [] },
      decisionLog: log,
    };
  }

  log.push({ ts: new Date().toISOString(), type: "failed", message: outcome.reason, outcome: "Error" });
  return { ...step, status: "error", error: outcome.reason, decisionLog: log };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

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
    // Reset stuck job so the run below can proceed
    await updateBookingJobStatus(id, "pending");
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

  // Shared skill context for agent-runtime dispatched steps (activity, etc.)
  const skillCtx: SkillContext = {
    jobId: id,
    sessionId: job.session_id,
    tripLabel: job.trip_label,
    autonomy,
    policy,
    profile,
    relationship: null,
    baseUrl: BASE_URL,
    log: () => {}, // fire-and-forget; step logs are written via onProgress
  };

  const steps: BookingJobStep[] = [...job.steps];

  for (let i = 0; i < steps.length; i++) {
    // Skip steps that already succeeded — supports partial retry (cron/manual)
    if (steps[i].status === "done") continue;

    // Snapshot before execution — needed for replan trigger detection
    const stepBefore = { ...steps[i] };

    const onProgress = async (updated: BookingJobStep) => {
      steps[i] = updated;
      await updateBookingJobSteps(id, steps);
    };

    // ── Dispatch: universal/restaurant → Stagehand, activity → agent-runtime, rest → recovery loop ──
    // "restaurant" steps use runUniversalStep (same as "universal") because they need
    // runBrowserTask called directly — runStepWithRecovery uses callEndpoint (HTTP) which
    // requires a valid apiEndpoint URL, but restaurant steps don't have one.
    if (steps[i].type === "universal" || steps[i].type === "restaurant") {
      steps[i] = await runUniversalStep(steps[i], onProgress, id, job.user_id);
    } else if ((steps[i].type as string) === "activity") {
      steps[i] = await runActivityStep(steps[i], skillCtx, onProgress);
    } else {
      steps[i] = await runStepWithRecovery(steps[i], autonomy, policy, onProgress);
    }
    await updateBookingJobSteps(id, steps);

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
        await updateBookingJobSteps(id, steps);
      }
    }
  }

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
