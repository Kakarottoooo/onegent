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
import { analyzeConversationalV2 } from "@/lib/agent/nlu-v2";
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

  // ── NLU v2 pilot (Plan C · Phase A) ──────────────────────────────────
  // Flag: NLU_V2_ENABLED_FOR_TRIP=true in .env.local routes trip scenarios
  // through the new three-layer pipeline (extractor → router → chat).
  // Non-trip scenarios always stay on v1. Opt-in per-request via body
  // `use_v2: true` for testing without touching env vars.
  //
  // Order: run v2 FIRST when enabled. Why? v1 (MiniMax) timeouts are
  // chronic; running v1 first means a v1 timeout short-circuits before
  // v2 ever gets a chance. With v2 first:
  //   - v2 trip → return v2 (Phase A goal)
  //   - v2 non-trip → fall through to v1 (v1 is authoritative for
  //     restaurant/hotel/flight/activity until Phase B migrates them)
  //   - v2 throws → fall through to v1
  const v2EnabledEnv = process.env.NLU_V2_ENABLED_FOR_TRIP === "true";
  const v2OptIn = b.use_v2 === true;
  const shouldTryV2 = v2EnabledEnv || v2OptIn;

  if (shouldTryV2) {
    try {
      const v2Result = await analyzeConversationalV2({
        message,
        history: input.history,
      });
      if (v2Result.scenario === "trip") {
        console.log(
          `[chat/parse] v2 trip pipeline succeeded — intent=${v2Result.intent} confirm_ready=${v2Result.confirm_ready}`,
        );
        return NextResponse.json({
          ok: true,
          result: v2Result,
          user_id: userId ?? null,
          nlu_version: "v2",
        });
      }
      console.log(
        `[chat/parse] v2 says scenario=${v2Result.scenario ?? "null"}, deferring to v1`,
      );
      // v2 classified non-trip → fall through to v1 which owns those scenarios
    } catch (v2Err) {
      console.warn(
        "[chat/parse] v2 pipeline failed, falling back to v1:",
        v2Err instanceof Error ? v2Err.message : v2Err,
      );
      // Fall through to v1
    }
  }

  try {
    const v1Result = await analyzeConversational(input);
    return NextResponse.json({
      ok: true,
      result: v1Result,
      user_id: userId ?? null,
      nlu_version: "v1",
    });
  } catch {
    return NextResponse.json({
      ok: true,
      result: buildFallbackResult(message),
      user_id: userId ?? null,
      nlu_version: "v1-fallback",
    });
  }
}
