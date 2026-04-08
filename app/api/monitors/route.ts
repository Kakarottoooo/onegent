/**
 * GET  /api/monitors?session_id=...  — list monitors for a session
 * POST /api/monitors                 — create a monitor manually
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getBookingMonitorsBySession,
  createBookingMonitor,
  deleteAllMonitorsBySession,
} from "@/lib/db";
import type { BookingMonitor } from "@/lib/monitors";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  try {
    const monitors = await getBookingMonitorsBySession(sessionId);
    return NextResponse.json({ monitors });
  } catch (err) {
    console.error("monitors GET error", err);
    return NextResponse.json({ error: "Failed to load monitors" }, { status: 500 });
  }
}

/** DELETE /api/monitors?session_id=... — bulk delete all monitors for a session */
export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  try {
    await deleteAllMonitorsBySession(sessionId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("monitors DELETE error", err);
    return NextResponse.json({ error: "Failed to delete monitors" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Omit<BookingMonitor, "created_at">;
    if (!body.id || !body.job_id || !body.session_id || !body.type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    await createBookingMonitor(body);
    return NextResponse.json({ ok: true, id: body.id });
  } catch (err) {
    console.error("monitors POST error", err);
    return NextResponse.json({ error: "Failed to create monitor" }, { status: 500 });
  }
}
