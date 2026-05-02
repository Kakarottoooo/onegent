import { NextResponse } from "next/server";
import { listBrowserSnapshots } from "@/lib/browser-snapshot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const snapshots = await listBrowserSnapshots(jobId);
  return NextResponse.json({ snapshots });
}
