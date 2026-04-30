import { describe, it, expect, vi } from "vitest";
import { modifyTaskTool } from "../tools/modify-task.js";
import { cancelTaskTool } from "../tools/cancel-task.js";
import { continueTaskTool } from "../tools/continue-task.js";
import { createTravelTaskTool } from "../tools/create-travel-task.js";
import { getTaskStatusTool } from "../tools/get-task-status.js";
import { getTaskAuditTool } from "../tools/get-task-audit.js";
import type { OnegentClient } from "../api-client.js";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeClient(overrides: Partial<OnegentClient> = {}): OnegentClient {
  // Cast — we only call the methods we override.
  return {
    config: { apiKey: "ogk_test_x", baseUrl: "http://test", timeoutMs: 1000 },
    createExecutionJob: vi.fn(),
    getExecutionJob: vi.fn(),
    getExecutionJobAudit: vi.fn(),
    modifyTask: vi.fn(),
    cancelTask: vi.fn(),
    continueTask: vi.fn(),
    ...overrides,
  } as unknown as OnegentClient;
}

// ─── modify_task ────────────────────────────────────────────────────────────

describe("modify_task tool", () => {
  it("rejects missing jobId at the schema layer", async () => {
    const client = makeClient();
    await expect(modifyTaskTool.handler({ constraints: { time: "20:00" } }, client)).rejects.toBeDefined();
  });

  it("rejects malformed time at the schema layer", async () => {
    const client = makeClient();
    await expect(
      modifyTaskTool.handler({ jobId: "j", constraints: { time: "8pm" } }, client),
    ).rejects.toBeDefined();
  });

  it("rejects time_window not in allowed enum", async () => {
    const client = makeClient();
    await expect(
      modifyTaskTool.handler({ jobId: "j", policy: { time_window_minutes: 45 } }, client),
    ).rejects.toBeDefined();
  });

  it("returns early when no constraints/policy passed", async () => {
    const modifyTask = vi.fn();
    const client = makeClient({ modifyTask });
    const out = await modifyTaskTool.handler({ jobId: "j" }, client);
    expect(out).toContain("nothing to change");
    expect(modifyTask).not.toHaveBeenCalled();
  });

  it("forwards constraints + policy to client.modifyTask and stitches output", async () => {
    const modifyTask = vi.fn().mockResolvedValue({
      jobId: "j",
      planVersion: 3,
      status: "pending",
      summary: "time → 20:00, party_size → 4",
    });
    const client = makeClient({ modifyTask });
    const out = await modifyTaskTool.handler(
      {
        jobId: "j",
        constraints: { time: "20:00", party_size: 4 },
        policy: { time_window_minutes: 60 },
        message: "later please",
      },
      client,
    );
    expect(modifyTask).toHaveBeenCalledTimes(1);
    const [jobIdArg, body] = modifyTask.mock.calls[0];
    expect(jobIdArg).toBe("j");
    expect(body.patch.constraints).toEqual({ time: "20:00", party_size: 4 });
    expect(body.patch.policy).toEqual({ time_window_minutes: 60 });
    expect(body.patch.message).toBe("later please");
    expect(out).toContain("planVersion: 3");
    expect(out).toContain("continue_task");
  });
});

// ─── cancel_task ────────────────────────────────────────────────────────────

describe("cancel_task tool", () => {
  it("rejects missing jobId", async () => {
    await expect(cancelTaskTool.handler({}, makeClient())).rejects.toBeDefined();
  });

  it("forwards to client.cancelTask and surfaces priorStatus", async () => {
    const cancelTask = vi.fn().mockResolvedValue({
      jobId: "j",
      cancelled: true,
      priorStatus: "pending",
    });
    const client = makeClient({ cancelTask });
    const out = await cancelTaskTool.handler({ jobId: "j" }, client);
    expect(cancelTask).toHaveBeenCalledWith("j");
    expect(out).toContain("Task j cancelled");
    expect(out).toContain("pending");
  });

  it("annotation marks it as destructive", () => {
    expect(cancelTaskTool.annotations?.destructiveHint).toBe(true);
  });
});

// ─── continue_task ──────────────────────────────────────────────────────────

describe("continue_task tool", () => {
  it("forwards to client.continueTask and tells caller to poll", async () => {
    const continueTask = vi.fn().mockResolvedValue({
      jobId: "j",
      triggered: true,
      priorStatus: "failed",
    });
    const client = makeClient({ continueTask });
    const out = await continueTaskTool.handler({ jobId: "j" }, client);
    expect(continueTask).toHaveBeenCalledWith("j");
    expect(out).toContain("Task j resumed");
    expect(out).toContain("get_task_status");
  });

  it("annotation marks it as openWorld + non-idempotent", () => {
    expect(continueTaskTool.annotations?.openWorldHint).toBe(true);
    expect(continueTaskTool.annotations?.idempotentHint).toBe(false);
  });
});

// ─── create_travel_task ─────────────────────────────────────────────────────

