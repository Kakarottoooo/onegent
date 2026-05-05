import { getBookingJob } from "@/lib/db";
import { getBrowserSnapshot } from "@/lib/browser-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; snapshotId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, snapshotId } = await params;
  const job = await getBookingJob(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const snapshot = await getBrowserSnapshot(id, snapshotId);
  if (!snapshot) {
    return new Response("Snapshot not found", { status: 404 });
  }

  return new Response(Buffer.from(snapshot.imageBase64, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
