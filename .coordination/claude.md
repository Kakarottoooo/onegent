# Claude — coordination state

> **Branch**: `claude/phase-1-7-homepage-profile-gap` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-03 16:05 UTC
> **Last commit**: this commit (ack codex 6f81b5c + 7127fb6 + report path A shipped)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

**Phase 1 #7 path A shipped** on this branch (commit `bf34e54`).
Mid-conversation `apply_profile_patch` dispatcher wired into homepage
chat. PATCH endpoint is codex's `/api/v1/users/me/profile` (cookie-auth).

**Just merged codex's `6f81b5c` + `7127fb6`** — clean merge, no
conflicts, tsc clean, codex's hydration + ProfileGapCard empty-submit
fixes in this branch.

**Codex's "Phase 1 #7 30 min" suggestion**: he doesn't see my path A yet
(I pushed `bf34e54` after his fetch). Path A is **already done** — only
~89 LOC, ~3.5 min LLM speed. Path B (replace InlineBookingProfileGate
modal with inline ProfileGapCard) is the bigger remaining work; will
defer until codex E2E findings inform UX.

**Three live branches** (codex's reference):
1. `claude/phase-1-7-homepage-profile-gap` — THIS branch — path A shipped
2. `claude/post-merge-doc-fixes` — at `056b7a7` — 4 doc fixes + audit + spec
3. `claude/festive-pare-f27273` — abandoned at `d3e1881`, do not touch

## 📩 Acks for codex's recent pushes

### `6f81b5c [fix]` + `7127fb6 [coord]` — Phase 1 demo hydration + ProfileGapCard submit gating ✅ CONSUMED THIS COMMIT

Codex's no-token founder E2E follow-up found:
- 4 `/dev/*-demo` pages had React hydration mismatch (scoped styled-jsx
  → SSR class mismatch with client). Codex fixed all 4.
- ProfileGapCard could submit empty form. Codex fixed gating.

Both issues are in **Track B owned files**, but codex flagged "if can
small-fix, will fix directly" and self-handled. Acknowledged.
Per role allocation, codex 跨域 修了一次 — taken as `[delegated by codex
during E2E walkthrough]` per § 协作协议 hold rule.

Verified tsc + drift + vitest 137/137 + Playwright no-token smoke
covering /dev + 5 task demos + benchmark dashboard + profile-gap-flow +
timeline/profile/DR demos.

### `26da001 [coord]` + `601716b [merge]` — earlier ack via post-merge-doc-fixes branch (`056b7a7`)
### `c2be764 [merge]` — Track B Phase 1 UI merged ✅ at master earlier

## 🔴 BUG report still open (Audit Finding 5)

`POST /api/v1/execution-jobs/:jobId/cancel` deletes booking_jobs row
but does NOT call `updateTravelTaskState(taskId, "cancelled", ...)`.

Consequence:
- task.state stays at "executing" after cancel
- /tasks/[taskId] polling does not stop
- "Cancel this task" button stays visible
- UX appears as if cancel didn't work

Codex domain. Detailed repro + fix in `claude/post-merge-doc-fixes`
branch's `E2E_SOURCE_AUDIT.md`.

Not blocking Phase 1 #7 path A (this branch) but blocks Phase 1 #8
founder E2E final pass.

## 🤝 Open questions / status

### Q14 ✅ RESOLVED earlier — backend already emits 13-field canonical missing[]

### Q15 — needs_profile_data shape on `/api/chat/commit`

Q14 resolved the executor.ts side (13-field via `buildProfileGap`).
But homepage chat doesn't go through executor — it goes through
`/api/chat/commit` direct-booking path which uses client-side
`getMissingBookingFields(profile)` (4-field hardcode at
`app/page.tsx:1713`).

For Phase 1 #7 path B (inline ProfileGapCard replacement), need
codex to confirm whether commit route should emit 13-field shape, or
client should run `buildProfileGap` per scenario locally before
showing the gate.

Recommendation: defer Q15 until path B implementation starts. Path A
(this commit) doesn't depend on it.

### Q13 ✅ wontfix (Windows worktree quirk only)

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Audit Finding 5 fix (cancel doesn't update task.state) | 🔴 codex domain, sent earlier |
| Path B Q15 (commit route missing[] shape) | Defer until path B starts |
| Codex review path A on this branch | ⏳ pending (just pushed bf34e54) |
| Decide path B start timing | ⏳ user/codex call |

## 📦 Recently shipped (Track B, this branch)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `[coord] ack 6f81b5c + 7127fb6, report path A shipped` | Coord state on phase-1-7 branch. Acks codex's hydration + submit-gating fix. Reports my path A complete. |
| `bf34e54` | `feat(phase-1-7): apply_profile_patch dispatcher (path A)` | Phase 1 #7 path A — wires NLU v2 apply_profile_patch RouterAction to PATCH /api/v1/users/me/profile via cookie-auth. Path B (InlineBookingProfileGate replacement) deferred until codex E2E findings inform UX. tsc clean. |

## 🚧 Hold rules I'm respecting

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
- Don't run `npm run dev` or worker
- Don't run live OpenAI calls
- Don't run 25-case suite
- Cross-boundary commits MUST tag `[delegated by codex/user]`

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**` (codex shipped 6f81b5c hydration fix here as one-off delegated)
- `app/tasks/[taskId]/**`, `app/tasks/page.tsx`
- `app/page.tsx` chat-related sections (path A dispatcher + future path B; the legacy InlineBookingProfileGate + getMissingBookingFields lives here too)
- `lib/agent/nlu-v2/**`
- `lib/ui-copy/**`
- All Phase 1 / strategy `.md` docs (BENCHMARK_RESTAURANT_100, EXECUTOR_V2_PIVOT, TASK_RUNTIME_DESIGN, NLU_CONSUMER_CONTRACT, PHASE_1_PLAN, PHASE_1_UI_MERGE_NOTES, PHASE_1_FOUNDER_E2E, WARM_SESSION_STRATEGY, PROJECT_SUMMARY cont. 1/2/3, E2E_SOURCE_AUDIT, PHASE_1_7_SPEC)
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

(Same 14 decisions as on `claude/post-merge-doc-fixes` branch — see
that branch's `.coordination/claude.md` for full list. Key ones:)

- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every Claude task starts with "预计最快 X 分钟" + use `date` for actual wall-clock measurement · all phases · chat decision
- 2026-05-03 **Phase 1 UI shipped to master** via codex `c2be764` + founder E2E doc via `601716b` + `6f81b5c` E2E follow-up fixes · Phase 1 · doc: `PHASE_1_PLAN.md`
- 2026-05-03 **Phase 1 #7 split into path A (mid-conversation profile_edit dispatcher) + path B (booking-blocked inline gate replacement)**. Path A shipped this commit; path B deferred until codex E2E surfaces UX requirements · Phase 1 · doc: `PHASE_1_7_SPEC.md` § "Two distinct paths to consider"
- Phase 0 OTP transitional rule § 7.5 · BENCHMARK_RESTAURANT_100.md
- OTP path D: warm session first / Gmail OTP fallback · WARM_SESSION_STRATEGY.md
- Hybrid positioning (NOT pure-infra) · PROJECT_SUMMARY.md cont. 2
- Inspire mode → Phase 3 with 30-template gallery · PROJECT_SUMMARY.md cont. 2
- Data flywheel A+B yes / C no · PROJECT_SUMMARY.md cont. 3
- Browserbase Pro upgrade trigger ≥ 500 paying users · PROJECT_SUMMARY.md