describe("create_travel_task tool", () => {
  it("rejects missing profile + missing profileId", async () => {
    const client = makeClient();
    await expect(
      createTravelTaskTool.handler(
        {
          task: {
            task_type: "restaurant_booking",
            restaurant_name: "Carbone",
            city: "New York",
            date: "2026-05-12",
            time: "19:00",
            covers: 2,
          },
        },
        client,
      ),
    ).rejects.toBeDefined();
  });

  it("dispatches restaurant_booking through client.createExecutionJob", async () => {
    const createExecutionJob = vi.fn().mockResolvedValue({ jobId: "j-1", status: "pending" });
    const client = makeClient({ createExecutionJob });
    const out = await createTravelTaskTool.handler(
      {
        task: {
          task_type: "restaurant_booking",
          restaurant_name: "Carbone",
          city: "New York",
          date: "2026-05-12",
          time: "19:00",
          covers: 2,
        },
        profile: {
          first_name: "Test",
          last_name: "User",
          email: "t@example.com",
          phone: "5551234567",
        },
      },
      client,
    );
    expect(createExecutionJob).toHaveBeenCalledTimes(1);
    const body = createExecutionJob.mock.calls[0][0];
    expect(body.request.scenario).toBe("restaurant");
    expect(body.request.params.restaurant_name).toBe("Carbone");
    expect(body.clientMetadata).toEqual({ agentId: "onegent-mcp", protocol: "v2" });
    expect(out).toContain("Task ID: j-1");
    expect(out).toContain("Carbone");
  });

  it("dispatches hotel_booking via correct scenario mapping", async () => {
    const createExecutionJob = vi.fn().mockResolvedValue({ jobId: "j-2", status: "pending" });
    const client = makeClient({ createExecutionJob });
    await createTravelTaskTool.handler(
      {
        task: {
          task_type: "hotel_booking",
          destination: "Paris",
          check_in: "2026-06-01",
          check_out: "2026-06-04",
          guests: 2,
          rooms: 1,
        },
        profileId: 42,
      },
      client,
    );
    const body = createExecutionJob.mock.calls[0][0];
    expect(body.request.scenario).toBe("hotel");
    expect(body.request.params.destination).toBe("Paris");
    expect(body.profileId).toBe(42);
  });

  it("dispatches flight_booking with optional fields", async () => {
    const createExecutionJob = vi.fn().mockResolvedValue({ jobId: "j-3", status: "pending" });
    const client = makeClient({ createExecutionJob });
    await createTravelTaskTool.handler(
      {
        task: {
          task_type: "flight_booking",
          origin: "JFK",
          destination: "LAX",
          depart_date: "2026-07-04",
          passengers: 1,
        },
        profileId: 1,
      },
      client,
    );
    const body = createExecutionJob.mock.calls[0][0];
    expect(body.request.scenario).toBe("flight");
    expect(body.request.params.origin).toBe("JFK");
    expect(body.request.params.return_date).toBeUndefined();
    expect(body.request.params.cabin).toBeUndefined();
  });

  it("rejects unknown task_type at the schema layer", async () => {
    const client = makeClient();
    await expect(
      createTravelTaskTool.handler(
        { task: { task_type: "spaceflight_booking" }, profileId: 1 },
        client,
      ),
    ).rejects.toBeDefined();
  });
});

// ─── get_task_status ────────────────────────────────────────────────────────

describe("get_task_status tool", () => {
  it("formats running status output with poll guidance", async () => {
    const getExecutionJob = vi.fn().mockResolvedValue({
      jobId: "j",
      status: "running",
      scenario: "restaurant",
      provider: "OpenTable",
      updatedAt: "2026-05-12T19:00:00Z",
    });
    const client = makeClient({ getExecutionJob });
    const out = await getTaskStatusTool.handler({ jobId: "j" }, client);
    expect(out).toContain("running");
    expect(out).toContain("OpenTable");
    expect(out).toContain("Check again");
  });

  it("formats paused_payment output with continue_task hint", async () => {
    const getExecutionJob = vi.fn().mockResolvedValue({
      jobId: "j",
      status: "paused_payment",
      scenario: "restaurant",
      updatedAt: "2026-05-12T19:00:00Z",
    });
    const client = makeClient({ getExecutionJob });
    const out = await getTaskStatusTool.handler({ jobId: "j" }, client);
    expect(out).toContain("payment");
    expect(out).toContain("continue_task");
  });

  it("formats no_availability output with modify_task hint", async () => {
    const getExecutionJob = vi.fn().mockResolvedValue({
      jobId: "j",
      status: "no_availability",
      scenario: "restaurant",
      updatedAt: "2026-05-12T19:00:00Z",
    });
    const client = makeClient({ getExecutionJob });
    const out = await getTaskStatusTool.handler({ jobId: "j" }, client);
    expect(out).toContain("no_availability");
    expect(out).toContain("modify_task");
  });

  it("annotation marks it readOnly + idempotent", () => {
    expect(getTaskStatusTool.annotations?.readOnlyHint).toBe(true);
    expect(getTaskStatusTool.annotations?.idempotentHint).toBe(true);
  });
});

// ─── get_task_audit ─────────────────────────────────────────────────────────

describe("get_task_audit tool", () => {
  it("renders empty state when no events", async () => {
    const getExecutionJobAudit = vi.fn().mockResolvedValue({ jobId: "j", events: [] });
    const client = makeClient({ getExecutionJobAudit });
    const out = await getTaskAuditTool.handler({ jobId: "j" }, client);
    expect(out).toContain("no audit events");
  });

  it("renders events with timestamp + level + message", async () => {
    const getExecutionJobAudit = vi.fn().mockResolvedValue({
      jobId: "j",
      events: [
        { ts: "2026-05-12T19:00:00Z", level: "info", message: "Started" },
        { ts: "2026-05-12T19:01:00Z", level: "error", message: "DOM drift" },
      ],
    });
    const client = makeClient({ getExecutionJobAudit });
    const out = await getTaskAuditTool.handler({ jobId: "j" }, client);
    expect(out).toContain("INFO: Started");
    expect(out).toContain("ERROR: DOM drift");
    expect(out).toContain("2 audit event");
  });

  it("forwards optional limit", async () => {
    const getExecutionJobAudit = vi.fn().mockResolvedValue({ jobId: "j", events: [] });
    const client = makeClient({ getExecutionJobAudit });
    await getTaskAuditTool.handler({ jobId: "j", limit: 10 }, client);
    expect(getExecutionJobAudit).toHaveBeenCalledWith("j", 10);
  });
});
