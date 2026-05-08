/**
 * GET /api/memory?session_id=...
 * GET /api/memory?session_id=...&shape=compact
 *
 * Returns the full three-layer memory model for a session:
 *   - taskMemory: per-scenario preference profiles
 *   - patternMemory: stated vs actual tolerance, satisfaction predictors, override triggers
 *   - relationship: named group profile (couple / friends / family)
 *
 * Used by the InsightsPanel to show the user what the agent has learned
 * about them across ALL bookings, not just entity-level preferences.
 *
 * App-shell or preview surfaces should use /api/memory/compact, or
 * shape=compact here, so full preference/profile detail stays lazy.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getAgentFeedbackEvents,
  getBookingJobsBySession,
  getRelationshipBySession,
} from "@/lib/db";
import { getCompactMemoryEndpointResponse } from "@/lib/memory-endpoint";
import { buildTaskMemory, buildPatternMemory } from "@/lib/memory";
import { computePolicyBias, buildPreferenceProfile } from "@/lib/policy";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  try {
    if (req.nextUrl.searchParams.get("shape") === "compact") {
      return NextResponse.json(await getCompactMemoryEndpointResponse(sessionId));
    }

    const [events, jobs, relationship] = await Promise.all([
      getAgentFeedbackEvents(sessionId, 500),
      getBookingJobsBySession(sessionId, 50),
      getRelationshipBySession(sessionId),
    ]);

    // Build job-level lookup maps for memory computation
    const jobLabels = new Map(jobs.map((j) => [j.id, j.trip_label]));
    const jobAutonomy = new Map(
      jobs
        .filter((j) => j.autonomy_settings?.restaurant?.timeWindowMinutes != null)
        .map((j) => [j.id, j.autonomy_settings!.restaurant.timeWindowMinutes])
    );

    const taskMemory   = buildTaskMemory(events, jobLabels);
    const patternMemory = buildPatternMemory(events, jobAutonomy, jobLabels);
    const bias         = computePolicyBias(events);
    const profile      = buildPreferenceProfile(events);

    return NextResponse.json({
      taskMemory,
      patternMemory,
      bias,
      profile,
      relationship,
      totalEvents: events.length,
    });
  } catch (err) {
    console.error("memory GET error", err);
    return NextResponse.json({ error: "Failed to build memory model" }, { status: 500 });
  }
}
