/**
 * StagehandExecutor — type-only adapter that wraps the existing
 * runBrowserTask in the BookingExecutor interface.
 *
 * Intentionally lightweight: no behavioural changes vs calling
 * runBrowserTask directly. The adapter exists so Phase 3's executor router
 * has a uniform shape to dispatch to. Today the start route still calls
 * runBrowserTask directly — wiring the router in is a Phase 3 task.
 */

import { runBrowserTask } from "../stagehand-executor";
import type { BrowserTaskResult } from "../types";
import type {
  BookingExecutor,
  ExecutorCapability,
  ExecutorInput,
  ExecutorResult,
  ExecutorStatus,
} from "./types";

export const stagehandExecutor: BookingExecutor = {
  name: "stagehand",

  async canHandle(input: ExecutorInput): Promise<ExecutorCapability> {
    if (!input.browserTask?.startUrl) {
      return { can: false, reason: "missing browserTask.startUrl" };
    }
    if (!input.browserTask?.task) {
      return { can: false, reason: "missing browserTask.task" };
    }
    return { can: true };
  },

  async run(input: ExecutorInput): Promise<ExecutorResult> {
    if (!input.browserTask) {
      return { status: "error", reason: "no browserTask provided" };
    }
    const result = await runBrowserTask(input.browserTask);
    return {
      status: mapBrowserStatus(result.status),
      handoff_url: result.handoffUrl,
      message: result.summary,
      reason: result.error,
      debugTrace: result.debugTrace,
    };
  },
};

export function mapBrowserStatus(status: BrowserTaskResult["status"]): ExecutorStatus {
  switch (status) {
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
    default:
      return "error";
  }
}
