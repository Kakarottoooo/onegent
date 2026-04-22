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
  type ApprovalRule,
  type DecisionRoomType,
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
} from "@/lib/conversational-nlu";

export const maxDuration = 30;

const ALLOWED_ROOM_TYPES: DecisionRoomType[] = ["restaurant", "hotel", "flight", "activity"];
const ALLOWED_RULES: ApprovalRule[] = ["unanimous", "majority"];

function parseIntent(value: unknown): ConversationalIntent | null {
  const allowed: ConversationalIntent[] = [
    "create_plan",
    "create_room",
    "refine_existing",
    "chitchat",
    "other",
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

  if (intent === "chitchat" || intent === "other") {
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

  if (intent === "create_room") {
    if (!scenario || scenario === "trip") {
      return NextResponse.json(
        { error: "Rooms require a concrete scenario (restaurant/hotel/flight/activity)" },
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
