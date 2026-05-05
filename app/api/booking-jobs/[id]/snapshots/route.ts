import { NextResponse } from "next/server";
import { getBookingJob } from "@/lib/db";
import {
  listBrowserSnapshots,
  toBrowserSnapshotListEntry,
} from "@/lib/browser-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const job = await getBookingJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const snapshots = (await listBrowserSnapshots(id)).map((snapshot) =>
    toBrowserSnapshotListEntry(
      snapshot,
      `/api/booking-jobs/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshot.id)}/image`,
    ),
  );
  return NextResponse.json({
    jobId: id,
    count: snapshots.length,
    snapshots,
  });
}
