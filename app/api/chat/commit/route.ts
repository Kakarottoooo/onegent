/**
 * POST /api/chat/commit
 *
 * Called when the user clicks "Confirm" on the inline confirm card after the
 * conversational NLU says confirm_ready=true. We route based on intent:
 *
 *   create_room  → createDecisionRoom with context lifted from collected_constraints
 *   create_plan  → return a "run-chat" hand-off payload; the client drives /api/chat
 *   refine_*     → not implemented in Phase 1 (returns 400)
 *
 * Phase 1 deliberately keeps the Plan path as a hand-off: the existing homepage
 * chat pipeline (/api/chat + runAgent) already persists plans via
 * /api/plan/save, so duplicating that here would just diverge.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  createDecisionRoom,
  upsertRoomConstraint,
  upsertMemberIntentState,
  resolveContactsByNames,
  inviteToDecisionRoom,
  insertPrivateMessage,
  sendDirectMessage,
  getUserProfile,
  markSessionUpgraded,
  markSessionUpgradedPlan,
  markSessionUpgradedTrip,
  type ApprovalRule,
  type DecisionRoomType,
  type DecisionRoomCategory,
} from "@/lib/db";
import type {
  RestaurantConstraintData,
  HotelConstraintData,
  FlightConstraintData,
  ActivityConstraintData,
} from "@/lib/rooms/constraint-types";
import type {
  ConversationalIntent,
  ConversationalScenario,
  ConversationalNLUResult,
} from "@/lib/agent/nlu-v2";
import {
  emptyTripState,
  getMissingFields,
  buildClarificationMessage,
  resolveDateHint,
  type TripIntentState,
  type TripVibe,
} from "@/lib/agent/trip-intent-state";

export const maxDuration = 30;

const ALLOWED_ROOM_TYPES: DecisionRoomType[] = ["restaurant", "hotel", "flight", "activity", "trip"];

/**
 * MVP default categories for a Stage 2 trip room. Matches Stage 1's 4-step
 * booking-job builder. Future: infer from TripIntentState signals (e.g. skip
 * flight if user's departure_city == destination_city), and/or let the user
 * opt-out of a category in the UI before the room is created.
 */
const DEFAULT_TRIP_CATEGORIES: DecisionRoomCategory[] = ["hotel", "flight", "activity", "restaurant"];
const ALLOWED_RULES: ApprovalRule[] = ["unanimous", "majority"];

function parseIntent(value: unknown): ConversationalIntent | null {
  const allowed: ConversationalIntent[] = [
    "create_plan",
    "create_room",
    "refine_existing",
    "chitchat",
    "unknown",
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as ConversationalIntent;
  }
  return null;
}

function parseScenario(value: unknown): ConversationalScenario | null {
  const allowed: ConversationalScenario[] = [
    "restaurant",
    "hotel",
    "flight",
    "activity",
    "trip",
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as ConversationalScenario;
  }
  return null;
}

function readString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readBool(obj: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (/^(true|yes|1|round.?trip)$/i.test(v)) return true;
      if (/^(false|no|0|one.?way)$/i.test(v)) return false;
    }
  }
  return null;
}

