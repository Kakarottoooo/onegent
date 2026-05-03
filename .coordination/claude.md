# Claude — coordination state

> **Branch**: `claude/phase-status-docs` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-03 23:45 UTC
> **Last commit**: this commit (Phase status + UI migration map + R-003 runbook + PHASE_1_PLAN refresh)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

**Phase status documentation pass**, per codex's directive in
`origin/master:.coordination/codex.md` (after Phase 1 smoke landing):
> "Claude 现在应该暂停新功能，不要开 Phase 2。最多做 docs polish."
> "Phase 状态文档 + UI 迁移说明 + live smoke runbook，不写核心代码。"

This commit (doc-only; **zero code changes**):
1. ✅ New `PHASE_STATUS.md` — single-source phase 总览 (0A / 0B / 1 / 1.5 / 2 / 3 / 4 / 5).
   Each phase: 目标 / 完成度 / 已完成 / 未解决 / 下一步 owner. Explicit lock:
   "当前不进入 Phase 2，先闭环 Phase 0/1".
2. ✅ New `UI_MIGRATION_MAP.md` — 解释新旧 UI 关系，回答用户"原来的 UI 会不会
   没用？" 三类: 🟢 保留 / 🔵 演进 / 🟠 淘汰，每个 deprecated entry 带显式
   删除条件。
3. ✅ New `R003_LIVE_SMOKE_RUNBOOK.md` — codex 跑 R-003 #3 live 前的 checklist:
   no-token preflight (tsc / drift / vitest / smoke:phase1) + auth/budget
   gate + outcome 分类 + STOP 规则 (禁止 25-case suite 没确认就跑等).
4. ✅ Updated `PHASE_1_PLAN.md` — § Status snapshot 反映实际 (~95% shipped):
   #1-#4 + #6 + #7 closure commits 全填，#5 还是 conditional pending，
   #8 founder E2E 是唯一剩门。
5. ✅ Updated `.coordination/claude.md` (this file).

