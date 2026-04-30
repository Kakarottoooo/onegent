import type { ChatMessage } from "@/lib/llm-client";
import type { Message } from "@/lib/types";

export interface SessionReplayRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  nlu_state?: unknown | null;
  created_at: string;
}

export interface RoomReplayRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta_json: { kind?: string; proposal_id?: string } | null;
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

export function buildSessionReplaySnapshot(params: {
  session?: { title?: string } | null;
  messages?: SessionReplayRow[] | null;
}): SessionReplaySnapshot {
  const rows = params.messages ?? [];
  const messages: Message[] = rows.map((row) => ({
    role: row.role,
    content: row.content,
  }));
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
    if (row.meta_json?.kind === "trip_proposal_card" && row.meta_json.proposal_id) {
      proposalId = row.meta_json.proposal_id;
      continue;
    }

    const role = row.role === "user" ? "user" : "assistant";
    messages.push({ role, content: row.content });

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