function buildRoomContext(
  type: DecisionRoomType,
  constraints: Record<string, unknown>,
  memberNames: string[]
): Record<string, unknown> {
  const city = readString(constraints, "city", "city_id", "hotel_city", "location");
  const dateFrom = readString(constraints, "date", "date_from", "check_in", "departure_date");
  const dateTo = readString(constraints, "date_to", "check_out", "return_date");

  const context: Record<string, unknown> = {
    city_id: city ?? null,
    date_window: dateFrom || dateTo ? { from: dateFrom ?? null, to: dateTo ?? null } : null,
  };

  if (type === "restaurant") {
    const time = readString(constraints, "time", "time_hint");
    const partySize = readNumber(constraints, "party_size", "guests", "covers");
    const cuisine = readString(constraints, "cuisine", "cuisine_hint");
    const budget = readNumber(constraints, "budget_per_person", "budget_per_person_hint", "budget");
    if (time) context.time = time;
    if (partySize) context.party_size = partySize;
    if (cuisine) context.cuisine_hint = cuisine;
    if (budget) context.budget_per_person = budget;
  }

  if (type === "hotel") {
    const guests = readNumber(constraints, "guests", "travelers", "party_size");
    const stars = readNumber(constraints, "stars", "min_stars");
    if (dateFrom) context.check_in = dateFrom;
    if (dateTo) context.check_out = dateTo;
    if (guests) context.guests = guests;
    if (stars) context.min_stars = stars;
  }

  if (type === "flight") {
    const origin = readString(constraints, "departure_city", "origin", "origin_airport");
    const dest = readString(constraints, "arrival_city", "dest", "dest_airport", "destination");
    const passengers = readNumber(constraints, "passengers", "party_size");
    const cabinClass = readString(constraints, "cabin_class", "cabin");
    const isRoundTrip = readBool(constraints, "is_round_trip", "round_trip");
    if (origin) context.departure_city = origin;
    if (dest) context.arrival_city = dest;
    if (dateFrom) context.departure_date = dateFrom;
    if (dateTo) context.return_date = dateTo;
    if (passengers) context.passengers = passengers;
    if (cabinClass) context.cabin_class = cabinClass;
    if (isRoundTrip !== null) context.is_round_trip = isRoundTrip;
  }

  if (type === "activity") {
    const eventName = readString(constraints, "event_name", "activity_name", "title");
    const eventType = readString(constraints, "event_type", "activity_type", "genre");
    const numTickets = readNumber(constraints, "num_tickets", "tickets", "quantity", "party_size");
    const venueHint = readString(constraints, "venue_hint", "venue_name", "venue");
    if (eventName) context.event_name = eventName;
    if (eventType) context.event_type = eventType;
    if (dateFrom) context.event_date = dateFrom;
    if (dateTo) context.event_date_to = dateTo;
    if (numTickets) context.num_tickets = numTickets;
    if (venueHint) context.venue_hint = venueHint;
  }

  // Conversational bridge — member names mentioned in chat but not yet in the
  // contacts system. P1-10 (mode C proxy-for-member) reads this to stage
  // per-member default constraints. The key prefix keeps it namespaced away
  // from the regular context shape read by the agent.
  if (memberNames.length > 0) {
    context._conversational_members = memberNames;
  }

  // P1-10: proxy constraints the creator reported on behalf of named members.
  // Stored as { [display_name]: partial_constraint_data } so the join route
  // can seed the member's personal constraint row when they sign in.
  const proxy = sanitizeProxyMemberConstraints(type, constraints.proxy_member_constraints);
  if (proxy && Object.keys(proxy).length > 0) {
    context._proxy_member_constraints = proxy;
  }

  return context;
}

/**
 * Normalize the raw `proxy_member_constraints` sub-object from NLU into a map
 * of display_name → whitelisted constraint keys. Drops anything the editor
 * can't render for this Room type; keeps display_name casing as-is so the
 * join matcher can case-insensitive compare.
 */
