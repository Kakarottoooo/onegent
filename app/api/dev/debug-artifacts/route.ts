/**
 * GET /api/dev/debug-artifacts — list providers + their runs.
 *
 * Same dev gate as the rest of `/api/dev/*`: NODE_ENV !== "production"
 * OR ENABLE_DEV_BENCHMARK_API=1 (re-using the env var on purpose).
 *
 * Returns DebugArtifactIndex (see lib/debug-artifacts.ts).
 */
import { NextResponse } from "next/server";
import { listDebugArtifacts } from "@/lib/debug-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }
  const index = await listDebugArtifacts();
  return NextResponse.json(index);
}

function isDevApiEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_BENCHMARK_API === "1"
  );
}
