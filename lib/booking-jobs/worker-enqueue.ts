import type { BookingJobStep } from "@/lib/db";
import {
  CORE_EXECUTION_SOURCE,
  isCoreExecutionSource,
  isCoreSupported,
  markStepForCore,
  PENDING_QUEUE_STATUS,
} from "@/lib/core/cend-adapter";

const DEFAULT_WORKER_SCENARIOS = ["restaurant", "hotel", "flight", "activity"] as const;

export type WorkerQueuePreparation = {
  steps: BookingJobStep[];
  effectiveWorkerScenarios: string[];
  shouldUseWorkerQueue: boolean;
  stampedCount: number;
  status: "pending_local" | "pending" | undefined;
};

export function parseWorkerScenarioList(raw: string | undefined): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((scenario) => scenario.trim())
    .filter((scenario) => scenario.length > 0 && scenario !== "*" && scenario.toLowerCase() !== "all");
  return parsed.length > 0 ? parsed : [...DEFAULT_WORKER_SCENARIOS];
}

function normalizeMarkedStepForQueue(step: BookingJobStep): {
  step: BookingJobStep;
  stamped: boolean;
} {
  const body = step.body as Record<string, unknown> | undefined;
  if (isCoreExecutionSource(body?.__source)) {
    if (body?.__source === CORE_EXECUTION_SOURCE) {
      return { step, stamped: false };
    }
    return {
      step: {
        ...step,
        body: {
          ...body,
          __source: CORE_EXECUTION_SOURCE,
        },
      },
      stamped: true,
    };
  }

  return { step: markStepForCore(step), stamped: true };
}

export function prepareWorkerQueueSteps(
  steps: BookingJobStep[],
  rawUseWorkerFor: string | undefined,
): WorkerQueuePreparation {
  const effectiveWorkerScenarios = parseWorkerScenarioList(rawUseWorkerFor);
  const allWorkerRoutable =
    steps.length > 0 &&
    steps.every(
      (step) =>
        isCoreSupported(step.type) &&
        effectiveWorkerScenarios.includes(step.type),
    );

  if (!allWorkerRoutable) {
    return {
      steps,
      effectiveWorkerScenarios,
      shouldUseWorkerQueue: false,
      stampedCount: 0,
      status: undefined,
    };
  }

  const stampedSteps: BookingJobStep[] = [];
  let stampedCount = 0;
  try {
    for (const step of steps) {
      const result = normalizeMarkedStepForQueue(step);
      stampedSteps.push(result.step);
      if (result.stamped) stampedCount += 1;
    }
  } catch {
    return {
      steps,
      effectiveWorkerScenarios,
      shouldUseWorkerQueue: false,
      stampedCount: 0,
      status: undefined,
    };
  }

  return {
    steps: stampedSteps,
    effectiveWorkerScenarios,
    shouldUseWorkerQueue: true,
    stampedCount,
    status: PENDING_QUEUE_STATUS as "pending_local" | "pending",
  };
}
