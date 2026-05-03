import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import type { ExecutionJobRequest, ExecutionScenario } from "../execution/types";

export type TravelTaskState =
  | "draft"
  | "executing"
  | "awaiting_profile"
  | "awaiting_login"
  | "awaiting_otp"
  | "ready_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type TravelTaskEventKind =
  | "task_created"
  | "booking_job_created"
  | "execution_started"
  | "state_changed"
  | "execution_finished"
  | "task_cancelled";

export interface TravelTask {
  id: string;
  user_id: string | null;
  scenario: ExecutionScenario;
  title: string;
  state: TravelTaskState;
  request_json: ExecutionJobRequest;
  policy_json: Record<string, unknown>;
  current_booking_job_id: string | null;
  decision_room_id: string | null;
  terminal_reason: string | null;
  terminal_code: string | null;
  created_by_key_id: string | null;
  created_by_org_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface TravelTaskEvent {
  id: string;
  task_id: string;
  kind: TravelTaskEventKind;
  data_json: Record<string, unknown>;
  created_at: string;
}

let travelTaskTablesReady: Promise<void> | null = null;

export async function ensureTravelTaskTables(): Promise<void> {
  if (!travelTaskTablesReady) {
    travelTaskTablesReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS travel_tasks (
          id                     TEXT PRIMARY KEY,
          user_id                TEXT,
          scenario               TEXT NOT NULL,
          title                  TEXT NOT NULL,
          state                  TEXT NOT NULL,
          request_json           JSONB NOT NULL,
          policy_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
          current_booking_job_id TEXT,
          decision_room_id        TEXT,
          terminal_reason         TEXT,
          terminal_code           TEXT,
          created_by_key_id      TEXT,
          created_by_org_name    TEXT,
          created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS task_events (
          id         TEXT PRIMARY KEY,
          task_id    TEXT NOT NULL REFERENCES travel_tasks(id) ON DELETE CASCADE,
          kind       TEXT NOT NULL,
          data_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE travel_tasks ADD COLUMN IF NOT EXISTS decision_room_id TEXT`.catch(() => {});
      await sql`ALTER TABLE travel_tasks ADD COLUMN IF NOT EXISTS terminal_reason TEXT`.catch(() => {});
      await sql`ALTER TABLE travel_tasks ADD COLUMN IF NOT EXISTS terminal_code TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_jobs ADD COLUMN IF NOT EXISTS task_id TEXT`.catch(() => {});
      await sql`CREATE INDEX IF NOT EXISTS travel_tasks_user_idx ON travel_tasks (user_id) WHERE user_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS travel_tasks_state_idx ON travel_tasks (state)`;
      await sql`CREATE INDEX IF NOT EXISTS travel_tasks_current_job_idx ON travel_tasks (current_booking_job_id) WHERE current_booking_job_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS travel_tasks_decision_room_idx ON travel_tasks (decision_room_id) WHERE decision_room_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS booking_jobs_task_idx ON booking_jobs (task_id) WHERE task_id IS NOT NULL`.catch(() => {});
      await sql`CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events (task_id, created_at)`;
    })().catch((err) => {
      travelTaskTablesReady = null;
      throw err;
    });
  }
  await travelTaskTablesReady;
}

export async function createTravelTask(params: {
  userId?: string | null;
  scenario: ExecutionScenario;
  title: string;
  state?: TravelTaskState;
  request: ExecutionJobRequest;
  policy?: Record<string, unknown>;
  currentBookingJobId?: string | null;
  decisionRoomId?: string | null;
  createdByKeyId?: string | null;
  createdByOrgName?: string | null;
}): Promise<TravelTask> {
  await ensureTravelTaskTables();
  const id = randomUUID();
  const state = params.state ?? "draft";
  const requestJson = JSON.stringify(params.request);
  const policyJson = JSON.stringify(params.policy ?? {});
  const result = await sql<TravelTask>`
    INSERT INTO travel_tasks (
      id,
      user_id,
      scenario,
      title,
      state,
      request_json,
      policy_json,
      current_booking_job_id,
      decision_room_id,
      created_by_key_id,
      created_by_org_name
    )
    VALUES (
      ${id},
      ${params.userId ?? null},
      ${params.scenario},
      ${params.title},
      ${state},
      ${requestJson}::jsonb,
      ${policyJson}::jsonb,
      ${params.currentBookingJobId ?? null},
      ${params.decisionRoomId ?? null},
      ${params.createdByKeyId ?? null},
      ${params.createdByOrgName ?? null}
    )
    RETURNING *
  `;

  const task = result.rows[0];
  await appendTaskEvent(task.id, "task_created", {
    scenario: task.scenario,
    title: task.title,
    state: task.state,
  });
  if (task.current_booking_job_id) {
    await sql`
      UPDATE booking_jobs
      SET task_id = ${task.id}, updated_at = NOW()
      WHERE id = ${task.current_booking_job_id}
    `.catch(() => {});
    await appendTaskEvent(task.id, "booking_job_created", {
      jobId: task.current_booking_job_id,
    });
  }
  return task;
}

export async function getTravelTask(taskId: string): Promise<TravelTask | null> {
  await ensureTravelTaskTables();
  const result = await sql<TravelTask>`
    SELECT * FROM travel_tasks WHERE id = ${taskId}
  `;
  return result.rows[0] ?? null;
}

export async function getTravelTaskByBookingJobId(jobId: string): Promise<TravelTask | null> {
  await ensureTravelTaskTables();
  const result = await sql<TravelTask>`
    SELECT * FROM travel_tasks
    WHERE current_booking_job_id = ${jobId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function listTravelTasks(limit = 25): Promise<TravelTask[]> {
  await ensureTravelTaskTables();
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const result = await sql<TravelTask>`
    SELECT * FROM travel_tasks
    ORDER BY created_at DESC
    LIMIT ${boundedLimit}
  `;
  return result.rows;
}

export async function listTravelTasksForUser(userId: string, limit = 25): Promise<TravelTask[]> {
  await ensureTravelTaskTables();
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const result = await sql<TravelTask>`
    SELECT * FROM travel_tasks
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${boundedLimit}
  `;
  return result.rows;
}

export async function updateTravelTaskState(
  taskId: string,
  state: TravelTaskState,
  data: Record<string, unknown> = {},
): Promise<TravelTask | null> {
  await ensureTravelTaskTables();
  const result = await sql<TravelTask>`
    UPDATE travel_tasks
    SET
      state = ${state},
      terminal_reason = COALESCE(${stringOrNull(data.terminalReason)}, terminal_reason),
      terminal_code = COALESCE(${stringOrNull(data.terminalCode)}, terminal_code),
      updated_at = NOW()
    WHERE id = ${taskId}
    RETURNING *
  `;
  const task = result.rows[0] ?? null;
  if (task) {
    await appendTaskEvent(task.id, "state_changed", {
      state,
      ...data,
    });
  }
  return task;
}

export async function updateTravelTaskRequest(params: {
  taskId: string;
  request: ExecutionJobRequest;
  state?: TravelTaskState;
  currentBookingJobId?: string | null;
  eventData?: Record<string, unknown>;
}): Promise<TravelTask | null> {
  await ensureTravelTaskTables();
  const requestJson = JSON.stringify(params.request);
  const result = await sql<TravelTask>`
    UPDATE travel_tasks
    SET
      request_json = ${requestJson}::jsonb,
      state = COALESCE(${params.state ?? null}, state),
      current_booking_job_id = COALESCE(${params.currentBookingJobId ?? null}, current_booking_job_id),
      terminal_reason = NULL,
      terminal_code = NULL,
      updated_at = NOW()
    WHERE id = ${params.taskId}
    RETURNING *
  `;
  const task = result.rows[0] ?? null;
  if (task) {
    if (params.currentBookingJobId) {
      await sql`
        UPDATE booking_jobs
        SET task_id = ${task.id}, updated_at = NOW()
        WHERE id = ${params.currentBookingJobId}
      `.catch(() => {});
    }
    await appendTaskEvent(task.id, "state_changed", {
      state: task.state,
      currentBookingJobId: task.current_booking_job_id,
      ...params.eventData,
    });
  }
  return task;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function appendTaskEvent(
  taskId: string,
  kind: TravelTaskEventKind,
  data: Record<string, unknown> = {},
): Promise<TravelTaskEvent> {
  await ensureTravelTaskTables();
  const id = randomUUID();
  const dataJson = JSON.stringify(data);
  const result = await sql<TravelTaskEvent>`
    INSERT INTO task_events (id, task_id, kind, data_json)
    VALUES (${id}, ${taskId}, ${kind}, ${dataJson}::jsonb)
    RETURNING *
  `;
  return result.rows[0];
}

export async function getTaskEvents(taskId: string): Promise<TravelTaskEvent[]> {
  await ensureTravelTaskTables();
  const result = await sql<TravelTaskEvent>`
    SELECT * FROM task_events
    WHERE task_id = ${taskId}
    ORDER BY created_at ASC
  `;
  return result.rows;
}
