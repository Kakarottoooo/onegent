import { NextRequest, NextResponse } from "next/server";
import {
  getAgentLogs,
  getBookingJob,
  type BookingJob,
} from "@/lib/db";
import {
  liveLogEpoch,
  liveLogGet,
  liveLogIsClosed,
  type LiveLogLineEntry,
} from "@/lib/live-log-store";
import {
  buildTaskTimelineEvents,
  buildTaskTimelineSummary,
} from "@/lib/task-timeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const TERMINAL_JOB_STATUSES = new Set(["done", "failed", "cancelled", "succeeded"]);
const STREAM_INTERVAL_MS = 1_200;
const STREAM_MAX_MS = 60_000;

interface TraceSnapshot {
  entries: LiveLogLineEntry[];
  closed: boolean;
  epoch: number;
  source: "live" | "audit";
}

async function readTrace(jobId: string, job: BookingJob): Promise<TraceSnapshot> {
  const liveEntries = liveLogGet(jobId, 0);
  if (liveEntries.length > 0) {
    return {
      entries: liveEntries,
      closed: liveLogIsClosed(jobId),
      epoch: liveLogEpoch(jobId),
      source: "live",
    };
  }

  const auditRows = await getAgentLogs({
    jobId,
    source: "audit",
    limit: 500,
  });

  const entries = [...auditRows].reverse().map((row) => {
    const details = (row.details ?? {}) as Record<string, unknown>;
    const eventType = typeof details.type === "string" ? details.type : "info";
    const rawTs = row.created_at as unknown;
    const ts = rawTs instanceof Date
      ? rawTs.toISOString()
      : new Date(rawTs as string | number).toISOString();

    return {
      line: `[${eventType}] ${row.message}`,
      ts,
    };
  });

  return {
    entries,
    closed: TERMINAL_JOB_STATUSES.has(job.status),
    epoch: 0,
    source: "audit",
  };
}

async function buildPayload(jobId: string) {
  const job = await getBookingJob(jobId);
  if (!job) return null;

  const trace = await readTrace(jobId, job);
  const events = buildTaskTimelineEvents(job, trace.entries);
  const summary = buildTaskTimelineSummary(job);
  const closed = trace.closed || TERMINAL_JOB_STATUSES.has(job.status);

  return {
    jobId,
    job,
    events,
    summary,
    entries: trace.entries,
    total: trace.entries.length,
    closed,
    epoch: trace.epoch,
    source: trace.source,
  };
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
    const payload = await buildPayload(id);
    if (!payload) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
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
        const payload = await buildPayload(id);
        if (!payload) {
          send("error", { error: "Job not found" });
          break;
        }

        const serialized = JSON.stringify(payload);
        if (serialized !== lastSerialized) {
          send("timeline", payload);
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
