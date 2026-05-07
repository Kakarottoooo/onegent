import { NextResponse } from "next/server";
import { resolveBookingJobAccess, readBookingJobSessionId } from "@/lib/booking-jobs/access";
import {
  listBrowserSnapshots,
  toBrowserSnapshotListEntry,
} from "@/lib/browser-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const access = await resolveBookingJobAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const sessionId = readBookingJobSessionId(req);

  const snapshots = (await listBrowserSnapshots(id)).map((snapshot) =>
    toBrowserSnapshotListEntry(
      snapshot,
      withSessionParam(
        `/api/booking-jobs/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshot.id)}/image`,
        sessionId,
      ),
    ),
  );
  return NextResponse.json({
    jobId: id,
    count: snapshots.length,
    snapshots,
  });
}

function withSessionParam(path: string, sessionId: string | null): string {
  if (!sessionId) return path;
  return `${path}?session_id=${encodeURIComponent(sessionId)}`;
}