function sanitizeProxyMemberConstraints(
  type: DecisionRoomType,
  value: unknown
): Record<string, Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!name.trim() || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const seed = buildCreatorConstraintSeed(type, raw as Record<string, unknown>);
    if (seed && Object.keys(seed).length > 0) {
      out[name.trim()] = seed;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Map the conversational NLU's free-form constraint keys into the per-member
 * constraint shape the room's ConstraintEditor expects. Only pulls keys the
 * editor can actually show — the rest stays on the room's context_json.
 *
 * Returns null when we have nothing personal to pre-fill (no cuisines / taste
 * / budget / dietary mentioned). That way we don't create an empty unsubmitted
 * row that would count as "pending" in the member list.
 */
function buildCreatorConstraintSeed(
  type: DecisionRoomType,
  constraints: Record<string, unknown>
): Record<string, unknown> | null {
  if (type === "restaurant") {
    const data: RestaurantConstraintData = {};
    const cuisine = readString(constraints, "cuisine", "cuisine_hint");
    if (cuisine) data.cuisines_like = [cuisine];
    const dislikes = constraints.cuisines_dislike;
    if (Array.isArray(dislikes)) {
      const clean = dislikes.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.cuisines_dislike = clean;
    }
    const dietary = constraints.dietary;
    if (Array.isArray(dietary)) {
      const clean = dietary.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.dietary = clean;
    }
    const budget = readNumber(constraints, "budget_per_person", "budget_per_person_hint", "budget_max", "budget");
    if (budget) data.budget_max = budget;
    const vibe = readString(constraints, "vibe", "ambience");
    if (vibe) data.vibe = vibe;
    const timePref = readString(constraints, "time_preference", "time_hint");
    if (timePref) data.time_preference = timePref;
    const notes = readString(constraints, "notes", "extra_notes");
    if (notes) data.notes = notes;
    return Object.keys(data).length > 0 ? (data as Record<string, unknown>) : null;
  }

  if (type === "hotel") {
    const data: HotelConstraintData = {};
    const budget = readNumber(constraints, "budget_max_per_night", "budget_per_night", "budget");
    if (budget) data.budget_max_per_night = budget;
    const neighborhood = readString(constraints, "neighborhood", "area");
    if (neighborhood) data.neighborhood = neighborhood;
    const stars = readNumber(constraints, "stars", "min_stars", "star_rating_min");
    if (stars) data.star_rating_min = stars;
    const vibe = readString(constraints, "vibe", "ambience");
    if (vibe) data.vibe = vibe;
    const amenities = constraints.amenities;
    if (Array.isArray(amenities)) {
      const clean = amenities.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.amenities = clean;
    }
    const notes = readString(constraints, "notes", "extra_notes");
    if (notes) data.notes = notes;
    return Object.keys(data).length > 0 ? (data as Record<string, unknown>) : null;
  }

  if (type === "flight") {
    const data: FlightConstraintData = {};
    const budget = readNumber(constraints, "budget_max_per_person", "budget_per_person", "budget");
    if (budget) data.budget_max_per_person = budget;
    const cabin = readString(constraints, "cabin_class", "cabin");
    if (cabin === "economy" || cabin === "premium_economy" || cabin === "business" || cabin === "first") {
      data.cabin_class_min = cabin;
    }
    const maxStops = readNumber(constraints, "max_stops");
    if (maxStops === 0 || maxStops === 1 || maxStops === 2) data.max_stops = maxStops;
    const earliest = readString(constraints, "earliest_departure");
    if (earliest) data.earliest_departure = earliest;
    const latest = readString(constraints, "latest_departure");
    if (latest) data.latest_departure = latest;
    const avoidRedEye = readBool(constraints, "avoid_red_eye");
    if (avoidRedEye !== null) data.avoid_red_eye = avoidRedEye;
    const preferred = constraints.preferred_airlines;
    if (Array.isArray(preferred)) {
      const clean = preferred.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.preferred_airlines = clean;
    }
    const avoid = constraints.avoid_airlines;
    if (Array.isArray(avoid)) {
      const clean = avoid.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.avoid_airlines = clean;
    }
    const notes = readString(constraints, "notes", "extra_notes");
    if (notes) data.notes = notes;
    return Object.keys(data).length > 0 ? (data as Record<string, unknown>) : null;
  }

  if (type === "activity") {
    const data: ActivityConstraintData = {};
    const budget = readNumber(constraints, "budget_max_per_ticket", "budget_per_ticket", "budget");
    if (budget) data.budget_max_per_ticket = budget;
    const seatType = readString(constraints, "seat_type", "seat_tier");
    if (seatType === "premium" || seatType === "standard" || seatType === "economy") {
      data.seat_type = seatType;
    }
    const sections = constraints.section_preferences;
    if (Array.isArray(sections)) {
      const clean = sections.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.section_preferences = clean;
    }
    const avoidSections = constraints.avoid_sections;
    if (Array.isArray(avoidSections)) {
      const clean = avoidSections.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (clean.length > 0) data.avoid_sections = clean;
    }
    const wheelchair = readBool(constraints, "wheelchair_required", "wheelchair", "accessibility_wheelchair");
    if (wheelchair) data.accessibility = { wheelchair: true };
    const delivery = readString(constraints, "delivery_preference", "delivery");
    if (delivery === "mobile" || delivery === "will_call" || delivery === "print") {
      data.delivery_preference = delivery;
    }
    const notes = readString(constraints, "notes", "extra_notes");
    if (notes) data.notes = notes;
    return Object.keys(data).length > 0 ? (data as Record<string, unknown>) : null;
  }

  return null;
}

function buildRoomTitle(
  type: DecisionRoomType,
  constraints: Record<string, unknown>,
  memberNames: string[],
  fallbackMessage: string
): string {
  const bits: string[] = [];
  const cuisine = readString(constraints, "cuisine", "cuisine_hint");
  if (type === "restaurant" && cuisine) bits.push(cuisine);
  if (type === "activity") {
    const eventName = readString(constraints, "event_name", "activity_name", "title");
    if (eventName) bits.push(eventName);
  }
  const city = readString(constraints, "city", "hotel_city", "arrival_city", "destination");
  if (city) bits.push(city);
  const date = readString(constraints, "date", "date_from", "check_in", "departure_date");
  if (date) bits.push(date);
  if (memberNames.length > 0) {
    const n = memberNames.slice(0, 3).join(", ");
    bits.push(`with ${n}${memberNames.length > 3 ? " +" : ""}`);
  }
  const built = bits.join(" · ").trim();
  if (built) return built.slice(0, 120);
  // Last resort: a trimmed snippet of what the user said.
  return fallbackMessage.trim().slice(0, 80) || "New Room";
}

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

  // The client sends the full NLU result back so the server doesn't have to
  // re-parse. We still validate enum fields defensively.
  const nluRaw = b.result as ConversationalNLUResult | undefined;
  if (!nluRaw || typeof nluRaw !== "object") {
    return NextResponse.json({ error: "result required" }, { status: 400 });
  }

  const intent = parseIntent(nluRaw.intent);
  if (!intent) return NextResponse.json({ error: "unknown intent" }, { status: 400 });

  const scenario = parseScenario(nluRaw.scenario);
  const constraints =
    nluRaw.collected_constraints && typeof nluRaw.collected_constraints === "object"
      ? (nluRaw.collected_constraints as Record<string, unknown>)
      : {};
  const memberNames = Array.isArray(nluRaw.member_names)
    ? nluRaw.member_names.filter((x): x is string => typeof x === "string")
    : [];
  const originalMessage = typeof b.message === "string" ? b.message : "";

  if (intent === "chitchat" || intent === "unknown") {
    return NextResponse.json(
      { error: "nothing to commit — ask a clarifying question instead" },
      { status: 400 }
    );
  }

  if (intent === "refine_existing") {
    return NextResponse.json(
      { error: "refine_existing is not wired in Phase 1" },
      { status: 400 }
    );
  }

  // ── Trip scenario (multi-category package) ──────────────────────────────
  // Both create_plan + trip and create_room + trip route here. create_plan
  // returns a kind="trip" handoff so the client fires the trip planner.
  // create_room + trip is Stage 2 (multi-party trip); for now we return a
  // clear "coming soon" signal instead of creating a broken Room.
  if (scenario === "trip") {
    const state = collectedConstraintsToTripState(constraints);
    const missing = getMissingFields(state);

    if (missing.length > 0) {
      // Defensive path — NLU should have kept confirm_ready=false, but if
      // commit is called anyway, surface a structured clarify response so
      // the client can show the user what's still needed.
      return NextResponse.json({
        ok: true,
        kind: "trip_clarify",
        missing_fields: missing,
        message: buildClarificationMessage(missing),
      });
    }

    if (intent === "create_room") {
      // Stage 2: multi-party trip room. Creator seeds room_member_intent_state
      // with their own trip state; invited members will do the same via the
      // homepage chat after accepting the invite. The synthesis agent (T13)
      // aggregates across everyone once all members contribute.
      const approvalRule: ApprovalRule =
        typeof b.approval_rule === "string" && ALLOWED_RULES.includes(b.approval_rule as ApprovalRule)
          ? (b.approval_rule as ApprovalRule)
          : "unanimous";

      const title = buildTripRoomTitle(state, memberNames);
      const id = randomUUID();
      const room = await createDecisionRoom({
        id,
        type: "trip",
        title,
        creatorId: userId,
        payerId: userId,
        // Keep the creator's TripIntentState in context_json too — redundant
        // with member_intent_state[creator] but lets pages that only read
        // decision_rooms render a summary without a second query.
        contextJson: { trip_seed: state, member_names: memberNames } as Record<string, unknown>,
        approvalRule,
        flow: "chat",
        categories: DEFAULT_TRIP_CATEGORIES,
      });

      // Seed creator's IntentState. Minimal shape — synthesis agent only
      // needs { scenario, trip, party_type, member_names } to merge.
      try {
        await upsertMemberIntentState({
          roomId: room.id,
          userId,
          intentStateJson: {
            intent: "create_room",
            scenario: "trip",
            party_type: "multi",
            member_names: memberNames,
            trip: state,
            planning_assumptions: state.planning_assumptions ?? [],
            confidence: 0.9,
            turn_count: 1,
            updated_at: new Date().toISOString(),
          },
        });
      } catch (err) {
        console.warn("[chat/commit] seed creator intent_state failed", err);
      }

      // Persist the pre-creation chat history (the conversation that built
      // up to this confirm card) into the creator's private channel. Without
      // this, A would refresh after creating the room and see an empty chat
      // because syncRoomContext only fires for turns AFTER the room exists.
      // Body shape: { history: [{role:"user"|"assistant", content:string}, ...] }
      const rawHistory = Array.isArray(b.history) ? (b.history as unknown[]) : [];
      for (const entry of rawHistory) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const role = e.role;
        const content = e.content;
        if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) continue;
        try {
          await insertPrivateMessage({ roomId: room.id, userId, role, content });
        } catch (err) {
          console.warn("[chat/commit] seed pre-creation history msg failed", err);
        }
      }
      // Also persist the final user message that triggered the confirm (the
      // client already echoed it but the rawHistory snapshot may not include
      // the just-typed turn).
      if (originalMessage.trim()) {
        try {
          await insertPrivateMessage({
            roomId: room.id,
            userId,
            role: "user",
            content: originalMessage,
          });
        } catch (err) {
          console.warn("[chat/commit] seed final user msg failed", err);
        }
      }

      // Deferred: we'll seed the assistant welcome message below AFTER invites
      // are resolved so it can include the real invite URL + handle list.

      // Stage 2 invite-UX: resolve named members to contacts + pre-invite.
      // Resolved contacts get added with status='invited'; they'll see the
      // pending invitation in their /rooms list and accept to join. Names
      // that don't match a contact (typos, non-contacts) are returned in
      // the response so the UI can prompt the user to share the link instead.
      const resolved = await resolveContactsByNames(userId, memberNames).catch(() => []);
      const invitedUserIds: string[] = [];
      const unresolvedNames: string[] = [];
      // Resolve the creator's display name once so the DM reads naturally
      // ("🤖 Alice just invited you..." instead of "user_abc123 just...").
      const creatorProfile = await getUserProfile(userId).catch(() => null);
      const creatorLabel =
        creatorProfile?.display_name ||
        creatorProfile?.username ||
        "A contact";
      for (const r of resolved) {
        if (r.contact_user_id && r.contact_user_id !== userId) {
          try {
            await inviteToDecisionRoom(room.id, r.contact_user_id);
            invitedUserIds.push(r.contact_user_id);
          } catch (err) {
            console.warn(`[chat/commit] inviteToDecisionRoom failed for ${r.contact_user_id}`, err);
            unresolvedNames.push(r.name);
            continue;
          }
          // Agent-role DM to the invited contact so they see the invitation
          // in their Contacts thread + know who to say yes to. role='agent'
          // is labeled distinctly in the DM UI so recipients know this
          // message wasn't personally typed.
          try {
            await sendDirectMessage({
              fromUserId: userId,
              toUserId: r.contact_user_id,
              role: "agent",
              content: `${creatorLabel} just invited you to a trip: "${title}". Open Rooms to accept.`,
              metaJson: {
                kind: "trip_invite",
                room_id: room.id,
                room_short_code: room.short_code,
                accept_path: "/rooms",
              },
            });
          } catch (err) {
            console.warn(`[chat/commit] agent DM failed for ${r.contact_user_id}`, err);
          }
        } else {
          unresolvedNames.push(r.name);
        }
      }

      // If this commit came from a solo session (homepage sidebar thread),
      // flag that session as "upgraded to a room" so the sidebar can show
      // the 🏠 icon and route future clicks to the room instead of the
      // dead solo URL. Non-fatal — session polish not on the critical path.
      const incomingSessionId =
        typeof b.session_id === "string" && b.session_id.trim() ? b.session_id.trim() : null;
      if (incomingSessionId) {
        try {
          await markSessionUpgraded(incomingSessionId, userId, room.id);
        } catch (err) {
          console.warn(`[chat/commit] markSessionUpgraded failed for session=${incomingSessionId}`, err);
        }
      }

      // Seed welcome assistant message into the CREATOR's private channel.
      // The client doesn't inject it in memory — it clears chat and replays
      // from DB on room enter, so this is what the creator sees right after
      // clicking "Confirm & create Room".
      const inviteLineForCreator = room.short_code
        ? `\n邀请链接（发给同行的人）：/rooms/join/${room.short_code}`
        : "";
      const whoList = memberNames.length > 0 ? memberNames.join("、") : "";
      const creatorWelcome =
        `Trip 房间「${room.title}」已建好！${whoList ? `已邀请 ${whoList}。` : ""}${inviteLineForCreator}\n\n` +
        `继续和我聊具体偏好（预算、住哪区、想吃什么、想玩啥），我会综合你们每个人的想法出完整方案。`;
      try {
        await insertPrivateMessage({
          roomId: room.id,
          userId,
          role: "assistant",
          content: creatorWelcome,
        });
      } catch (err) {
        console.warn("[chat/commit] seed creator welcome failed", err);
      }

      // Seed welcome for each INVITED user into their own private channel.
      // Without this, invited users open the room and see a blank chat. This
      // gives them context + a prompt to start contributing preferences.
      const invitedWelcome =
        `${creatorLabel} 邀请你一起计划 Trip「${room.title}」。\n\n` +
        `告诉我你对这次行程的偏好（预算、住哪区、想吃什么、想玩啥、出行时间偏好等），` +
        `我会把你们每个人的想法综合起来出方案。你说的内容只有你自己能看到，我只会把汇总后的方案发到群里。`;
      for (const invitedId of invitedUserIds) {
        try {
          await insertPrivateMessage({
            roomId: room.id,
            userId: invitedId,
            role: "assistant",
            content: invitedWelcome,
          });
        } catch (err) {
          console.warn(`[chat/commit] seed invited welcome failed for ${invitedId}`, err);
        }
      }

      return NextResponse.json({
        ok: true,
        kind: "room",
        id: room.id,
        short_code: room.short_code,
        // Chat-flow rooms live on the homepage under ?room_id=<id>; NOT
        // /rooms/<id> (the legacy form-based UI). See also rooms/join page,
        // which redirects chat-flow joiners here instead of /rooms/<id>.
        url: `/?room_id=${room.id}`,
        invite_url: room.short_code ? `/rooms/join/${room.short_code}` : null,
        title: room.title,
        room_type: "trip",
        flow: "chat",
        categories: room.categories,
        invited_user_ids: invitedUserIds,
        unresolved_names: unresolvedNames,
      });
    }

    // Solo trip handoff (intent==="create_plan" + scenario==="trip"). Mark
    // the session completed so the sidebar shows it under "Completed".
    const tripIncomingSessionId =
      typeof b.session_id === "string" && b.session_id.trim() ? b.session_id.trim() : null;
    if (tripIncomingSessionId) {
      try {
        await markSessionUpgradedTrip(tripIncomingSessionId, userId);
      } catch (err) {
        console.warn(`[chat/commit] markSessionUpgradedTrip failed for session=${tripIncomingSessionId}`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      kind: "trip",
      trip_state: state,
      search_query: originalMessage || buildTripSummary(state),
    });
  }

  if (intent === "create_room") {
    if (!scenario) {
      return NextResponse.json(
        { error: "Rooms require a concrete scenario (restaurant/hotel/flight/activity/trip)" },
        { status: 400 }
      );
    }
    const roomType = scenario as DecisionRoomType;
    if (!ALLOWED_ROOM_TYPES.includes(roomType)) {
      return NextResponse.json({ error: `unsupported room type ${roomType}` }, { status: 400 });
    }

    const context = buildRoomContext(roomType, constraints, memberNames);
    const title = buildRoomTitle(roomType, constraints, memberNames, originalMessage);

    const approvalRule: ApprovalRule =
      typeof b.approval_rule === "string" && ALLOWED_RULES.includes(b.approval_rule as ApprovalRule)
        ? (b.approval_rule as ApprovalRule)
        : "unanimous";

    const id = randomUUID();
    const room = await createDecisionRoom({
      id,
      type: roomType,
      title,
      creatorId: userId,
      payerId: userId,
      contextJson: context,
      approvalRule,
    });

    // P1-09: seed the creator's personal constraint row with whatever taste
    // hints the NLU captured (cuisine likes, budget, vibe, ...). Left as
    // submitted=false so the creator still clicks "Submit" on the room page —
    // this way the seed is an aid, not a stealth auto-submit.
    const seed = buildCreatorConstraintSeed(roomType, constraints);
    if (seed) {
      try {
        await upsertRoomConstraint(room.id, userId, seed, false);
      } catch (err) {
        // Non-fatal: the user can still fill in the editor manually.
        console.warn("[chat/commit] seed creator constraint failed", err);
      }
    }

    return NextResponse.json({
      ok: true,
      kind: "room",
      id: room.id,
      short_code: room.short_code,
      url: `/rooms/${room.id}`,
      invite_url: room.short_code ? `/rooms/join/${room.short_code}` : null,
      title: room.title,
    });
  }

  if (intent === "create_plan") {
    if (!scenario) {
      return NextResponse.json(
        { error: "Plans require a scenario to be set" },
        { status: 400 }
      );
    }

    // ── US-W5: direct-booking shortcut ──────────────────────────────────
    // When NLU set direct_booking=true, the user named one specific venue
    // (restaurant_name / hotel_name in collected_constraints). Skip the LLM
    // recommendation pass entirely — emit a kind="direct_booking" payload
    // that the client uses to POST /api/booking-jobs straight away with a
    // step pointing at that exact venue.
    //
    // Decision Rooms (intent==="create_room") deliberately do NOT take this
    // shortcut even when the creator names a venue — co-deciders need to
    // see/vote on the option, so we keep the recommendation path for them.
    const directBookingFlag =
      typeof (nluRaw as { direct_booking?: boolean }).direct_booking === "boolean"
        ? Boolean((nluRaw as { direct_booking?: boolean }).direct_booking)
        : false;
    if (directBookingFlag) {
      const directPayload = buildDirectBookingPayload(scenario, constraints);
      if (directPayload) return NextResponse.json(directPayload);
      // Fall through if we couldn't build the step (e.g. flag set but no
      // restaurant_name in constraints — defensive guard, shouldn't happen).
    }

    // Plan committed — flag the session as completed so the sidebar moves it
    // from Drafts to Completed (Q3 a: plan creation is the moment the user's
    // exploration converges; everything after is "actioning the result").
    const planIncomingSessionId =
      typeof b.session_id === "string" && b.session_id.trim() ? b.session_id.trim() : null;
    if (planIncomingSessionId) {
      try {
        await markSessionUpgradedPlan(planIncomingSessionId, userId, scenario);
      } catch (err) {
        console.warn(`[chat/commit] markSessionUpgradedPlan failed for session=${planIncomingSessionId}`, err);
      }
    }

    // Hand off to the existing chat pipeline — the client will call /api/chat
    // with this query and constraints and let runAgent persist the plan.
    return NextResponse.json({
      ok: true,
      kind: "plan",
      scenario,
      search_query: originalMessage || buildPlanQueryFromConstraints(scenario, constraints),
      constraints,
    });
  }

  return NextResponse.json({ error: "unhandled intent" }, { status: 400 });
}

