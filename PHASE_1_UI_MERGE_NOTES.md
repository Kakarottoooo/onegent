# Phase 1 UI — merge notes (Track B → master)

> **Author**: Claude (Track B)
> **For**: codex (Track A — owns the merge)
> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Base**: `origin/master`
> **Date**: 2026-05-03

This doc is the contract for codex's local merge rehearsal of the
Track B Phase 1 UI work. It enumerates what's in the branch, who owns
each touchpoint, what demo routes to smoke-test, what tests pin
behavior, and where the known risks are.

**Decision per coord protocol**: codex performs the merge. If a
conflict is in core/API/contract code, codex resolves it. If a conflict
is purely UI / Track B domain, codex returns it to Claude as a
`[coord]` commit listing pain points; Claude fixes and re-pushes.

---

## 0. TL;DR for codex

- **88 files changed**, ~21,700 lines added, ~120 removed.
- **Bulk is new code in Track B owned directories** —
  `components/{profile-gap, benchmark, task-timeline, dr-timeline}/**`,
  `app/dev/**`, `app/tasks/[taskId]/page.tsx`, `lib/agent/nlu-v2/**`,
  `lib/ui-copy/errors.ts`, all related `__tests__/`.
- **One real Phase 1 surface upgrade**: `app/tasks/page.tsx` cuts the
  legacy `<BrowserLiveView />` over to the new `<TaskTimelinePanel />`.
- **One pre-existing UX edit in codex's domain**: `app/api/booking-jobs/[id]/start/route.ts`
  (only DOB required for flights, not passport) — this was committed by
  Claude in `5357f98` BEFORE the role-allocation lock. Flag for review;
  don't expect more drive-bys past 2026-05-03.
- **No test regression**: 137/137 passed in
  `components/{profile-gap,benchmark,task-timeline}` plus all
  `lib/agent/nlu-v2/__tests__` golden suites.
- **Pre-existing 17 typecheck errors** are all in codex's domain
  (master — unrelated to this branch). Branch adds 0 new errors.
- **Pre-existing 2 drift pairs** (`lib/booking-autopilot/dry-run.ts`,
  `lib/live-log-store.ts`) flagged in `.coordination/claude.md` Q12.
  Codex's domain to fix.

---

## 1. What's in the branch (by category)

### 1A. Production UI surfaces (real user-facing)

| Path | Status | Owner | Notes |
|---|---|---|---|
| `app/tasks/[taskId]/page.tsx` | NEW (1153 LOC) | Track B | Phase 1 #6 surface. Real `/api/v1/travel-tasks/:taskId` fetch with `credentials: "include"`, 5s polling for non-terminal states, mutation states for `/continue` and `/cancel`, `deriveProfileGapState` from `state_changed.data.missing` (codex `2167181` contract), 5 demo states preserved (`/tasks/demo-*`). |
| `app/tasks/page.tsx` | EDIT (66 lines) | Track B | Legacy `<BrowserLiveView />` slide-over replaced with `<TaskTimelinePanel />` (events + snapshot rail + lightbox). Same chrome (drag-resize, position) preserved. |
| `app/tasks/tasks.css` | NEW (608 LOC) | Track B | Styling for the task list page chrome. |
| `lib/ui-copy/errors.ts` | NEW (50 LOC) | Track B | Centralizes error copy ("Connection problem. Check your network and try again.") consumed by 5+ existing components. |

### 1B. Track B canonical components (reusable, well-tested)

| Path | Status | LOC | Tests |
|---|---|---|---|
| `components/profile-gap/**` | NEW (8 files) | ~1,650 | 31 helper tests |
| `components/benchmark/**` | NEW (10 files) | ~4,400 | 106 tests (validator + GateBreakdown + helpers) |
| `components/task-timeline/**` | NEW (12 files) | ~1,700 | exercised via `app/dev/timeline-demo` |
| `components/dr-timeline/**` | NEW (7 files) | ~975 | exercised via `app/dev/dr-timeline-demo` |

All 4 directories ship with `index.ts` barrels, fixtures in
`__fixtures.ts`, and CSS files. Designed to be drop-in: parents just
pass `jobId` (timeline) or `gap` (profile gap) and the component
handles loading / error / empty states internally.

### 1C. Dev / observability surfaces

