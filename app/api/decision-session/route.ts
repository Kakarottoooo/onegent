import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createDecisionSession } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { initiatorConstraints, cityId, decisionType, inviteeUserId } = body as {
      initiatorConstraints: string;
      cityId?: string;
      decisionType?: string;
      inviteeUserId?: string | null;
    };

    if (!initiatorConstraints?.trim()) {
      return NextResponse.json({ error: "initiatorConstraints is required" }, { status: 400 });
    }

    const { userId } = await auth();
    const sessionId = nanoid(8);
    const initiatorToken = nanoid(24); // server-side initiator identity token
    const partnerToken = nanoid(24);

    // Guardrails: inviteeUserId must be a string and != initiator (we don't
    // verify mutual-contact here — UI already filters; resolveContactsByNames
    // is the trust boundary if abused).
    const safeInviteeId =
      typeof inviteeUserId === "string" &&
      inviteeUserId.trim().length > 0 &&
      inviteeUserId !== userId
        ? inviteeUserId.trim()
        : null;

    await createDecisionSession({
      id: sessionId,
      initiatorUserId: userId ?? null,
      inviteeUserId: safeInviteeId,
      initiatorSessionToken: initiatorToken,
      partnerSessionToken: partnerToken,
      initiatorConstraints: initiatorConstraints.trim(),
      cityId: cityId ?? "losangeles",
      decisionType: decisionType ?? "dinner_tonight",
    });

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
