import { NextRequest, NextResponse } from "next/server";
import {
  getDecisionSession,
  updateDecisionSession,
  getUserProfile,
  setDecisionSessionInvitee,
} from "@/lib/db";
import { runAgentForTwoParty } from "@/lib/agent/two-party";
import { auth } from "@clerk/nextjs/server";
import type { DecisionSession } from "@/lib/db";

// runAgentForTwoParty calls MiniMax (merge) + MiniMax (intent) + SerpAPI — can take up to 55s
export const maxDuration = 60;

/** Determine the caller's role from server-side signals, not client-supplied field. */
export function deriveRole(
  req: NextRequest,
  session: DecisionSession,
  userId: string | null
): "initiator" | "partner" {
  // Prefer Clerk userId match (most reliable)
  if (userId && session.initiator_user_id && userId === session.initiator_user_id) {
    return "initiator";
  }
  // Fall back to HttpOnly cookie set at session creation
  const cookieToken = req.cookies.get(`dr_init_${session.id}`)?.value;
  if (cookieToken && cookieToken === session.initiator_session_token) {
    return "initiator";
  }
  return "partner";
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getDecisionSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }
  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    await updateDecisionSession(id, { status: "expired" });
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }
  // Inline both initiator + invitee profiles so the partner's landing page
  // and the post-decision "Add as contact" prompt don't need a second
  // round-trip. Best-effort — failures fall back to the magic-link UI.
  type ProfileSlim = {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    profile_code: string | null;
    username: string | null;
  };
  async function loadSlim(uid: string | null): Promise<ProfileSlim | null> {
    if (!uid) return null;
    try {
      const p = await getUserProfile(uid);
      if (!p) return null;
      return {
        user_id: p.user_id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        profile_code: p.profile_code,
        username: p.username,
      };
    } catch {
      return null;
    }
  }
  const [initiator_profile, invitee_profile] = await Promise.all([
    loadSlim(session.initiator_user_id),
    loadSlim(session.invitee_user_id),
  ]);
  return NextResponse.json({ session, initiator_profile, invitee_profile });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as {
    action: "submit_partner_constraints" | "vote" | "feedback";
    partnerConstraints?: string;
    cardId?: string;
    approved?: boolean;
    feedback?: "loved" | "fine" | "never";
    feedbackRole?: "initiator" | "partner";
  };

  const session = await getDecisionSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  const { userId } = await auth();
  const callerRole = deriveRole(req, session, userId ?? null);

  // ── Action: partner submits their constraints ──────────────────────────────
  if (body.action === "submit_partner_constraints") {
    if (session.status !== "waiting_partner") {
      return NextResponse.json(
        { error: "Voting already started — constraints are locked" },
        { status: 409 }
      );
    }
    if (!body.partnerConstraints?.trim()) {
      return NextResponse.json({ error: "partnerConstraints is required" }, { status: 400 });
    }

    // If partner is logged in and the session has no invitee bound yet,
    // backfill so post-decision "Add as contact" works for anon-link flows.
    if (callerRole === "partner" && userId && !session.invitee_user_id && userId !== session.initiator_user_id) {
      try {
        await setDecisionSessionInvitee(id, userId);
      } catch {
        /* non-fatal — user can still complete the DR */
      }
    }

    // Run the two-party agent to get merged options (hard 45s cap)
    const agentTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Two-party agent timed out")), 55_000)
    );
    let mergeResult;
    try {
      mergeResult = await Promise.race([
        runAgentForTwoParty(session.initiator_constraints, body.partnerConstraints.trim(), session.city_id),
        agentTimeout,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent timed out";
      return NextResponse.json({ error: `Search timed out — please try again. (${msg})` }, { status: 504 });
    }

    if (mergeResult.conflict) {
      await updateDecisionSession(id, {
        partner_constraints: body.partnerConstraints.trim(),
        conflict: true,
        conflict_reason: mergeResult.conflictReason ?? "Constraints are mutually exclusive",
        merged_options: mergeResult.options,
        status: "conflict",
      });
    } else {
      await updateDecisionSession(id, {
        partner_constraints: body.partnerConstraints.trim(),
        merged_options: mergeResult.options,
        status: "voting",
      });
    }

    const updated = await getDecisionSession(id);
    return NextResponse.json({ session: updated });
  }

  // ── Action: vote on a card ─────────────────────────────────────────────────
  if (body.action === "vote") {
    if (!body.cardId || body.approved === undefined) {
      return NextResponse.json({ error: "cardId and approved are required" }, { status: 400 });
    }
    if (session.status !== "voting" && session.status !== "conflict") {
      return NextResponse.json({ error: "Session is not in voting state" }, { status: 409 });
    }

    // Role is derived server-side — not trusted from client body
    const voteField = callerRole === "initiator" ? "initiator_vote" : "partner_vote";
    const existingVotes: { card_id: string; approved: boolean }[] =
      (session[voteField] as { card_id: string; approved: boolean }[]) ?? [];

    // Idempotent: overwrite existing vote for this card
    const filtered = existingVotes.filter((v) => v.card_id !== body.cardId);
    const newVotes = [...filtered, { card_id: body.cardId, approved: body.approved }];

    await updateDecisionSession(id, { [voteField]: newVotes });

    // Re-fetch to get the latest other-party votes (avoids stale read race condition)
    const fresh = await getDecisionSession(id);
    const otherVoteField = callerRole === "initiator" ? "partner_vote" : "initiator_vote";
    const otherVotes: { card_id: string; approved: boolean }[] =
      (fresh?.[otherVoteField] as { card_id: string; approved: boolean }[]) ?? [];

    const decidedCard = newVotes.find(
      (v) => v.approved && otherVotes.some((ov) => ov.card_id === v.card_id && ov.approved)
    );

    if (decidedCard) {
      await updateDecisionSession(id, {
        status: "decided",
        decided_card_id: decidedCard.card_id,
      });
    }

    const updated = await getDecisionSession(id);
    return NextResponse.json({ session: updated });
  }

  // ── Action: submit post-decision feedback ──────────────────────────────────
  if (body.action === "feedback") {
    if (!body.feedback || !body.feedbackRole) {
      return NextResponse.json({ error: "feedback and feedbackRole are required" }, { status: 400 });
    }
    const field = body.feedbackRole === "initiator" ? "feedback_initiator" : "feedback_partner";
    await updateDecisionSession(id, { [field]: body.feedback });
    const updated = await getDecisionSession(id);
    return NextResponse.json({ session: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
