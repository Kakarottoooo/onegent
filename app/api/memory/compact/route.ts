/**
 * GET /api/memory/compact?session_id=...
 *
 * Shell-safe memory summary. It returns bounded counts, labels, and rates
 * without full preference profiles, raw feedback metadata, or booking steps.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCompactMemoryEndpointResponse } from "@/lib/memory-endpoint";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  try {
    return NextResponse.json(await getCompactMemoryEndpointResponse(sessionId));
  } catch (err) {
    console.error("memory compact GET error", err);
    return NextResponse.json({ error: "Failed to build compact memory model" }, { status: 500 });
  }
}
