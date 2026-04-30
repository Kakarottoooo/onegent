/**
 * POST /api/chat/trip/plan
 *
 * Runs the TripPackage planner: given a filled TripIntentState, returns a
 * single-tier TripPackage (hotel + flight in Phase 1). The homepage chat
 * flow calls this right after /api/chat/commit returns kind="trip".
 *
 * Auth: requires a Clerk session — trip packaging is tied to user-scoped
 * booking profiles, and the autopilot we eventually launch is user-owned.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildTripPackage } from "@/lib/agent/planners/trip-package";
import {
  getMissingFields,
  buildClarificationMessage,
  resolveDateHint,
  type TripIntentState,
  type TripVibe,
} from "@/lib/agent/trip-intent-state";
import { summarizeTripConflicts, suggestNextFreeWindow } from "@/lib/calendar-availability";
import { getCalendarConnection } from "@/lib/calendar-db";
import { syncGoogleBusySlots } from "@/lib/calendar-service";

// Planner fires hotel + flight pipelines in parallel; each can take 15-30s
// (SerpAPI search + MiniMax ranking). 60s gives headroom; in dev mode Next
// ignores this and uses whatever the OS/browser allows.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const rawState = b.trip_state;
  if (!rawState || typeof rawState !== "object") {
    return NextResponse.json({ error: "trip_state required" }, { status: 400 });
  }
  const state = await enrichTripStateWithCalendar(
    userId,
    coerceTripState(rawState as Record<string, unknown>),
  );

  const missing = getMissingFields(state);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "trip_state is missing required fields",
        missing_fields: missing,
        message: buildClarificationMessage(missing),
      },
      { status: 400 }
    );
  }

  console.log("[trip/plan] start", {
    destination: state.destination_city,
    origin: state.departure_city,
    dates: { from: state.start_date, to: state.end_date, nights: state.nights },
    travelers: state.travelers,
    vibe: state.vibe,
  });

  try {
    const start = Date.now();
    const result = await buildTripPackage(state);
    console.log("[trip/plan] done", {
      elapsed_ms: Date.now() - start,
      hotel_options: result.package.hotel_options.length,
      flight_options: result.package.flight_options.length,
      restaurant_options: result.package.restaurant_options.length,
      activity_options: result.package.activity_options.length,
      errors: result.errors,
    });
    return NextResponse.json({
      ok: true,
      trip_package: result.package,
      errors: result.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "trip planner failed";
    console.error("[trip/plan] planner error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Defensive coercion of the client-supplied trip_state. Clients can send
 * extra or weirdly-typed fields; we only pull the known shape.
 */
function coerceTripState(raw: Record<string, unknown>): TripIntentState {
  const state: TripIntentState = {
    activities: [],
    cuisine_preferences: [],
    vibe: "mixed",
    planning_assumptions: [],
  };

  if (typeof raw.destination_city === "string" && raw.destination_city.trim()) {
    state.destination_city = raw.destination_city.trim();
  }
  if (typeof raw.departure_city === "string" && raw.departure_city.trim()) {
    state.departure_city = raw.departure_city.trim();
  }
  // Defensive re-normalization: even though commit should send ISO dates,
  // never trust a client payload — if an old client or a relative string
  // slips through, resolve it or drop it.
  const today = new Date();
  if (typeof raw.start_date === "string" && raw.start_date.trim()) {
    const resolved = resolveDateHint(raw.start_date, today);
    if (resolved) state.start_date = resolved;
  }
  if (typeof raw.end_date === "string" && raw.end_date.trim()) {
    const resolved = resolveDateHint(raw.end_date, today);
    if (resolved) state.end_date = resolved;
  }
  if (typeof raw.nights === "number" && Number.isFinite(raw.nights) && raw.nights > 0) {
    state.nights = raw.nights;
  }
  if (typeof raw.travelers === "number" && Number.isFinite(raw.travelers) && raw.travelers > 0) {
    state.travelers = raw.travelers;
  }
  if (typeof raw.hotel_star_rating === "number" && raw.hotel_star_rating > 0) {
    state.hotel_star_rating = raw.hotel_star_rating;
  }
  if (typeof raw.hotel_neighborhood === "string" && raw.hotel_neighborhood.trim()) {
    state.hotel_neighborhood = raw.hotel_neighborhood.trim();
  }
  if (typeof raw.budget_total === "number" && raw.budget_total > 0) {
    state.budget_total = raw.budget_total;
  }
  if (Array.isArray(raw.activities)) {
    state.activities = raw.activities.filter(
      (a): a is string => typeof a === "string" && a.trim().length > 0
    );
  }
  if (Array.isArray(raw.cuisine_preferences)) {
    state.cuisine_preferences = raw.cuisine_preferences.filter(
      (a): a is string => typeof a === "string" && a.trim().length > 0
    );
  }
  if (Array.isArray(raw.planning_assumptions)) {
    state.planning_assumptions = raw.planning_assumptions.filter(
      (a): a is string => typeof a === "string" && a.trim().length > 0
    );
  }
  const vibe = raw.vibe;
  if (
    vibe === "trendy" ||
    vibe === "upscale" ||
    vibe === "local" ||
    vibe === "mixed"
  ) {
    state.vibe = vibe as TripVibe;
  }

  return state;
}

async function enrichTripStateWithCalendar(
  userId: string,
  state: TripIntentState,
): Promise<TripIntentState> {
  const startDate = resolveDateHint(state.start_date);
  const endDate = resolveDateHint(state.end_date);
  if (!startDate || !endDate) return state;

  const connection = await getCalendarConnection(userId, "google");
  if (!connection) return state;

  try {
    const syncStart = new Date(`${startDate}T00:00:00Z`);
    syncStart.setUTCDate(syncStart.getUTCDate() - 7);
    const syncEnd = new Date(`${endDate}T00:00:00Z`);
    syncEnd.setUTCDate(syncEnd.getUTCDate() + 30);

    const synced = await syncGoogleBusySlots({
      userId,
      rangeStart: syncStart.toISOString().slice(0, 10),
      rangeEnd: syncEnd.toISOString().slice(0, 10),
    });
    const summary = summarizeTripConflicts(synced.slots, startDate, endDate);
    const assumptions = [...state.planning_assumptions];

    if (summary.conflictCount === 0) {
      assumptions.push(`Google Calendar looks clear for ${startDate} to ${endDate}.`);
      return { ...state, planning_assumptions: assumptions };
    }

    assumptions.push(
      `Google Calendar shows ${summary.conflictCount} busy block${summary.conflictCount === 1 ? "" : "s"} across ${summary.busyDays} day${summary.busyDays === 1 ? "" : "s"} in ${startDate} to ${endDate}.`,
    );

    const suggestion = suggestNextFreeWindow({
      slots: synced.slots,
      startDate,
      nights: state.nights ?? 2,
      searchDays: 45,
    });
    if (suggestion && suggestion.from !== startDate) {
      assumptions.push(`Nearest free window found: ${suggestion.from} to ${suggestion.to}.`);
    }

    return { ...state, planning_assumptions: assumptions };
  } catch (error) {
    console.warn("[trip/plan] calendar enrichment failed", error);
    return state;
  }
}