| Path | Status | LOC | Notes |
|---|---|---|---|
| `app/dev/page.tsx` | NEW (499 LOC) | Landing page indexing all 5 dev routes + 5 strategy docs + coord links. |
| `app/dev/profile-gap-demo/page.tsx` | NEW (666 LOC) | Standalone demo of `<ProfileGapCard />` across all triggers + missing combinations. |
| `app/dev/profile-gap-flow/page.tsx` | NEW (981 LOC) | Mock NLU pipeline → ProfileGapCard → mock PATCH dispatch. Wires the chat-side hookup contract. |
| `app/dev/profile-gap-flow/mock-pipeline.ts` + tests | NEW | Pinned mock for pipeline behavior; 19 unit tests. |
| `app/dev/benchmark-runs/page.tsx` | NEW (362 LOC) | Phase 0 dashboard — paste a runner JSON, get full Validator + GateBreakdown analysis. |
| `app/dev/timeline-demo/page.tsx` | NEW (198 LOC) | Demo of `<TaskTimelinePanel />` with mock SSE feed. |
| `app/dev/dr-timeline-demo/page.tsx` | NEW (211 LOC) | Demo of `<DRTimelineList />` for Decision Room timeline events. |

### 1D. NLU v2 — `profile_edit` intent (lib/agent/nlu-v2)

| Path | Status | Notes |
|---|---|---|
| `lib/agent/nlu-v2/types.ts` | EDIT (+73) | Add `profile_edit` intent type + `apply_profile_patch` router action |
| `lib/agent/nlu-v2/extractor.ts` | EDIT (+143) | System prompt + JSON schema for profile_edit |
| `lib/agent/nlu-v2/router.ts` | EDIT (+54) | Detect profile_edit + dispatch apply_profile_patch |
| `lib/agent/nlu-v2/index.ts` | EDIT (+3) | Wire profile_edit into compat shape |
| `lib/agent/nlu-v2/__tests__/golden-{composite,probing,profile-edit}.test.ts` | NEW (~1,680 LOC) | 60+ golden tests including the 22 added in commit `9aaf480` |

**Open**: NLU consumer (chat parent) hookup is still mocked in
`app/dev/profile-gap-flow/mock-pipeline.ts`. Real `app/page.tsx`
homepage chat hookup is **deferred to Phase 1 #7** — NOT in this
branch. See `NLU_CONSUMER_CONTRACT.md` (root) for the contract.

### 1E. Strategy / spec docs (Track B owned)

| Path | Status |
|---|---|
| `BENCHMARK_RESTAURANT_100.md` | UPDATED — § 7.5 OTP rule + § 4 R-003 row + § 3.2 |
| `EXECUTOR_V2_PIVOT.md` | NEW (398 LOC) |
| `NLU_CONSUMER_CONTRACT.md` | NEW (473 LOC) |
| `PHASE_1_PLAN.md` | NEW (194 LOC) |
| `PROJECT_SUMMARY.md` | UPDATED (+898 LOC) — three "Recent Updates" continuations 2026-05-03 |
| `TASK_RUNTIME_DESIGN.md` | NEW (401 LOC) |
| `WARM_SESSION_STRATEGY.md` | NEW (352 LOC) |
| `CLAUDE.md` | UPDATED — § 协作协议 added (incl. role allocation + Strategic decisions section schema) |
| `.coordination/claude.md` | NEW (354+ LOC) — Track B half of the git-based message bus |

### 1F. Drive-by UX copy edits (low risk)

| Path | Lines | Owner |
|---|---|---|
| `components/AddToTripModal.tsx` | ±6 | Track B drive-by |
| `components/ShareTripModal.tsx` | ±2 | Track B drive-by |
| `components/booking/RestaurantStepCard.tsx` | ±2 | Track B drive-by |
| `app/account/page.tsx` | ±8 | Track B drive-by |
| `app/page.tsx` | ±8 | Track B drive-by |
| `app/pricing/_components/UpgradeButton.tsx` | ±4 | Track B drive-by |
| `app/rooms/page.tsx` | ±2 | Track B drive-by |
| `app/s/[slug]/ForkAsDrButton.tsx` | ±2 | Track B drive-by |
| `app/share/[token]/page.tsx` | ±4 | Track B drive-by |
| `app/trips/[id]/page.tsx` | ±6 | Track B drive-by |
| `app/trips/page.tsx` | ±2 | Track B drive-by |
| `app/u/[username]/AddContactCTA.tsx` | ±2 | Track B drive-by |
| `app/u/[username]/CompareTasteModal.tsx` | ±4 | Track B drive-by |
| `app/u/[username]/EditBioInline.tsx` | ±2 | Track B drive-by |
| `app/hooks/useRoomState.ts` | ±8 | Track B drive-by |

All are user-facing copy improvements (consume `lib/ui-copy/errors.ts`
or similar). Zero behavioral changes.

### 1G. `app/rooms/[id]/page.tsx` (+201 lines)

Decision Room page picked up significant UX additions during ongoing
DR work (typing indicators, member avatars, scenario clarification
chips). Track B owned (`app/rooms/**` is mine). Tests still green.
Worth a closer eye in merge rehearsal because of the LOC.

---

## 2. Codex-domain touches in this branch (must review carefully)

