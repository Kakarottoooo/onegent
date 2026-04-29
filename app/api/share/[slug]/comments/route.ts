import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getSharedArtifactBySlug,
  createComment,
  createNotification,
  getUserProfile,
  listCommentsByArtifact,
} from "@/lib/db";

type Params = { params: Promise<{ slug: string }> };

const MAX_BODY = 280;

/**
 * GET /api/share/[slug]/comments
 * Public read for visible artifacts. Returns comments ASC by created_at
 * with author profile fields inlined.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { userId } = await auth();
  const isOwner = !!userId && userId === artifact.owner_id;
  if (!isOwner && artifact.visibility !== "public") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const comments = await listCommentsByArtifact(artifact.id);
  return NextResponse.json({ comments, artifact_owner_id: artifact.owner_id });
}

/**
 * POST /api/share/[slug]/comments { body: string }
 * Sign-in required; body capped at 280 chars (DB also truncates).
 * Public artifacts only — same scope as reactions.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (artifact.visibility !== "public") {
    return NextResponse.json({ error: "Cannot comment on a private share" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { body?: string };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Body is required" }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: `Comments are capped at ${MAX_BODY} chars` }, { status: 400 });
  }

  const comment = await createComment(artifact.id, userId, text);

  // Notify the artifact owner — but never self-notify (owner commenting
  // on their own thing).
  if (artifact.owner_id !== userId) {
    try {
      const fromProfile = await getUserProfile(userId);
      const fromLabel =
        fromProfile?.display_name ??
        (fromProfile?.username
          ? `@${fromProfile.username}`
          : `@${fromProfile?.profile_code ?? "someone"}`);
      await createNotification({
        userId: artifact.owner_id,
        kind: "comment_received",
        title: `${fromLabel} commented on your share`,
        body: text.slice(0, 140),
        linkUrl: `/s/${slug}`,
        metadata: { artifact_id: artifact.id, slug, from_user_id: userId, comment_id: comment.id },
      });
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ comment, artifact_owner_id: artifact.owner_id });
}
