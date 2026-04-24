/**
 * POST /api/chat/parse
 *
 * Every keystroke-cycle on the homepage chat funnels through here. The NLU v2
 * pipeline (extractor → router → chat) classifies the message, lifts
 * constraints, and suggests the next clarifying question. The caller turns
 * the result into chat bubbles + quick-pick buttons + an optional confirm
 * card.
 *
 * This endpoint is intentionally stateless — the client owns the history.
 * If the v2 pipeline throws, we return a crash-fallback so the UI never
 * locks up.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  analyzeConversationalV2,
  buildFallbackResult,
} from "@/lib/agent/nlu-v2";
import {
  isRoomMember,
  upsertMemberIntentState,
  insertPrivateMessage,
  createChatSession,
  insertChatSessionMessage,
  getChatSession,
  getDecisionRoomById,
} from "@/lib/db";
import { triggerSynthesis } from "@/lib/agent/trip-synthesis";
import type { ChatMessage } from "@/lib/llm-client";

export const maxDuration = 30;

function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ChatMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const role = e.role;
    const content = e.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    out.push({ role, content });
  }
  // Keep the tail — oldest turns fall out of context first.
  return out.slice(-20);
}

/**
 * Detect user-typed "synthesize / show me the plan / give me options" phrases.
 * When the user is already inside a trip room, the extractor layer tends to
 * classify these as chitchat and the chat layer (Sonnet) hallucinates a
 * freeform itinerary — bypassing the room's structured synthesis pipeline.
 *
 * Returning true flips the NLU result to intent=create_room + confirm_ready,
 * which the client (page.tsx) routes to POST /api/rooms/[id]/synthesize.
 *
 * Conservative patterns — only fires when the intent is unambiguous. Picky
 * on purpose: false positives here would skip the clarification loop.
 */
