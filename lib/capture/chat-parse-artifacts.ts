import type { NluV2ParseResult } from "@/lib/agent/nlu-v2";
import {
  buildCaptureTravelObjectFromNlu,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
import {
  buildCaptureTaskBoundary,
  type CaptureTaskBoundaryResult,
} from "@/lib/capture/task-boundary";

export interface BuildCaptureChatParseArtifactsInput {
  message: string;
  result: NluV2ParseResult;
  sessionId?: string | null;
  chatId?: string | null;
  capturedAt?: string;
}

export interface CaptureChatParseArtifacts {
  capture_travel_object: CaptureTravelObject;
  capture_task_boundary: CaptureTaskBoundaryResult;
}

export function buildCaptureChatParseArtifacts(
  input: BuildCaptureChatParseArtifactsInput,
): CaptureChatParseArtifacts {
  const captureTravelObject = buildCaptureTravelObjectFromNlu({
    message: input.message,
    result: input.result,
    sessionId: input.sessionId,
    chatId: input.chatId,
    capturedAt: input.capturedAt,
  });
  const captureTaskBoundary = buildCaptureTaskBoundary(captureTravelObject, {
    sourceSessionId: input.sessionId,
    sourceChatId: input.chatId,
  });

  return {
    capture_travel_object: captureTravelObject,
    capture_task_boundary: captureTaskBoundary,
  };
}
