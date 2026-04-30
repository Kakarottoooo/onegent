/**
 * Scenario synthesis for chat-flow Decision Rooms (non-trip).
 *
 * Trip rooms have their own buildTripPackage flow (see trip-synthesis.ts) —
 * this file is the lighter-weight equivalent for restaurant / hotel /
 * flight / activity rooms. Each member chats with the agent privately;
 * this function reads all their IntentStates and merges them into a
 * single search query that the legacy /api/chat recommendation pipeline
 * can consume.
 *
 * Non-goals (intentionally not handled here, defer to follow-ups):
 *   - Voting / approval / decision recording (use existing card vote infra)
 *   - Conflict surfacing ("you wanted Italian, they wanted sushi") — the
 *     merge is "union, then trust the agent's recommendation pass" for now
 *   - Per-scenario specialised optimisation (e.g. flight cheapest-finder)
 */
import { randomUUID } from "crypto";
import {
  createRoomProposal,
  getDecisionRoomById,
  insertPrivateMessage,
  listActiveProposals,
  listMemberIntentStates,
  listRoomMembers,
  type DecisionRoomType,
} from "@/lib/db";
import { runAgent } from "@/lib/agent";
import type { CategoryType } from "@/lib/types";

export interface ScenarioSynthesis {
  /** Free-text search query the legacy /api/chat agent will consume. */
  query: string;
  /** Pre-merged constraints object — kept for future per-scenario
   *  optimisations (e.g. "all members hate cilantro, pre-filter that"). */
  merged: Record<string, unknown>;
  /** Member contribution stats — used by the chat reply ("综合了 N 位
   *  成员的偏好"). */
  contributorCount: number;
  memberCount: number;
}

export interface ScenarioSynthesisOutcome {
  status: "ok" | "no_room" | "wrong_type" | "no_joined_members" | "waiting_for_members";
  result: ScenarioSynthesis | null;
}

const NON_TRIP_TYPES: DecisionRoomType[] = ["restaurant", "hotel", "flight", "activity"];

/**
 * Run synthesis for a non-trip chat-flow room. Reads each member's
 * IntentState, merges them, and returns a search query.
 *
 * `force=true` skips the "all members contributed" gate — used by manual
 * triggers ("出方案") where the user wants to see options even if a
 * straggler hasn't chatted yet (the merge just uses what's available).
 */
export async function synthesizeScenarioRoom(
  roomId: string,
  opts: { force?: boolean } = {},
): Promise<ScenarioSynthesisOutcome> {
  const room = await getDecisionRoomById(roomId).catch(() => null);
  if (!room) return { status: "no_room", result: null };
  if (!NON_TRIP_TYPES.includes(room.type)) {
    return { status: "wrong_type", result: null };
  }

  const [members, intentRows] = await Promise.all([
    listRoomMembers(roomId),
    listMemberIntentStates(roomId),
  ]);
  const joined = members.filter((m) => m.status === "joined");
  if (joined.length === 0) {
    return { status: "no_joined_members", result: null };
  }

  if (!opts.force) {
    const contributorIds = new Set(intentRows.map((r) => r.user_id));
    const allContributed = joined.every((m) => contributorIds.has(m.user_id));
    if (!allContributed) {
      return { status: "waiting_for_members", result: null };
    }
  }

  // Pull each member's scenario sub-object.
  const subs: Array<Record<string, unknown>> = [];
  for (const row of intentRows) {
    const state = row.intent_state_json as Record<string, unknown> | null;
    if (!state || typeof state !== "object") continue;
    const sub = state[room.type];
    if (sub && typeof sub === "object") {
      subs.push(sub as Record<string, unknown>);
    }
  }

  const merged = mergeSubObjects(room.type, subs);
  const query = buildSearchQuery(room.type, merged);

  return {
    status: "ok",
    result: {
      query,
      merged,
      contributorCount: intentRows.length,
      memberCount: joined.length,
    },
  };
}

// ─── Per-scenario merge ──────────────────────────────────────────────────
// Naive but useful: union arrays, take first-non-null for text, min for
// budget caps, max for party_size. The recommendation agent downstream
// gets fuzzy enough constraints to find options that satisfy everyone.

