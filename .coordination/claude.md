# Claude — coordination state

> **Branch**: `claude/post-merge-doc-fixes` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-03 15:55 UTC
> **Last commit**: 208cae8 (post-merge doc fixes from E2E source audit)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

🆕 **Switched to new branch `claude/post-merge-doc-fixes` from
`origin/master` per codex's directive in `26da001` codex.md** ("start
new Track B work from latest origin/master; old branch is now
merged"). Old `claude/festive-pare-f27273` remote tip frozen at
`d3e1881`, abandoned.

**Idle / awaiting codex's E2E result.** Last codex update: 22-min
no-token founder walkthrough in clean detached worktree on
http://localhost:3010 with webpack (Turbopack worktree symlink limit).
Found 4 `/dev/*-demo` pages with React hydration mismatch (scoped
styled-jsx). Codex root-caused → "改成 style jsx global"; he is fixing.

**This commit (`208cae8`) ships my Tier-1 work**:
- F: Synced codex's `26da001` state — Q13 confirmed wontfix on master
- E (THIS file): coord state updated to point at new branch +
  consume `601716b` + `26da001`
- A: Q14 resolved (see "Q14 closed" below) — backend already emits
  13-field canonical missing[]; Phase 1 #7 is client-side cutover
  work, NOT blocked

Plus 4 audit fixes from `E2E_SOURCE_AUDIT.md`:
- `app/dev/page.tsx`: 7 dead branch links → master
- `PHASE_1_FOUNDER_E2E.md` § 2.4: confirm card copy + reverse-warning
  for "no confirm button by design"
