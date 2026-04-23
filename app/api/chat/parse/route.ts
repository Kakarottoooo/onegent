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
import {
  analyzeConversationalV2,
  buildFallbackResult,
} from "@/lib/agent/nlu-v2";
import {
  isRoomMember,
  upsertMemberIntentState,
  insertPrivateMessage,
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

  try {
    const result = await analyzeConversationalV2({
      message,
      history,
      pinned_target_id,
    });
    console.log(
      `[chat/parse] v2 — scenario=${result.scenario} intent=${result.intent} confirm_ready=${result.confirm_ready}${roomId ? ` room=${roomId}` : ""}`,
    );

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
