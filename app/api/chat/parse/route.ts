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
  updateChatSessionMeta,
  getDecisionRoomById,
  listActiveProposals,
  listRoomMembers,
  listMemberIntentStates,
  getUserProfile,
  resolveContactsByNamesFuzzy,
  pickPreferredContactLabel,
  type FuzzyContactResolution,
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
  // Hydrated IntentState from the prior assistant turn — when present, lets the
  // extractor merge into existing constraints/scenario instead of starting from
  // scratch. The client pulls this from the most recent assistant message of
  // the replayed session (chat_session_messages.nlu_state JSONB column).
  const prevNluState =
    b.prev_nlu_state && typeof b.prev_nlu_state === "object" ? b.prev_nlu_state : null;

  // Client-resolved @-mentions. We look up the profiles server-side so the
  // names are trustworthy (client could have stale display_name) and pass
  // them through to the NLU as a hard override on party_type / member_names.
  const rawMentionedIds = Array.isArray(b.mentioned_user_ids)
    ? (b.mentioned_user_ids as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      )
    : [];
  const mentionedMembers = rawMentionedIds.length > 0
    ? (
        await Promise.all(
          // Drop the caller's own id — they're not a "co-decider" of themselves.
          rawMentionedIds
            .filter((id) => id !== userId)
            .slice(0, 8) // sanity cap
            .map(async (id) => {
              const p = await getUserProfile(id).catch(() => null);
              return p
                ? { user_id: id, display_name: p.display_name, username: p.username }
                : null;
            }),
        )
      ).filter((m): m is { user_id: string; display_name: string | null; username: string | null } => !!m)
    : [];

  try {
    const result = await analyzeConversationalV2({
      message,
      history,
      pinned_target_id,
      prev_state: prevNluState as Parameters<typeof analyzeConversationalV2>[0]["prev_state"],
      mentioned_members: mentionedMembers.length > 0 ? mentionedMembers : undefined,
    });
    const oosTags = (result.__v2_state?.planning_assumptions ?? []).filter(
      (a: unknown): a is string =>
        typeof a === "string" && a.toLowerCase().startsWith("out_of_scope:"),
    );
    console.log(
      `[chat/parse] v2 — scenario=${result.scenario} intent=${result.intent} confirm_ready=${result.confirm_ready}${roomId ? ` room=${roomId}` : ""}${oosTags.length ? ` oos=[${oosTags.join("|")}]` : ""}`,
    );

    // Auto-resolve member_names against the caller's contacts so the user can
    // type natural language ("和朋友 ziweiC 找餐厅") instead of being forced
    // through the @-picker UI. Strategy = (i) blocking: if any name fails to
    // resolve unanimously, override the result to ask_clarification with the
    // candidates as quick picks. Never silently drop a name and downgrade to
    // solo — that's the failure mode the user explicitly called out.
    //
    // Skipped when:
    //   - no userId (logged-out caller, can't read their contacts anyway)
    //   - explicit @-picker already supplied mentioned_members (ground truth)
    //   - user is already in a roomId (members of an existing DR are not
    //     looked up against the personal contact graph; @-mentions inside a
    //     DR have a different code path)
    const memberNamesFromNlu = (result.__v2_state?.member_names ?? []).filter(
      (s: unknown): s is string => typeof s === "string" && s.trim().length > 0,
    );
    const autoResolvedMentionedIds: string[] = [];
    if (
      userId &&
      !roomId &&
      mentionedMembers.length === 0 &&
      memberNamesFromNlu.length > 0
    ) {
      try {
        const resolutions: FuzzyContactResolution[] =
          await resolveContactsByNamesFuzzy(userId, memberNamesFromNlu);
        const everyResolved = resolutions.every((r) => !!r.contact_user_id);
        if (everyResolved) {
          // Replace the user-typed tokens with each contact's preferred label.
          // pickPreferredContactLabel demotes Clerk-email-fallback display_name
          // below username so a contact whose Clerk profile lacks a fullName
          // doesn't show as "guoziwei2019@126.com" in the ConfirmCard pill.
          const canonicalNames = resolutions.map((r) =>
            (r.matched && pickPreferredContactLabel(r.matched)) || r.name,
          );
          result.member_names = canonicalNames;
          if (result.__v2_state) {
            result.__v2_state.member_names = canonicalNames;
            result.__v2_state.party_type = "multi";
            if (result.__v2_state.intent === "create_plan") {
              result.__v2_state.intent = "create_room";
            }
          }
          result.party_type = "multi";
          if (result.intent === "create_plan") result.intent = "create_room";
          for (const r of resolutions) {
            if (r.contact_user_id) autoResolvedMentionedIds.push(r.contact_user_id);
          }
          console.log(
            `[chat/parse] auto-resolved ${resolutions.length} member name(s) → ${autoResolvedMentionedIds.length} contact(s)`,
          );
        } else {
          // Block: build a single ask_clarification turn covering every name
          // that couldn't pin down to one contact. The user picks the right
          // contact (or invites) and the next parse cycle re-tries.
          const lines: string[] = [];
          const picks: Array<{ label: string; value: string }> = [];
          const seenLabels = new Set<string>();
          for (const r of resolutions) {
            if (r.contact_user_id) continue;
            if (r.candidates.length === 0) {
              lines.push(`联系人里没找到「${r.name}」。`);
            } else {
              lines.push(`「${r.name}」是下面哪一位？`);
              for (const c of r.candidates) {
                const label = pickPreferredContactLabel(c) ?? "(unnamed)";
                if (seenLabels.has(label)) continue;
                seenLabels.add(label);
                picks.push({ label, value: label });
              }
            }
          }
          // Always offer escape hatches so the user is never trapped:
          //   - 单人继续 → "_solo_" sentinel; client treats as "drop the
          //     co-decider claim and proceed solo"
          //   - 邀请新成员 → "_invite_" sentinel; client opens the existing
          //     lookup-and-invite flow
          picks.push({ label: "邀请新成员", value: "邀请新成员" });
          picks.push({ label: "我自己来就行", value: "我自己来就行" });
          const reply =
            lines.join("\n\n") ||
            "等一下让我先确认一下你说的是哪位朋友。";
          result.assistant_reply = reply;
          result.suggested_clarify_question = reply;
          result.suggested_quick_picks = picks;
          result.confirm_ready = false;
          result.missing_fields = ["co_decider"];
          if (result.__v2_action) {
            result.__v2_action = {
              type: "ask_clarification",
              missing: ["co_decider"],
              suggested_quick_picks: picks,
            };
          }
          console.log(
            `[chat/parse] contact-resolver blocked: ${resolutions
              .filter((r) => !r.contact_user_id)
              .map((r) => `${r.name}=${r.candidates.length}cand`)
              .join(", ")}`,
          );
        }
      } catch (err) {
        console.warn("[chat/parse] contact resolver failed:", err);
      }
    }

    // In-trip-room synthesize trigger: when the user's in a trip room and
    // clearly asks for the plan ("给我方案", "synthesize"), override the
    // NLU result so the client fires /api/rooms/[id]/synthesize instead of
    // showing Sonnet's hallucinated itinerary as a regular chat bubble.
    // This is a deterministic gate — pure regex on the user message, run
    // AFTER the NLU result comes back, so the extractor/router stay pure.
    if (roomId && isSynthesisTrigger(message)) {
      const room = await getDecisionRoomById(roomId).catch(() => null);
      if (room && room.type === "trip") {
        // IMPORTANT: only override when NO proposal exists yet. If the room
        // already has one (active or accepted), re-firing synthesize would
        // create a duplicate proposal and orphan every vote that was cast
        // against the first one — users see the approval count "reset" to 0
        // and can never converge on the threshold.
        //
        // After the first proposal exists, the user's "给方案" / "plan"
        // request means "show me what you already generated" — the card is
        // already on screen, we just nudge them to look at it.
        const proposals = await listActiveProposals(roomId).catch(() => []);
        const hasLiveProposal = proposals.some(
          (p) => p.status === "active" || p.status === "accepted",
        );
        if (hasLiveProposal) {
          console.log(
            `[chat/parse] synthesis trigger matched but room=${roomId} already has a proposal — refusing to duplicate`,
          );
          result.assistant_reply =
            "方案已经出好了，在下方卡片里选择你的偏好就行。如果想重新生成一套，说「重新生成」。";
          // Deliberately leave intent/confirm_ready alone — we DON'T want
          // the client to trigger synthesize again.
        } else {
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
      } else if (room && (room.type === "restaurant" || room.type === "hotel" || room.type === "flight" || room.type === "activity")) {
        // Plan A: non-trip chat-flow rooms also recognize the synthesis
        // trigger. The override mirrors the trip path — set
        // intent=create_room + confirm_ready=true so the client sees
        // "we're ready" and calls /api/rooms/[id]/synthesize, which
        // returns the merged search query. The client then posts that
        // query to /api/chat with categoryHint=room.type to render
        // recommendation cards inline.
        console.log(
          `[chat/parse] scenario synthesis trigger matched for room=${roomId} type=${room.type}`,
        );
        result.intent = "create_room";
        result.scenario = room.type;
        result.confirm_ready = true;
        result.assistant_reply = `好的，我把大家的偏好综合一下，找一些都喜欢的${room.type === "restaurant" ? "餐厅" : room.type === "hotel" ? "酒店" : room.type === "flight" ? "航班" : "活动"}。`;
      }
    }

    // DR private-chat guard: when the user is inside a Decision Room and the
    // utterance is NOT a synthesis trigger, suppress confirm_ready. The DR
    // is the plan — individual member chat turns must NOT pop a "Confirm to
    // create a new plan / search now" card, because doing so fires
    // /api/chat with that single member's preferences, bypasses the
    // multi-party merge, and surfaces single-user search results in
    // everyone's view. Synthesis fires either auto (3b below) or via the
    // explicit "出方案" trigger above (which set confirm_ready=true with
    // intent=create_room — that path is unchanged).
    let drSynthesisReady = false;
    if (roomId && !isSynthesisTrigger(message)) {
      result.confirm_ready = false;
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
        result.__v2_state ?? null,
      );
      // Onegent-flavored sidebar metadata: scenario + destination land on the
      // session row so it labels itself "🍽️ NY · Italian dinner" instead of
      // a 80-char message truncation. No extra LLM call — we already paid for
      // result.scenario + collected_constraints above.
      if (resolvedSessionId) {
        const destination = extractDestination(result.collected_constraints);
        const scenario = result.scenario ?? null;
        if (destination !== null || scenario !== null) {
          try {
            await updateChatSessionMeta(resolvedSessionId, userId, {
              destination,
              scenario,
            });
          } catch (err) {
            console.warn(`[chat/parse] updateChatSessionMeta failed for ${resolvedSessionId}`, err);
          }
        }
      }
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

      // Non-trip DR: compute "ready for scenario synthesis" gate so the
      // client can auto-trigger /api/rooms/[id]/synthesize once the last
      // member has contributed. Mirrors the trip auto-synthesis logic but
      // returns a flag instead of writing a proposal row, since non-trip
      // synthesis just produces a search query the client must execute.
      const room = await getDecisionRoomById(roomId).catch(() => null);
      if (
        room &&
        (room.type === "restaurant" || room.type === "hotel" || room.type === "flight" || room.type === "activity")
      ) {
        try {
          const [members, intentRows] = await Promise.all([
            listRoomMembers(roomId),
            listMemberIntentStates(roomId),
          ]);
          const pendingInviteCount = members.filter((m) => m.status === "invited").length;
          const joined = members.filter((m) => m.status === "joined");
          const contributorIds = new Set(intentRows.map((r) => r.user_id));
          const allJoinedContributed =
            joined.length > 0 && joined.every((m) => contributorIds.has(m.user_id));
          const proposals = await listActiveProposals(roomId).catch(() => []);
          const hasLiveProposal = proposals.some(
            (p) => p.status === "active" || p.status === "accepted",
          );

          // Auto-fire requires:
          //   1. A real multi-party room — at least 2 joined members. A
          //      1-member DR is a degenerate case (creator alone, invite
          //      not landed yet, or solo accidental DR) and the user must
          //      say "出方案" explicitly to trigger. Without this guard,
          //      a creator's first preference message right after room
          //      creation can fire synthesis before any partner has even
          //      been added to the members table.
          //   2. No invitees still pending — they need a chance to chat.
          //   3. Every joined member has an IntentState row.
          //   4. No active/accepted proposal already exists.
          const isMultiPartyReady = joined.length >= 2;
          console.log(
            `[chat/parse] auto-synth gate room=${roomId} joined=${joined.length} pending=${pendingInviteCount} contributors=${intentRows.length} hasProposal=${hasLiveProposal} multiParty=${isMultiPartyReady} allContributed=${allJoinedContributed}`,
          );

          if (
            isMultiPartyReady &&
            pendingInviteCount === 0 &&
            allJoinedContributed &&
            !hasLiveProposal
          ) {
            drSynthesisReady = true;
            result.assistant_reply =
              "好了，每位成员的偏好都收到了。我现在把大家的想法综合起来，找几个都喜欢的选项。";
          } else if (pendingInviteCount > 0) {
            // DR has invitees still pending — make the reply explicit so
            // the user knows synthesis is waiting on the invite acceptance.
            const baseReply = result.assistant_reply ?? "";
            const note = `（你的偏好已记下。还在等 ${pendingInviteCount} 位被邀请的朋友加入，等他们也聊完我会自动综合方案。）`;
            result.assistant_reply = baseReply ? `${baseReply}\n\n${note}` : note;
          } else if (joined.length > 1 && !allJoinedContributed) {
            // Multiple members joined, but not everyone has chatted yet.
            const stillNeed = joined.length - intentRows.length;
            const baseReply = result.assistant_reply ?? "";
            const note = `（已记下你的偏好。等其他 ${stillNeed} 位成员聊完，我自动综合方案。）`;
            result.assistant_reply = baseReply ? `${baseReply}\n\n${note}` : note;
          } else if (joined.length === 1 && pendingInviteCount === 0) {
            // Single-member DR with no invitees — likely the partner didn't
            // get added yet (or never will). Tell the user instead of
            // silently auto-synthesising for one person.
            const baseReply = result.assistant_reply ?? "";
            const note = "（还没有同伴加入这个房间。等他们进来一起聊偏好，或者直接说「出方案」我帮你单独看看选项。）";
            result.assistant_reply = baseReply ? `${baseReply}\n\n${note}` : note;
          }
        } catch (err) {
          console.warn("[chat/parse] DR synthesis-ready gate check failed:", err);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      result,
      user_id: userId ?? null,
      nlu_version: "v2",
      session_id: resolvedSessionId,
      scenario_synthesis_ready: drSynthesisReady,
      // Contact IDs the auto-resolver matched against the caller's contact
      // graph from natural-language member_names. The client merges these
      // with explicit @-picker ids so /api/chat/commit's mentioned_user_ids
      // path lights up exactly the same way regardless of input modality.
      auto_mentioned_user_ids: autoResolvedMentionedIds,
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
/** Pull a short, human-friendly destination label out of the NLU's
 *  collected_constraints. Falls back through several common keys because
 *  scenarios disagree on naming (restaurant uses "location", flight uses
 *  "dest", trip uses "destination"). Returns null when nothing usable. */
function extractDestination(constraints: Record<string, unknown> | null | undefined): string | null {
  if (!constraints) return null;
  const candidateKeys = ["destination", "location", "city", "dest", "arrival_city", "neighborhood"];
  for (const key of candidateKeys) {
    const v = constraints[key];
    if (typeof v === "string" && v.trim()) {
      // Trim airport-code parens etc. Cap length so a runaway value doesn't
      // blow out the sidebar row.
      return v.trim().slice(0, 40);
    }
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string" && v[0].trim()) {
      return v[0].trim().slice(0, 40);
    }
  }
  return null;
}

async function syncSessionContext(
  userId: string,
  incomingSessionId: string | undefined,
  userMessage: string,
  assistantReply: string | null | undefined,
  nluState: unknown,
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
      // Persist the IntentState snapshot on the assistant row so a refresh
      // or sidebar switch can hydrate prev_state on the next parse turn.
      await insertChatSessionMessage({
        sessionId,
        role: "assistant",
        content: assistantReply,
        nluState: nluState ?? undefined,
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
