import {
  appendTaskEvent,
  completeJob,
  runExecutionJobWithRecovery,
  updateTravelTaskState,
  type ExecutionJobRequest,
  type ExecutionJobResult,
  type ExecutionJobStatus,
  type TravelTaskState,
} from "@/lib/core";

export async function runTravelTaskAttempt(params: {
  taskId: string;
  jobId: string;
  execution: ExecutionJobRequest;
}): Promise<void> {
  await runAttemptForTask(params.taskId, params.jobId, params.execution);
}

async function runAttemptForTask(
  taskId: string,
  jobId: string,
  execution: ExecutionJobRequest,
): Promise<void> {
  try {
    const result = await runExecutionJobWithRecovery(execution, {
      jobId,
      userId: null,
      stepIndex: 0,
    });
    await completeJob(jobId, result);
    await appendTaskEvent(taskId, "execution_finished", {
      jobId,
      status: result.status,
      summary: result.summary,
      error: result.error,
    });
    await updateTravelTaskState(taskId, mapExecutionStatusToTaskState(result.status), {
      jobId,
      executionStatus: result.status,
      ...terminalDataForResult(result),
    });
  } catch (err) {
    console.error(`[api/v1/travel-tasks] executor crashed for task ${taskId}`, err);
    const message = err instanceof Error ? err.message : String(err);
    const result: ExecutionJobResult = {
      jobId,
      status: "error",
      summary: "Executor crashed",
      error: message,
      decisionLog: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await completeJob(jobId, result).catch(() => {});
    await appendTaskEvent(taskId, "execution_finished", {
      jobId,
      status: "error",
      error: message,
    }).catch(() => {});
    await updateTravelTaskState(taskId, "failed", {
      jobId,
      executionStatus: "error",
      terminalCode: "executor_crashed",
      terminalReason: message,
      error: message,
    }).catch(() => {});
  }
}

function terminalDataForResult(result: ExecutionJobResult): Record<string, unknown> {
  switch (result.status) {
    case "completed":
      return { terminalCode: "completed", terminalReason: result.summary };
    case "paused_payment":
    case "ready_for_confirmation":
      return { terminalCode: result.status, terminalReason: result.summary };
    case "needs_profile_data": {
      const profileGap = result.profileGap;
      return {
        terminalCode: "needs_profile_data",
        terminalReason: profileGap?.message ?? result.summary,
        ...(profileGap
          ? {
              profileGap,
              missing: profileGap.missing,
              profileGapScenario: profileGap.scenario,
            }
          : {}),
      };
    }
    case "needs_login":
    case "needs_otp":
      return { terminalCode: result.status, terminalReason: result.summary };
    case "captcha":
    case "error":
    case "no_availability":
      return { terminalCode: result.status, terminalReason: result.error ?? result.summary };
    case "pending":
    case "running":
      return {};
  }
}

function mapExecutionStatusToTaskState(status: ExecutionJobStatus): TravelTaskState {
  switch (status) {
    case "needs_profile_data":
      return "awaiting_profile";
    case "needs_login":
      return "awaiting_login";
    case "needs_otp":
      return "awaiting_otp";
    case "paused_payment":
    case "ready_for_confirmation":
      return "ready_for_confirmation";
    case "completed":
      return "completed";
    case "pending":
    case "running":
      return "executing";
    case "captcha":
    case "error":
    case "no_availability":
      return "failed";
  }
}
