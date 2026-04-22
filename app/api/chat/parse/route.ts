/**
 * POST /api/chat/parse
 *
 * Every keystroke-cycle on the homepage chat funnels through here. The
 * conversational NLU (Phase 1 layer) classifies the message, lifts
 * constraints, and suggests the next clarifying question. The caller turns
 * the result into chat bubbles + quick-pick buttons + an optional confirm
 * card.
 *
 * This endpoint is intentionally stateless — the client owns the history.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  analyzeConversational,
  buildFallbackResult,
  type ConversationalNLUInput,
} from "@/lib/conversational-nlu";
import type { ChatMessage, LayerModel, Provider } from "@/lib/llm-client";

export const maxDuration = 30;

const KNOWN_PROVIDERS: readonly Provider[] = ["minimax", "openai", "anthropic", "google"];

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

function parseUserModel(value: unknown): LayerModel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const provider = v.provider;
  const model = v.model;
  if (typeof provider !== "string" || typeof model !== "string") return undefined;
  if (!KNOWN_PROVIDERS.includes(provider as Provider)) return undefined;
  if (!model.trim()) return undefined;
  return {
    provider: provider as Provider,
    model,
    apiKey: typeof v.apiKey === "string" ? v.apiKey : undefined,
  };
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

  const input: ConversationalNLUInput = {
    message,
    history: parseHistory(b.history),
    pinned_target_id:
      typeof b.pinned_target_id === "string" && b.pinned_target_id.trim()
        ? b.pinned_target_id.trim()
        : undefined,
    userModel: parseUserModel(b.userModel),
  };

  try {
    const result = await analyzeConversational(input);
    return NextResponse.json({
      ok: true,
      result,
      user_id: userId ?? null,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      result: buildFallbackResult(message),
      user_id: userId ?? null,
    });
  }
}
