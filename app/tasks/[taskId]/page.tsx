"use client";

/**
 * /tasks/[taskId] — single travel task detail page.
 *
 * Reads the task facade endpoint codex shipped (`8b7e3dd` + `0f5c080`):
 *   GET /api/v1/travel-tasks/:taskId
 *
 * The endpoint requires API-key auth right now; cookie-auth proxy is in
 * codex's in-flight queue. Until it lands, browser fetches with the
 * user's session cookie will get 401. To stay productive while we wait,
 * this page supports **fixture mode** for any task ID matching
 * `demo-<state>` — e.g. `/tasks/demo-awaiting-otp`. When cookie-auth
 * proxy lands, real UUIDs work without further code changes.
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Header (title, state pill, breadcrumbs)                    │
 *   ├──────────────────────────────────────┬──────────────────────┤
 *   │  Main column                          │  Side rail           │
 *   │  ─────────                            │  ────────            │
 *   │  · TaskTimelinePanel (events +        │  · Task meta          │
 *   │    snapshot rail)                     │  · Booking details    │
 *   │  · ProfileGapCard if state ===        │  · Actions (Cancel    │
 *   │    "awaiting_profile"                 │    button when        │
 *   │  · Confirm card if                    │    cancellable)       │
 *   │    "ready_for_confirmation"           │                       │
 *   │  · Failure card if "failed"           │                       │
 *   └──────────────────────────────────────┴──────────────────────┘
 *
 * Demo task IDs (case-insensitive — try any of these):
 *   /tasks/demo-executing
 *   /tasks/demo-awaiting-profile
 *   /tasks/demo-awaiting-otp
 *   /tasks/demo-ready-for-confirmation
 *   /tasks/demo-failed
 *
 * NOT in this file:
 *   - The Cancel endpoint call (placeholder onClick — wires to
 *     /api/v1/execution-jobs/:jobId/cancel once cookie-auth proxy ships)
 *   - The ProfileGapCard onSave handler (placeholder logs the payload —
 *     wires to /api/v1/travel-tasks/:taskId/continue once cookie-auth
 *     proxy ships; codex `13036a0` already provides that endpoint)
 *
 * Both placeholders are exactly the 1-line swap points: when cookie-auth
 * lands, replace `console.log` / `alert` with `fetch(`/api/v1/...`)`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ProfileGapCard } from "@/components/profile-gap";
import type {
  GapSavePayload,
  ProfileGapState,
} from "@/components/profile-gap/types";
import { TaskTimelinePanel } from "@/components/task-timeline";

/* ─── Task facade types (mirror /api/v1/travel-tasks/:taskId response) ─ */

type TravelTaskState =
  | "draft"
  | "executing"
  | "awaiting_profile"
  | "awaiting_login"
  | "awaiting_otp"
  | "ready_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