// ── US-W5: direct-booking payload builder ────────────────────────────────
// Mirrors the BookingJobStep shape that RecommendationCard.handleReserve
// posts to /api/booking-jobs. The client fills in profileId + profile from
// /api/user/booking-profiles?default=true before posting (we don't have
// the user's profile here on the server side of /api/chat/commit anyway).

interface DirectBookingPayload {
  ok: true;
  kind: "direct_booking";
  scenario: "restaurant" | "hotel";
  venue_name: string;
  booking_step: {
    type: "restaurant" | "hotel";
    emoji: string;
    label: string;
    apiEndpoint: "/api/booking-jobs/start";
    body: Record<string, unknown>;
    status: "pending";
  };
}

function buildDirectBookingPayload(
  scenario: ConversationalScenario,
  constraints: Record<string, unknown>,
): DirectBookingPayload | null {
  if (scenario === "restaurant") {
    const name = readString(constraints, "restaurant_name");
    if (!name) return null;
    const city = readString(constraints, "city") ?? "";
    const date = readString(constraints, "date");
    const time = readString(constraints, "time");
    const covers = readNumber(constraints, "party_size", "covers", "guests") ?? 2;
    const body: Record<string, unknown> = {
      restaurantName: name,
      city,
      covers,
    };
    if (date) body.date = date;
    if (time) body.time = time;
    return {
      ok: true,
      kind: "direct_booking",
      scenario: "restaurant",
      venue_name: name,
      booking_step: {
        type: "restaurant",
        emoji: "\u{1F37D}️",
        label: name,
        apiEndpoint: "/api/booking-jobs/start",
        body,
        status: "pending",
      },
    };
  }
  if (scenario === "hotel") {
    const name = readString(constraints, "hotel_name");
    if (!name) return null;
    const city = readString(constraints, "city") ?? "";
    const checkIn = readString(constraints, "check_in", "date");
    const checkOut = readString(constraints, "check_out", "date_to");
    const guests = readNumber(constraints, "guests", "party_size") ?? 2;
    const body: Record<string, unknown> = {
      hotelName: name,
      city,
      guests,
    };
    if (checkIn) body.checkIn = checkIn;
    if (checkOut) body.checkOut = checkOut;
    return {
      ok: true,
      kind: "direct_booking",
      scenario: "hotel",
      venue_name: name,
      booking_step: {
        type: "hotel",
        emoji: "\u{1F3E8}",
        label: name,
        apiEndpoint: "/api/booking-jobs/start",
        body,
        status: "pending",
      },
    };
  }
  return null;
}

