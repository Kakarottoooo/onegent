import { writeAudit } from "../core/audit/audit-log";
import type { BookingExecutor, BookingExecutorInput, ExecutorSelection } from "./types";
import { legacyStagehandExecutor } from "./legacy-stagehand";

export async function runBookingExecutor(input: BookingExecutorInput) {
  const selection = selectExecutor(input);
  await writeAudit({
    jobId: input.ctx.jobId,
    stepIndex: input.ctx.stepIndex,
    type: "executor_selected",
    message: `Selected ${selection.id} executor`,
    details: { reason: selection.reason },
  });

  const executor = await getExecutor(selection.id);
  return executor.run(input);
}

export function selectExecutor(input: BookingExecutorInput): ExecutorSelection {
  const forced = process.env.ONEGENT_EXECUTOR_V2?.trim();
  if (forced === "legacy_stagehand" || forced === "computer_use") {
    return { id: forced, reason: "ONEGENT_EXECUTOR_V2 override" };
  }

  const preferred = input.request.clientMetadata?.preferredExecutor;
  if (preferred === "legacy_stagehand" || preferred === "computer_use") {
    return { id: preferred, reason: "clientMetadata.preferredExecutor" };
  }

  const targets = splitTargets(process.env.ONEGENT_COMPUTER_USE_FOR);
  if (targets.has("all")) {
    return { id: "computer_use", reason: "ONEGENT_COMPUTER_USE_FOR=all" };
  }

  const scenario = input.request.request.scenario;
  if (targets.has(scenario)) {
    return { id: "computer_use", reason: `ONEGENT_COMPUTER_USE_FOR includes ${scenario}` };
  }

  const host = safeHost(input.browserTask.startUrl);
  if (targets.has(host) || (host.endsWith("resy.com") && targets.has("resy"))) {
    return { id: "computer_use", reason: `ONEGENT_COMPUTER_USE_FOR matched ${host}` };
  }

  return { id: "legacy_stagehand", reason: "default legacy path" };
}

async function getExecutor(id: string): Promise<BookingExecutor> {
  if (id === "computer_use") {
    const { computerUseExecutor } = await import("./computer-use");
    return computerUseExecutor;
  }
  return legacyStagehandExecutor;
}

function splitTargets(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
