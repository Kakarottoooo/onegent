import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  createSharedArtifact,
  getBookingJob,
  getDecisionSession,
  type SharedArtifactKind,
  type SharedArtifactVisibility,
  type SharedArtifactOptions,
} from "@/lib/db";

/**
 * GET /api/share?r=<base64-json> — legacy ad-hoc share endpoint.
 * Kept for backwards compat; new code should POST to mint a slug-based
 * artifact and read it via /api/share/[slug].
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const r = searchParams.get("r");

  if (!r) {
    return NextResponse.json({ error: "Missing r parameter" }, { status: 400 });
  }

  try {
    const decoded = Buffer.from(r, "base64").toString("utf-8");
    const data = JSON.parse(decoded);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Invalid share token" }, { status: 400 });
  }
}

/**
 * POST /api/share
 *
 * Mint a shareable artifact for a booking, DR outcome, or future kinds.
 * Validates that the caller actually owns the underlying ref_id — we don't
 * want random users sharing other people's bookings.
 *
 * Body: { kind, refId, visibility?, options? }
 * Returns: { artifact, url }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    refId?: string;
    visibility?: string;
    options?: SharedArtifactOptions;
  } | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const kind = body.kind as SharedArtifactKind | undefined;
  const refId = typeof body.refId === "string" ? body.refId.trim() : "";
  if (!kind || !refId) {
    return NextResponse.json({ error: "kind and refId required" }, { status: 400 });
  }

  // v1 only allows these two share targets — taste_profile / itinerary kinds
  // come later. The DB CHECK constraint accepts the other values for forward
  // compat but the API gates them so we don't ship half-built UIs.
  if (kind !== "booking" && kind !== "dr_outcome") {
    return NextResponse.json({ error: `kind '${kind}' not yet supported` }, { status: 400 });
  }

  // Validate ownership of the ref_id — prevents A from sharing B's booking.
  if (kind === "booking") {
    const job = await getBookingJob(refId);
    if (!job) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (job.user_id !== userId) {
      return NextResponse.json({ error: "Not your booking" }, { status: 403 });
    }
  } else {
    const session = await getDecisionSession(refId);
    if (!session) {
      return NextResponse.json({ error: "Decision session not found" }, { status: 404 });
    }
    const isInitiator = session.initiator_user_id === userId;
    const isInvitee = session.invitee_user_id === userId;
    if (!isInitiator && !isInvitee) {
      return NextResponse.json({ error: "Not your decision room" }, { status: 403 });
    }
    if (session.status !== "decided") {
      return NextResponse.json(
        { error: "Decision room must be decided before sharing" },
        { status: 409 },
      );
    }
  }

  // v1 visibility is just private | public (the DB allows more for forward
  // compat, but exposing 'contacts' / 'specific' without UI/audience would
  // create dead options).
  const requestedVisibility = (body.visibility as SharedArtifactVisibility) ?? "private";
  if (requestedVisibility !== "private" && requestedVisibility !== "public") {
    return NextResponse.json(
      { error: `visibility '${requestedVisibility}' not yet supported` },
      { status: 400 },
    );
  }

  const options: SharedArtifactOptions = {
    showPrice: body.options?.showPrice ?? true,
    showTime: body.options?.showTime ?? true,
  };

  const artifact = await createSharedArtifact({
    ownerId: userId,
    kind,
    refId,
    visibility: requestedVisibility,
    options,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  // Public landing lives at /s/[slug] — short for sharing, and avoids the
  // legacy /share/[token] base64 flow still wired into the home page.
  const url = `${base}/s/${artifact.slug}`;

  return NextResponse.json({ artifact, url });
}
