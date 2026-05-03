import type { ChatMessage } from "@/lib/llm-client";
import type { ConversationalNLUResult } from "@/lib/agent/nlu-v2";
import type {
  Message,
  RecommendationCard,
  HotelRecommendationCard,
  FlightRecommendationCard,
  ActivityRecommendationCard,
  CategoryType,
  OutputLanguage,
} from "@/lib/types";

/** Replay-payload meta_json for search-card results — written by the
 *  homepage persist callback after /api/chat streams cards back, read
 *  here on sidebar navigation / refresh. Each field is optional (a row
 *  carries the kind that fired). */
interface SearchCardsMetaJson {
  kind: "search_cards";
  cards?: RecommendationCard[];
  hotelCards?: HotelRecommendationCard[];
  flightCards?: FlightRecommendationCard[];
  activityCards?: ActivityRecommendationCard[];
  category?: CategoryType;
  output_language?: OutputLanguage;
}

export interface PendingConfirmSnapshot {
  kind: "room" | "plan" | "trip";
  nlu: ConversationalNLUResult;
  message: string;
  mentioned_user_ids?: string[];
}

export interface PersistedDirectBookingPayload {
  kind: "direct_booking";
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

export interface InlineBookingProfileSnapshot {
  id: number | null;
  venueName: string;
  payload: PersistedDirectBookingPayload;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  missing: string[];
}

interface PendingConfirmMetaJson {
  kind: "pending_confirm_state";
  state: "open" | "closed";
  confirm?: PendingConfirmSnapshot | null;
}

interface InlineBookingProfileMetaJson {
  kind: "inline_booking_profile_state";
  state: "open" | "closed";
  gate?: InlineBookingProfileSnapshot | null;
}

type ReplayMetaJson =
  | { kind?: string; proposal_id?: string }
  | SearchCardsMetaJson
  | PendingConfirmMetaJson
  | InlineBookingProfileMetaJson
  | Record<string, unknown>
  | null;

export interface SessionReplayRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  nlu_state?: unknown | null;
  meta_json?: ReplayMetaJson;
  created_at: string;
}

export interface RoomReplayRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta_json: ReplayMetaJson;
  created_at: string;
}

export interface SessionReplaySnapshot {
  title: string | null;
  messages: Message[];
  nluHistory: ChatMessage[];
  lastNluState: unknown | null;
  pendingConfirm: PendingConfirmSnapshot | null;
  inlineBookingProfile: InlineBookingProfileSnapshot | null;
}

export interface RoomReplaySnapshot {
  messages: Message[];
  nluHistory: ChatMessage[];
  proposalId: string | null;
  /** Which kind of proposal lives at proposalId — drives which inline card
   *  component the page renders (TripProposalChatCard vs
   *  ScenarioProposalChatCard). null when no proposal marker was seen. */
  proposalKind: "trip" | "scenario" | null;
}

/** Type guard — narrows an arbitrary meta_json blob to the
 *  search-card-bearing shape that we wrote on persist. Defends against
 *  legacy rows where meta_json carries other kinds. */
function isSearchCardsMeta(meta: ReplayMetaJson): meta is SearchCardsMetaJson {
  return !!meta && typeof meta === "object" && (meta as { kind?: unknown }).kind === "search_cards";
}

function isPendingConfirmMeta(meta: ReplayMetaJson): meta is PendingConfirmMetaJson {
  return !!meta && typeof meta === "object" && (meta as { kind?: unknown }).kind === "pending_confirm_state";
}

function isInlineBookingProfileMeta(meta: ReplayMetaJson): meta is InlineBookingProfileMetaJson {
  return !!meta && typeof meta === "object" && (meta as { kind?: unknown }).kind === "inline_booking_profile_state";
}

/** Reconstruct an inline-rendered Message from a persisted row, hydrating
 *  any search-card payload that was saved alongside the text bubble. The
 *  base shape stays identical for plain-text rows so the rest of the
 *  replay code keeps working unchanged. */
function rowToMessage(
  role: "user" | "assistant",
  content: string,
  meta: ReplayMetaJson,
): Message | null {
  if (isPendingConfirmMeta(meta) || isInlineBookingProfileMeta(meta)) return null;
  const base: Message = { role, content };
  if (!isSearchCardsMeta(meta)) return base;
  if (meta.cards) base.cards = meta.cards;
  if (meta.hotelCards) base.hotelCards = meta.hotelCards;
  if (meta.flightCards) base.flightCards = meta.flightCards;
  if (meta.activityCards) base.activityCards = meta.activityCards;
  if (meta.category) base.category = meta.category;
  if (meta.output_language) base.output_language = meta.output_language;
  return base;
}

export function buildSessionReplaySnapshot(params: {
  session?: { title?: string } | null;
  messages?: SessionReplayRow[] | null;
}): SessionReplaySnapshot {
  const rows = params.messages ?? [];
  const messages: Message[] = [];
  const nluHistory: ChatMessage[] = rows
    .filter((row) => {
      const meta = row.meta_json ?? null;
      return !isPendingConfirmMeta(meta) && !isInlineBookingProfileMeta(meta);
    })
    .slice(-20)
    .map((row) => ({
      role: row.role,
      content: row.content,
    }));
  let pendingConfirm: PendingConfirmSnapshot | null = null;
  let inlineBookingProfile: InlineBookingProfileSnapshot | null = null;

  for (const row of rows) {
    const meta = row.meta_json ?? null;
    if (isPendingConfirmMeta(meta)) {
      pendingConfirm = meta.state === "open" ? meta.confirm ?? null : null;
      continue;
    }
    if (isInlineBookingProfileMeta(meta)) {
      inlineBookingProfile = meta.state === "open" ? meta.gate ?? null : null;
      continue;
    }
    const msg = rowToMessage(row.role, row.content, meta);
    if (msg) messages.push(msg);
  }

  let lastNluState: unknown | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.role === "assistant" && row.nlu_state) {
      lastNluState = row.nlu_state;
      break;
    }
  }

  return {
    title: params.session?.title ?? null,
    messages,
    nluHistory,
    lastNluState,
    pendingConfirm,
    inlineBookingProfile,
  };
}

export function buildRoomReplaySnapshot(rows?: RoomReplayRow[] | null): RoomReplaySnapshot {
  const messages: Message[] = [];
  const nluHistory: ChatMessage[] = [];
  let proposalId: string | null = null;
  let proposalKind: "trip" | "scenario" | null = null;

  for (const row of rows ?? []) {
    const meta = row.meta_json ?? null;
    const kind =
      meta && typeof meta === "object"
        ? (meta as { kind?: unknown }).kind
        : null;
    const pid =
      meta && typeof meta === "object"
        ? (meta as { proposal_id?: unknown }).proposal_id
        : null;
    if (
      (kind === "trip_proposal_card" || kind === "scenario_proposal_card") &&
      typeof pid === "string"
    ) {
      // Last marker wins — force re-synthesis appends a newer marker after
      // the older one, and we want the most recent proposal on screen.
      proposalId = pid;
      proposalKind = kind === "trip_proposal_card" ? "trip" : "scenario";
      continue;
    }

    const role = row.role === "user" ? "user" : "assistant";
    const msg = rowToMessage(role, row.content, meta);
    if (msg) messages.push(msg);

    if (row.role === "user" || row.role === "assistant") {
      nluHistory.push({ role: row.role, content: row.content });
    }
  }

  return {
    messages,
    nluHistory: nluHistory.slice(-20),
    proposalId,
    proposalKind,
  };
}
