import type { BrowserTaskInput } from "../booking-autopilot/types";
import type {
  ExecutionJobRequest,
  ExecutionJobResult,
} from "../core/execution/types";

export type BookingExecutorId =
  | "legacy_stagehand"
  | "computer_use"
  | "manual_takeover";

export interface BookingExecutorContext {
  jobId: string;
  userId?: string | null;
  stepIndex: number;
}

export interface BookingExecutorInput {
  request: ExecutionJobRequest;
  ctx: BookingExecutorContext;
  browserTask: BrowserTaskInput;
  createdAt: string;
}

export interface BookingExecutor {
  id: BookingExecutorId;
  run(input: BookingExecutorInput): Promise<ExecutionJobResult>;
}

export interface ExecutorSelection {
  id: BookingExecutorId;
  reason: string;
}
