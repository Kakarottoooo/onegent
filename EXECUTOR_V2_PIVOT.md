# Executor V2 Pivot — Computer Use as the new main path

> **Date opened**: 2026-05-02
> **Status**: 🟡 In progress · Resy Computer Use closure pending
> **Branches**: `master` (codex Track A) · `claude/festive-pare-f27273` (Claude Track B)
> **Owners**: codex (backend / executor) · Claude (UI / observability / tests)
> **Archive criteria**: when (a) Resy via Computer Use reaches "stopped before final confirm" reliably AND (b) `claude/festive-pare-f27273` is merged to master, this file moves to `PROJECT_SUMMARY_ARCHIVE_*` and the high-level summary takes over.

---

## TL;DR

We're pivoting the **browser execution layer** from the bespoke Stagehand-per-platform stack to **OpenAI Computer Use as the default**, with the existing Stagehand wrapped as a `legacy_stagehand` adapter (kept for fallback, not new investment). The product layer above (chat, NLU, Decision Room, profile, queue, MCP, audit, payment-stop) is **unchanged** — that's the moat, the executor is commodity infrastructure.

The pivot is split into two tracks:

- **Track A (codex)** — backend executor + data contracts
- **Track B (Claude)** — UI + observability + tests

Both are progressing in parallel, with explicit file-domain ownership (see [Ownership matrix](#ownership-matrix)) so we don't step on each other.

---

## Why we pivoted

By the morning of 2026-05-02, **7 commits in a row** had been spent debugging a single OpenTable restaurant booking (rounds 5 → 10 of OT fixes). The bug list was endless: phantom-worker race, ESM/CJS require trap, Stagehand wrapper proxy gaps (`waitForFunction`, `locator.filter`, `scrollIntoViewIfNeeded`, `boundingBox`), esbuild `__name` leak, `extractTargetCity` missing export, lib/worker fork drift…

The realization: this isn't a bug-fixing problem. It's an **architectural complexity problem**. The Stagehand stack has structurally too many moving parts:

```
Stagehand wrapper (proxy gaps)
  ↓
Local chromium (default fingerprint, esbuild leaks)
  ↓
6 platform providers (OT / Resy / Booking / Expedia / Hotels / Expedia flight)
  ↓
3-layer per provider (stage-signals + fillForm + auditAndRefill)
  ↓
ESM/CJS dual-mode (require undefined under tsx)
  ↓
lib + worker fork (drift guard burden)
  ↓
Phantom worker queue race
  ↓
Profile pre-check + payment stop logic
```

**Each layer is a bug source.** Each new platform / scenario / field multiplies the surface.

OpenAI Computer Use (Anthropic's Computer Use API surface, OpenAI's Responses-API `tools: [{ type: "computer" }]`) collapses most of those layers into one primitive: *"here's a screenshot, here's an instruction, return UI actions."* It costs more per booking ($1–5 vs $0.10–0.50) and runs slower (30–90s vs 10–20s), but:

- **0 platform-specific code** — new platforms = 0 new files
- **Robust to platform UI changes** — model adapts visually instead of selectors breaking
- **One execution loop** — drops the bespoke stack entirely

Critically, **the things Onegent does that Computer Use *won't*** are exactly the product moat:

| Onegent | Computer Use will do this? |
|---|---|
| Multi-user Decision Room | ❌ Anthropic doesn't do social products |
| Persistent profile + memory | ❌ API providers don't store user relationships |
| Domain knowledge (TSA / passport / DOB rules) | ❌ Generic |
| Trust boundary (止步 CVV) | ❌ CU defaults to fill anything |
| Async / scheduled tasks | ❌ Request-response API, not long-running |
| MCP reverse-exposure (claude.ai → Onegent) | ❌ Not their business model |
| Group / family bookings | ❌ |
| Payment binding / compliance | ❌ |

So Computer Use is to Onegent what AWS S3 is to Dropbox — a primitive we sit on top of, not a competitor.

**Strategic anchor**: Don't build infrastructure. Build a product. The infrastructure providers are not your competition — they're your suppliers.

---

## Architecture

### Before (legacy)

```
                  app/api/booking-jobs/[id]/start/route.ts
                                  ↓
                    lib/core/execution/runExecutionJob
                                  ↓
                          runBrowserTask() ────────────────┐
                                  ↓                        │
              lib/booking-autopilot/stagehand-executor.ts  │
                          OR worker mirror                 │
                                  ↓                        │
                  6 platform providers + 3-layer logic     │
                                  ↓                        │
                    Stagehand + local chromium             │
```

### After (`execution-v2`, codex 49f9175 + 8a2da14)

```
                  app/api/booking-jobs/[id]/start/route.ts
                                  ↓
                    lib/core/execution/runExecutionJob
                                  ↓
              ┌──── ExecutorV2 registry (env-flagged) ────┐
              │                                            │
              ▼                                            │
    ┌─────────────────────┐    ┌──────────────────────┐   │
    │ legacy_stagehand    │    │ computer_use         │   │
    │ adapter (default)   │    │ executor (gradual)   │   │
    │ wraps existing      │    │ OpenAI Computer Use  │   │
    │ stagehand-executor  │    │ Responses API        │   │
    └─────────────────────┘    └──────────────────────┘   │
              │                          │                 │
              ▼                          ▼                 │
        Browserbase /               Computer Use API       │
        local chromium              (model + harness)      │
                                                            │
        Both adapters emit unified BookingExecutionEvent ──┘
        kinds: opened_site / selected_slot / accepted_policy
             / needs_otp / otp_submitted / ready_for_confirmation
             / failed
        unified status: needs_otp / needs_login /
                        ready_for_user_confirmation /
                        no_availability / failed
```

### Feature flags

```bash
# Pick the executor at runtime (set in Railway / .env.local):
ONEGENT_EXECUTOR_V2=computer_use         # opt in to new path
ONEGENT_EXECUTOR_V2=legacy_stagehand     # default; keeps old behavior

# Scenario-scoped Computer Use rollout:
ONEGENT_COMPUTER_USE_FOR=resy            # only Resy uses CU
ONEGENT_COMPUTER_USE_FOR=resy,restaurant # CU for all restaurant scenarios
ONEGENT_COMPUTER_USE_FOR=all             # CU for everything
```

Default: legacy stays default until Resy Essex closure proves the CU path. Then we expand scenario by scenario.

### What changed at the contract layer

Track A also added structured eventing endpoints that didn't exist before:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/booking-jobs/:id/timeline-events` | SSE | Server-pushes `timeline` events with `{events, summary, entries, closed, source, job}` payloads |
| `/api/booking-jobs/:id/timeline-events?format=json` | GET | Polled fallback when EventSource isn't available |
| `/api/booking-jobs/:id/snapshots` | GET | Canonical snapshot list — feeds Track B's right-rail |
| `/api/browser-live/:id/snapshots` | GET | Compat path for the existing live agent canvas |

The unified `BookingExecutionResult` status now also includes a structured `needs_profile_data` (in progress as of writing) so the UI knows to render `ProfileGapCard` instead of a raw error.

---

## Ownership matrix

### Track A (codex) — `master` branch

```
✅ Owned, freely modifies:
   lib/core/execution/**
   worker/src/core/execution/**
   lib/execution-v2/**
   worker/src/execution-v2/**
   lib/booking-execution-events/**
   worker/src/booking-execution-events/**
   app/api/booking-jobs/[id]/start/route.ts
   app/api/booking-jobs/:id/timeline-events/**
   app/api/booking-jobs/:id/snapshots/**
   app/api/browser-live/**
   worker/src/index.ts
   lib/booking-autopilot/** (legacy fallback adapter — kept, not deleted)
   worker/src/booking-autopilot/** (legacy mirror — same)
   scripts/check-drift.ts
```

### Track B (Claude) — `claude/festive-pare-f27273` branch

```
✅ Owned, freely modifies:
   components/task-timeline/**
   components/profile-gap/**
   components/dr-timeline/**
   app/tasks/page.tsx
   app/rooms/[id]/page.tsx (DR cutover, in-place polish)
   app/tasks/tasks.css
   app/dev/timeline-demo/**
   app/dev/profile-gap-demo/**
   app/dev/dr-timeline-demo/**
   lib/agent/nlu-v2/__tests__/**
   lib/agent/nlu-v2/router.ts (member_names blank-validation bug fix only)
   lib/ui-copy/errors.ts
```

### Cross-cutting (one writes, the other reads)

```
codex emits  → Claude consumes
─────────────────────────────────
SSE timeline events + status enums   → use-timeline-events hook
/snapshots payload                   → use-snapshots hook
needs_profile_data status            → ProfileGapCard wiring (pending)
ProfileFieldId (types.ts)            → flight DOB / passport rule alignment
```

The merge eventually moves Claude's work into master. Codex handles that ([noted in their plan](#open-items)).

---

## Backend contracts (Track A · codex 8a2da14)

### Timeline events SSE

```http
GET /api/booking-jobs/:id/timeline-events
Accept: text/event-stream
```

Server pushes:

```
event: timeline
data: {
  "events": [...],           // already-derived high-level TimelineEvent[]
  "summary": "...",          // optional one-line agent summary
  "entries": [...],          // raw decisionLog (legacy / fallback shape)
  "closed": false,           // run finished?
  "source": "executor-v2",   // "executor-v2" | "legacy"
  "job": { ... }             // full job snapshot for fallback derive-events
}
```

`?format=json` query string returns the same shape as a single-shot GET response (for polling clients).

### Snapshots

```http
GET /api/booking-jobs/:id/snapshots         # canonical
GET /api/browser-live/:id/snapshots         # compat alias
```

Returns either `{snapshots: [...]}` or `[...]` directly. Each snapshot has `{id, ts, src/url, label?}` (Track B's normalizer accepts multiple field-name aliases).

### Needs-profile-data status (in progress)

```ts
// Will land in lib/core/execution/types.ts
type ExecutionJobStatus =
  | "running"
  | "needs_otp"
  | "needs_login"
  | "needs_profile_data"        // ← NEW
  | "ready_for_confirmation"
  | "no_availability"
  | "failed";

// Payload when status === "needs_profile_data":
{
  kind: "needs_profile_data",
  missing: ProfileFieldId[],     // aligned to components/profile-gap/types.ts
  reason?: string,
  trigger: "restaurant" | "hotel" | "flight" | "activity"
}
```

`ProfileFieldId` is **already defined** in `components/profile-gap/types.ts`; Track A imports that type to keep the contract aligned.

Field-set rules (Track A's spec):

- **Restaurant**: name, email, phone (no DOB / passport / payment)
- **Hotel**: name, email, phone, address, payment (redirect)
- **Flight (domestic US)**: name, email, phone, **DOB only** (no passport)
- **Flight (international)**: name, email, phone, DOB, passport, expiry, country
- **Activity**: name, email, phone

This explicitly removes the previous over-strict pre-check that blocked all flights without passport (fixed in commit 5357f98 → ported by codex to master).

---

## Frontend wiring (Track B · Claude)

Built ahead of contracts, then wired once endpoints landed:

### Components built (all ship-ready, demo-route previewable)

| Package | Purpose | Demo |
|---|---|---|
| `components/task-timeline/` | Slide-over panel with high-level event timeline + snapshot stream + lightbox + status banner | `/dev/timeline-demo` |
| `components/profile-gap/` | Inline chat card for missing profile fields; payment fields short-circuit to Settings | `/dev/profile-gap-demo` |
| `components/dr-timeline/` | DR Activity Timeline (chronological event feed for Decision Rooms — cutover already live) | `/dev/dr-timeline-demo` + `/rooms/{id}` |

### Hooks (consume Track A's contracts)

| Hook | Reads | Falls back to |
|---|---|---|
| `useTimelineEvents(jobId)` | `/api/booking-jobs/:id/timeline-events` SSE | `?format=json` polling → `/api/booking-jobs/:id` + `derive-events.ts` |
| `useSnapshots(jobId, {paused})` | `/api/booking-jobs/:id/snapshots` | `/api/browser-live/:id/snapshots` |

Both have defensive normalizers — unknown event kinds filter out, multiple field-name aliases accepted, never crash on payload shape changes.

### Cutovers landed

- ✅ DR Activity Timeline → `app/rooms/[id]/page.tsx` (commit `d0172f5`) — real `useRoomState` snapshot drives the new feed, polling at the existing 4s rate
- ✅ Task Timeline → `app/tasks/page.tsx` (commit `efa0404`) — slide-over now renders `<TaskTimelinePanel />` with SSE + canonical snapshots, replacing the legacy `<BrowserLiveView />` canvas

### Pending wiring

- ⏸ ProfileGapCard → homepage chat — waits for Track A to emit `needs_profile_data` status. Component + types are ready.

---

## Lib deletion criteria (updated)

The `DELETE_WHEN` rule for `lib/booking-autopilot/` was originally "all 4 categories run via worker." That trigger has been **superseded** by the pivot.

**New deletion criteria** (any of these unblocks deletion):

1. ✅ `legacy_stagehand` adapter wraps the existing executor cleanly (codex 49f9175 — DONE)
2. 🟡 `computer_use` executor closes Resy Essex to "stopped before final confirm" reliably (in progress)
3. 🟡 `ONEGENT_COMPUTER_USE_FOR=all` runs in production for ≥ 3 categories (pending)
4. ⏸ User confirms they want to remove the legacy fallback (decision pending)

Until conditions 2-4 are met, lib/ stays as a fallback path. The drift guard now also covers `browser-snapshot-store` (codex 8a2da14).

---

## Done log (today's commits)

### Track A (master)

| Hash | Subject |
|---|---|
| `49f9175` | feat: ExecutorV2 registry + legacy_stagehand + computer_use adapters + unified status enum |
| `8a2da14` | feat(tasks): expose timeline and snapshot endpoints + worker boot fix (extractTargetCity) + check-drift Node-native + browser-snapshot-store |

### Track B (`claude/festive-pare-f27273`)

| Hash | Subject |
|---|---|
| `5357f98` | fix(flight): require only DOB, not passport — domestic flights don't need passport |
| `cd4f2de` | feat(task-timeline): Track B stages 1+2+3 — components/task-timeline/ scaffolding |
| `07f4e4a` | feat(task-timeline): /dev/timeline-demo route + idle-state demo fix |
| `a8e011f` | feat(profile-gap): inline chat card for missing profile fields |
| `ed5a5e4` | feat(dr): polish ChatPanel — bigger surface, avatars, better hierarchy |
| `e127156` | feat(dr-timeline): Activity Timeline component + /dev/dr-timeline-demo |
| `d0172f5` | feat(dr): wire Activity Timeline into the room detail page |
| `210fd30` | test(nlu-v2): add 38 golden tests covering composite plans + edge cases |
| `a2e5006` | fix(nlu-v2): blank/whitespace member_names must not pass DR creation gate |
| `134aa43` | copy(ui): rewrite ~30 dev-tone error strings + add UI_ERR helper |
| `efa0404` | feat(task-timeline): wire SSE + snapshot endpoints; cutover /tasks page |

NLU test count: **88 → 151 passing** (+63 cases), 1 real bug found and fixed (`member_names` blank-validation gap).

---

## Open items

### Track A (codex's next)

1. 🟡 Add `needs_profile_data` status emission to `lib/core/execution` + `worker/src/core/execution`
2. 🟡 Restructure flight DOB/passport gating (domestic vs international) at the executor layer (the previous fix in route.ts will remain as a pre-flight check; executor mirrors it)
3. 🟡 Per-scenario `getRequiredProfileFields(scenario, params)` helper aligned to `ProfileFieldId`
4. 🟡 Resy Essex Computer Use closure — first scenario flagged via `ONEGENT_COMPUTER_USE_FOR=resy`
5. 🟡 Audit / timeline emit explicit "needs_profile_data" event for the UI

### Track B (Claude's next, after Track A unblocks)

1. ⏸ Wire `<ProfileGapCard>` into homepage chat once `needs_profile_data` status emits
2. ⏸ Possibly fold `<ProfileGapCard>` into the booking-job detail page too if status arrives mid-execution
3. ⏸ Status banner on `<TaskTimelinePanel>` when `status === "needs_profile_data"` — could surface a "Add details" CTA that opens the inline form

### Cross-cutting / merge

- ⏸ `claude/festive-pare-f27273` → `master` merge (codex handles, since Track A files now overlap with Claude's earlier flight-DOB fix)
- ⏸ Once merged, `extractTargetCity` stub (already in master 8a2da14) lands in the worktree's worker too

---

## Risks + open questions

1. **Computer Use cost at scale** — $1-5 per booking. With 0 paying users today this is fine, but the Browserbase roadmap's cost curves (see `PROJECT_SUMMARY.md`) need to be re-modeled for CU specifically. Likely **CU through the OpenAI API counts against the same Browserbase Pro budget logic** (i.e., scale = move toward direct browser farm where CU isn't needed, since the model can drive a local stagehand).
2. **Reliability of CU on hard targets** — Booking.com / Expedia have aggressive anti-bot. The Computer Use harness uses real Chromium with model-driven actions, but anti-bot sometimes flags vision models too. **Resy Essex first** because Resy reliability is a known good test case.
3. **Adapter merge conflicts** — Once we want to delete the `legacy_stagehand` path, the `lib/booking-autopilot/` and `worker/src/booking-autopilot/` directories vanish. The 21+ `/lib/**` files that import from there need redirection — same audit as the original DELETE_WHEN plan. Codex handles.
4. **NLU `chat.ts` was collapsed into `unified.ts`** during the v2 refactor — golden tests for unified turn require `OPENAI_API_KEY` and skip without it. Today's 38+25 new test cases use the pure router and are deterministic; the LLM-dependent tests stay skipped in CI.

---

## Pointers

- **State doc**: `PROJECT_SUMMARY.md` — high-level position + architecture + Browserbase roadmap (this file is **transition-only**)
- **NLU plan (completed)**: `NLU_REFACTOR_PLAN_C.md`
- **Browser farm plan**: `BROWSER_FARM_PLAN.md`
- **Trip packaging plan**: `TRIP_PACKAGING_PLAN.md`
- **Decision Room test plan**: `DECISION_ROOM_TEST_PLAN.md`
- **Cross-track ownership rules**: see `CLAUDE.md`'s "Booking Automation Architecture" + this file's [Ownership matrix](#ownership-matrix)

---

*Maintained jointly by codex (Track A) and Claude (Track B). When Resy Essex closes via Computer Use and the branches merge, this file moves to archive and PROJECT_SUMMARY.md becomes the single source of truth again.*
