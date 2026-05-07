import { NextResponse } from "next/server";
import { resolveBookingJobAccess, readBookingJobSessionId } from "@/lib/booking-jobs/access";
import {
  listBrowserSnapshots,
  toBrowserSnapshotListEntry,
} from "@/lib/browser-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const access = await resolveBookingJobAccess(req, jobId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const sessionId = readBookingJobSessionId(req);
  const snapshots = (await listBrowserSnapshots(jobId)).map((snapshot) =>
    toBrowserSnapshotListEntry(
      snapshot,
      withSessionParam(
        `/api/browser-live/${encodeURIComponent(jobId)}/snapshots/${encodeURIComponent(snapshot.id)}/image`,
        sessionId,
      ),
    ),
  );
  return NextResponse.json({ snapshots });
}

function withSessionParam(path: string, sessionId: string | null): string {
  if (!sessionId) return path;
  return `${path}?session_id=${encodeURIComponent(sessionId)}`;
}