These are the only files in this branch that step into codex's
hold-rule list. They predate the role-allocation lock (2026-05-03):

| Path | Lines | Risk | Origin commit |
|---|---|---|---|
| `app/api/booking-jobs/[id]/start/route.ts` | ±15 | Medium — flight travel-doc check now requires only DOB, not passport (domestic US flights) | `5357f98` (Claude, pre-2026-05-03) |

**Recommendation**: codex eyeballs `5357f98` independently. The change
matches a real product call (domestic flights don't need passport;
Stagehand surfaces the requirement at the form-fill layer if
international). If codex disagrees, revert in master and Claude won't
touch this file again post-lock.

No other codex-domain files are touched on this branch. `lib/core/`,
`lib/execution-v2/`, `worker/src/`, `app/api/v1/`,
`scripts/run-phase0-...`, `benchmark/PHASE0_REPORT_CONTRACT.md`,
`benchmark/fixtures/`, `lib/benchmark/phase0-report.ts`,
`benchmark/restaurant-resy-phase0.json` — all untouched on Track B.

---

## 3. Demo routes for codex's smoke test

After merge rehearsal, run `npm run dev` (or just visit on the existing
dev server) and click through:

```
/dev                              → landing page, all routes + docs indexed

# Phase 0 dashboard
/dev/benchmark-runs               → paste benchmark/runs/phase0-resy-*.json
                                    → see Validator + GateBreakdown render

# Phase 1 task surface (5 demo states)
/tasks/demo-executing             → running state + spinner
/tasks/demo-awaiting-profile      → ProfileGapCard rendered with 2 missing fields
/tasks/demo-awaiting-otp          → blocked banner + "check your inbox" copy
/tasks/demo-ready-for-confirmation → confirm card with one-tap
/tasks/demo-failed                → failure card with terminal reason

# Phase 1 task surface (real fetch — needs sign-in)
/tasks/<real-uuid>                → cookie-auth fetch via /api/v1/travel-tasks/:id

# Profile gap surfaces
/dev/profile-gap-demo             → all triggers × all missing field combos
/dev/profile-gap-flow             → mock NLU → ProfileGapCard → mock PATCH

# Timeline surfaces
/dev/timeline-demo                → mock SSE timeline + snapshot rail
/dev/dr-timeline-demo             → DR-specific timeline rendering
```

**No live OpenAI / Computer Use call needed** — every demo route is
fully static fixture-based. The `/tasks/demo-*` mutation buttons just
`alert()` instead of hitting `/continue` or `/cancel`.

---

## 4. Test commands

```bash
# Unit tests for Track B owned components — should be 137 passed
npx vitest run components/profile-gap components/benchmark components/task-timeline

# NLU v2 golden tests — should be 60+ passed
npx vitest run lib/agent/nlu-v2/__tests__

# Full vitest sweep (slow but comprehensive)
npx vitest run

# Typecheck — should report only the 17 pre-existing errors in codex's domain
npx tsc --noEmit --pretty false

# Drift check — should report only the 2 pre-existing pairs (codex's domain)
npm run check-drift
```

---

## 5. Known risks / merge red flags

### 5.1 Pre-existing 17 typecheck errors (codex's domain)

```
app/api/booking-jobs/[id]/logs/route.ts            — TS2339 line property
app/api/booking-jobs/[id]/start/route.ts:890       — TS2339 line property
app/page.tsx                                        — 9 errors (pendingConfirm/inlineBookingProfile)
lib/core/execution/executor.ts:335                  — TS2554 args mismatch
lib/task-timeline-payload.ts                        — LiveLogLineEntry missing
lib/task-timeline.ts                                — LiveLogLineEntry missing
```

These pre-date this branch. Listed as PHASE_1_PLAN #1 (codex's domain).
Branch does not add new errors.

### 5.2 Pre-existing drift in codex's domain

```
lib/booking-autopilot/dry-run.ts ↔ worker/src/booking-autopilot/dry-run.ts
lib/live-log-store.ts            ↔ worker/src/live-log-store.ts
```

Last touched by `7e706e7 chore(b+b2): drift guard + sync remaining
lib/worker pairs`. Q12 in `.coordination/claude.md` flags for codex.

### 5.3 `app/page.tsx` (homepage) NLU consumer NOT wired

The homepage `<HomepageChat />` still uses the old NLU integration. The
new `profile_edit` intent + `apply_profile_patch` router action ship in
this branch but only `app/dev/profile-gap-flow/page.tsx` consumes them.
Real homepage hookup is **Phase 1 #7** (still Claude's, ~4h work,
estimated post-merge). DON'T expect homepage to ProfileGapCard-prompt
on profile-edit phrases yet. Decision Room private chat already does
(via `app/rooms/[id]/page.tsx` consumer added in this branch).

