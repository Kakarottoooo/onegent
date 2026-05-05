import { NextRequest, NextResponse } from "next/server";
import { buildJobTimelinePayload } from "@/lib/task-timeline-payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const STREAM_INTERVAL_MS = 1_200;
const STREAM_MAX_MS = 60_000;

type TimelinePayload = NonNullable<Awaited<ReturnType<typeof buildJobTimelinePayload>>>;

function toSlimTimelinePayload(payload: TimelinePayload) {
  const { job: _job, entries: _entries, ...slim } = payload;
  return slim;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = new URL(req.url);
  const wantsJson =
    url.searchParams.get("format") === "json" ||
    req.headers.get("accept")?.includes("application/json");

  if (wantsJson) {
    const payload = await buildJobTimelinePayload(id);
    if (!payload) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(url.searchParams.get("slim") === "1"
      ? toSlimTimelinePayload(payload)
      : payload);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastSerialized = "";
      const startedAt = Date.now();

      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      controller.enqueue(encoder.encode("retry: 1500\n\n"));

      while (!req.signal.aborted && Date.now() - startedAt < STREAM_MAX_MS) {
        const payload = await buildJobTimelinePayload(id);
        if (!payload) {
          send("error", { error: "Job not found" });
          break;
        }

        const streamPayload = toSlimTimelinePayload(payload);
        const serialized = JSON.stringify(streamPayload);
        if (serialized !== lastSerialized) {
          send("timeline", streamPayload);
          lastSerialized = serialized;
        } else {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }

        if (payload.closed) break;
        await sleep(STREAM_INTERVAL_MS);
      }

      try {
        controller.close();
      } catch {
        // The client may have already disconnected.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Content-Encoding": "identity",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
