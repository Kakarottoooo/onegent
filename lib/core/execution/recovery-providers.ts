/**
 * lib/core/execution/recovery-providers · provider fallback chain
 *
 * When the primary provider doesn't have the venue, try alternate providers
 * of the same intent. Restaurant-only at this layer — hotel flows through
 * Booking.com (with Hotels.com as a built-in provider alias handled inside
 * lib/booking-autopilot/providers/), and flight uses Expedia alone.
 *
 * Restaurant chain:
 *   Yelp (primary, already tried by recovery.Phase 1)
 *     → OpenTable
 *     → Resy
 *     → Google Places lookup → navigate official website for reservation link
 *     → return no_availability with manual-handoff URL
 *
 * Each step:
 *   - Gated by validateConsent({ type: "use_provider", providerId })
 *   - Writes writeAudit({ type: "provider_fallback" }) on transition
 *   - Uses runBrowserTask directly (not runExecutionJob) because the
 *     provider here is NOT the primary for this scenario — we have to
 *     construct the URL / task ourselves; runExecutionJob would route
 *     right back to Yelp.
 *
 * Called by recovery.ts Phase 3 after Phase 1 or Phase 2 fails.
 */

import { runBrowserTask } from "@/lib/booking-autopilot/stagehand-executor";
import { buildRestaurantTask } from "@/lib/booking-autopilot/core/task-builders";
import type {
  BrowserTaskInput,
  BrowserTaskResult,
  BookingProfile,
} from "@/lib/booking-autopilot/types";

import { writeAudit } from "@/lib/core/audit/audit-log";
import { validateConsent } from "@/lib/core/consent/validator";
import type { ConsentPolicy } from "@/lib/core/consent/types";

import { resolveProfile, type ExecutionContext } from "./executor";
import type {
  ExecutionJobRequest,
  ExecutionJobResult,
} from "./types";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Try alternate providers after the primary (Yelp for restaurant) fails.
 * Returns a successful ExecutionJobResult when any provider books, or a
 * handoff-style "no_availability" result pointing at the venue's own
 * reservation page (website fallback). Returns null only when no
 * alternate provider is allowed or reachable at all.
 *
 * Non-restaurant scenarios return null immediately (no multi-provider
 * chain defined for hotel/flight/activity at this layer).
 */
export async function tryProviderFallbackChain(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
  policy: ConsentPolicy,
  attemptsBefore: number,
): Promise<ExecutionJobResult | null> {
  if (request.request.scenario !== "restaurant") return null;

  const profile = await resolveProfile(request, ctx.userId ?? null);
  let attempts = attemptsBefore;

  // ── Step 1: OpenTable ──
  const openTableCheck = validateConsent(policy, {
    type: "use_provider",
    providerId: "opentable-com",
  });
  if (openTableCheck.allowed) {
    await writeAudit({
      jobId: ctx.jobId,
      type: "provider_fallback",
      stepIndex: ctx.stepIndex,
      message: "Trying OpenTable after Yelp miss",
      details: { fromProvider: "yelp-com", toProvider: "opentable-com" },
    });

    attempts++;
    const openTableResult = await tryOpenTable(request, ctx, profile);
    if (openTableResult) {
      return bookedResult(openTableResult, ctx.jobId, attempts);
    }
  } else {
    await writeAudit({
      jobId: ctx.jobId,
      type: "action_denied",
      stepIndex: ctx.stepIndex,
      message: `OpenTable blocked by consent policy: ${openTableCheck.reason}`,
    });
  }

  // ── Step 2: Resy ──
  const resyCheck = validateConsent(policy, {
    type: "use_provider",
    providerId: "resy-com",
  });
  if (resyCheck.allowed) {
    await writeAudit({
      jobId: ctx.jobId,
      type: "provider_fallback",
      stepIndex: ctx.stepIndex,
      message: "Trying Resy after OpenTable miss",
      details: { fromProvider: "opentable-com", toProvider: "resy-com" },
    });

    attempts++;
    const resyResult = await tryResy(request, ctx, profile);
    if (resyResult) {
      return bookedResult(resyResult, ctx.jobId, attempts);
    }
  } else {
    await writeAudit({
      jobId: ctx.jobId,
      type: "action_denied",
      stepIndex: ctx.stepIndex,
      message: `Resy blocked by consent policy: ${resyCheck.reason}`,
    });
  }

  // ── Step 3: Google Places → official website ──
  const websiteCheck = validateConsent(policy, {
    type: "use_provider",
    providerId: "website-generic",
  });
  if (websiteCheck.allowed) {
    await writeAudit({
      jobId: ctx.jobId,
      type: "provider_fallback",
      stepIndex: ctx.stepIndex,
      message: "Looking up official website via Google Places",
      details: { fromProvider: "resy-com", toProvider: "website-generic" },
    });

    attempts++;
    const websiteResult = await tryWebsiteHandoff(request, ctx, profile);
    if (websiteResult) {
      return {
        ...websiteResult,
        attemptCount: attempts,
        usedFallback: true,
      };
    }
  } else {
    await writeAudit({
      jobId: ctx.jobId,
      type: "action_denied",
      stepIndex: ctx.stepIndex,
      message: `Website fallback blocked by consent policy: ${websiteCheck.reason}`,
    });
  }

  return null;
}

