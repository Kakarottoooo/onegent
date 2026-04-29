import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getSharedArtifactBySlug,
  toggleReaction,
  getReactionState,
  createNotification,
  getUserProfile,
} from "@/lib/db";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/share/[slug]/react
 * Returns reaction counts + whether the caller has reacted (per kind).
 * Public for anyone who can see the artifact.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { userId } = await auth();
  // Same visibility gate as the slug page itself — private artifacts
  // never leak existence via this endpoint.
  const isOwner = !!userId && userId === artifact.owner_id;
  if (!isOwner && artifact.visibility !== "public") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const state = await getReactionState(artifact.id, userId ?? null);
  return NextResponse.json(state);
}

/**
 * POST /api/share/[slug]/react { kind?: 'heart' }
 * Toggle the caller's reaction. Sign-in required.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Reactions only on public artifacts — keeps the social loop scoped to
  // content the owner explicitly published.
  if (artifact.visibility !== "public") {
    return NextResponse.json({ error: "Cannot react to a private share" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const rawKind = typeof body.kind === "string" ? body.kind.trim() : "heart";
  // v1 allowlist — keeps the surface tight while we observe usage. Add
  // emojis here once we have data on what people actually want.
  if (!["heart"].includes(rawKind)) {
    return NextResponse.json({ error: `Reaction '${rawKind}' not supported` }, { status: 400 });
  }

  const toggled = await toggleReaction(artifact.id, userId, rawKind);

  // Only notify on the *adding* edge, never on un-react. Dedupe per
  // (reactor, artifact) so a flapping toggle doesn't spam the owner.
  if (toggled.active && artifact.owner_id !== userId) {
    try {
      const fromProfile = await getUserProfile(userId);
      const fromLabel =
        fromProfile?.display_name ??
        (fromProfile?.username
          ? `@${fromProfile.username}`
          : `@${fromProfile?.profile_code ?? "someone"}`);
      await createNotification({
        userId: artifact.owner_id,
        kind: "reaction_received",
        title: `${fromLabel} hearted your share`,
        body: null,
        linkUrl: `/s/${slug}`,
        metadata: { artifact_id: artifact.id, slug, from_user_id: userId, kind: rawKind },
        dedupeKey: `reaction:${artifact.id}:${userId}:${rawKind}`,
      });
    } catch {
      /* non-fatal */
    }
  }

  const state = await getReactionState(artifact.id, userId);
  return NextResponse.json({ ...toggled, ...state });
}