/**
 * Map the NLU's free-form collected_constraints object into a TripIntentState
 * suitable for getMissingFields / the downstream planner. Tolerates several
 * key aliases because the LLM surfaces constraints inconsistently across
 * languages and turns.
 */
function collectedConstraintsToTripState(
  c: Record<string, unknown>
): TripIntentState {
  const state: TripIntentState = emptyTripState();

  const destination = readString(
    c,
    "destination_city",
    "city",
    "hotel_city",
    "arrival_city",
    "destination"
  );
  if (destination) state.destination_city = destination;

  const origin = readString(c, "departure_city", "origin", "origin_city", "from_city");
  if (origin) state.departure_city = origin;

  // Dates arrive from the NLU as relative strings ("next Saturday", "next
  // weekend", "tomorrow"). Resolve them to ISO YYYY-MM-DD here so downstream
  // date math stays safe. Keep the raw string in state.planning_assumptions
  // so the planner can mention "per your ‘next weekend' request" later.
  const rawStart = readString(c, "start_date", "check_in", "departure_date", "date_from", "date");
  const rawEnd = readString(c, "end_date", "check_out", "return_date", "date_to");
  const today = new Date();
  const resolvedStart = resolveDateHint(rawStart, today);
  if (resolvedStart) {
    state.start_date = resolvedStart;
    if (rawStart && rawStart !== resolvedStart) {
      state.planning_assumptions.push(`Interpreted "${rawStart}" as ${resolvedStart}.`);
    }
  }
  const resolvedEnd = resolveDateHint(rawEnd, today);
  if (resolvedEnd) {
    state.end_date = resolvedEnd;
    if (rawEnd && rawEnd !== resolvedEnd) {
      state.planning_assumptions.push(`Interpreted "${rawEnd}" as ${resolvedEnd}.`);
    }
  }

  const nights = readNumber(c, "nights", "duration_nights", "trip_duration_days");
  if (nights != null) state.nights = nights;

  const travelers = readNumber(c, "travelers", "party_size", "passengers", "guests", "num_people");
  if (travelers != null) state.travelers = travelers;

  const stars = readNumber(c, "hotel_star_rating", "stars", "min_stars", "star_rating_min");
  if (stars != null) state.hotel_star_rating = stars;

  const neighborhood = readString(c, "hotel_neighborhood", "neighborhood", "area");
  if (neighborhood) state.hotel_neighborhood = neighborhood;

  const vibeRaw = readString(c, "vibe", "tier", "budget_tier");
  const vibe = normalizeVibe(vibeRaw);
  if (vibe) state.vibe = vibe;

  const budgetTotal = readNumber(c, "budget_total", "total_budget");
  if (budgetTotal != null) state.budget_total = budgetTotal;

  const activities = c.activities;
  if (Array.isArray(activities)) {
    state.activities = activities
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim());
  }

  const cuisines =
    (Array.isArray(c.cuisine_preferences) && c.cuisine_preferences) ||
    (Array.isArray(c.cuisines) && c.cuisines) ||
    null;
  if (cuisines) {
    state.cuisine_preferences = cuisines
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim());
  }

  return state;
}