interface TravelTaskPublic {
  id: string;
  scenario: "restaurant" | "hotel" | "flight" | "activity";
  title: string;
  state: TravelTaskState;
  currentBookingJobId: string | null;
  decisionRoomId: string | null;
  terminalReason: string | null;
  terminalCode: string | null;
  policy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CurrentJobPublic {
  id: string;
  status: string;
  tripLabel: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface TaskFacadeResponse {
  task: TravelTaskPublic;
  currentJob: CurrentJobPublic | null;
  events: Array<{ id: string; kind: string; data: unknown; createdAt: string }>;
  _links: Record<string, string | null>;
  /** Optional: fixture-only field telling us which demo state we're rendering. */
  _fixtureState?: string;
  /** Optional: fixture-only ProfileGapState for awaiting_profile demo. */
  _fixtureProfileGap?: ProfileGapState;
}

/* ─── Demo fixtures (key by task ID suffix) ───────────────────────── */

const DEMO_TASKS: Record<string, TaskFacadeResponse> = {
  "demo-executing": {
    task: {
      id: "demo-executing",
      scenario: "restaurant",
      title: "Buvette in West Village next Thursday 8pm solo dinner",
      state: "executing",
      currentBookingJobId: "demo-job-001",
      decisionRoomId: null,
      terminalReason: null,
      terminalCode: null,
      policy: {},
      createdAt: "2026-05-03T03:51:52.014Z",
      updatedAt: "2026-05-03T03:52:30.020Z",
    },
    currentJob: {
      id: "demo-job-001",
      status: "running",
      tripLabel: "Restaurant · Buvette",
      createdAt: "2026-05-03T03:51:52.500Z",
      updatedAt: "2026-05-03T03:52:30.000Z",
      completedAt: null,
    },
    events: [],
    _links: {},
    _fixtureState: "running",
  },
  "demo-awaiting-profile": {
    task: {
      id: "demo-awaiting-profile",
      scenario: "restaurant",
      title: "Carbone tonight 7pm party of 2",
      state: "awaiting_profile",
      currentBookingJobId: "demo-job-002",
      decisionRoomId: null,
      terminalReason: "Restaurant requires DOB and phone for reservations.",
      terminalCode: "needs_profile_data",
      policy: {},
      createdAt: "2026-05-03T03:55:00.000Z",
      updatedAt: "2026-05-03T03:55:18.000Z",
    },
    currentJob: {
      id: "demo-job-002",
      status: "needs_profile_data",
      tripLabel: "Restaurant · Carbone",
      createdAt: "2026-05-03T03:55:00.500Z",
      updatedAt: "2026-05-03T03:55:18.000Z",
      completedAt: null,
    },
    events: [],
    _links: {},
    _fixtureState: "running",
    _fixtureProfileGap: {
      trigger: "restaurant",
      missing: ["date_of_birth", "phone"],
      reason: "Carbone uses Resy and needs verified contact details.",
    },
  },
  "demo-awaiting-otp": {
    task: {
      id: "demo-awaiting-otp",
      scenario: "restaurant",
      title: "Don Angie next Friday 7:30pm party of 2",
      state: "awaiting_otp",
      currentBookingJobId: "demo-job-003",
      decisionRoomId: null,
      terminalReason: "Resy is asking for the verification code from your inbox.",
      terminalCode: "needs_otp",
      policy: {},
      createdAt: "2026-05-03T04:10:00.000Z",
      updatedAt: "2026-05-03T04:11:48.000Z",
    },
    currentJob: {
      id: "demo-job-003",
      status: "awaiting_otp",
      tripLabel: "Restaurant · Don Angie",
      createdAt: "2026-05-03T04:10:00.500Z",
      updatedAt: "2026-05-03T04:11:48.000Z",
      completedAt: null,
    },
    events: [],
    _links: {},
    _fixtureState: "needs_otp",
  },
  "demo-ready-for-confirmation": {
    task: {
      id: "demo-ready-for-confirmation",
      scenario: "restaurant",
      title: "TAO Downtown tomorrow 7pm 2 people for date night",
      state: "ready_for_confirmation",
      currentBookingJobId: "demo-job-004",
      decisionRoomId: null,
      terminalReason: "Reservation form is filled. One tap from confirmed.",
      terminalCode: null,
      policy: {},
      createdAt: "2026-05-03T05:00:00.000Z",
      updatedAt: "2026-05-03T05:01:24.000Z",
    },
    currentJob: {
      id: "demo-job-004",
      status: "ready_for_confirmation",
      tripLabel: "Restaurant · TAO Downtown",
      createdAt: "2026-05-03T05:00:00.500Z",
      updatedAt: "2026-05-03T05:01:24.000Z",
      completedAt: null,
    },
    events: [],
    _links: {},
    _fixtureState: "ready_for_confirmation",
  },
  "demo-failed": {
    task: {
      id: "demo-failed",
      scenario: "restaurant",
      title: "Atomix 2 Saturdays out 8pm 2 people",
      state: "failed",
      currentBookingJobId: "demo-job-005",
      decisionRoomId: null,
      terminalReason:
        "Computer Use stopped at https://resy.com/cities/ny/search?query=Atomix&time=2100",
      terminalCode: "executor_stuck",
      policy: {},
      createdAt: "2026-05-03T05:30:00.000Z",
      updatedAt: "2026-05-03T05:32:14.000Z",
    },
    currentJob: {
      id: "demo-job-005",
      status: "failed",
      tripLabel: "Restaurant · Atomix",
      createdAt: "2026-05-03T05:30:00.500Z",
      updatedAt: "2026-05-03T05:32:14.000Z",
      completedAt: "2026-05-03T05:32:14.000Z",
    },
    events: [],
    _links: {},
    _fixtureState: "failed",
  },
};

/* ─── Status display ──────────────────────────────────────────────── */

const STATE_LABEL: Record<TravelTaskState, string> = {
  draft: "Draft",
  executing: "Running",
  awaiting_profile: "Need details",
  awaiting_login: "Need login",
  awaiting_otp: "Awaiting code",
  ready_for_confirmation: "Ready to confirm",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATE_TONE: Record<TravelTaskState, "active" | "blocked" | "done" | "fail"> = {
  draft: "active",
  executing: "active",
  awaiting_profile: "blocked",
  awaiting_login: "blocked",
  awaiting_otp: "blocked",
  ready_for_confirmation: "done",
  completed: "done",
  failed: "fail",
  cancelled: "fail",
};

function isCancelable(state: TravelTaskState): boolean {
  return (
    state === "executing" ||
    state === "awaiting_profile" ||
    state === "awaiting_login" ||
    state === "awaiting_otp" ||
    state === "draft"
  );
}

/* ─── Page ─────────────────────────────────────────────────────────── */

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: TaskFacadeResponse }
  | { kind: "demo-not-found" }
  | { kind: "needs-sign-in" }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

const TERMINAL_STATES: TravelTaskState[] = ["completed", "failed", "cancelled"];

export default function TaskDetailPage() {
  const params = useParams();
  const taskId =
    typeof params?.taskId === "string"
      ? params.taskId
      : Array.isArray(params?.taskId)
      ? params.taskId[0]
      : "";

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** Becomes true while a mutation (continue / cancel) is mid-flight; disables buttons. */
  const [mutating, setMutating] = useState<null | "continue" | "cancel">(null);

  const isDemoId = taskId.toLowerCase().startsWith("demo-");

  /* ─── Fetch / fixture lookup ─────────────────────────────────── */

  const fetchTask = useCallback(async (): Promise<void> => {
    if (!taskId) {
      setState({ kind: "error", message: "Missing task ID in URL." });
      return;
    }

    if (isDemoId) {
      const fx = DEMO_TASKS[taskId.toLowerCase()];
      if (!fx) {
        setState({ kind: "demo-not-found" });
        return;
      }
      setState({ kind: "ready", data: fx });
      return;
    }

    try {
      const res = await fetch(`/api/v1/travel-tasks/${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) {
        // Codex's `48c80b2` enabled cookie-auth on /api/v1/travel-tasks/*.
        // 401 now means the user isn't signed in (or the task isn't theirs).
        setState({ kind: "needs-sign-in" });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "not-found" });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `API returned ${res.status} ${res.statusText}`,
        });
        return;
      }
      const json = (await res.json()) as TaskFacadeResponse;
      setState({ kind: "ready", data: json });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Fetch failed.",
      });
    }
  }, [taskId, isDemoId]);

  // Initial fetch + on taskId change.
  useEffect(() => {
    setState({ kind: "loading" });
    void fetchTask();
  }, [fetchTask]);

  // Polling: refetch every 5s while task is in a non-terminal state.
  // Stops automatically when the task completes / fails / cancels, AND when
  // the page unmounts. Demo tasks don't poll (they're static fixtures).
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (isDemoId) return;
    const taskState = state.data.task.state;
    if (TERMINAL_STATES.includes(taskState)) return;

    const id = setInterval(() => {
      void fetchTask();
    }, 5000);
    return () => clearInterval(id);
  }, [state, isDemoId, taskId, fetchTask]);

  /* ─── Handlers (real API now that codex shipped 48c80b2) ──────── */

  const handleProfileSave = useCallback(
    async (payload: GapSavePayload) => {
      if (isDemoId) {
        // Demo path: keep informative log but no real network. Allows
        // testing the form UX in /tasks/demo-awaiting-profile.
        console.log("[/tasks/[taskId]] ProfileGapCard onSave (demo, no-op):", payload);
        window.alert(
          `Demo mode — would POST to /api/v1/travel-tasks/${taskId}/continue\n${JSON.stringify(
            payload.values,
            null,
            2,
          )}`,
        );
        return;
      }
      setMutating("continue");
      try {
        const res = await fetch(
          `/api/v1/travel-tasks/${encodeURIComponent(taskId)}/continue`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile: payload.values }),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`/continue returned ${res.status}: ${text.slice(0, 200)}`);
        }
        // Refetch immediately to pick up the new state (executor now
        // has the profile data and should transition out of awaiting_profile).
        await fetchTask();
      } catch (err) {
        window.alert(
          `Couldn't save profile: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      } finally {
        setMutating(null);
      }
    },
    [taskId, isDemoId, fetchTask],
  );

  const handleCancel = useCallback(async () => {
    if (state.kind !== "ready") return;
    const jobId = state.data.task.currentBookingJobId;
    if (!jobId) {
      window.alert("No active booking job to cancel.");
      return;
    }
    if (!window.confirm("Cancel this task? The current booking attempt will be stopped.")) {
      return;
    }
    if (isDemoId) {
      console.log("[/tasks/[taskId]] Cancel job (demo, no-op):", jobId);
      window.alert(`Demo mode — would POST to /api/v1/execution-jobs/${jobId}/cancel`);
      return;
    }
    setMutating("cancel");
    try {
      const res = await fetch(
        `/api/v1/execution-jobs/${encodeURIComponent(jobId)}/cancel`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`/cancel returned ${res.status}: ${text.slice(0, 200)}`);
      }
      await fetchTask();
    } catch (err) {
      window.alert(
        `Couldn't cancel: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setMutating(null);
    }
  }, [state, isDemoId, fetchTask]);

  /* ─── Render ──────────────────────────────────────────────────── */

  return (
    <main className="task-detail">
      <Header taskId={taskId} state={state} />

      {state.kind === "loading" && (
        <div className="task-detail__loading">Loading task…</div>
      )}

      {state.kind === "demo-not-found" && (
        <div className="task-detail__error-card">
          <h2>Demo not found</h2>
          <p>
            <code>{taskId}</code> isn&apos;t a known demo fixture. Available
            demos:
          </p>
          <ul>
            {Object.keys(DEMO_TASKS).map((id) => (
              <li key={id}>
                <Link href={`/tasks/${id}`}>
                  <code>/tasks/{id}</code>
                </Link>
              </li>
            ))}
          </ul>
          <p>
            For real task IDs (UUIDs), the page will fetch from
            <code> /api/v1/travel-tasks/:taskId</code> once codex ships
            cookie-auth proxy for <code>/api/v1/*</code>.
          </p>
        </div>
      )}

      {state.kind === "needs-sign-in" && (
        <div className="task-detail__error-card">
          <h2>Sign in to view this task</h2>
          <p>
            This page reads <code>/api/v1/travel-tasks/{taskId}</code> with
            your session cookie. Either you aren&apos;t signed in, or this
            task belongs to a different account.
          </p>
          <p>
            <Link href="/sign-in">Sign in</Link>, or try one of the demo
            states below to see the page UX without an account:
          </p>
          <ul>
            {Object.keys(DEMO_TASKS).map((id) => (
              <li key={id}>
                <Link href={`/tasks/${id}`}>
                  <code>/tasks/{id}</code>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === "not-found" && (
        <div className="task-detail__error-card">
          <h2>Task not found</h2>
          <p>
            <code>{taskId}</code> doesn&apos;t exist. It may have been
            cleaned up, or the ID is mistyped. Check{" "}
            <Link href="/tasks">your task list</Link>.
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="task-detail__error-card">
          <h2>Couldn&apos;t load task</h2>
          <p>{state.message}</p>
        </div>
      )}

      {state.kind === "ready" && (
        <Body
          data={state.data}
          onProfileSave={handleProfileSave}
          onCancel={handleCancel}
          mutating={mutating}
        />
      )}

      <TaskDetailStyles />
    </main>
  );
}

/* ─── Header ───────────────────────────────────────────────────────── */

function Header({ taskId, state }: { taskId: string; state: LoadState }) {
  const task = state.kind === "ready" ? state.data.task : null;

  return (
    <header className="task-detail__header">
      <div className="task-detail__breadcrumb">
        <Link href="/tasks">← Tasks</Link>
        <span className="task-detail__breadcrumb-sep">/</span>
        <code className="task-detail__breadcrumb-id">{taskId || "—"}</code>
      </div>
      <div className="task-detail__title-row">
        <h1 className="task-detail__title">
          {task?.title ?? (state.kind === "loading" ? "Loading…" : "—")}
        </h1>
        {task && <StatePill state={task.state} />}
      </div>
      {task && (
        <div className="task-detail__meta">
          <span>
            <strong>Scenario:</strong> {task.scenario}
          </span>
          <span>
            <strong>Created:</strong> {fmtDate(task.createdAt)}
          </span>
          <span>
            <strong>Updated:</strong> {fmtDate(task.updatedAt)}
          </span>
          {task.decisionRoomId && (
            <span>
              <strong>Decision Room:</strong> <code>{task.decisionRoomId}</code>
            </span>
          )}
        </div>
      )}
    </header>
  );
}

function StatePill({ state }: { state: TravelTaskState }) {
  return (
    <span className={`task-detail__pill task-detail__pill--${STATE_TONE[state]}`}>
      {STATE_LABEL[state]}
    </span>
  );
}

/* ─── Body (main + side rail) ──────────────────────────────────────── */

function Body({
  data,
  onProfileSave,
  onCancel,
  mutating,
}: {
  data: TaskFacadeResponse;
  onProfileSave: (payload: GapSavePayload) => Promise<void> | void;
  onCancel: () => void;
  mutating: null | "continue" | "cancel";
}) {
  const { task, currentJob } = data;
  // Real tasks: derive ProfileGapState from task data when state ===
  // awaiting_profile. Demo tasks: use the hard-coded _fixtureProfileGap.
  const profileGapState = data._fixtureProfileGap ?? deriveProfileGapState(data);
  const showProfileGap = task.state === "awaiting_profile" && profileGapState;
  const showConfirm = task.state === "ready_for_confirmation";
  const showFailure = task.state === "failed";

  // For demo, drive TaskTimelinePanel via its `demo` prop. For real tasks,
  // pass the actual job ID.
  const timelineDemoProp = useMemo(() => {
    return data._fixtureState as
      | "running"
      | "needs_otp"
      | "ready_for_confirmation"
      | "failed"
      | "no_availability"
      | "empty"
      | undefined;
  }, [data._fixtureState]);

  return (
    <div className="task-detail__body">
      <section className="task-detail__main">
        <div className="task-detail__panel-wrap">
          <TaskTimelinePanel
            jobId={timelineDemoProp ? null : currentJob?.id ?? null}
            demo={timelineDemoProp}
            title={task.title}
            subtitle={`${task.scenario} · ${STATE_LABEL[task.state]}`}
          />
        </div>

        {showProfileGap && profileGapState && (
          <div className="task-detail__profile-gap">
            {mutating === "continue" && (
              <p className="task-detail__hint" style={{ marginBottom: 8 }}>
                Saving and resuming…
              </p>
            )}
            <ProfileGapCard
              state={profileGapState}
              onSave={onProfileSave}
            />
          </div>
        )}

        {showConfirm && (
          <div className="task-detail__confirm-card">
            <h3>Ready to confirm</h3>
            <p>
              Reservation form is filled. Onegent has paused before the final
              confirm tap — review the latest snapshot and confirm in your own
              browser when you&apos;re ready.
            </p>
            {data._links?.snapshots && (
              <p className="task-detail__hint">
                Latest snapshot: <code>{data._links.snapshots}</code>
              </p>
            )}
          </div>
        )}

        {showFailure && (
          <div className="task-detail__failure-card">
            <h3>Couldn&apos;t complete this booking</h3>
            <p>{task.terminalReason ?? "No reason provided."}</p>
            {task.terminalCode && (
              <p className="task-detail__hint">
                Code: <code>{task.terminalCode}</code>
              </p>
            )}
          </div>
        )}
      </section>

      <aside className="task-detail__rail">
        <RailSection title="Booking job">
          {currentJob ? (
            <dl className="task-detail__dl">
              <dt>Job ID</dt>
              <dd><code>{currentJob.id}</code></dd>
              <dt>Status</dt>
              <dd>{currentJob.status}</dd>
              {currentJob.tripLabel && (
                <>
                  <dt>Trip</dt>
                  <dd>{currentJob.tripLabel}</dd>
                </>
              )}
              <dt>Started</dt>
              <dd>{fmtDate(currentJob.createdAt)}</dd>
              {currentJob.completedAt && (
                <>
                  <dt>Finished</dt>
                  <dd>{fmtDate(currentJob.completedAt)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="task-detail__rail-empty">No active job.</p>
          )}
        </RailSection>

        <RailSection title="Actions">
          {isCancelable(task.state) ? (
            <button
              type="button"
              className="task-detail__btn task-detail__btn--danger"
              onClick={onCancel}
              disabled={mutating !== null}
            >
              {mutating === "cancel" ? "Cancelling…" : "Cancel this task"}
            </button>
          ) : (
            <p className="task-detail__rail-empty">
              Task is in a terminal state — no actions.
            </p>
          )}
        </RailSection>

        {data._fixtureState && (
          <RailSection title="Demo info">
            <p className="task-detail__rail-empty">
              You&apos;re viewing fixture data for state{" "}
              <code>{data._fixtureState}</code>. Real tasks load from
              <code> /api/v1/travel-tasks/:taskId</code> once cookie-auth
              proxy lands.
            </p>
            <ul className="task-detail__demo-list">
              {Object.keys(DEMO_TASKS)
                .filter((id) => id !== task.id)
                .map((id) => (
                  <li key={id}>
                    <Link href={`/tasks/${id}`}>
                      <code>{id}</code>
                    </Link>
                  </li>
                ))}
            </ul>
          </RailSection>
        )}
      </aside>
    </div>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="task-detail__rail-section">
      <h4 className="task-detail__rail-title">{title}</h4>
      {children}
    </section>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

/**
 * Derive a ProfileGapState from a real task facade response.
 *
 * Looks for the latest event with shape `{ kind: "state_changed",
 * data: { state: "awaiting_profile", missing: [...] } }` and uses its
 * `missing[]` field. Falls back to a generic empty list if the event
 * shape doesn't match — backend can fill the field and this page
 * picks it up without further code change.
 *
 * `trigger` derives from task.scenario; `reason` from task.terminalReason.
 */
function deriveProfileGapState(data: TaskFacadeResponse): ProfileGapState | null {
  if (data.task.state !== "awaiting_profile") return null;

  const scenario = data.task.scenario;
  const trigger: ProfileGapState["trigger"] =
    scenario === "restaurant" || scenario === "hotel" ||
    scenario === "flight" || scenario === "activity"
      ? scenario
      : "generic";

  // Try to extract missing[] from the most recent state_changed event.
  let missing: ProfileGapState["missing"] = [];
  for (let i = data.events.length - 1; i >= 0; i--) {
    const ev = data.events[i];
    if (ev.kind !== "state_changed") continue;
    const evData = ev.data as Record<string, unknown> | null;
    if (!evData || evData.state !== "awaiting_profile") continue;
    const m = evData.missing;
    if (Array.isArray(m)) {
      // Filter to strings; FieldRow / normalizeMissingFields handles unknown IDs.
      missing = m.filter((x): x is string => typeof x === "string") as ProfileGapState["missing"];
    }
    break;
  }

  return {
    trigger,
    missing,
    reason: data.task.terminalReason ?? undefined,
  };
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ─── Inline styles ───────────────────────────────────────────────── */

function TaskDetailStyles() {
  return (
    <style>{`
      .task-detail {
        --ink-2: #f3f4f6;
        --ink-3: #e5e7eb;
        --ink-6: #6b7280;
        --ink-7: #4b5563;
        --ink-8: #1f2937;
        --ink-9: #111827;
        --card: #ffffff;
        --bg: #fafafa;

        --tone-active: #0ea5e9;
        --tone-active-bg: rgba(14, 165, 233, 0.10);
        --tone-active-border: rgba(14, 165, 233, 0.30);

        --tone-blocked: #f59e0b;
        --tone-blocked-bg: rgba(245, 158, 11, 0.12);
        --tone-blocked-border: rgba(245, 158, 11, 0.32);

        --tone-done: #16a34a;
        --tone-done-bg: rgba(22, 163, 74, 0.10);
        --tone-done-border: rgba(22, 163, 74, 0.30);

        --tone-fail: #b91c1c;
        --tone-fail-bg: rgba(185, 28, 28, 0.10);
        --tone-fail-border: rgba(185, 28, 28, 0.30);

        max-width: 1200px;
        margin: 0 auto;
        padding: 28px 28px 80px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
        background: var(--bg);
        min-height: 100vh;
        color: var(--ink-9);
      }

      .task-detail__header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 24px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--ink-3);
      }
      .task-detail__breadcrumb {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: var(--ink-6);
      }
      .task-detail__breadcrumb a {
        color: var(--tone-active);
        text-decoration: none;
      }
      .task-detail__breadcrumb a:hover { text-decoration: underline; }
      .task-detail__breadcrumb-sep { color: var(--ink-3); }
      .task-detail__breadcrumb-id {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .task-detail__title-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }
      .task-detail__title {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
        line-height: 1.3;
      }
      .task-detail__meta {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--ink-7);
      }
      .task-detail__meta strong {
        color: var(--ink-9);
        font-weight: 600;
      }
      .task-detail__meta code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }

      .task-detail__pill {
        display: inline-flex;
        align-items: center;
        padding: 4px 11px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .task-detail__pill--active {
        color: var(--tone-active);
        background: var(--tone-active-bg);
        border: 1px solid var(--tone-active-border);
      }
      .task-detail__pill--blocked {
        color: var(--tone-blocked);
        background: var(--tone-blocked-bg);
        border: 1px solid var(--tone-blocked-border);
      }
      .task-detail__pill--done {
        color: var(--tone-done);
        background: var(--tone-done-bg);
        border: 1px solid var(--tone-done-border);
      }
      .task-detail__pill--fail {
        color: var(--tone-fail);
        background: var(--tone-fail-bg);
        border: 1px solid var(--tone-fail-border);
      }

      .task-detail__loading {
        padding: 60px 0;
        text-align: center;
        color: var(--ink-6);
        font-size: 13px;
      }

      .task-detail__error-card {
        padding: 22px 24px;
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 10px;
        max-width: 720px;
      }
      .task-detail__error-card h2 {
        margin: 0 0 8px;
        font-size: 16px;
      }
      .task-detail__error-card p {
        margin: 6px 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--ink-7);
      }
      .task-detail__error-card code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .task-detail__error-card ul { margin: 8px 0 12px 18px; padding: 0; }
      .task-detail__error-card li { margin: 3px 0; font-size: 12.5px; }

      .task-detail__body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: 24px;
      }
      @media (max-width: 900px) {
        .task-detail__body { grid-template-columns: 1fr; }
      }

      .task-detail__main {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .task-detail__panel-wrap {
        position: relative;
        min-height: 480px;
        border: 1px solid var(--ink-3);
        border-radius: 10px;
        overflow: hidden;
        background: var(--card);
      }

      .task-detail__profile-gap,
      .task-detail__confirm-card,
      .task-detail__failure-card {
        padding: 18px 20px;
        border-radius: 10px;
        background: var(--card);
        border: 1px solid var(--ink-3);
      }
      .task-detail__confirm-card {
        background: var(--tone-done-bg);
        border-color: var(--tone-done-border);
      }
      .task-detail__failure-card {
        background: var(--tone-fail-bg);
        border-color: var(--tone-fail-border);
      }
      .task-detail__confirm-card h3,
      .task-detail__failure-card h3 {
        margin: 0 0 6px;
        font-size: 14px;
      }
      .task-detail__confirm-card p,
      .task-detail__failure-card p {
        margin: 4px 0;
        font-size: 12.5px;
        color: var(--ink-7);
        line-height: 1.55;
      }
      .task-detail__hint {
        font-size: 11.5px !important;
        color: var(--ink-6) !important;
      }
      .task-detail__hint code {
        font-family: ui-monospace, monospace;
        background: rgba(0, 0, 0, 0.06);
        padding: 1px 5px;
        border-radius: 3px;
      }

      .task-detail__rail {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .task-detail__rail-section {
        padding: 14px 16px;
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 10px;
      }
      .task-detail__rail-title {
        margin: 0 0 8px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-6);
      }
      .task-detail__dl {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 4px 10px;
        font-size: 12px;
        margin: 0;
      }
      .task-detail__dl dt {
        color: var(--ink-6);
        font-weight: 500;
      }
      .task-detail__dl dd {
        margin: 0;
        color: var(--ink-8);
        word-break: break-all;
      }
      .task-detail__dl code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .task-detail__rail-empty {
        margin: 0;
        font-size: 12px;
        color: var(--ink-6);
        line-height: 1.55;
      }
      .task-detail__rail-empty code {
        font-family: ui-monospace, monospace;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }

      .task-detail__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 14px;
        border-radius: 8px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
      }
      .task-detail__btn--danger {
        color: var(--tone-fail);
        background: var(--tone-fail-bg);
        border-color: var(--tone-fail-border);
      }
      .task-detail__btn--danger:hover {
        background: rgba(185, 28, 28, 0.18);
      }

      .task-detail__demo-list {
        margin: 10px 0 0 18px;
        padding: 0;
        font-size: 11.5px;
      }
      .task-detail__demo-list li { margin: 2px 0; }
      .task-detail__demo-list a { color: var(--tone-active); text-decoration: none; }
      .task-detail__demo-list a:hover { text-decoration: underline; }
      .task-detail__demo-list code {
        font-family: ui-monospace, monospace;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
    `}</style>
  );
}