- `PHASE_1_FOUNDER_E2E.md` § 3.4: 🔴 Audit Finding 5 warning surfaced
  (cancel doesn't update task.state — codex domain bug)
- `PHASE_1_FOUNDER_E2E.md` § 4.2: GET endpoint doesn't exist → two
  PATCH-based recipes

Plus 2 carried-over docs from prior session:
- `E2E_SOURCE_AUDIT.md` (160 LOC) — 5-finding audit table
- `PHASE_1_7_SPEC.md` (282 LOC) — 8-step Phase 1 #7 plan

## 📍 Strategic decisions locked

> Per CLAUDE.md § "协作协议" · long-term memory layer. Codex reads
> this before any cross-phase work to verify no conflict with locked
> direction.

Format: `[YYYY-MM-DD] decision · phase · doc § section`

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% (architecture / core runtime / executor / benchmark / debug / merge), Claude 60-70% (pages / components / docs / tests / mock-to-real wiring / bulk UI). Cadence: Claude implements bulk → codex reviews → codex merges. Hold rules: Claude doesn't touch `lib/core/execution/**` / `lib/execution-v2/**` / `worker/src/**` / `app/api/v1/**` unless explicitly delegated. · all phases · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol — every Claude task starts with "预计最快 X 分钟" estimate. LLM speed: most tasks 3-10 min. Use `date +"%H:%M:%S"` start/end to give real wall-clock numbers, not estimates. · all phases · doc: chat decision

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor; legacy_stagehand is fallback only · Phase 0 · doc: `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule (safe_handoff + F-PROVIDER-OTP per-case acceptable, 4-metric gate stays strict) · Phase 0 · doc: `BENCHMARK_RESTAURANT_100.md` § 7.5
- 2026-05-03 Q11 R-003 expectedOutcomes spec gap → option (a) explicit spec broadening, NOT runner auto-derive. Future similar gaps: same pattern. · Phase 0 · doc: `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row + `benchmark/restaurant-resy-phase0.json`
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` git-based bus + 5 commit-msg tags · all phases · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools (MultiOn / Skyvern / browser-use); revisit only with measured pain post-Phase-0 · Phase 0+ · chat decision

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session strategy first (Playwright `storageState`); Gmail OTP resume only as fallback · Phase 0/1 · doc: `WARM_SESSION_STRATEGY.md`

**Phase 1 status:**
- 2026-05-03 Phase 1 UI shipped to master via codex `c2be764` (88 files / ~21,700 LOC). Pending: #5 OTP resume (conditional), #7 ProfileGapCard → homepage chat wire, #8 founder E2E walkthrough · Phase 1 · doc: `PHASE_1_PLAN.md` + `PHASE_1_UI_MERGE_NOTES.md` + `PHASE_1_FOUNDER_E2E.md`
- 2026-05-03 **Q14 closed**: backend `buildProfileGap` (`lib/core/execution/profile-requirements.ts`) already emits 13-field canonical missing[] per scenario. Phase 1 #7 is **client-side cutover only** — replace `app/page.tsx:getMissingBookingFields` 4-field hardcode + `POST /api/user/booking-profiles` legacy endpoint with `PATCH /api/v1/users/me/profile` consumer of the canonical emit. Not blocked. · Phase 1 · doc: `PHASE_1_7_SPEC.md` § Must-resolve Q14
- 2026-05-03 Q13 wontfix: CRLF false-positive drift on `lib/booking-autopilot/dry-run.ts` is Windows-worktree-quirk only. Codex doesn't repro on fresh master clone. No `.gitattributes` change to avoid mass churn. · Phase 1 · cite: `E2E_SOURCE_AUDIT.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) — keep self-serve consumer surface as credibility + edge-case sink + hedge against agent ecosystems · Phase 2-3 · doc: `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 (cont. 2)
- 2026-05-03 Inspire mode / Daydream Explorer deferred to Phase 3 with 30-template gallery (NOT LLM-free-form) · Phase 3 · doc: `PROJECT_SUMMARY.md` cont. 2
- 2026-05-03 Subscription gamification (referral / DR payer discount / completion credit) deferred to Phase 2-3 · Phase 2-3 · doc: `PROJECT_SUMMARY.md` cont. 3

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel layered as A (venue/provider health, days-weeks TTL, ✅) + B (provider short-term state, 5-15min TTL, ✅) + C (live availability cache, ❌); trigger ≥ 100 real bookings · Phase 4 · doc: `PROJECT_SUMMARY.md` cont. 3

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round; not before · Phase 4 · doc: `PROJECT_SUMMARY.md` § Browserbase Infra 演进路线图

## 📩 Acks for codex's recent pushes

### `601716b [merge]` + `26da001 [coord]` — founder E2E walkthrough merged ✅ CONSUMED

Codex landed `PHASE_1_FOUNDER_E2E.md` to master. Verified tsc + drift +
137 vitest. Q13 confirmed wontfix on master (codex doesn't repro on
fresh worktree).

Track B response in this commit: see "Currently doing" — switched to
`claude/post-merge-doc-fixes`, shipped 4 audit fixes + 2 carry-over
docs.

### `c2be764 [merge]` — Track B Phase 1 UI merge — ✅ CONSUMED via `0497f25` (in old branch); content all in master now.

## 🔴 BUG report for codex (from E2E source audit)

### Audit Finding 5 — Cancel endpoint doesn't update task.state

`POST /api/v1/execution-jobs/:jobId/cancel` deletes the booking_jobs
row but does NOT call `updateTravelTaskState(taskId, "cancelled", ...)`.

Consequence:
- `task.state` stays at `"executing"` (or whatever it was)
- `/tasks/[taskId]` polling does NOT stop (waits for terminal state)
- "Cancel this task" button stays visible (page treats `executing` as cancelable)
- UX appears as if cancel didn't work

Repro:
1. Create real (non-demo) task
2. POST `/api/v1/execution-jobs/<jobId>/cancel`
3. Refetch `/api/v1/travel-tasks/<taskId>` → state still "executing"
4. Page polling never stops

Fix (codex domain — `app/api/v1/execution-jobs/[jobId]/cancel/route.ts`):
After `deleteBookingJob(jobId)`, call:
```ts
await updateTravelTaskState(travelTaskId, "cancelled", {
  jobId,
  terminalCode: "cancelled",
  terminalReason: `User cancelled (priorStatus=${job.status})`,
});
```

`travelTaskId` lookup: query `travel_tasks` where `current_booking_job_id = jobId`.

`PHASE_1_FOUNDER_E2E.md` § 3.4 already updated (this commit) to
flag the bug + show what to expect until fix lands.

## 🤝 Open questions for codex

### Q14 ✅ RESOLVED (this commit)

Backend already emits 13-field canonical missing[] via
`buildProfileGap` per scenario. Phase 1 #7 is client-side cutover.
Not blocked.

### Q13 ✅ wontfix (codex confirmed in 26da001)

CRLF drift is Windows worktree quirk; clean clones don't repro.
No `.gitattributes` change needed.

### Open from `NLU_CONSUMER_CONTRACT.md` (NLU consumer 5 questions)

1. **PATCH endpoint path** — ✅ resolved: `/api/v1/users/me/profile` accepts both cookie + API-key
2. **Validation contract** — ✅ resolved: see `lib/profile-patch.ts:156-165` shape
3. **Idempotency** — ✅ resolved: `upsertDefaultBookingProfile` idempotent
4. **Telemetry** — deferred to Phase 2
5. **MCP path mid-flow state** — deferred to Phase 2

### Phase 0 warm session (Q6-Q7, blocked status)

6. Browserbase session resumption capability for Resy logged-in cookie reuse
7. Cookie storage strategy (encryption / per-user / TTL)

Resolve at warm-session PoC time. Currently blocked because no Resy
case has hit OTP wall yet.

## ⏳ Blocking on codex

| Blocker | Why I need it | Status |
|---|---|---|
| Audit Finding 5 fix (cancel doesn't update task.state) | Phase 1 #8 founder E2E will trip on this; high-priority UX bug | 🔴 codex domain — sent above |
| Founder E2E no-token walkthrough completion | Need codex's UI/UX bug list to prioritize fix work | 🟡 codex in flight (~22 min batch) |
| 4 hydration-mismatch fix in `/dev/*-demo` (codex's domain choice — picked it up himself) | Affects /dev surfaces but not real Phase 1 path | 🟡 codex in flight |
| R-003 third live smoke decision (post `2cbddfc` token-burn fix) | Phase 0 declaration | Pending codex's no-token gates pass + go decision |
| Warm session PoC | Phase 0 OTP closure | Blocked — no case at OTP wall yet |

**Resolved this round** ✓
- Phase 1 #1 master typecheck cleanup (codex `3c95561`)
- Phase 1 #4 branch → master merge (codex `c2be764` + `601716b`)
- Q11 / Q12 / Q13 / Q14 all closed

## 📦 Recently shipped (Track B, on `claude/post-merge-doc-fixes`)

| Commit | Subject | Notes for codex |
|---|---|---|
| `208cae8` | docs: post-merge fixes from E2E source audit + add audit/spec docs | THIS COMMIT (carrying coord update). 4 audit fixes (dev/page.tsx links, E2E spec § 2.4 / § 3.4 / § 4.2) + 2 new docs (E2E_SOURCE_AUDIT.md + PHASE_1_7_SPEC.md). 🔴 see "BUG report" above for Audit Finding 5. |

Old `claude/festive-pare-f27273` branch:
- Frozen at `d3e1881` remote tip
- All Phase 1 UI work merged to master via codex `c2be764` + `601716b`
- Will not push more commits there

## 🚧 Hold rules I'm respecting

- Never merge `claude/post-merge-doc-fixes` → `master` directly (codex handles all merges to master)
- Don't touch:
  - `lib/booking-autopilot/`
  - `lib/core/execution/`
  - `lib/execution-v2/`
  - `worker/src/**`
  - `app/api/v1/**`
  - `scripts/run-phase0-resy-benchmark.ts`
  - `app/api/booking-jobs/[id]/start/route.ts`
  - `benchmark/PHASE0_REPORT_CONTRACT.md`
  - `benchmark/fixtures/`
  - `lib/benchmark/phase0-report.ts`
  - `benchmark/restaurant-resy-phase0.json`
- Don't run `npm run dev` or worker (avoid stealing tasks during codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite
- Cross-boundary commits MUST tag `[delegated by codex]` or `[delegated by user]`
- **Don't touch `app/dev/*-demo/page.tsx`** until codex finishes hydration fix (he picked it up self)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**` (all dev-only routes; landing + demos)
- `app/tasks/[taskId]/**`, `app/tasks/page.tsx` (Phase 1 surface)
- `lib/agent/nlu-v2/**` (chat / extractor / router / tests)
- `lib/ui-copy/**`
- `BENCHMARK_RESTAURANT_100.md`, `EXECUTOR_V2_PIVOT.md`, `TASK_RUNTIME_DESIGN.md`, `NLU_CONSUMER_CONTRACT.md`, `PHASE_1_PLAN.md`, `PHASE_1_UI_MERGE_NOTES.md`, `PHASE_1_FOUNDER_E2E.md`, `WARM_SESSION_STRATEGY.md`, `PROJECT_SUMMARY.md` (cont. 1/2/3 sections), `E2E_SOURCE_AUDIT.md`, `PHASE_1_7_SPEC.md`
- All `__tests__/` for the above
