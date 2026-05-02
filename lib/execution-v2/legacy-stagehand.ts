import type { BrowserTaskStatus } from "../booking-autopilot/types";
import { runBrowserTask } from "../booking-autopilot/stagehand-executor";
import type { DecisionLogEntry } from "../db";
import type { ExecutionJobResult, ExecutionJobStatus } from "../core/execution/types";
import type { BookingExecutor, BookingExecutorInput } from "./types";

export const legacyStagehandExecutor: BookingExecutor = {
  id: "legacy_stagehand",
  async run(input: BookingExecutorInput): Promise<ExecutionJobResult> {
    const taskResult = await runBrowserTask(input.browserTask);
    const status = mapTaskStatusToJobStatus(taskResult.status);
    const now = new Date().toISOString();

    return {
      jobId: input.ctx.jobId,
      status,
      handoffUrl: taskResult.handoffUrl,
      sessionUrl: taskResult.sessionUrl,
      summary: taskResult.summary,
      screenshotBase64: taskResult.screenshotBase64,
      decisionLog: buildSummaryLog(taskResult.debugTrace, input.createdAt),
      error: taskResult.error,
      availableSlots: taskResult.availableSlots,
      createdAt: input.createdAt,
      updatedAt: now,
      completedAt: isTerminalStatus(status) ? now : undefined,
      attemptCount: 1,
      usedFallback: false,
    };
  },
};

function mapTaskStatusToJobStatus(s: BrowserTaskStatus): ExecutionJobStatus {
  switch (s) {
    case "completed":
      return "completed";
    case "paused_payment":
      return "paused_payment";
    case "needs_login":
      return "needs_login";
    case "captcha":
      return "captcha";
    case "no_availability":
      return "no_availability";
    case "error":
      return "error";
  }
}

function isTerminalStatus(s: ExecutionJobStatus): boolean {
  return (
    s === "paused_payment" ||
    s === "ready_for_confirmation" ||
    s === "needs_otp" ||
    s === "completed" ||
    s === "no_availability" ||
    s === "error" ||
    s === "needs_login" ||
    s === "captcha"
  );
}

function buildSummaryLog(trace: string[] | undefined, createdAt: string): DecisionLogEntry[] {
  if (!trace?.length) return [];
  return [
    {
      ts: createdAt,
      type: "info",
      message: `Executor trace (${trace.length} entries)`,
      outcome: trace[trace.length - 1]?.slice(0, 120),
    },
  ];
}
