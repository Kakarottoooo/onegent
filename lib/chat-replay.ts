import type { ChatMessage } from "@/lib/llm-client";
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

type ReplayMetaJson =
  | { kind?: string; proposal_id?: string }
  | SearchCardsMetaJson
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
}

export interface RoomReplaySnapshot {
  messages: Message[];
  nluHistory: ChatMessage[];
  proposalId: string | null;
}

/** Type guard — narrows an arbitrary meta_json blob to the
 *  search-card-bearing shape that we wrote on persist. Defends against
 *  legacy rows where meta_json carries other kinds. */
function isSearchCardsMeta(meta: ReplayMetaJson): meta is SearchCardsMetaJson {
  return !!meta && typeof meta === "object" && (meta as { kind?: unknown }).kind === "search_cards";
}

/** Reconstruct an inline-rendered Message from a persisted row, hydrating
 *  any search-card payload that was saved alongside the text bubble. The
 *  base shape stays identical for plain-text rows so the rest of the
 *  replay code keeps working unchanged. */
function rowToMessage(
  role: "user" | "assistant",
  content: string,
  meta: ReplayMetaJson,
): Message {
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
  const messages: Message[] = rows.map((row) =>
    rowToMessage(row.role, row.content, row.meta_json ?? null),
  );
  const nluHistory: ChatMessage[] = rows.slice(-20).map((row) => ({
    role: row.role,
    content: row.content,
  }));

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
  };
}

export function buildRoomReplaySnapshot(rows?: RoomReplayRow[] | null): RoomReplaySnapshot {
  const messages: Message[] = [];
  const nluHistory: ChatMessage[] = [];
  let proposalId: string | null = null;

  for (const row of rows ?? []) {
    const meta = row.meta_json ?? null;
    if (
      meta &&
      typeof meta === "object" &&
      (meta as { kind?: unknown }).kind === "trip_proposal_card" &&
      typeof (meta as { proposal_id?: unknown }).proposal_id === "string"
    ) {
      proposalId = (meta as { proposal_id: string }).proposal_id;
      continue;
    }

    const role = row.role === "user" ? "user" : "assistant";
    messages.push(rowToMessage(role, row.content, meta));

    if (row.role === "user" || row.role === "assistant") {
      nluHistory.push({ role: row.role, content: row.content });
    }
  }

  return {
    messages,
    nluHistory: nluHistory.slice(-20),
    proposalId,
  };
}
