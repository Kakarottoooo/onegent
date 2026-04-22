import { NextRequest, NextResponse } from "next/server";
import { deleteOrphanMonitorsBySession } from "@/lib/db";

/**
 * POST /api/monitors/cleanup-orphans
 *
 * Deletes booking_monitors rows whose job_id no longer resolves to a real
 * booking_jobs row — leftovers from older clear-all/delete paths that did
 * not cascade. Safe to call on every Live panel mount.
 *
 * Body: { session_id: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const removed = await deleteOrphanMonitorsBySession(sessionId);
  return NextResponse.json({ removed });
}
