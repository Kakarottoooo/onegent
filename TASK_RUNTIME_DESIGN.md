# Task Runtime — Phase 1 design (TravelTask facade)

> **Date opened**: 2026-05-02
> **Phase**: 1 of 5 (per [EXECUTOR_V2_PIVOT.md](./EXECUTOR_V2_PIVOT.md))
> **Status**: 📐 Design only — no code yet, awaiting codex Phase 0 (Resy CU closure) before implementation
> **Owners**: codex (backend FSM + schema + API) · Claude (UI migration + design feedback)
> **Archive criteria**: when Phase 1 ships and `/api/v1/travel-tasks` is the canonical write path, this file moves to `_archived/` and the design lives on in code + tests.

---

## TL;DR

We add a thin **`TravelTask` facade** on top of the existing `booking_jobs` row. The facade exposes a task-centric state machine and API; internally, every task still ends up creating a `booking_jobs` row that today's UI / worker / billing / Track B work all read unchanged. **Nothing breaks.**

```
   ┌────────────────────────────────────────────────────────┐
   │             API + UI consume TravelTask                 │
   │   POST /api/v1/tasks            POST /tasks/:id/approve │
   │   GET  /tasks                   POST /tasks/:id/cancel  │
   └─────────────────┬──────────────────────────────────────┘
                     ▼
          travel_tasks (new)
            ├─ state machine        ◄── this is the new abstraction
            ├─ policy_json
            └─ current_booking_job_id ──┐
                                        ▼
                              booking_jobs (existing, untouched)
                                        │
                                        ▼
                              ExecutorV2 registry (codex 49f9175)
                                        │
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                  legacy_stagehand   computer_use   (future adapters)
```

The 5 questions codex asked, answered below.

---

## 1. `travel_tasks` minimum schema

Two tables. Both intentionally narrow — JSON columns absorb the variation we don't want to over-design yet.

### `travel_tasks`

```sql
CREATE TABLE travel_tasks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT NOT NULL,                 -- Clerk user id
  scenario                TEXT NOT NULL,                 -- 'restaurant' | 'hotel' | 'flight' | 'activity' | 'trip'
  state                   TEXT NOT NULL,                 -- see § 2

  -- Frozen at creation: whatever NLU + user constraint gave us.
  -- Same shape as today's booking_jobs.steps[0].body, just hoisted.
  request_json            JSONB NOT NULL,

  -- Per-task policy. Starts as JSON, later may move to task_permissions
  -- table once we see real usage patterns. Recognized keys (extensible):
  --   budget_max          : number (currency = scenario-implicit)
  --   allow_provider_swap : boolean
  --   allow_time_shift    : boolean
  --   pause_before_payment: boolean (default true — never compromise)
  --   approval_required   : 'none' | 'creator' | 'all_members'
  --   max_attempts        : number
  policy_json             JSONB,

  -- Pointer to the active execution attempt. NULL while task is in
  -- 'draft' / 'awaiting_profile' / 'awaiting_approval' (no attempt
  -- created yet). Updated as fallback creates new attempts.
  current_booking_job_id  UUID REFERENCES booking_jobs(id) ON DELETE SET NULL,

  -- DR linkage when the task is multi-party. NULL for solo.
  decision_room_id        UUID REFERENCES decision_rooms(id) ON DELETE SET NULL,

  -- Failure / cancellation reason (free text + optional code).
  terminal_reason         TEXT,
  terminal_code           TEXT,                          -- 'cancelled_by_user' | 'no_availability' | 'auth_failed' | etc.

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ
);

CREATE INDEX idx_travel_tasks_user_state ON travel_tasks(user_id, state);
CREATE INDEX idx_travel_tasks_current_job ON travel_tasks(current_booking_job_id);
CREATE INDEX idx_travel_tasks_dr ON travel_tasks(decision_room_id) WHERE decision_room_id IS NOT NULL;
```

**Why JSONB for `request_json` and `policy_json`?**
- `request_json`: scenarios already vary widely (restaurant fields ≠ flight fields). Putting them in JSON saves us from wide-table bloat or polymorphic joins.
- `policy_json`: codex's recommendation — JSON now, separate `task_permissions` table later if usage proves it deserves first-class indexing.

