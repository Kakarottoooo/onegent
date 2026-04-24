/**
 * Stage 2 trip synthesis — multi-party aggregation layer.
 *
 * Reads every member's IntentState from `room_member_intent_state`, merges
 * their TripIntentStates into a single anonymized aggregate, then hands off
 * to the Stage 1 trip-package planner (`lib/agent/planners/trip-package`)
 * to produce the 3-tier TripPackage that goes on the public channel.
 *
 * Design notes:
 *   - Merge is deterministic (no LLM). Pure function over sorted inputs so
 *     re-synthesis yields identical results if nothing changed.
 *   - The MERGED state is what gets fed to the planner — there is no
 *     per-member branching in the package output. Disagreements are
 *     resolved inside `mergeTripIntents` (see rules below).
 *   - Output to decision_rooms.synthesis_json = the raw TripPackage. The
 *     public-channel summary message is generated separately (and stays
 *     anonymized — never names who said what).
 *   - Caller controls WHEN to synthesize. T14 adds the N/N-members + 30s
 *     debounce trigger on top of this module.
 */
import { randomUUID } from "crypto";
import {
  listMemberIntentStates,
  getDecisionRoomById,
  listRoomMembers,
  updateDecisionRoomSynthesis,
  appendRoomMessage,
  createRoomProposal,
  listActiveProposals,
  sendDirectMessage,
  areContacts,
  getUserProfile,
  insertPrivateMessage,
} from "@/lib/db";
import {
  type TripIntentState,
  emptyTripState,
  getMissingFields,
} from "./trip-intent-state";
import { buildTripPackage, type BuildTripPackageResult } from "./planners/trip-package";

// ─── Merge logic ──────────────────────────────────────────────────────────

/**
 * Merge N members' TripIntentStates into one aggregate state.
 * Rules:
 *   - Scalar (destination, dates, vibe, neighborhood): first-defined wins
 *     (creator's state is passed first by convention, ordered by
 *     updated_at asc in synthesizeTripForRoom).
 *   - Arrays (activities, cuisine_preferences, planning_assumptions):
 *     union across all members.
 *   - Budget: MIN of all defined values (most restrictive budget wins).
 *   - hotel_star_rating: MIN (most restrictive ceiling).
 *   - travelers: NOT merged here — callers override with room member count.
 *
 * Pure function; no DB, no LLM. Sort + merge is stable so re-running with
 * the same inputs produces the same output.
 */
export function mergeTripIntents(states: TripIntentState[]): TripIntentState {
  if (states.length === 0) return emptyTripState();

  const merged: TripIntentState = { ...emptyTripState(), ...states[0] };

  const scalarKeys: (keyof TripIntentState)[] = [
    "destination_city",
    "departure_city",
    "start_date",
    "end_date",
    "nights",
    "hotel_neighborhood",
  ];

  // Scalars: fill any blank in merged from later states.
  for (const key of scalarKeys) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      for (const s of states.slice(1)) {
        const v = s[key];
        if (v !== undefined && v !== null && v !== "") {
          (merged as unknown as Record<string, unknown>)[key] = v;
          break;
        }
      }
    }
  }

  // Vibe: upgrade from "mixed" to any specific vibe voted by anyone.
  for (const s of states) {
    if (s.vibe && s.vibe !== "mixed") {
      merged.vibe = s.vibe;
      break;
    }
  }

  // Union arrays.
  const activities = new Set<string>();
  const cuisines = new Set<string>();
  const assumptions = new Set<string>();
  for (const s of states) {
    s.activities?.forEach((a) => activities.add(a));
    s.cuisine_preferences?.forEach((c) => cuisines.add(c));
    s.planning_assumptions?.forEach((a) => assumptions.add(a));
  }
  merged.activities = Array.from(activities);
  merged.cuisine_preferences = Array.from(cuisines);
  merged.planning_assumptions = Array.from(assumptions);

  // Budget total: take the most restrictive defined value.
  const budgets = states
    .map((s) => s.budget_total)
    .filter((b): b is number => typeof b === "number" && b > 0);
  if (budgets.length > 0) {
    merged.budget_total = Math.min(...budgets);
  }

  // Star rating: take the most restrictive (lowest) ceiling defined.
  const stars = states
    .map((s) => s.hotel_star_rating)
    .filter((s): s is number => typeof s === "number" && s > 0);
  if (stars.length > 0) {
    merged.hotel_star_rating = Math.min(...stars);
  }

  return merged;
}

