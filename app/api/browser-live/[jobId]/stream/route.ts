import { browserSessionStore } from "@/lib/browser-session-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const page = browserSessionStore.get(jobId);

  if (!page) {
    return new Response("Session not found or expired", { status: 404 });
  }

  let closed = false;
  const encoder = new TextEncoder();
  const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: string) => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
  };
  const sendComment = (controller: ReadableStreamDefaultController<Uint8Array>, comment: string) => {
    controller.enqueue(encoder.encode(`: ${comment}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      sendEvent(controller, "connected", "ok");
      let consecutiveFailures = 0;

      while (!closed) {
        const livePage = browserSessionStore.get(jobId);
        if (!livePage) {
          sendEvent(controller, "closed", "session ended");
          break;
        }

        try {
          if (typeof livePage.isClosed === "function" && livePage.isClosed()) {
            sendEvent(controller, "closed", "session ended");
            break;
          }

          const buf = await livePage.screenshot({ type: "jpeg", quality: 55 });
          const b64 = buf.toString("base64");
          controller.enqueue(encoder.encode(`data: ${b64}\n\n`));
          consecutiveFailures = 0;
        } catch (error) {
          consecutiveFailures += 1;
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const definitelyClosed =
            message.includes("target page, context or browser has been closed") ||
            message.includes("browser has been closed") ||
            message.includes("page has been closed") ||
            message.includes("session closed");

          if (definitelyClosed || consecutiveFailures >= 10) {
            sendEvent(controller, "closed", "session ended");
            break;
          }

          // Navigation and rendering can make screenshot() fail briefly. Keep the
          // stream alive and let the client continue using EventSource.
          sendComment(controller, `transient screenshot failure ${consecutiveFailures}`);
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