function mergeSubObjects(
  type: DecisionRoomType,
  subs: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (subs.length === 0) return {};
  if (subs.length === 1) return { ...subs[0] };

  const out: Record<string, unknown> = {};

  if (type === "restaurant") {
    // Text: prefer the first member's value (creator-priority).
    pickFirstString(out, subs, ["city", "date", "time", "neighborhood", "vibe"]);
    // Counts: max (the bigger party wins so everyone fits).
    pickMaxNumber(out, subs, ["party_size"]);
    // Budget: min (so we don't blow past anyone's cap).
    pickMinNumber(out, subs, ["budget_per_person"]);
    // Cuisine: cardinal — if all members agree on one, use it; else union as
    // an array on `cuisines_like` (the search query embeds it as text).
    const cuisines = unionStrings(subs, "cuisine");
    if (cuisines.length === 1) out.cuisine = cuisines[0];
    else if (cuisines.length > 1) out.cuisines_like = cuisines;
    // Dietary union — every member's restrictions are honored.
    const dietary = unionArrays(subs, "dietary");
    if (dietary.length > 0) out.dietary = dietary;
  } else if (type === "hotel") {
    pickFirstString(out, subs, ["city", "check_in", "check_out", "neighborhood", "vibe"]);
    pickMaxNumber(out, subs, ["nights", "guests"]);
    // Budget: min per night.
    pickMinNumber(out, subs, ["budget_max_per_night"]);
    // Star rating: max (highest standard among members).
    pickMaxNumber(out, subs, ["star_rating"]);
    // Amenities: union (all-of, since hotels can have many).
    const amenities = unionArrays(subs, "amenities");
    if (amenities.length > 0) out.amenities = amenities;
  } else if (type === "flight") {
    pickFirstString(out, subs, ["origin", "dest", "date", "return_date"]);
    pickMaxNumber(out, subs, ["passengers"]);
    // Cabin: max (highest tier requested wins, so the most comfortable
    // member's request is honored). Order: economy < premium_economy <
    // business < first.
    const cabin = maxCabin(subs);
    if (cabin) out.cabin_class = cabin;
    // is_round_trip: if any member explicitly wanted round-trip, use it.
    for (const s of subs) {
      if (s.is_round_trip === true) {
        out.is_round_trip = true;
        break;
      }
    }
  } else if (type === "activity") {
    pickFirstString(out, subs, ["event_name", "event_type", "city", "event_date"]);
    pickMaxNumber(out, subs, ["num_tickets"]);
    pickMinNumber(out, subs, ["budget_max_per_ticket"]);
  }

  return out;
}

// ─── Search query builder ────────────────────────────────────────────────

function buildSearchQuery(
  type: DecisionRoomType,
  merged: Record<string, unknown>,
): string {
  const bits: string[] = [];
  if (type === "restaurant") {
    const cuisine = readStr(merged, "cuisine");
    const cuisinesLike = readStringArray(merged, "cuisines_like");
    const city = readStr(merged, "city");
    const date = readStr(merged, "date");
    const time = readStr(merged, "time");
    const partySize = readNum(merged, "party_size");
    const budget = readNum(merged, "budget_per_person");
    const dietary = readStringArray(merged, "dietary");
    const neighborhood = readStr(merged, "neighborhood");
    const vibe = readStr(merged, "vibe");

    if (cuisine) bits.push(cuisine);
    else if (cuisinesLike.length > 0) bits.push(cuisinesLike.join(" or "));
    bits.push("restaurant");
    if (city) bits.push(`in ${city}`);
    if (neighborhood) bits.push(`(${neighborhood})`);
    if (date) bits.push(`on ${date}`);
    if (time) bits.push(`at ${time}`);
    if (partySize) bits.push(`for ${partySize}`);
    if (budget) bits.push(`under $${budget}/person`);
    if (vibe) bits.push(vibe);
    if (dietary.length > 0) bits.push(`(${dietary.join(", ")})`);
  } else if (type === "hotel") {
    const stars = readNum(merged, "star_rating");
    const city = readStr(merged, "city");
    const checkIn = readStr(merged, "check_in");
    const checkOut = readStr(merged, "check_out");
    const nights = readNum(merged, "nights");
    const guests = readNum(merged, "guests");
    const budgetMax = readNum(merged, "budget_max_per_night");
    const neighborhood = readStr(merged, "neighborhood");
    const amenities = readStringArray(merged, "amenities");

    if (stars) bits.push(`${stars}-star`);
    bits.push("hotel");
    if (city) bits.push(`in ${city}`);
    if (neighborhood) bits.push(`(${neighborhood})`);
    if (checkIn && checkOut) bits.push(`${checkIn} to ${checkOut}`);
    else if (checkIn && nights) bits.push(`from ${checkIn}, ${nights} nights`);
    if (guests) bits.push(`${guests} guests`);
    if (budgetMax) bits.push(`under $${budgetMax}/night`);
    if (amenities.length > 0) bits.push(`with ${amenities.join(", ")}`);
  } else if (type === "flight") {
    const origin = readStr(merged, "origin");
    const dest = readStr(merged, "dest");
    const date = readStr(merged, "date");
    const returnDate = readStr(merged, "return_date");
    const passengers = readNum(merged, "passengers");
    const cabin = readStr(merged, "cabin_class");
    const isRoundTrip = merged.is_round_trip === true;

    bits.push("flight");
    if (origin && dest) bits.push(`from ${origin} to ${dest}`);
    else if (origin) bits.push(`from ${origin}`);
    else if (dest) bits.push(`to ${dest}`);
    if (date && returnDate) bits.push(`${date} returning ${returnDate}`);
    else if (date) bits.push(`on ${date}${isRoundTrip ? " round-trip" : ""}`);
    if (passengers) bits.push(`${passengers} passengers`);
    if (cabin) bits.push(`${cabin.replace("_", " ")} class`);
  } else if (type === "activity") {
    const eventName = readStr(merged, "event_name");
    const eventType = readStr(merged, "event_type");
    const city = readStr(merged, "city");
    const date = readStr(merged, "event_date");
    const numTickets = readNum(merged, "num_tickets");
    const budgetMax = readNum(merged, "budget_max_per_ticket");

    if (eventName) bits.push(eventName);
    else if (eventType) bits.push(eventType);
    if (city) bits.push(`in ${city}`);
    if (date) bits.push(`on ${date}`);
    if (numTickets) bits.push(`${numTickets} tickets`);
    if (budgetMax) bits.push(`under $${budgetMax}/ticket`);
  }

  return bits.filter((s) => s.trim().length > 0).join(" ").trim() || "options";
}