function isSynthesisTrigger(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) return false;
  // Chinese cues. Tolerate extra particles (吧 啊 呀 呢 了).
  const zh = [
    /给.{0,4}方案/, // 给我方案 / 给个方案 / 给我一个方案
    /出[一二三]?套?方案/, // 出方案 / 出一套方案
    /看看方案/,
    /综合.{0,5}方案/,
    /生成.{0,3}方案/,
    /方案[呢吧啊]/,
    /(?:开始|现在).{0,4}(?:出|给|综合|生成)/,
    /我想看看?方案/,
  ];
  for (const re of zh) {
    if (re.test(message)) return true;
  }
  // English cues.
  const en = [
    /\b(?:give|show|send)\s+(?:me\s+)?(?:the\s+)?(?:plan|options?|proposal|itinerary)\b/,
    /\bsynthes[iy]ze\b/,
    /\bgenerate\s+(?:the\s+)?(?:plan|options?|itinerary)\b/,
    /\blet'?s\s+see\s+(?:the\s+)?(?:plan|options?)\b/,
    /\bwhat\s+(?:do\s+you\s+have|have\s+you\s+got)\b/,
    /\bready\s+to\s+see\b/,
  ];
  for (const re of en) {
    if (re.test(m)) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  // Auth is soft: the homepage chat is available to logged-in users; we surface
  // a fallback bubble instead of a 401 when the session is missing so the UI
  // never locks up.
  const { userId } = await auth().catch(() => ({ userId: null as string | null }));

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

  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const history = parseHistory(b.history);
  const pinned_target_id =
    typeof b.pinned_target_id === "string" && b.pinned_target_id.trim()
      ? b.pinned_target_id.trim()
      : undefined;
  const roomId =
    typeof b.room_id === "string" && b.room_id.trim() ? b.room_id.trim() : undefined;
  const incomingSessionId =
    typeof b.session_id === "string" && b.session_id.trim() ? b.session_id.trim() : undefined;

  try {
    const result = await analyzeConversationalV2({
      message,
      history,
      pinned_target_id,
    });
    console.log(
      `[chat/parse] v2 — scenario=${result.scenario} intent=${result.intent} confirm_ready=${result.confirm_ready}${roomId ? ` room=${roomId}` : ""}`,
    );

    // In-trip-room synthesize trigger: when the user's in a trip room and
    // clearly asks for the plan ("给我方案", "synthesize"), override the
    // NLU result so the client fires /api/rooms/[id]/synthesize instead of
    // showing Sonnet's hallucinated itinerary as a regular chat bubble.
    // This is a deterministic gate — pure regex on the user message, run
    // AFTER the NLU result comes back, so the extractor/router stay pure.
    if (roomId && isSynthesisTrigger(message)) {
      const room = await getDecisionRoomById(roomId).catch(() => null);
      if (room && room.type === "trip") {
        console.log(
          `[chat/parse] synthesis trigger matched — overriding intent=create_room confirm_ready=true for room=${roomId}`,
        );
        result.intent = "create_room";
        result.scenario = "trip";
        result.confirm_ready = true;
        // Replace whatever Sonnet said so the user doesn't see a fabricated
        // itinerary. The client will follow up with the real synthesis outcome
        // ("方案已出" / "还在等 N 位成员" / "信息不足缺 X") in a second bubble.
        result.assistant_reply = "好的，我去综合大家的偏好，出一套方案。";
      }
    }

    // Sessions (ChatGPT-style solo thread): when not in a room context,
    // mirror the turn into chat_session_messages. Auto-create a session on
    // first message. `resolvedSessionId` is returned in the response so the
    // client can update the URL to ?session_id=<id>.
    let resolvedSessionId: string | null = null;
    if (!roomId && userId) {
      resolvedSessionId = await syncSessionContext(
        userId,
        incomingSessionId,
        message,
        result.assistant_reply,
      );
    }

    // Stage 2: if the user is chatting inside a room context, sync their
    // IntentState + private-channel messages. Non-fatal: any failure here
    // is logged and swallowed so the chat reply still surfaces.
    if (roomId && userId) {
      await syncRoomContext(roomId, userId, message, result);
      // Auto-trigger synthesis in the background via Next.js `after()` so
      // the chat response returns immediately. triggerSynthesis gates on
      // room.synthesis_json === null (one-time lock) + all members have
      // contributed. If that gate fails it no-ops cheaply.
      after(async () => {
        try {
          const outcome = await triggerSynthesis(roomId);
          if (outcome.triggered) {
            console.log(`[chat/parse] synthesis trigger result: ${outcome.reason} for room=${roomId}`);
          }
        } catch (err) {
          console.warn("[chat/parse] background synthesis failed:", err);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      result,
      user_id: userId ?? null,
      nlu_version: "v2",
      session_id: resolvedSessionId,
    });
  } catch (err) {
    console.warn(
      "[chat/parse] v2 pipeline failed, returning fallback:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({
      ok: true,
      result: buildFallbackResult(message),
      user_id: userId ?? null,
      nlu_version: "v2-fallback",
    });
  }
}

/**
 * Mirror this turn into the room's async state: upsert the user's IntentState
 * (so trip-synthesis can read everyone's latest preferences) + append their
 * user/assistant messages to the private channel. Gated by isRoomMember —
 * a stranger who guesses a room_id can NOT write into it.
 *
 * Runs fully async from each member's perspective — member A completing
 * their turn does not wait on member B. The synthesis agent (T13/T14)
 * decides when "everyone's ready".
 */
async function syncRoomContext(
  roomId: string,
  userId: string,
  userMessage: string,
  result: Awaited<ReturnType<typeof analyzeConversationalV2>>,
): Promise<void> {
  try {
    const member = await isRoomMember(roomId, userId);
    if (!member) {
      console.warn(`[chat/parse] user ${userId} tried to sync into room ${roomId} but is not a member — skipping`);
      return;
    }
    const writes: Promise<unknown>[] = [
      insertPrivateMessage({ roomId, userId, role: "user", content: userMessage }),
    ];
    if (result.__v2_state) {
      writes.push(
        upsertMemberIntentState({
          roomId,
          userId,
          intentStateJson: result.__v2_state as unknown as Record<string, unknown>,
        }),
      );
    }
    if (result.assistant_reply) {
      writes.push(
        insertPrivateMessage({
          roomId,
          userId,
          role: "assistant",
          content: result.assistant_reply,
        }),
      );
    }
    await Promise.all(writes);
  } catch (err) {
    console.warn(`[chat/parse] room sync failed for room=${roomId} user=${userId}:`, err);
  }
}

/**
 * Persist this turn into the user's solo chat session (ChatGPT-style
 * sidebar history). Creates the session on first message when no
 * incoming session_id is provided. Returns the session id so the
 * response can echo it back for the client to update the URL.
 *
 * Silently returns null on any failure — session continuity is a polish,
 * not a critical path.
 */
async function syncSessionContext(
  userId: string,
  incomingSessionId: string | undefined,
  userMessage: string,
  assistantReply: string | null | undefined,
): Promise<string | null> {
  try {
    let sessionId = incomingSessionId ?? null;
    let created = false;
    if (sessionId) {
      // Defensive: make sure this user owns the session before writing.
      const existing = await getChatSession(sessionId, userId);
      if (!existing) {
        console.warn(`[chat/parse] session ${sessionId} not owned by user=${userId}; creating fresh`);
        sessionId = null;
      }
    }
    if (!sessionId) {
      sessionId = randomUUID();
      const title = (userMessage.trim() || "New chat").slice(0, 80);
      await createChatSession({ id: sessionId, userId, title });
      created = true;
    }
    await insertChatSessionMessage({ sessionId, role: "user", content: userMessage });
    if (assistantReply && assistantReply.trim()) {
      await insertChatSessionMessage({
        sessionId,
        role: "assistant",
        content: assistantReply,
      });
    }
    console.log(
      `[chat/parse] session sync ok — session=${sessionId} ${created ? "(new)" : "(existing)"} user=${userId}`,
    );
    return sessionId;
  } catch (err) {
    console.warn(`[chat/parse] session sync FAILED for user=${userId}, incoming=${incomingSessionId ?? "none"}:`, err);
    return null;
  }
}
