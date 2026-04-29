import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  createDecisionSession,
  addDecisionSessionMember,
  createNotification,
  getUserProfile,
} from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      initiatorConstraints,
      cityId,
      decisionType,
      inviteeUserId,
      inviteeUserIds,
    } = body as {
      initiatorConstraints: string;
      cityId?: string;
      decisionType?: string;
      inviteeUserId?: string | null;
      inviteeUserIds?: string[] | null;
    };

    if (!initiatorConstraints?.trim()) {
      return NextResponse.json({ error: "initiatorConstraints is required" }, { status: 400 });
    }

    const { userId } = await auth();
    const sessionId = nanoid(8);
    const initiatorToken = nanoid(24); // server-side initiator identity token
    const partnerToken = nanoid(24);

    // Normalize invitee inputs into a deduped array, max 7 (so total party ≤ 8).
    // The legacy `inviteeUserId` field still works for 2-party DRs.
    const rawInviteeList: string[] = Array.isArray(inviteeUserIds)
      ? inviteeUserIds
      : typeof inviteeUserId === "string" && inviteeUserId.trim().length > 0
        ? [inviteeUserId.trim()]
        : [];
    const cleanedInvitees = Array.from(
      new Set(
        rawInviteeList
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim())
          .filter((id) => id !== userId), // can't invite yourself
      ),
    ).slice(0, 7);
    const isGroup = cleanedInvitees.length > 1;

    // Multi-party requires sign-in (members table is keyed by user_id).
    if (isGroup && !userId) {
      return NextResponse.json(
        { error: "Group decision rooms require sign-in." },
        { status: 401 },
      );
    }

    // Legacy 2-party fields stay populated for backwards compat — old
    // code paths read invitee_user_id directly.
    const legacyInviteeId = cleanedInvitees[0] ?? null;

    await createDecisionSession({
      id: sessionId,
      initiatorUserId: userId ?? null,
      inviteeUserId: legacyInviteeId,
      initiatorSessionToken: initiatorToken,
      partnerSessionToken: partnerToken,
      initiatorConstraints: initiatorConstraints.trim(),
      cityId: cityId ?? "losangeles",
      decisionType: decisionType ?? "dinner_tonight",
    });

    // For 3+ party DRs, write all members to decision_session_members so the
    // /decide page knows who's expected and the voting logic can require
    // unanimity across the group. Initiator is included with is_initiator=true
    // and constraints pre-populated so they don't have to re-submit.
    if (isGroup && userId) {
      await addDecisionSessionMember(sessionId, userId, true);
      // Initiator's constraints already carried on decision_sessions.initiator_constraints;
      // mirror them onto the member row so unified UI doesn't need branching reads.
      const { setMemberConstraints } = await import("@/lib/db");
      await setMemberConstraints(sessionId, userId, initiatorConstraints.trim());
      for (const inviteeId of cleanedInvitees) {
        await addDecisionSessionMember(sessionId, inviteeId, false);
      }
    }

    // Producer hook: notify each invitee they were pulled into a DR.
    // For 2-party DRs we still notify the single invitee when bound by ID.
    if (cleanedInvitees.length > 0 && userId) {
      try {
        const inviterProfile = await getUserProfile(userId);
        const inviterLabel =
          inviterProfile?.display_name ??
          (inviterProfile?.username
            ? `@${inviterProfile.username}`
            : `@${inviterProfile?.profile_code ?? "someone"}`);
        const groupSuffix = isGroup ? ` (${cleanedInvitees.length + 1}-person group)` : "";
        await Promise.all(
          cleanedInvitees.map((inviteeId) =>
            createNotification({
              userId: inviteeId,
              kind: "dr_invite",
              title: `${inviterLabel} invited you to a Decision Room${groupSuffix}`,
              body: initiatorConstraints.trim().slice(0, 140),
              linkUrl: `/decide/${sessionId}`,
              metadata: { session_id: sessionId, inviter_id: userId },
              dedupeKey: `dr_invite:${sessionId}:${inviteeId}`,
            }),
          ),
        );
      } catch {
        /* swallow */
      }
    }

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/decide/${sessionId}`;

    const response = NextResponse.json({ sessionId, shareUrl });
    // Set initiator identity cookie — HttpOnly, SameSite=Strict, 24h
    // Used server-side to verify vote role without relying on client-supplied role field
    response.cookies.set(`dr_init_${sessionId}`, initiatorToken, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 24,
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("[decision-session POST]", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
