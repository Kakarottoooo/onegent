import { NextResponse } from "next/server";
import { liveLogGet, liveLogIsClosed, liveLogEpoch } from "@/lib/live-log-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const after = parseInt(url.searchParams.get("after") ?? "0", 10);

  const lines = liveLogGet(id, after);
  const total = after + lines.length;
  const closed = liveLogIsClosed(id);
  const epoch = liveLogEpoch(id);

  return NextResponse.json({ lines, total, closed, epoch });
}