// ─── Tiny readers ───────────────────────────────────────────────────────

function readStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function readNum(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function pickFirstString(
  out: Record<string, unknown>,
  subs: Array<Record<string, unknown>>,
  keys: string[],
): void {
  for (const k of keys) {
    for (const s of subs) {
      const v = readStr(s, k);
      if (v) {
        out[k] = v;
        break;
      }
    }
  }
}

function pickMaxNumber(
  out: Record<string, unknown>,
  subs: Array<Record<string, unknown>>,
  keys: string[],
): void {
  for (const k of keys) {
    let best: number | null = null;
    for (const s of subs) {
      const v = readNum(s, k);
      if (v !== null && (best === null || v > best)) best = v;
    }
    if (best !== null) out[k] = best;
  }
}

function pickMinNumber(
  out: Record<string, unknown>,
  subs: Array<Record<string, unknown>>,
  keys: string[],
): void {
  for (const k of keys) {
    let best: number | null = null;
    for (const s of subs) {
      const v = readNum(s, k);
      if (v !== null && (best === null || v < best)) best = v;
    }
    if (best !== null) out[k] = best;
  }
}

function unionStrings(
  subs: Array<Record<string, unknown>>,
  key: string,
): string[] {
  const set = new Set<string>();
  for (const s of subs) {
    const v = readStr(s, key);
    if (v) set.add(v);
  }
  return Array.from(set);
}

function unionArrays(
  subs: Array<Record<string, unknown>>,
  key: string,
): string[] {
  const set = new Set<string>();
  for (const s of subs) {
    for (const v of readStringArray(s, key)) {
      set.add(v);
    }
  }
  return Array.from(set);
}

function maxCabin(subs: Array<Record<string, unknown>>): string | null {
  const order = ["economy", "premium_economy", "business", "first"];
  let bestIdx = -1;
  for (const s of subs) {
    const c = readStr(s, "cabin_class");
    if (!c) continue;
    const i = order.indexOf(c);
    if (i > bestIdx) bestIdx = i;
  }
  return bestIdx >= 0 ? order[bestIdx] : null;
}

// ─── Server-side end-to-end: search → proposal row ──────────────────────
// Why this exists: previously each member's CLIENT independently posted
// the merged query to /api/chat. The LLM is non-deterministic so two
// users in the same DR saw DIFFERENT card lists (5 vs 3 restaurants),
// and there was no shared row to vote on. Trip rooms already solved this
// via decision_room_proposals (createRoomProposal in trip-synthesis.ts);
// this is the parallel for restaurant/hotel/flight/activity DRs.

export type ScenarioProposalStatus =
  | "ok"
  | "no_room"
  | "wrong_type"
  | "no_joined_members"
  | "waiting_for_members"
  | "search_failed";

export interface ScenarioProposalOutcome {
  status: ScenarioProposalStatus;
  /** When status==='ok': id of the proposal row everyone reads. */
  proposalId?: string;
  /** True when an existing proposal was returned (race-loser or repeat call). */
  alreadyExists?: boolean;
  /** Synthesis stats — when present, surfaces "merged from N members" copy. */
  result?: ScenarioSynthesis | null;
}

/** Return the active scenario_search_cards proposal for a room, or null. */
async function findActiveScenarioProposal(roomId: string) {
  const proposals = await listActiveProposals(roomId).catch(() => []);
  return (
    proposals.find(
      (p) =>
        (p.status === "active" || p.status === "accepted") &&
        typeof p.content_json === "object" &&
        p.content_json !== null &&
        (p.content_json as Record<string, unknown>).kind === "scenario_search_cards",
    ) ?? null
  );
}

/** Pull the cards array out of runAgent's union return shape. */
function pickCards(
  type: DecisionRoomType,
  agentResult: Awaited<ReturnType<typeof runAgent>>,
): unknown[] {
  if (type === "restaurant") return agentResult.recommendations;
  if (type === "hotel") return agentResult.hotelRecommendations;
  if (type === "flight") return agentResult.flightRecommendations;
  if (type === "activity") return agentResult.activityRecommendations;
  return [];
}

/**
 * End-to-end synthesis for a non-trip DR: merge constraints → run search
 * server-side → land the cards in a single shared proposal row → seed a
 * marker into every joined member's private channel so their replay
 * shows the same card list.
 *
 * Idempotent: if an active scenario_search_cards proposal already exists
 * for the room, returns that row's id without re-running the LLM. Two
 * concurrent callers race-protected via re-check after runAgent (small
 * window — no advisory lock yet, fine for low-collision MVP).
 */
export async function synthesizeAndCreateScenarioProposal(
  roomId: string,
  opts: { force?: boolean } = {},
): Promise<ScenarioProposalOutcome> {
  // Idempotency check FIRST — repeat calls (page refresh, second member
  // also auto-firing) just return the existing row.
  const pre = await findActiveScenarioProposal(roomId);
  if (pre) return { status: "ok", proposalId: pre.id, alreadyExists: true, result: null };

  const synth = await synthesizeScenarioRoom(roomId, opts);
  if (synth.status !== "ok" || !synth.result) {
    return { status: synth.status, result: null };
  }

  const room = await getDecisionRoomById(roomId).catch(() => null);
  if (!room) return { status: "no_room", result: null };

  // Server-side LLM search. The categoryHint pin is critical — without it
  // the agent re-classifies and may pick the wrong pipeline (e.g. a
  // "flight from NYC" merged query in a restaurant room).
  let agentResult: Awaited<ReturnType<typeof runAgent>>;
  try {
    agentResult = await runAgent(
      synth.result.query,
      [],
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      room.type as CategoryType,
    );
  } catch (err) {
    console.warn(`[scenario-synthesis] runAgent failed for ${roomId}:`, err);
    return { status: "search_failed", result: synth.result };
  }

  const cards = pickCards(room.type, agentResult);
  if (!cards || cards.length === 0) {
    return { status: "search_failed", result: synth.result };
  }

  // Race re-check: another caller may have inserted while we were
  // running runAgent (~10s window).
  const post = await findActiveScenarioProposal(roomId);
  if (post) {
    return { status: "ok", proposalId: post.id, alreadyExists: true, result: synth.result };
  }

  const proposalId = randomUUID();
  const contentJson: Record<string, unknown> = {
    kind: "scenario_search_cards",
    category: room.type,
    cards,
    query: synth.result.query,
    output_language: agentResult.output_language,
    contributor_count: synth.result.contributorCount,
    member_count: synth.result.memberCount,
  };

  try {
    await createRoomProposal({
      id: proposalId,
      roomId,
      contentJson,
      rationale: `Synthesized from ${synth.result.contributorCount} member${
        synth.result.contributorCount === 1 ? "" : "s"
      }' chat preferences`,
      conflictsJson: null,
    });
  } catch (err) {
    console.warn(`[scenario-synthesis] createRoomProposal failed`, err);
    return { status: "search_failed", result: synth.result };
  }

  // Seed the inline-card marker into every joined member's private
  // channel — same pattern as trip-synthesis. The client's replay code
  // detects kind === 'scenario_proposal_card' and renders cards from the
  // proposal row instead of a plain text bubble.
  try {
    const members = await listRoomMembers(roomId);
    const cardContent = "✅ 方案已出！下方卡片选你的偏好，看看大家投谁。";
    const cardMeta = {
      kind: "scenario_proposal_card" as const,
      proposal_id: proposalId,
      room_id: roomId,
      category: room.type,
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
        console.warn(`[scenario-synthesis] seed marker for ${m.user_id} failed`, err);
      }
    }
  } catch (err) {
    console.warn(`[scenario-synthesis] marker-seed phase failed`, err);
  }

  return { status: "ok", proposalId, alreadyExists: false, result: synth.result };
}
