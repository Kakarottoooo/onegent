/**
 * Stage 0B lab event writer — pure helpers.
 *
 * Builds and serializes LabEvent records to JSONL. The lab runner writes
 * the JSONL file; downstream tests / cockpit code reads it back. The
 * writer never touches the network, browser, or Browser Harness.
 */

import type {
  LabAction,
  LabEvent,
  LabHardStopReason,
  LabOutcome,
  LabVisibleFacts,
  Stage0bLabProvider,
} from "./types";
import type { ActivitySkillPageType } from "@/lib/activity-skills";

export interface BuildLabEventInput {
  run_id: string;
  seq: number;
  provider: Stage0bLabProvider;
  page_type: ActivitySkillPageType;
  action: LabAction;
  currentUrl: string;
  outcome: LabOutcome;
  timestamp?: string;
  screenshotPath?: string;
  visible_facts?: LabVisibleFacts;
  hardStop?: LabHardStopReason;
  notes?: string;
}

/**
 * Build a fully-validated LabEvent. Throws when the inputs violate the
 * contract documented in STAGE0B_TM_SEATGEEK_LAB.md so the runner cannot
 * silently emit malformed evidence.
 */
export function buildLabEvent(input: BuildLabEventInput): LabEvent {
  if (!input.run_id || typeof input.run_id !== "string") {
    throw new Error("buildLabEvent: run_id is required and must be a non-empty string");
  }
  if (!Number.isInteger(input.seq) || input.seq < 1) {
    throw new Error(`buildLabEvent: seq must be an integer >= 1 (got ${input.seq})`);
  }
  if (!input.currentUrl) {
    throw new Error("buildLabEvent: currentUrl is required (evidence-first)");
  }
  if (input.action === "halt_at_hard_stop" && !input.hardStop) {
    throw new Error(
      "buildLabEvent: action=halt_at_hard_stop requires a hardStop reason",
    );
  }
  if (input.action === "screenshot" && !input.screenshotPath) {
    throw new Error(
      "buildLabEvent: action=screenshot requires a screenshotPath (evidence-first)",
    );
  }
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    run_id: input.run_id,
    seq: input.seq,
    provider: input.provider,
    page_type: input.page_type,
    action: input.action,
    currentUrl: input.currentUrl,
    outcome: input.outcome,
    ...(input.screenshotPath ? { screenshotPath: input.screenshotPath } : {}),
    ...(input.visible_facts ? { visible_facts: input.visible_facts } : {}),
    ...(input.hardStop ? { hardStop: input.hardStop } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

/**
 * Serialize a LabEvent to a single JSONL line (no trailing newline so the
 * caller controls line termination). The writer guarantees the line
 * contains no embedded newlines so a partial-write never corrupts a later
 * line in the same JSONL file.
 */
export function serializeLabEvent(event: LabEvent): string {
  const json = JSON.stringify(event);
  if (json.includes("\n") || json.includes("\r")) {
    throw new Error(
      "serializeLabEvent: refusing to emit a JSONL line containing CR/LF (would corrupt the file)",
    );
  }
  return json;
}

/**
 * Parse a JSONL line back into a LabEvent. Throws on schema violations so
 * downstream readers cannot silently consume malformed evidence.
 */
export function parseLabEvent(line: string): LabEvent {
  const obj = JSON.parse(line);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("parseLabEvent: line did not parse to an object");
  }
  const e = obj as Record<string, unknown>;
  const required: Array<keyof LabEvent> = [
    "timestamp",
    "run_id",
    "seq",
    "provider",
    "page_type",
    "action",
    "currentUrl",
    "outcome",
  ];
  for (const k of required) {
    if (!(k in e)) {
      throw new Error(`parseLabEvent: missing required field "${k}"`);
    }
  }
  return obj as LabEvent;
}
