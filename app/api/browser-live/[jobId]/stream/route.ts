import { browserSessionStore } from "@/lib/browser-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const page = browserSessionStore.get(jobId);

  if (!page) {
    console.log(`[live-stream] 404 — no session for jobId=${jobId}`);
    return new Response("Session not found or expired", { status: 404 });
  }

  console.log(`[live-stream] starting stream jobId=${jobId.slice(0, 8)}`);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // controller already closed
        }
      };

      // Initial connection event
      send(`event: connected\ndata: ok\n\n`);

      let consecutiveFailures = 0;
      let framesSent = 0;

      while (!closed) {
        const livePage = browserSessionStore.get(jobId);
        if (!livePage) {
          console.log(`[live-stream] session gone, closing jobId=${jobId}`);
          send(`event: closed\ndata: session ended\n\n`);
          break;
        }

        try {
          if (typeof livePage.isClosed === "function" && livePage.isClosed()) {
            console.log(`[live-stream] page closed, ending stream jobId=${jobId}`);
            send(`event: closed\ndata: session ended\n\n`);
            break;
          }

          const buf = await livePage.screenshot({ type: "jpeg", quality: 50, timeout: 2500 });
          const b64 = buf.toString("base64");
          framesSent++;
          if (framesSent === 1) {
            console.log(`[live-stream] first frame jobId=${jobId.slice(0, 8)} (${buf.length}b)`);
          }
          send(`data: ${b64}\n\n`);
          consecutiveFailures = 0;
        } catch (error) {
          consecutiveFailures += 1;
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const definitelyClosed =
            message.includes("target page, context or browser has been closed") ||
            message.includes("browser has been closed") ||
            message.includes("page has been closed") ||
            message.includes("session closed");

          if (consecutiveFailures === 1 || consecutiveFailures % 5 === 0) {
            console.log(`[live-stream] screenshot fail #${consecutiveFailures} jobId=${jobId}: ${message.slice(0, 200)}`);
          }

          if (definitelyClosed) {
            console.log(`[live-stream] page closed — ending stream jobId=${jobId}`);
            send(`event: closed\ndata: session ended\n\n`);
            break;
          }

          // Don't give up on transient failures (stagehand.act() holds CDP lock).
          // Keep retrying — the stream will recover as soon as the action completes.
          if (consecutiveFailures >= 40) {
            // 40 * 200ms = 8s total wait — something is really stuck
            console.log(`[live-stream] giving up after ${consecutiveFailures} failures jobId=${jobId}`);
            send(`event: closed\ndata: session ended\n\n`);
            break;
          }

          // Keep-alive comment so SSE connection stays open
          send(`: screenshot-failure-${consecutiveFailures}\n\n`);
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        await new Promise((r) => setTimeout(r, 80));
      }

      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      console.log(`[live-stream] client disconnected jobId=${jobId}`);
      closed = true;
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