// ─── Extract helpers ──────────────────────────────────────────────────────

/**
 * Pull the TripIntentState out of a stored IntentState JSON payload.
 * Returns null if this member hasn't chatted about a trip yet (e.g. just
 * joined the room but hasn't said anything).
 */
export function extractTripFromIntentState(
  intentStateJson: Record<string, unknown>,
): TripIntentState | null {
  const trip = intentStateJson.trip;
  if (!trip || typeof trip !== "object" || Array.isArray(trip)) return null;
  const t = trip as Partial<TripIntentState>;
  // Accept partial — mergeTripIntents + buildTripPackage will validate
  // completeness via getMissingFields.
  return {
    ...emptyTripState(),
    ...t,
    activities: Array.isArray(t.activities) ? t.activities : [],
    cuisine_preferences: Array.isArray(t.cuisine_preferences) ? t.cuisine_preferences : [],
    planning_assumptions: Array.isArray(t.planning_assumptions) ? t.planning_assumptions : [],
  };
}

// ─── Top-level synthesis ──────────────────────────────────────────────────

export type SynthesisStatus =
  | "ok"               // package produced + stored
  | "empty"            // no members have a trip state yet
  | "incomplete"       // merged state missing required fields
  | "no_room";         // room_id doesn't exist

export interface SynthesisResult {
  status: SynthesisStatus;
  /** Aggregate state across all members (always present except status=no_room). */
  merged: TripIntentState | null;
  /** Member count (for the public summary "3 people want..."). */
  memberCount: number;
  /** How many of those members actually contributed trip intent. */
  contributorCount: number;
  /** Missing required fields when status=incomplete. */
  missing: string[];
  /** TripPackage when status=ok. Already persisted to decision_rooms.synthesis_json. */
  package: BuildTripPackageResult | null;
}

/**
 * Run the full synthesis pipeline for a trip room:
 *   1. Load all member IntentStates.
 *   2. Extract + merge their trip sub-states.
 *   3. Validate completeness (destination, dates, departure, travelers).
 *   4. If complete, call buildTripPackage and persist synthesis_json.
 *
 * Non-mutating on the room when status != "ok" — caller decides whether to
 * ask for more info, wait, or retry later.
 */
