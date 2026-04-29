import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { softDeleteComment } from "@/lib/db";

type Params = { params: Promise<{ slug: string; id: string }> };

/**
 * DELETE /api/share/[slug]/comments/[id]
 *
 * Soft-delete a comment. Allowed if caller is either the comment author OR
 * the artifact owner (moderation). The slug param exists for symmetry but
 * isn't strictly required — comment ID alone is unique. The auth check is
 * inside the helper via a subquery on shared_artifacts.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await softDeleteComment(id, userId);
  if (!ok) {
    return NextResponse.json(
      { error: "Comment not found or not yours to delete" },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
