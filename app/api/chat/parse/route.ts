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

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  analyzeConversationalV2,
  buildFallbackResult,
} from "@/lib/agent/nlu-v2";
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

  try {
    const result = await analyzeConversationalV2({
      message,
      history,
      pinned_target_id,
    });
    console.log(
      `[chat/parse] v2 — scenario=${result.scenario} intent=${result.intent} confirm_ready=${result.confirm_ready}`,
    );
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