export async function synthesizeTripForRoom(roomId: string): Promise<SynthesisResult> {
  const room = await getDecisionRoomById(roomId);
  if (!room) {
    return {
      status: "no_room",
      merged: null,
      memberCount: 0,
      contributorCount: 0,
      missing: [],
      package: null,
    };
  }

  const [members, intentRows] = await Promise.all([
    listRoomMembers(roomId),
    listMemberIntentStates(roomId),
  ]);

  // Oldest first — creator first (by convention of upsert order).
  const orderedRows = [...intentRows].sort(
    (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
  );

  const tripStates = orderedRows
    .map((r) => extractTripFromIntentState(r.intent_state_json))
    .filter((s): s is TripIntentState => s !== null);

  const memberCount = members.filter((m) => m.status === "joined").length;
  const contributorCount = tripStates.length;

  if (tripStates.length === 0) {
    return {
      status: "empty",
      merged: null,
      memberCount,
      contributorCount,
      missing: [],
      package: null,
    };
  }

  const merged = mergeTripIntents(tripStates);
  // Authoritative traveler count is the room's joined member count — a
  // member can't say "we're 3 people" and lower the count by dropping out;
  // same way they can't inflate it by saying "we're 5" when only 2 joined.
  merged.travelers = Math.max(memberCount, 1);

  const missing = getMissingFields(merged);
  if (missing.length > 0) {
    return {
      status: "incomplete",
      merged,
      memberCount,
      contributorCount,
      missing,
      package: null,
    };
  }

  // Full info — run the Stage 1 planner.
  const pkgResult = await buildTripPackage(merged);

  await updateDecisionRoomSynthesis(roomId, pkgResult.package as unknown as Record<string, unknown>);

  return {
    status: "ok",
    merged,
    memberCount,
    contributorCount,
    missing: [],
    package: pkgResult,
  };
}

// ─── Public-channel summary ───────────────────────────────────────────────

/**
 * Anonymized one-paragraph summary to post in the public channel when
 * synthesis kicks off or completes. Never names members — only aggregates
 * ("3 people", "group budget", etc.). Safe to share.
 */
export function buildPublicSummary(result: SynthesisResult): string {
  if (result.status === "no_room") return "";
  if (result.status === "empty") {
    return `Trip 房间里还没人说偏好，等大家开口我就开始综合方案。`;
  }
  if (result.status === "incomplete") {
    const missingHint = result.missing.length > 0 ? `（还差：${result.missing.join("、")}）` : "";
    return `目前 ${result.contributorCount}/${result.memberCount} 人说了偏好，信息还不够完整${missingHint}，我等齐了就出方案。`;
  }

  const m = result.merged!;
  const parts: string[] = [];
  parts.push(`${result.memberCount} 人 trip`);
  if (m.destination_city) parts.push(`目的地 ${m.destination_city}`);
  if (m.departure_city) parts.push(`从 ${m.departure_city} 出发`);
  if (m.nights) parts.push(`${m.nights} 晚`);
  if (m.start_date) parts.push(`${m.start_date} 起`);
  if (m.budget_total) parts.push(`预算 ≤ $${m.budget_total}`);
  if (m.hotel_star_rating) parts.push(`酒店 ≥ ${m.hotel_star_rating} 星`);
  const extras: string[] = [];
  if (m.activities.length > 0) extras.push(`想玩 ${m.activities.slice(0, 3).join("、")}`);
  if (m.cuisine_preferences.length > 0) extras.push(`喜欢 ${m.cuisine_preferences.slice(0, 3).join("、")}`);
  const extraLine = extras.length > 0 ? `\n偏好：${extras.join("；")}` : "";
  return `已综合所有人偏好：${parts.join(" · ")}${extraLine}\n方案已出，请投票。`;
}

// ─── Trigger dispatcher ───────────────────────────────────────────────────
// Single entry point for both the auto-trigger (fired inline from each chat
// turn via Next.js `after()`) and the manual re-run endpoint.

export type TriggerReason =
  | "already_synthesized"   // synthesis_json is non-null and not force re-run
  | "wrong_type"            // not a trip+chat room
  | "wrong_status"          // room.status past collecting; caller wants force
  | "no_joined_members"
  | "waiting_for_members"   // at least one joined member hasn't contributed yet
  | "no_room"
  | SynthesisStatus;        // "ok" | "empty" | "incomplete" | "no_room"

export interface TriggerOutcome {
  triggered: boolean;
  reason: TriggerReason;
  result: SynthesisResult | null;
}

export interface TriggerOptions {
  /** Force re-run even when synthesis_json is already populated. Used by the
   *  manual /api/rooms/[id]/synthesize endpoint. */
  force?: boolean;
}

/**
 * Decide whether to synthesize + actually run it + post public-channel
 * message + transition room status. Safe to call concurrently — worst case
 * is two calls both succeed and the last write wins (deterministic content).
 *
 * Contract (one-time lock + manual re-run):
 *   - If `synthesis_json` already set and `force=false` → no-op.
 *   - Only triggers when ALL joined members have at least one intent_state
 *     entry (contribution check). No 30s debounce — natural pacing from
 *     the chat stream is enough.
 *   - On status="ok":
 *       1. synthesis_json stored (inside synthesizeTripForRoom)
 *       2. Public summary message appended to decision_room_messages
 *       3. Room status transitioned "collecting" → "approving"
 */
export async function triggerSynthesis(
  roomId: string,
  opts: TriggerOptions = {},
): Promise<TriggerOutcome> {
  const room = await getDecisionRoomById(roomId);
  if (!room) return { triggered: false, reason: "no_room", result: null };
  if (room.type !== "trip" || room.flow !== "chat") {
    return { triggered: false, reason: "wrong_type", result: null };
  }

  if (!opts.force) {
    if (room.synthesis_json !== null) {
      return { triggered: false, reason: "already_synthesized", result: null };
    }
    if (room.status !== "collecting") {
      return { triggered: false, reason: "wrong_status", result: null };
    }

    // All-contributed gate: every joined member must have at least one
    // intent_state row. No debounce — "waiting_for_members" keeps retrying
    // each chat turn until the last straggler chats.
    const [members, intentRows] = await Promise.all([
      listRoomMembers(roomId),
      listMemberIntentStates(roomId),
    ]);
    const joined = members.filter((m) => m.status === "joined");
    if (joined.length === 0) {
      return { triggered: false, reason: "no_joined_members", result: null };
    }
    const contributorIds = new Set(intentRows.map((r) => r.user_id));
    const allContributed = joined.every((m) => contributorIds.has(m.user_id));
    if (!allContributed) {
      return { triggered: false, reason: "waiting_for_members", result: null };
    }
  }

  const result = await synthesizeTripForRoom(roomId);

  if (result.status === "ok" && result.package) {
    // Create the proposal row (one option, the whole TripPackage).
    // createRoomProposal auto-transitions room.status → "approving".
    const proposalId = randomUUID();
    try {
      await createRoomProposal({
        id: proposalId,
        roomId,
        contentJson: result.package.package as unknown as Record<string, unknown>,
        rationale: `Synthesized from ${result.contributorCount} member${result.contributorCount === 1 ? "" : "s"}' chat preferences`,
        conflictsJson: null,
      });
    } catch (err) {
      console.warn("[trip-synthesis] createRoomProposal failed", err);
    }

    // Stage 2 · T11 inline proposal card: seed a marker message into EACH
    // joined member's private channel. Client detects meta_json.kind and
    // renders a <TripProposalChatCard /> instead of a plain text bubble.
    // `created_at` ordering puts this at the end of their replay so the
    // card appears right after whatever they last said.
    try {
      const members = await listRoomMembers(roomId);
      const cardContent =
        "✅ 方案已出！在下方卡片里选择你的偏好，实时看大家的共识进度。";
      const cardMeta = {
        kind: "trip_proposal_card" as const,
        proposal_id: proposalId,
        room_id: roomId,
      };
      for (const m of members) {
        if (m.status !== "joined") continue;
        try {
          await insertPrivateMessage({
            roomId,
            userId: m.user_id,
            role: "assistant",
            content: cardContent,
            metaJson: cardMeta,
          });
        } catch (err) {
          console.warn(`[trip-synthesis] seed proposal card for ${m.user_id} failed`, err);
        }
      }
    } catch (err) {
      console.warn("[trip-synthesis] proposal-card seed phase failed", err);
    }
    try {
      await appendRoomMessage({
        roomId,
        senderId: null,
        content: buildPublicSummary(result),
        metaJson: { kind: "trip_synthesis" },
      });
    } catch (err) {
      console.warn("[trip-synthesis] appendRoomMessage failed", err);
    }

    // Fan out "plan ready" DMs to every joined member (except the creator
    // themselves) — the public-channel message isn't visible in chat-flow
    // rooms, so without this members have no in-chat signal. from_user_id
    // is the room creator (the party the DM system treats as "sender"); the
    // DM UI badges role='agent' distinctly so recipients know it's system-
    // generated, not personally typed.
    try {
      const creatorProfile = await getUserProfile(room.creator_id).catch(() => null);
      const creatorLabel =
        creatorProfile?.display_name || creatorProfile?.username || "Your room";
      const dmContent = `✅ Trip plan ready for "${room.title}" — open Rooms → this trip to review the 3 tier options and vote.`;
      const members = await listRoomMembers(roomId);
      for (const m of members) {
        if (m.user_id === room.creator_id) continue;
        if (m.status !== "joined") continue;
        if (!(await areContacts(room.creator_id, m.user_id).catch(() => false))) continue;
        try {
          await sendDirectMessage({
            fromUserId: room.creator_id,
            toUserId: m.user_id,
            role: "agent",
            content: dmContent,
            metaJson: {
              kind: "trip_synthesis_ready",
              room_id: roomId,
              room_title: room.title,
              triggered_by: creatorLabel,
            },
          });
        } catch (err) {
          console.warn(`[trip-synthesis] member DM failed for ${m.user_id}`, err);
        }
      }
    } catch (err) {
      console.warn("[trip-synthesis] member-notify phase failed", err);
    }
  }

  return { triggered: true, reason: result.status, result };
}

/**
 * Return the active (status="active") proposal for a trip room. Trip rooms
 * have at most one active proposal at a time; if multiple exist (force
 * re-synthesis) the most recent wins. Returns null when no proposal yet.
 */
export async function getActiveTripProposal(roomId: string) {
  const proposals = await listActiveProposals(roomId);
  return proposals.find((p) => p.status === "active") ?? null;
}