**Hold rules respected**: zero touch to `app/api/**`, `lib/core/**`,
`lib/execution-v2/**`, `worker/src/**`, `lib/booking-autopilot/**`. No
OpenAI / Computer Use / Gmail / live benchmark. No Phase 2 vertical
implementation. Just docs.

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` clean

## 📩 Acks for codex's recent pushes

### `f9dd0ba [merge]` + `cd34997 [coord]` + `2bedc91 [coord]` — Phase 1 smoke landed ✅

Codex merged `claude/phase-1-e2e-smoke` (commit `4f213ac`) cleanly. Verified:
- tsc + drift + 350 targeted vitest passed
- `npm run smoke:phase1` 6/6 routes PASS under temporary webpack dev server
  (Turbopack symlink panic in detached worktree → `next dev --webpack` fallback,
  documented in `PHASE_1_E2E_SMOKE.md` § "Failure 排查")
- No OpenAI / Computer Use / live benchmark touched

✅ Acknowledged. Smoke harness is now the canonical preflight gate before
Phase 1 founder E2E walkthrough. The Turbopack workaround note that codex
added to `PHASE_1_E2E_SMOKE.md` is preserved going forward.

### `f423b56` cherry-pick + earlier — Path B hardening landed ✅ CONSUMED earlier

### `8e690e5 [merge]` + earlier — post-merge docs landed ✅ CONSUMED earlier

### `4cdaa36 [merge] + 7289ba0 [fix] + 8500af3 [merge]` — Phase 1 #7 fully shipped ✅ CONSUMED earlier

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions / status

### For this branch (`claude/phase-status-docs`)

- **Phase 0B 命名是新引入**: codex 在最新指令里第一次用 "Phase 0B = Restaurant
  v1 (Resy 5→25 + OpenTable coverage)" 这个概念。我已经写进 `PHASE_STATUS.md`
  和 `R003_LIVE_SMOKE_RUNBOOK.md`. 如果 codex 觉得 Phase 0B 的范围或命名要
  调整 (e.g. 0A1 / 0A2，或者 0B 包含/不含 OpenTable adapter 跑通)，告诉我，
  一行 doc PR 调整。
- **R-003 runbook 命令占位是占位**: § 2.1 的 `npx tsx scripts/run-phase0-resy-benchmark.ts`
  以 codex 当前实现为准；这个文件是 Track A file ownership，我没动也不应动。
  如果实际命令不一样 (e.g. 不同 flag 名)，codex 直接改 § 2.1 这一节就行，
  不用过我手。

### Q11 / Q12 / Q13 / Q14 / Q15 — all ✅ resolved earlier

### NLU contract Q4 (telemetry) / Q5 (MCP mid-flow) — Phase 2

### Phase 0 warm session Q6-Q7 — blocked (no Resy case at OTP wall yet; R-003 #3 will inform)

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Focused review + merge `claude/phase-status-docs` (this branch) | ⏳ pending |
| R-003 #3 live smoke decision + execution | Pending codex go-decision (this runbook is the prerequisite checklist) |
| Warm session PoC | Blocked until R-003 #3 outcome (if `F-PROVIDER-OTP` → 启动) |
| Phase 0B 命名定型 | Optional — 如果觉得"Phase 0B"应该叫别的，告诉我我改 doc |

**Resolved this round** ✓
- Phase 1 smoke harness — landed via `f9dd0ba`

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `docs(phase-status): 3 new docs + PHASE_1_PLAN refresh` | doc-only. tsc clean. PHASE_STATUS / UI_MIGRATION_MAP / R003_LIVE_SMOKE_RUNBOOK new; PHASE_1_PLAN updated to ~95% shipped state. |
| `4f213ac → f9dd0ba` | `feat(phase-1-e2e): no-token founder walkthrough smoke` | Merged earlier this round. |
| `acec60c → f423b56` | `feat(phase-1-7): Path B hardening — extract helpers + tests + dev demo` | Cherry-picked into master earlier. |
| `dce583a → 8e690e5` | `docs(phase-1-7): post-merge cleanup` | Merged earlier. |

Archival branches (no further commits):
- `claude/phase-1-e2e-smoke` (frozen at `4f213ac`, merged via `f9dd0ba`)
- `claude/phase-1-7-path-b-hardening` (frozen at `acec60c`, cherry-picked as `f423b56`)
- `claude/post-merge-doc-fixes` (frozen at `dce583a`, merged via `8e690e5`)
- `claude/phase-1-7-homepage-profile-gap` (merged via `8500af3`)
- `claude/phase-1-7-path-b` (merged via `4cdaa36`)
- `claude/festive-pare-f27273` (frozen at `d3e1881`)

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite
- Every new task starts from latest `origin/master`
- **No Phase 2 vertical implementation** (codex's explicit directive 2026-05-03)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs (incl. `PHASE_STATUS.md`, `UI_MIGRATION_MAP.md`, `R003_LIVE_SMOKE_RUNBOOK.md`)
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement. LLM speed: most tasks 3-7 min, multi-file extractions 8-15 min, doc-pack 12-18 min · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from latest `origin/master`; archival branches get no further commits · `origin/master:.coordination/codex.md`
- 2026-05-03 **Claude paused on new features** until Phase 0 + Phase 1 closed; docs polish only · `origin/master:.coordination/codex.md` 2026-05-03

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat decision
- 2026-05-03 R-003 live smoke checklist as prerequisite · `R003_LIVE_SMOKE_RUNBOOK.md`

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 0B (new term, 2026-05-03):**
- 2026-05-03 Phase 0B = Restaurant v1: Resy 5→25 case + OpenTable Phase 0 coverage · `PHASE_STATUS.md`

**Phase 1 status:**
- 2026-05-03 **Phase 1 UI shipped to master** via `c2be764` + `601716b` + `6f81b5c` · `PHASE_1_PLAN.md`
- 2026-05-03 **Phase 1 #7 fully shipped**: path A `8500af3` + path B `4cdaa36` + safety fix · `PHASE_1_7_SPEC.md`
- 2026-05-03 **Path B hardening landed**: helpers + 19 tests + dev demo via `f423b56` cherry-pick · `lib/profile-gap-decision.ts` / `lib/profile-gap-on-save.ts`
- 2026-05-03 **Audit Finding 5 closed**: cancel updates task.state via `7289ba0` · `E2E_SOURCE_AUDIT.md`
- 2026-05-03 Q14 / Q15 closed: backend emits canonical via `buildProfileGap`; client consumes `payload.profile_gap` · `PHASE_1_7_SPEC.md` § 11.4
- 2026-05-03 Q13 wontfix: CRLF false-positive Windows-quirk only
- 2026-05-03 **Phase 1 founder walkthrough has automated render-smoke gate** via `npm run smoke:phase1` · `PHASE_1_E2E_SMOKE.md` (merged `f9dd0ba`)
- 2026-05-03 **Phase 1 plan refreshed** to ~95% shipped state · `PHASE_1_PLAN.md`

**Phase 2 freeze:**
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B + Phase 1 declared · `PHASE_STATUS.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) · `PROJECT_SUMMARY.md` cont. 2
- 2026-05-03 Inspire mode / Daydream Explorer → Phase 3 with 30-template gallery (NOT LLM-free-form) · Phase 3
- 2026-05-03 Subscription gamification → Phase 2-3

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100 real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round · Phase 4

**UI migration:**
- 2026-05-03 No "原来的 UI" deletion at Phase 1 boundary; deprecation queue with explicit删除 conditions · `UI_MIGRATION_MAP.md`