function normalizeVibe(raw: string | null): TripVibe | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("upscale") || s.includes("luxury") || s.includes("5-star") || s.includes("五星")) {
    return "upscale";
  }
  if (s.includes("trendy") || s.includes("hip") || s.includes("cool") || s.includes("时髦")) {
    return "trendy";
  }
  if (s.includes("local") || s.includes("authentic") || s.includes("neighborhood") || s.includes("本地")) {
    return "local";
  }
  if (s.includes("mid") || s.includes("mixed") || s.includes("mid budget") || s.includes("中等")) {
    return "mixed";
  }
  return null;
}

/**
 * Title for a Stage 2 multi-party trip room. Prefers a short, human-friendly
 * form like "NY trip with 李明, 张三" or "3-night Tokyo trip".
 */
function buildTripRoomTitle(state: TripIntentState, memberNames: string[]): string {
  const who = memberNames.slice(0, 2).join(", ") + (memberNames.length > 2 ? " +" : "");
  const city = state.destination_city ?? "trip";
  const nights = state.nights ? `${state.nights}-night ` : "";
  const base = `${nights}${city} trip`.trim();
  return who ? `${base} with ${who}` : base;
}

function buildTripSummary(state: TripIntentState): string {
  const parts: string[] = ["Plan a trip"];
  if (state.nights) parts.push(`${state.nights}-night`);
  if (state.destination_city) parts.push(`to ${state.destination_city}`);
  if (state.departure_city) parts.push(`from ${state.departure_city}`);
  if (state.travelers) parts.push(`for ${state.travelers} ${state.travelers === 1 ? "person" : "people"}`);
  if (state.start_date) parts.push(`starting ${state.start_date}`);
  return parts.join(" ");
}

function buildPlanQueryFromConstraints(
  scenario: ConversationalScenario,
  constraints: Record<string, unknown>
): string {
  const city = readString(constraints, "city", "hotel_city", "arrival_city");
  const date = readString(constraints, "date", "check_in", "departure_date");
  const cuisine = readString(constraints, "cuisine", "cuisine_hint");
  const pieces: string[] = [];
  if (scenario === "restaurant") {
    pieces.push(cuisine ? `Find a ${cuisine} restaurant` : "Find a restaurant");
  } else if (scenario === "hotel") {
    pieces.push("Find a hotel");
  } else if (scenario === "flight") {
    pieces.push("Find a flight");
  } else if (scenario === "activity") {
    pieces.push("Find something to do");
  } else {
    pieces.push("Plan a trip");
  }
  if (city) pieces.push(`in ${city}`);
  if (date) pieces.push(`on ${date}`);
  return pieces.join(" ").trim();
}
