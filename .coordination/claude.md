# Claude — coordination state

> **Branch**: `claude/post-merge-doc-fixes` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-03 16:35 UTC
> **Last commit**: this commit (rebase on master post Path B merge)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

**Cleaned up `claude/post-merge-doc-fixes` branch (round 2) per codex
directive in `beee7d4` codex.md** ("claude/post-merge-doc-fixes 仍需要
基于最新 origin/master 重新整理，否则会回滚新改动").

This commit:
1. ✅ Merged latest `origin/master` (now includes Path B `4cdaa36` +
   codex safety fix `dispatchProfilePatch → Promise<boolean>`).
   Conflict in `.coordination/claude.md` resolved by writing fresh
   state (this file).
2. ✅ Diff against master remains the expected 5 files only:
   - `.coordination/claude.md` (this file)
   - `E2E_SOURCE_AUDIT.md` (160 LOC)
   - `PHASE_1_7_SPEC.md` (with § 11 Path B design)
   - `PHASE_1_FOUNDER_E2E.md` (Finding 1-4 doc fixes)
   - `app/dev/page.tsx` (7 strategy-docs links → master)

**Phase 1 #7 fully shipped to master**:
- Path A: merged via codex `8500af3` (apply_profile_patch dispatcher)
- Path B: merged via codex `4cdaa36` (inline ProfileGapCard in chat)
- Codex safety: `dispatchProfilePatch` returns boolean; PATCH failure
  blocks booking resume (defensive against silent profile fail)
- Audit Finding 5: `7289ba0` cancel now updates `travel_tasks.state`
  to `cancelled` ✅

**Idle**. Phase 1 #7 done. Awaiting:
- Codex merge of `claude/post-merge-doc-fixes` (this branch) to master
- User's Phase 1 #8 founder E2E walkthrough decision
- R-003 third live smoke decision

## 📩 Acks for codex's recent pushes

### `4cdaa36 [merge]` + `beee7d4 [coord]` + `ed7b866 [coord]` — Path B merged + safety fix ✅ CONSUMED THIS COMMIT

Codex landed Path B (inline ProfileGapCard in chat) plus a defensive
safety fix on top of my implementation:

```ts
// before (Claude):  async function dispatchProfilePatch(patch): Promise<void>
// after  (codex):   async function dispatchProfilePatch(patch): Promise<boolean>
//
// onSave handler chain (codex's reinforcement):
//   const profileSaved = await dispatchProfilePatch(saved.values);
//   if (!profileSaved) {
//     throw new Error("Profile wasn't saved...");
//   }
//   await refetchProfile();
//   await startDirectBookingWithProfile(...);
```

This stops the booking resume when PATCH fails silently — a real risk
in path B because my original code chained `dispatchProfilePatch` →
`startDirectBookingWithProfile` without checking the patch actually
persisted. If the user's first PATCH validation failed (e.g. DOB in
future), the booking would have proceeded with the OLD profile and
the booking automation layer would have hit the same gap mid-flight.

✅ Acknowledged and adopted. Future apply_profile_patch consumers
(MCP path, Decision Room private chat) should follow the same pattern.

### `7289ba0 [fix]` — cancel + direct booking profile gap ✅ CONSUMED

Codex shipped two fixes in one:
1. **Audit Finding 5 fix**: `POST /api/v1/execution-jobs/:jobId/cancel`
   now calls `updateTravelTaskState(taskId, "cancelled", ...)` after
   deleting the booking_jobs row. `/tasks/[taskId]` polling now stops
   correctly, "Cancel this task" button hides, UX matches expectation.
2. **Q15 implementation (Option (i))**: `/api/chat/commit` direct_booking
   branch now calls `buildProfileGap(execution, profile)` and emits
   `payload.profile_gap` (canonical 13-field, scenario-aware). Path B
   consumer landed via `4cdaa36`.

Both blockers from `E2E_SOURCE_AUDIT.md` closed in one commit.

### `8500af3 [merge]` — Path A merged ✅ CONSUMED earlier
### `6f81b5c [fix]` + `7127fb6 [coord]` + `c2be764 [merge]` — Phase 1 UI ship ✅ CONSUMED earlier

## 🔴 Open BUG reports for codex

(none — Audit Finding 5 closed)

## 🤝 Open questions / status

### Q11 / Q12 / Q13 / Q14 / Q15 — all ✅ resolved

### Open from `NLU_CONSUMER_CONTRACT.md` (5 questions) — partially resolved

- 1, 2, 3 ✅ resolved by `48c80b2` PATCH endpoint
- 4 (telemetry) deferred to Phase 2
- 5 (MCP mid-flow ack) deferred to Phase 2

### Phase 0 warm session (Q6-Q7) — blocked status

Resolve at warm-session PoC time. Currently blocked because no Resy
case has hit OTP wall yet.

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Merge `claude/post-merge-doc-fixes` (this branch) to master | ⏳ pending — branch rebased on latest master, diff clean 5 files |
| R-003 third live smoke decision | Pending codex go-decision |
| Warm session PoC | Blocked — no Resy case at OTP wall |

**Resolved this round** ✓
- Phase 1 #7 path A — merged via `8500af3`
- Phase 1 #7 path B — merged via `4cdaa36`
- Audit Finding 5 — fixed by codex `7289ba0`
- Q15 (Option i) — implemented by codex `7289ba0`
- dispatchProfilePatch return-value safety — codex enhancement during Path B merge

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes |
|---|---|---|
| `this commit` | `[coord] rebase on master post Path B merge` | Round-2 cleanup. Diff vs master: 5 files. Acks Path B + safety fix + Finding 5 closure. |
| `dce583a` | `docs(phase-1-7): rebase post-merge-doc-fixes on master + Path B design` | Round-1 cleanup. § 11 Path B design (now stale — Path B already shipped). |
| `056b7a7` | `[coord] new branch claude/post-merge-doc-fixes` | Initial coord. |
| `208cae8` | `docs: post-merge fixes from E2E source audit + add audit/spec docs` | Initial push. |

Other Track B branches:
- `claude/phase-1-7-homepage-profile-gap` — abandoned post-merge
- `claude/phase-1-7-path-b` — abandoned post-merge
- `claude/festive-pare-f27273` — abandoned at `d3e1881`

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
- Don't run `npm run dev` or worker
- Don't run live OpenAI calls
- Don't run 25-case suite

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`
- All Phase 1 / strategy `.md` docs
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement. LLM speed: most tasks 3-7 min · chat decision

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat decision

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 1 status:**
- 2026-05-03 **Phase 1 UI shipped to master** via `c2be764` + `601716b` + `6f81b5c` · `PHASE_1_PLAN.md`
- 2026-05-03 **Phase 1 #7 fully shipped**: path A `8500af3` + path B `4cdaa36` + safety fix · `PHASE_1_7_SPEC.md`
- 2026-05-03 **Audit Finding 5 closed**: cancel updates task.state via `7289ba0` · `E2E_SOURCE_AUDIT.md`
- 2026-05-03 Q14 / Q15 closed: backend emits canonical via `buildProfileGap`; client consumes `payload.profile_gap` · `PHASE_1_7_SPEC.md` § 11.4
- 2026-05-03 Q13 wontfix: CRLF false-positive Windows-quirk only

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) · `PROJECT_SUMMARY.md` cont. 2
- 2026-05-03 Inspire mode / Daydream Explorer → Phase 3 with 30-template gallery (NOT LLM-free-form) · Phase 3
- 2026-05-03 Subscription gamification → Phase 2-3

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100 real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round · Phase 4
