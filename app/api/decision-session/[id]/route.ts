import { NextRequest, NextResponse } from "next/server";
import {
  getDecisionSession,
  updateDecisionSession,
  getUserProfile,
  getUserProfilesByIds,
  setDecisionSessionInvitee,
  getSharedArtifactByRef,
  listDecisionSessionMembers,
  setMemberConstraints,
  setMemberVotes,
  setMemberFeedback,
  type DecisionSessionMember,
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
  const [initiator_profile, invitee_profile, members] = await Promise.all([
    loadSlim(session.initiator_user_id),
    loadSlim(session.invitee_user_id),
    listDecisionSessionMembers(id),
  ]);

  // For 3+-party DRs we attach a hydrated members[] array so the /decide
  // page can render the participants panel without a second round-trip.
  // 2-party DRs return [] here — frontend falls back to initiator_profile +
  // invitee_profile in that case.
  let hydratedMembers: Array<{
    user_id: string;
    is_initiator: boolean;
    has_submitted: boolean;
    has_voted: boolean;
    votes: { card_id: string; approved: boolean }[];
    profile: ProfileSlim | null;
  }> = [];
  if (members.length > 0) {
    const profileMap = await getUserProfilesByIds(members.map((m) => m.user_id));
    hydratedMembers = members.map((m) => {
      const p = profileMap[m.user_id] ?? null;
      const votes = Array.isArray(m.votes) ? m.votes : [];
      return {
        user_id: m.user_id,
        is_initiator: m.is_initiator,
        has_submitted: !!m.submitted_at,
        has_voted: votes.length > 0,
        votes,
        profile: p
          ? {
              user_id: p.user_id,
              display_name: p.display_name,
              avatar_url: p.avatar_url,
              profile_code: p.profile_code,
              username: p.username,
            }
          : null,
      };
    });
  }

  // Attach own_share when the *caller* (auth) created an artifact for this
  // session. This lets the decided screen flip "Save & share" to "Shared ·
  // X views" without a second round trip. Only fetched for authed users
  // since shares are owner-scoped.
  const { userId: callerId } = await auth();
  let own_share: { slug: string; view_count: number; visibility: string } | null = null;
  if (callerId) {
    try {
      const art = await getSharedArtifactByRef(callerId, "dr_outcome", session.id);
      if (art) {
        own_share = {
          slug: art.slug,
          view_count: art.view_count,
          visibility: art.visibility,
        };
      }
    } catch {
      /* swallow — UI gracefully shows the Share button as fallback */
    }
  }

  return NextResponse.json({
    session,
    initiator_profile,
    invitee_profile,
    own_share,
    members: hydratedMembers,
  });
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

  // Group mode is detected by presence of decision_session_members rows.
  // 2-party DRs continue working off initiator_*/partner_* columns; group
  // DRs use the members table for everything (constraints, votes, feedback).
  const members = await listDecisionSessionMembers(id);
  const isGroup = members.length > 0;

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

    // ── Group path ───────────────────────────────────────────────────────
    if (isGroup) {
      if (!userId) {
        return NextResponse.json(
          { error: "Group rooms require sign-in to submit constraints." },
          { status: 401 },
        );
      }
      const meAsMember = members.find((m) => m.user_id === userId);
      if (!meAsMember) {
        return NextResponse.json(
          { error: "You're not a member of this room." },
          { status: 403 },
        );
      }
      // Save this member's constraints; merge only triggers when *all* members
      // have submitted (otherwise late joiners get excluded from the search).
      await setMemberConstraints(id, userId, body.partnerConstraints.trim());
      const refreshed = await listDecisionSessionMembers(id);
      const allSubmitted = refreshed.every((m) => !!m.submitted_at);
      if (!allSubmitted) {
        const updated = await getDecisionSession(id);
        return NextResponse.json({
          session: updated,
          waiting_for: refreshed.filter((m) => !m.submitted_at).length,
        });
      }
      // All in — build combined partner_constraints by joining every
      // non-initiator member's text. Hack until the merge prompt is
      // rewritten to natively accept N-party input.
      const initiatorMember = refreshed.find((m) => m.is_initiator);
      const others = refreshed.filter((m) => !m.is_initiator);
      const initiatorConstraints =
        initiatorMember?.constraints ?? session.initiator_constraints;
      const combinedPartner = others
        .map((m, i) => `Person ${i + 2}: ${m.constraints ?? ""}`)
        .join("\n\n");
      const agentTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Group agent timed out")), 55_000),
      );
      let mergeResult;
      try {
        mergeResult = await Promise.race([
          runAgentForTwoParty(initiatorConstraints, combinedPartner, session.city_id),
          agentTimeout,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent timed out";
        return NextResponse.json(
          { error: `Search timed out — please try again. (${msg})` },
          { status: 504 },
        );
      }
      if (mergeResult.conflict) {
        await updateDecisionSession(id, {
          partner_constraints: combinedPartner,
          conflict: true,
          conflict_reason:
            mergeResult.conflictReason ?? "Group constraints are mutually exclusive",
          merged_options: mergeResult.options,
          status: "conflict",
        });
      } else {
        await updateDecisionSession(id, {
          partner_constraints: combinedPartner,
          merged_options: mergeResult.options,
          status: "voting",
        });
      }
      const updated = await getDecisionSession(id);
      return NextResponse.json({ session: updated });
    }

    // ── Legacy 2-party path ──────────────────────────────────────────────
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

    // ── Group path: write to members.votes; decided when ALL members have
    //    approved the same card (unanimity). ───────────────────────────────
    if (isGroup) {
      if (!userId) {
        return NextResponse.json({ error: "Sign-in required to vote in group rooms." }, { status: 401 });
      }
      const me = members.find((m) => m.user_id === userId);
      if (!me) {
        return NextResponse.json({ error: "You're not a member of this room." }, { status: 403 });
      }
      const existing = Array.isArray(me.votes) ? me.votes : [];
      const newVotes = [
        ...existing.filter((v) => v.card_id !== body.cardId),
        { card_id: body.cardId, approved: body.approved },
      ];
      await setMemberVotes(id, userId, newVotes);
      const refreshed = await listDecisionSessionMembers(id);
      // Decided iff *every* member has an approved vote for the same card_id.
      const decidedCardId = pickUnanimousApproval(refreshed, body.cardId);
      if (decidedCardId) {
        await updateDecisionSession(id, {
          status: "decided",
          decided_card_id: decidedCardId,
        });
      }
      const updated = await getDecisionSession(id);
      return NextResponse.json({ session: updated });
    }

    // ── Legacy 2-party path ────────────────────────────────────────────────
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
    if (!body.feedback) {
      return NextResponse.json({ error: "feedback is required" }, { status: 400 });
    }

    if (isGroup) {
      if (!userId) {
        return NextResponse.json({ error: "Sign-in required for feedback." }, { status: 401 });
      }
      await setMemberFeedback(id, userId, body.feedback);
      const updated = await getDecisionSession(id);
      return NextResponse.json({ session: updated });
    }

    if (!body.feedbackRole) {
      return NextResponse.json({ error: "feedbackRole is required" }, { status: 400 });
    }
    const field = body.feedbackRole === "initiator" ? "feedback_initiator" : "feedback_partner";
    await updateDecisionSession(id, { [field]: body.feedback });
    const updated = await getDecisionSession(id);
    return NextResponse.json({ session: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * If a card_id is approved by every member, return that card_id; otherwise
 * null. The candidate is the card that was just voted on — checking it
 * narrowly avoids scanning the whole vote space when only one new vote
 * could have flipped unanimity.
 */
function pickUnanimousApproval(
  members: DecisionSessionMember[],
  candidateCardId: string,
): string | null {
  if (members.length === 0) return null;
  for (const m of members) {
    const votes = Array.isArray(m.votes) ? m.votes : [];
    const v = votes.find((x) => x.card_id === candidateCardId);
    if (!v || !v.approved) return null;
  }
  return candidateCardId;
}