**Why a separate `decision_room_id` column?**
DR is already wired into the existing flow. A task can be created from a DR (multi-party seed) or reach a state where DR voting is needed. Either way, pointing at the room from the task lets us thread the existing DR UI into the task-centric layer cleanly. NULL for solo tasks.

### `task_events`

```sql
CREATE TABLE task_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES travel_tasks(id) ON DELETE CASCADE,

  -- Aligned to TimelineEventKind in components/task-timeline/event-vocabulary.ts
  -- (already 14 kinds + 4 reserved). Plus task-specific extensions for
  -- state changes the timeline cares about:
  --   state_changed              (payload: { from, to })
  --   approval_requested
  --   approval_granted
  --   approval_denied
  --   attempt_started            (payload: { booking_job_id, adapter })
  --   attempt_failed             (payload: { booking_job_id, reason })
  --   fallback_started
  kind         TEXT NOT NULL,

  level        TEXT NOT NULL,                            -- 'info' | 'warn' | 'error' | 'state_change'
  payload_json JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_events_task_time ON task_events(task_id, created_at);
```

**Replaces** today's per-step `decisionLog` array as the canonical event source for the new `/api/v1/tasks/:id/timeline-events` SSE — codex's `8a2da14` already publishes this SSE, so during Phase 1 the implementation just changes the source from `step.decisionLog` to `task_events` (transparent to Track B's `useTimelineEvents` hook — it parses the same payload).

---

## 2. Task state machine

```
                    ┌───────────────┐
                    │     draft     │ ◄── POST /api/v1/tasks
                    └───────┬───────┘
                            │ start (user clicks confirm card OR
                            │        DR proposal accepted)
                            ▼
              ┌──────────────────────────────┐
              │     awaiting_profile         │ ◄── pre-flight detected
              │  (codex Phase 1 contract:    │     missing DOB / passport /
              │   needs_profile_data status) │     payment fields
              └───────────┬──────────────────┘
                          │ profile filled by ProfileGapCard
                          │ + POST /api/profile/update
                          ▼
                   ┌──────────────────────────┐
                   │   awaiting_approval      │ ◄── only when policy says
                   │   (multi-party DR vote)  │     approval_required ≠ 'none'
                   └───────────┬──────────────┘
                               │ DR resolved or solo skip
                               ▼
              ┌────────────────────────────────────┐
              │             executing              │
              │ (booking_jobs row created;         │
              │  worker / executor running)        │
              └─────┬───┬───┬────────┬────────────┘
                    │   │   │        │
                    │   │   │        ├──────► ready_for_confirmation ──► completed
                    │   │   │        │             (user reviews;          (final
                    │   │   │        │              confirms)               confirm
                    │   │   │        │                                      sent)
                    │   │   │        │
                    │   │   │        └──────► failed
                    │   │   │                  (terminal_reason +
                    │   │   │                   terminal_code set)
                    │   │   │
                    │   │   └──► awaiting_otp ──► executing
                    │   │                          (OTP submitted)
                    │   │
                    │   └──► awaiting_login ──► executing
                    │                            (user authed
                    │                             out-of-band)
                    │
                    └──► fallback_started ──► executing
                          (new booking_jobs   (current_booking_job_id
                           attempt created;    re-pointed; old
                           old kept for        attempt frozen)
                           audit)

  Any state EXCEPT completed/failed/cancelled can transition to:
        ↓
   ┌──────────────┐
   │   cancelled  │ ◄── POST /api/v1/tasks/:id/cancel
   └──────────────┘
```

### State invariants

| State | `current_booking_job_id` | User-visible | UI affordance |
|---|---|---|---|
| `draft` | NULL | "Drafting your booking…" | Edit constraints / cancel |
| `awaiting_profile` | NULL | ProfileGapCard inline | Fill fields / cancel |
| `awaiting_approval` | NULL | DR voting widget | Vote / pull early / cancel |
| `executing` | not NULL | Live timeline + snapshots | Watch / cancel |
| `awaiting_otp` | not NULL | StatusBanner pause | Enter code / cancel |
| `awaiting_login` | not NULL | StatusBanner pause | Open site / cancel |
| `ready_for_confirmation` | not NULL | StatusBanner success | **Confirm** / back out |
| `completed` | not NULL | Confirmation card | Open / share / add to trip |
| `cancelled` | nullable | Cancellation reason | Re-open as new task |
| `failed` | not NULL | Failure reason + recovery option | Retry / handoff / abandon |

### Terminal states

`completed`, `cancelled`, `failed` are terminal. Once entered, the task FSM does not re-transition — a user "retry" creates a new `travel_tasks` row (with the prior task_id captured in the new task's `request_json.parent_task_id` for lineage).

---

## 3. How `booking_jobs` hangs off `travel_tasks`

A task is a **logical** unit. A `booking_jobs` row is a **physical attempt**. One-to-many.

```
travel_tasks (1)
       │
       └── current_booking_job_id ─────► booking_jobs (N)
                                          │
                                          ├── booking_jobs[0]  (first attempt)
                                          ├── booking_jobs[1]  (fallback after
                                          │                     OT no_availability)
                                          └── booking_jobs[2]  (current — Resy)
```

### Reverse mapping (booking_job → its task)

For Phase 1 we add a column on `booking_jobs` instead of a separate join table — keeps queries simple:

```sql
ALTER TABLE booking_jobs ADD COLUMN task_id UUID REFERENCES travel_tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_booking_jobs_task ON booking_jobs(task_id);
```

`task_id` is **NULL on legacy rows** (existing booking jobs created before Phase 1 ships) — safe because UI / worker / Stripe don't read it. New rows always have it set.

### Backfill strategy

**None for legacy data.** Old `booking_jobs` stay parentless and continue to render in the existing `/tasks` page via the legacy code path. New rows go through the `TravelTask` facade. Over time, legacy rows age out as users' bookings complete or get archived.

This keeps Phase 1 a strict additive migration — zero risk of touching production rows.

### Multi-attempt mechanics

When a fallback is triggered:
1. Mark current `booking_jobs` row as `failed` (or `superseded`, new status — needs codex confirmation)
2. Insert new `booking_jobs` row with same `task_id`
3. Update `travel_tasks.current_booking_job_id` to point at the new row
4. Emit `task_events { kind: 'fallback_started', payload: { from_job, to_job, reason } }`

The Track B Task Timeline already has `fallback_started` reserved in its event vocabulary ([components/task-timeline/event-vocabulary.ts](./components/task-timeline/event-vocabulary.ts)) — so the UI just renders it.

---

## 4. `/tasks` UI minimum migration (job-centric → task-centric)

The current `app/tasks/page.tsx` is a **3,476-line beast** that:
- Fetches `GET /api/booking-jobs` and lists `BookingJob` rows
- Renders `<JobCard>` per row
- Slide-over panel renders `<TaskTimelinePanel jobId={liveJobId} />` (just cutover today)

### Phase 1 minimum diff (~80-line change)

**Step A — backend** (codex):
- Add `GET /api/v1/tasks` returning `[TravelTask & { booking_job: BookingJob }]` — server-side join joins the `current_booking_job_id` so the response shape includes everything `<JobCard>` already reads
- Keep `GET /api/booking-jobs` working unchanged (legacy path)

**Step B — frontend** (Claude):
- Add a feature flag check: `ONEGENT_USE_TASK_API` (env or query param `?api=v1`)
- When the flag is on: fetch `/api/v1/tasks` instead of `/api/booking-jobs`
- Map response: `task` → render `<JobCard job={task.booking_job} task={task} />` — JobCard reads booking_job for the body, task for the new state pill (`awaiting_profile` / `awaiting_approval` / etc.)
- Slide-over passes `task.id` to `<TaskTimelinePanel taskId={task.id} />` once codex switches the SSE source from `booking-jobs/:id/timeline-events` to `tasks/:id/timeline-events`

**Step C — JobCard adjustments** (Claude, ~30 lines):
- Read `task.state` if present, otherwise fall back to `job.status` (existing behavior)
- Add new state pills for the task-only states (`awaiting_profile`, `awaiting_approval`, `awaiting_otp`, `awaiting_login`, `ready_for_confirmation`)
- For `awaiting_profile`, render the `<ProfileGapCard>` inline when expanded (reuses the component built in `a8e011f`)
- For `awaiting_approval`, render a "voting in progress" pill with link to the DR

### What stays unchanged

- `<TaskTimelinePanel>` — already accepts `jobId`, can accept `taskId` later via a small prop addition; SSE payload shape stays the same
- `<DRTimelineList>` — DR Activity Timeline keeps reading from `useRoomState`; if we want, we can add a "linked task" link to each room later, but not required for Phase 1
- `<ProfileGapCard>` — wires up via the new `awaiting_profile` state
- `<ChatPanel>` — DR chat untouched

### Cutover plan (Phase 1 closing)

```
Stage 1: ship behind ?api=v1 query flag — internal QA only
Stage 2: flip default for new sessions, keep old fetcher fallback
Stage 3: delete old fetcher; remove flag
```

---

## 5. What old logic stays untouched in Phase 1

The honest list — knowing this list is the difference between "12-week refactor" and "2-week additive migration".

### ✅ Untouched

| Component | Why it doesn't move |
|---|---|
| `booking_jobs` schema | Task is a facade; jobs stay as-is |
| `decisionLog` per-step array | Phase 4 (Domain Brain) restructures it; until then, both `decisionLog` and `task_events` exist; codex's SSE reads from whichever is populated |
| Worker queue (`worker/src/index.ts` claim loop) | Operates on `booking_jobs.id` — task layer just creates new jobs |
| ExecutorV2 registry (codex 49f9175) | Already abstracted at the right layer — task creates a job, executor runs it |
| `app/api/booking-jobs/[id]/start/route.ts` | Stays as-is for legacy callers; `/api/v1/tasks` is a parallel path |
| Stripe billing / quota (`free 3/mo + 1 DR`) | Counts against `booking_jobs` rows — no change needed |
| Track B's `Task Timeline` SSE consumer (`use-timeline-events.ts`) | Parses `{ events, summary, entries, closed, source, job }` — codex just adds an alias from `/tasks/:id/timeline-events` to the same emitter |
| Track B's `Snapshot rail` (`use-snapshots.ts`) | Already has canonical / compat endpoint dance — task layer can later add `/tasks/:id/snapshots` as another alias |
| DR / Activity Timeline / proposals / votes | Threads into task via `decision_room_id` reference — UI unchanged |
| MCP server v1 (`book_restaurant` etc.) | Stays as legacy distribution path; Phase 5 ships v2 alongside |
| ProfileGapCard internals | Already takes a `state` prop and `onSave` handler — wiring is "render this when task state == awaiting_profile" |
| User profile / contacts / notifications | Unrelated subsystems |
| OAuth / Clerk auth | Unrelated |
| `app/page.tsx` homepage chat | NLU output already gets POSTed to `/api/chat/commit` which creates a `booking_jobs` row — Phase 1 makes that route also create a `travel_tasks` row wrapping it, but the route signature is unchanged |

### 🟡 Lightly touched (read but not modified)

- `JobCard` adds a state pill for new states (~30 lines)
- Slide-over geometry passes `taskId` instead of `jobId` (~5 lines)
- NLU v2 commit handler wraps its booking-job creation with a task-creation call (~15 lines, codex's territory)

### ❌ Explicitly out of scope for Phase 1

- New `task_permissions` table (Phase 2)
- Site Skill Registry / structured outcome writing (Phase 4)
- Memory / preference learning (Phase 4 or later)
- 100-case benchmark suite formalization (Phase 4)
- MCP v2 task protocol (Phase 5)
- Onegent Connect UI (Phase 2)
- Multi-route execution router beyond ExecutorV2 (Phase 3)
- Supplier / merchant feed (out of 90-day scope)

---

## Phase 1 acceptance criteria

When Phase 1 is "done":

```
✅ POST /api/v1/tasks creates a travel_tasks row + initial booking_jobs row
✅ GET /api/v1/tasks returns user's tasks with embedded current_booking_job
✅ POST /api/v1/tasks/:id/approve transitions awaiting_approval → executing
✅ POST /api/v1/tasks/:id/cancel works in any non-terminal state
✅ Task FSM enforces invariants — illegal transitions return 400 with clear error
✅ /tasks page renders task-centric list when ?api=v1 OR feature flag is set
✅ Resy CU run goes through the task layer (not bypassed)
✅ awaiting_profile state correctly set when codex's needs_profile_data fires
✅ ProfileGapCard renders inline when state === 'awaiting_profile'
✅ State change emits task_events row + SSE timeline event
✅ All existing tests pass (NLU 151, drift guard, etc.)
✅ Stripe billing still counts correctly (per booking_jobs unchanged)
```

---

## Open questions / risks

1. **Concurrency on `current_booking_job_id` updates** — when fallback creates a new attempt, the old worker might still be writing. Need an atomic "supersede" transition that closes the old job + repoints the task in one transaction. Codex to design.

2. **Cancellation cascade** — does cancelling a task force-cancel the underlying running booking_job? Likely yes (worker checks `task.state === 'cancelled'` on next claim or polls a kill flag). Codex to design.

3. **Multi-scenario tasks (trip)** — a "trip" has 4 scenarios. Does that mean 1 trip task with 4 child tasks, or 1 task with 4 booking_jobs? Phase 1 punts on this — `scenario='trip'` tasks may be allowed to have one booking_job per category-attempt, FSM same. Phase 2+ may introduce `parent_task_id` for explicit parent/child if needed.

4. **DR-created tasks** — when a Decision Room reaches an accepted proposal, the existing flow creates a `booking_jobs` row directly. Phase 1 changes this to create a `travel_tasks` first. Need to make sure all DR-finalize call sites go through the new path. Codex audit.

5. **Audit log naming collision** — `agent_logs` table exists; `task_events` is new. Initially they overlap (executor writes both). Phase 4 collapses into one — until then, dual-write is acceptable.

6. **Backwards-compat for already-running jobs** — at deploy time, jobs in `executing` state have no `task_id`. The task layer ignores them; they finish and complete via the legacy path. New jobs all go through tasks.

---

## Implementation order (codex's actual sequencing, paraphrased)

```
1. DB migration — travel_tasks + task_events + booking_jobs.task_id
2. lib/core task FSM — pure-function state-transition validator
3. lib/core/execution — wrap runExecutionJob to also write task state changes
4. POST /api/v1/tasks + state-transition routes
5. /api/chat/commit + DR finalize call sites — switch to task-creation path
6. SSE emitter — alias /tasks/:id/timeline-events to existing endpoint
7. ?api=v1 feature flag check in /tasks page (Track B)
8. JobCard new state pills (Track B)
9. ProfileGapCard wiring (Track B, after needs_profile_data lands)
10. Stripe billing test — confirm quota still counts correctly
```

Tracks A + B work in parallel from step 7. Steps 1-6 are codex serial.

---

## Pointers

- **Pivot context**: [EXECUTOR_V2_PIVOT.md](./EXECUTOR_V2_PIVOT.md)
- **Track B's existing event vocabulary** (will be reused as task_events.kind values): [components/task-timeline/event-vocabulary.ts](./components/task-timeline/event-vocabulary.ts)
- **Track B's existing ProfileGapCard contract** (will trigger when `state === 'awaiting_profile'`): [components/profile-gap/types.ts](./components/profile-gap/types.ts)
- **DR data shapes** (will be referenced via `decision_room_id`): [lib/db.ts](./lib/db.ts) — `DecisionRoom`, `DecisionRoomProposal`, etc.
- **Codex's ExecutorV2 contracts** (master 49f9175 + 8a2da14): see PROJECT_SUMMARY.md "Recent Updates 2026-05-02"

---

*This is a Phase 1-only design. Phases 2-5 will get their own design docs as they're queued. Resist the urge to design the 5-year OS in this file — that's [EXECUTOR_V2_PIVOT.md](./EXECUTOR_V2_PIVOT.md)'s job.*