// ─── Provider attempts ───────────────────────────────────────────────────────

/**
 * Build an OpenTable search URL and run a browser task. Same shape as
 * tryResy — mirrors what was buildRestaurantContext's startUrl before
 * Yelp took over as primary. covers + dateTime in the URL bias OpenTable's
 * default party-size / time selectors so the agent doesn't have to set them
 * from the search page.
 */
async function tryOpenTable(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
  profile: BookingProfile,
): Promise<BrowserTaskResult | null> {
  if (request.request.scenario !== "restaurant") return null;
  const p = request.request.params;

  const termRaw = p.city ? `${p.restaurant_name} ${p.city}` : p.restaurant_name;
  const openTableUrl = `https://www.opentable.com/s?term=${encodeURIComponent(termRaw)}&covers=${p.covers}&dateTime=${p.date}T${p.time}:00`;

  const { task } = buildRestaurantTask({
    restaurantName: p.restaurant_name,
    city: p.city,
    date: p.date,
    time: p.time,
    covers: p.covers,
    profile,
  });

  const input: BrowserTaskInput = {
    startUrl: openTableUrl,
    task,
    profile,
    jobId: ctx.jobId,
    stepIndex: ctx.stepIndex ?? 0,
    profileId: request.profileId,
  };

  try {
    const result = await runBrowserTask(input);
    return isGenuineBooking(result, openTableUrl) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Build a Resy search URL and run a browser task against it. Returns the
 * raw BrowserTaskResult only if isGenuineBooking() is satisfied — we
 * don't want Resy's "restaurant not found" page to be mistaken for
 * success. Returns null on any failure / not-genuine-booking.
 *
 * Mirrors route.ts:772-796 exactly, including the cityToResySlug
 * fallback to "nashville" for unknown cities.
 */
async function tryResy(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
  profile: BookingProfile,
): Promise<BrowserTaskResult | null> {
  if (request.request.scenario !== "restaurant") return null;
  const p = request.request.params;

  const { cityToResySlug } = await import(
    "@/lib/booking-autopilot/providers/resy-com"
  );
  const resySlug = cityToResySlug(p.city || "nashville");
  const resyUrl = `https://resy.com/cities/${resySlug}?date=${p.date}&seats=${p.covers}&query=${encodeURIComponent(p.restaurant_name)}`;

  const { task } = buildRestaurantTask({
    restaurantName: p.restaurant_name,
    city: p.city,
    date: p.date,
    time: p.time,
    covers: p.covers,
    profile,
  });

  const input: BrowserTaskInput = {
    startUrl: resyUrl,
    task,
    profile,
    jobId: ctx.jobId,
    stepIndex: ctx.stepIndex ?? 0,
    profileId: request.profileId,
  };

  try {
    const result = await runBrowserTask(input);
    return isGenuineBooking(result, resyUrl) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Google Places → find the venue's official website → navigate to it →
 * try to locate a reservations link. Returns a synthetic ExecutionJobResult
 * with status="no_availability" (since this is a hand-off, not a true
 * Onegent-completed booking), handoffUrl set to either the reservation
 * page or the homepage.
 *
 * Returns null if Google Places can't find the venue at all.
 *
 * Mirrors route.ts:798-872.
 */
async function tryWebsiteHandoff(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
  profile: BookingProfile,
): Promise<ExecutionJobResult | null> {
  if (request.request.scenario !== "restaurant") return null;
  const p = request.request.params;

  // Step A: Google Places lookup to find the official website URL.
  let officialWebsite: string | undefined;
  try {
    const { googlePlacesSearch } = await import("@/lib/tools");
    const results = await googlePlacesSearch({
      query: p.restaurant_name,
      location: p.city || "Nashville, TN",
      maxResults: 3,
    });
    // Prefer a name-similar result; fall back to first hit. Mirrors
    // route.ts:808-814's fuzzy-match approach (8-char prefix substring).
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const targetNorm = normalize(p.restaurant_name);
    const match =
      results.find((r) => {
        const nameNorm = normalize(r.name);
        return (
          nameNorm.includes(targetNorm.slice(0, 8)) ||
          targetNorm.includes(nameNorm.slice(0, 8))
        );
      }) ?? results[0];
    officialWebsite = match?.url;
  } catch {
    // Swallowed: fall through to "no website found".
  }

  if (!officialWebsite) return null;

  // Step B: Navigate the website looking for a reservations link.
  const browseInput: BrowserTaskInput = {
    startUrl: officialWebsite,
    task: `On the restaurant website for "${p.restaurant_name}", find and click a "Reservations", "Book a Table", "Book Now", or "Reserve" link or button. Navigate to the reservation page. Do not fill any forms — just navigate to where reservations can be made.`,
    profile,
    jobId: ctx.jobId,
    stepIndex: ctx.stepIndex ?? 0,
    profileId: request.profileId,
  };

  let reservationUrl = officialWebsite;
  try {
    const websiteData = await runBrowserTask(browseInput);
    if (
      websiteData.handoffUrl &&
      websiteData.handoffUrl !== officialWebsite &&
      websiteData.handoffUrl.startsWith("http")
    ) {
      reservationUrl = websiteData.handoffUrl;
    }
  } catch {
    // Swallowed: reservationUrl stays at officialWebsite.
  }

  // ── US-W5 Bug B: validate vendor widget URLs ────────────────────────────
  // Many top-tier restaurants (Carbone, Le Bernardin, Marea …) embed their
  // booking widget via SevenRooms / Tock / Resy / etc. The agent often lands
  // on the iframe's src URL (e.g. https://www.sevenrooms.com/events/<id>),
  // which we capture above. But that URL frequently 404s when opened
  // standalone — it depends on the parent page for context. Without this
  // check we'd ship the user a dead link.
  //
  // HEAD-test the URL when it matches a known vendor; if it doesn't load
  // standalone, fall back to the venue's main site with clearer copy.
  const foundReservationPage = reservationUrl !== officialWebsite;
  const vendor = foundReservationPage ? matchKnownVendor(reservationUrl) : null;
  let summary: string;

  if (foundReservationPage && vendor) {
    const accessible = await headProbe(reservationUrl);
    if (accessible) {
      summary =
        `"${p.restaurant_name}" books through ${vendor.name} (not OpenTable or Resy). ` +
        `Tap below to open the reservation widget — your details are saved.`;
    } else {
      // Vendor URL doesn't load standalone. Send the user to the venue's
      // homepage with explicit instructions instead of a dead deep link.
      reservationUrl = officialWebsite;
      summary =
        `"${p.restaurant_name}" books through ${vendor.name} (not OpenTable or Resy). ` +
        `Their widget needs to load from the venue's website — tap below to open it, ` +
        `then click "Reservations" at the top.`;
    }
  } else if (foundReservationPage) {
    summary =
      `"${p.restaurant_name}" books through their own system (not OpenTable or Resy). ` +
      `We found their reservation page — tap below to finish booking there.`;
  } else {
    summary =
      `"${p.restaurant_name}" is not on OpenTable or Resy, and we couldn't locate ` +
      `a reservation widget on their website. Tap below to try booking on their homepage.`;
  }

  const now = new Date().toISOString();
  return {
    jobId: ctx.jobId,
    status: "no_availability",
    handoffUrl: reservationUrl,
    summary,
    decisionLog: [],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    attemptCount: 1, // overwritten by caller
    usedFallback: true,
  };
}

// ─── Vendor classification (US-W5 Bug B) ─────────────────────────────────────

interface KnownVendor {
  pattern: RegExp;
  name: string;
}

/**
 * Booking-widget vendor URLs we recognise. Used by tryWebsiteHandoff to
 * decide whether to HEAD-probe a candidate handoff URL before surfacing it
 * to the user. Order matters only for telemetry — the first match wins.
 *
 * Add a new entry when we see another vendor consistently produce dead
 * deep links. Today's set covers the long-tail of top NYC restaurants
 * (SevenRooms is by far the most common; Tock is rising for prix-fixe).
 */
const KNOWN_BOOKING_VENDORS: readonly KnownVendor[] = [
  { pattern: /sevenrooms\.com/i, name: "SevenRooms" },
  { pattern: /(?:explore)?tock\.com/i, name: "Tock" },
  { pattern: /opentable\.com\/(?:widget|restref|booking)/i, name: "OpenTable widget" },
  { pattern: /resy\.com\/(?:cities|events)/i, name: "Resy" },
  { pattern: /yelp\.com\/(?:reservations|biz_redir)/i, name: "Yelp Reservations" },
  { pattern: /eatapp\.co/i, name: "Eat App" },
  { pattern: /respak\.io|reservation\.dineplan/i, name: "Dineplan" },
];

/** Exported only for unit tests — internal signal-classifier. */
export function matchKnownVendor(url: string): KnownVendor | null {
  for (const v of KNOWN_BOOKING_VENDORS) {
    if (v.pattern.test(url)) return v;
  }
  return null;
}

/**
 * HEAD-probe a URL with a 3 s budget. Returns true when the server responds
 * 2xx OR with 405 (method not allowed but URL otherwise reachable). Returns
 * false on 4xx (excluding 405), 5xx, network error, or timeout.
 *
 * Kept local to recovery-providers because no other lib/core caller needs
 * "is this URL probably reachable" semantics yet — promote to a util when
 * a second consumer appears.
 */
async function headProbe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    if (res.ok) return true;
    if (res.status === 405) return true; // server rejects HEAD but URL is fine
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Guard against false positives: Stagehand's final-outcome.ts sometimes
 * returns status="paused_payment" for runs that never left the search
 * page. isGenuineBooking ensures we only treat a Resy result as "booked"
 * when the agent actually advanced past the search URL and the summary
 * doesn't contain a known failure phrase.
 *
 * Mirrors route.ts:763-770 verbatim.
 */
function isGenuineBooking(d: BrowserTaskResult, searchUrl: string): boolean {
  if (
    d.status === "no_availability" ||
    d.status === "error" ||
    d.status === "captcha" ||
    d.status === "needs_login"
  ) {
    return false;
  }
  const s = d.summary.toLowerCase();
  if (s.includes("skipped initial agent run")) return false;
  if (s.includes("not found") || s.includes("no availability") || s.includes("didn't find")) {
    return false;
  }
  if (d.handoffUrl === searchUrl) return false; // never left search page
  return true;
}

/**
 * Map a successful BrowserTaskResult → ExecutionJobResult, with attemptCount
 * and usedFallback=true.
 */
function bookedResult(
  task: BrowserTaskResult,
  jobId: string,
  attempts: number,
): ExecutionJobResult {
  const now = new Date().toISOString();
  return {
    jobId,
    status: task.status === "paused_payment" ? "paused_payment" : "completed",
    handoffUrl: task.handoffUrl,
    sessionUrl: task.sessionUrl,
    summary: task.summary,
    screenshotBase64: task.screenshotBase64,
    decisionLog: [],
    error: task.error,
    availableSlots: task.availableSlots,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    attemptCount: attempts,
    usedFallback: true,
  };
}