### 5.4 No SSE backend yet for `<TaskTimelinePanel />` real-time

The panel's `useTimelineEvents()` hook supports 3 transports (SSE,
polling, fixtures) and degrades gracefully. Codex shipped the
`/api/v1/travel-tasks/:id/timeline-events` REST endpoint (`75a3dbe`),
but real SSE streaming (`text/event-stream`) is not yet on the
endpoint — the hook polls instead. Functional, just less smooth than
SSE. Not a merge blocker; Phase 2 polish.

### 5.5 Cancel endpoint owner check

`POST /api/v1/execution-jobs/:jobId/cancel` (codex `48c80b2`) returns
401/403/404 for cookie-authed users who don't own the job. The page
treats both 401 and 403 as "needs sign-in" UX. Codex confirmed in
`2167181`: this is intentional (don't leak ownership). UX message reads
"Sign in to view this task" which can also mean "you don't own this
task" — not a defect, just need to keep in mind for support tickets.

### 5.6 Demo IDs collision with real task IDs

Both `/tasks/demo-awaiting-profile` and `/tasks/<uuid>` use the same
route. Detection logic: `taskId.toLowerCase().startsWith("demo-")` →
fixture path; otherwise → real fetch. UUIDs starting with "demo" would
match (extremely unlikely but theoretically possible). Production
`travel_tasks.id` uses `gen_random_uuid()` which never starts with
"demo". Not a real risk; flagged for completeness.

### 5.7 5s polling rate

While task is in non-terminal state, the page refetches
`/api/v1/travel-tasks/:taskId` every 5 seconds. Codex confirmed this
is acceptable for Phase 1 founder testing volume. Revisit in Phase 2
when adding hidden-tab pause / WebSocket push.

---

## 6. Pre-merge checklist for codex

Before pulling Track B into master:

- [ ] Read `.coordination/claude.md` § 🟢 Currently doing (latest state)
- [ ] Read `.coordination/claude.md` § 📍 Strategic decisions locked (verify no conflict)
- [ ] Run `npx tsc --noEmit --pretty false` on the merge tree — count errors should equal pre-existing 17
- [ ] Run `npm run check-drift` on the merge tree — count drifts should equal pre-existing 2
- [ ] Run `npx vitest run components/profile-gap components/benchmark components/task-timeline lib/agent/nlu-v2/__tests__` — should be all green
- [ ] Smoke 3 routes: `/dev`, `/tasks/demo-awaiting-profile`, `/dev/benchmark-runs`
- [ ] Eyeball `app/api/booking-jobs/[id]/start/route.ts:716-740` (the flight DOB-only check from `5357f98`) — confirm or revert
- [ ] If conflict in core/API/contract code: codex resolves
- [ ] If conflict purely in `components/` or `app/dev/` or Track B docs: bounce back to Claude as `[coord]` commit
- [ ] After merge: drop a `[handoff]` commit on master noting "Phase 1 UI merge complete" so Claude can ack and rebase the branch

---

## 7. Post-merge follow-up (Claude-owned, not in this branch)

These are Phase 1 deliverables that come AFTER the UI merge:

- **Phase 1 #7** — Wire `profile_edit` intent into `app/page.tsx`
  homepage chat (real `apply_profile_patch` dispatch to PATCH endpoint).
  Still mocked in `app/dev/profile-gap-flow/`. ~4h.
- **Phase 1 #8** — Founder E2E walkthrough (user runs through
  `/tasks/demo-*` then real flow). User-driven; Claude documents observed
  bugs.
- **Phase 1 #5** — OTP resume flow (only if warm session PoC fails).

See `PHASE_1_PLAN.md` for full sequencing.

---

## 8. References

- `CLAUDE.md` § "协作协议" — coord protocol contract (commit-msg tags,
  H2 schema, Strategic decisions section, role allocation)
- `.coordination/claude.md` — current Track B state (this commit
  updates it)
- `.coordination/codex.md` — codex's parallel state (read on session
  start)
- `BENCHMARK_RESTAURANT_100.md` — Phase 0 spec (R-003 row + § 7.5 OTP
  rule)
- `PHASE_1_PLAN.md` — 8-deliverable Phase 1 sequencing
- `PROJECT_SUMMARY.md` § "Recent Updates 2026-05-03" cont. 1/2/3 —
  full strategic context
- `WARM_SESSION_STRATEGY.md` — Phase 0 OTP path D (BLOCKED status)
- `NLU_CONSUMER_CONTRACT.md` — chat panel hookup contract for the
  Phase 1 #7 work (post-merge)
- `EXECUTOR_V2_PIVOT.md` — Computer Use pivot rationale
- `TASK_RUNTIME_DESIGN.md` — task facade design (codex's API mirrors
  this)
