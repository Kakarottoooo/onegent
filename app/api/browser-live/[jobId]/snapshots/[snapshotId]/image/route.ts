import { getBrowserSnapshot } from "@/lib/browser-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string; snapshotId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { jobId, snapshotId } = await params;
  const snapshot = await getBrowserSnapshot(jobId, snapshotId);
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
