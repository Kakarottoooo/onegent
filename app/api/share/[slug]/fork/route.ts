import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { auth } from "@clerk/nextjs/server";
import {
  getSharedArtifactBySlug,
  getDecisionSession,
  createDecisionSession,
} from "@/lib/db";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /api/share/[slug]/fork
 *
 * Clone a public DR-outcome share's `initiator_constraints` into a brand
 * new decision session owned by the caller. They land on `/decide/<id>` as
 * the initiator and pick their own partner from there.
 *
 * Why we copy *constraints* rather than the merged options or decided card:
 *   - Friend forking it wants to do something *like* this, not blindly book
 *     the same place. Constraints encode their goal; options are stale.
 *   - Picking the same restaurant on a different night/with different people
 *     usually doesn't make sense.
 *
 * Booking-kind shares aren't forkable in v1 — they don't carry a constraint
 * string and "Fork" without an editable seed is a worse UX than starting
 * fresh from the homepage.
 */
export async function POST(_req: Request, { params }: Params) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Fork is only meaningful for shares the caller can actually see.
  const isOwner = artifact.owner_id === userId;
  if (!isOwner && artifact.visibility !== "public") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (artifact.kind !== "dr_outcome") {
    return NextResponse.json(
      { error: "Only Decision Room shares can be forked" },
      { status: 400 },
    );
  }

  const original = await getDecisionSession(artifact.ref_id);
  if (!original) {
    return NextResponse.json({ error: "Original session is gone" }, { status: 410 });
  }

  const newSessionId = nanoid(8);
  const initiatorToken = nanoid(24);
  const partnerToken = nanoid(24);
  await createDecisionSession({
    id: newSessionId,
    initiatorUserId: userId,
    initiatorSessionToken: initiatorToken,
    partnerSessionToken: partnerToken,
    initiatorConstraints: original.initiator_constraints,
    cityId: original.city_id,
    decisionType: original.decision_type,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shareUrl = `${base}/decide/${newSessionId}`;

  // Set initiator cookie so the forker is recognized as initiator on the
  // PATCH path even before Clerk userId comparison runs.
  const res = NextResponse.json({
    sessionId: newSessionId,
    shareUrl,
    forkedFromSlug: slug,
  });
  res.cookies.set(`dr_init_${newSessionId}`, initiatorToken, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  return res;
}
