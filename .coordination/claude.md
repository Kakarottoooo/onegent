# Claude — coordination state

> **Branch**: `claude/dev-resy-probe-dashboard` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 04:00 UTC
> **Last commit**: this commit (Resy probe dashboard + benchmark artifact rail + probe-first protocol doc)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md` (+ codex working branch `origin/codex/openai-chat-model-env:.coordination/codex.md`).

## 🟢 Currently doing

**Resy probe dashboard + benchmark artifact rail + probe-first protocol**,
per codex's task assignment (relayed by founder):
> "1. 做 /dev/resy-probe-runs dashboard ... 2. 扩展 benchmark dashboard
> artifact viewer ... 3. 写 UI 迁移文案/状态说明"

This commit (UI/docs/tests only — strictly no provider/runtime/worker/benchmark runner):
1. ✅ New `lib/benchmark/resy-probe-report.ts` — Track B types + node-only
   loader for Resy probe report. Schema versioned (v1). Codex's probe runner
   `scripts/probe-resy-availability.ts` (in flight) writes JSON matching
   this shape.
2. ✅ New `app/api/dev/resy-probe-runs/route.ts` (list) +
   `app/api/dev/resy-probe-runs/[file]/route.ts` (single). Path-traversal
   guard. Same `ENABLE_DEV_BENCHMARK_API=1` env gate as benchmark-runs.
3. ✅ New `app/dev/resy-probe-runs/page.tsx` (~360 LOC dashboard).
   Renders: recommended next live case + copy-able command + summary
   stats + per-case table with slots / matchingSlots / signals / verdict.
4. ✅ Extended `app/dev/benchmark-runs/page.tsx` — added `<ArtifactRail>`
   below the case table. Surfaces taskId / currentJobId / timelineUrl /
   snapshotsUrl / report path / outcome chips
   (severe-tripwire / no_availability_correct / booking-ready / safe-failure)
   + `<StrategyLogPanel>` ready to render `[provider][strategy ...]` lines
   when codex adds a `strategyLog` field to the case result.
5. ✅ Added artifact-rail CSS to `components/benchmark/benchmark.css`.
6. ✅ Added `/dev/resy-probe-runs` entry to `/dev` landing index +
   refreshed `/dev/benchmark-runs` blurb to mention the ArtifactRail.
7. ✅ New `RESY_AVAILABILITY_PROBE_PROTOCOL.md` — protocol doc explaining
   the no-slot-vs-fill-OTP gap that the 2026-05-04 R-003 retry exposed.
8. ✅ `PHASE_STATUS.md` § "Phase 0A R-003 retry" — added `2026-05-04`
   retry analysis: outcome was `no_availability_correct`, not Resy fill
   failure; door to Phase 0B requires a `live_ok` case + actual
   ready-for-confirmation OR safe-handoff w/ OTP. Did NOT modify Phase
   0A/0B definitions per existing hold rule.
9. ✅ `R003_LIVE_SMOKE_RUNBOOK.md` § "Step 0" preamble — points at the
   probe-first protocol BEFORE the existing § 0–§ 7 checklist. Did NOT
   modify execution commands per existing hold rule.
10. ✅ `lib/__tests__/resy-probe-report.test.ts` — 9 vitest cases for
    loader + lister: filename pattern, traversal guard, schema-version
    gate, JSON-parse guard, sort-newest-first, summary fields, fallback
    on malformed.
11. ✅ Empty-state UX on dashboard — `benchmark/runs/*.json` is gitignored
    (it's an output dir per `.gitignore:61`), so I don't ship a committed
    dev fixture. When no probe JSON exists, the dashboard renders an
    explicit "No probe runs yet — generate one with `npx tsx scripts/probe-resy-availability.ts`"
    state. First real probe run from codex's runner auto-populates.

**Review points for codex** (please check these before merge):
- **Schema fit**: probe runner output should match `ResyProbeRun` in
  `lib/benchmark/resy-probe-report.ts`. If shape differs, please tell me
  and I'll adjust the types in the same commit as your runner ships
  (single coordinated push).
- **`strategyLog` field on Phase0BenchmarkCaseResult**: my `<StrategyLogPanel>`
  currently parses `[provider][strategy ...]` lines from `terminalReason`.
  When you add a proper `strategyLog?: string[]` field to the report,
  I switch the source to that — single line in `extractStrategyLines()`.
- **Probe API gate**: I reused `ENABLE_DEV_BENCHMARK_API=1` env var so
  flipping prod gate flips both. If you want a separate
  `ENABLE_DEV_PROBE_API=1`, say so.
- **DEV-FIXTURE file**: only created so /dev/resy-probe-runs renders out
  of the box. Safe to delete the file once your real probe lands its
  first JSON. The dashboard handles empty list gracefully.
- **Phase 0A/0B docs**: I touched ONLY status text (R-003 outcome
  analysis), not the codex-owned definitions. If my analysis text
  conflicts with how you want the gate framed, edit freely.

**Strictly NOT touched** (per task scope):
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/execution-v2/**`
- `lib/core/**`
- `scripts/run-phase0-resy-benchmark.ts`
- `scripts/probe-resy-availability.ts`
- `lib/benchmark/phase0-report.ts` (codex source-of-truth — read-only here)

(Earlier doc-only commit context retained below for the merged history.)
1. ✅ Added top-of-doc "选哪条路径" decision matrix (10-min Quick vs
   60-90 min Full).
2. ✅ Added `🛑 什么时候停止不要继续测` section with 🔴 ship-blocker /
   🟠 phase-1.5 / 🟡 not-counted classifications. Each 🔴 row points
   at the specific Phase 1 fix that owns it (cookie-auth / cancel
   transition / ProfileGapCard inline / payment guard / etc.).
3. ✅ Added § A. Quick path (10 min): smoke + cookie-auth闭环 +
   ProfileGapCard inline check + ownership boundary + payment guard
   curl. Maps directly to the Phase 1 deltas from path A/B + cookie
   auth + Audit Finding 5.
4. ✅ Enhanced § 8 bug template with priority labels (P0/P1/P2/P3 mapped
   to the stop-condition tiers), reproducibility,触发时间, server
   log excerpt slot, reference commit SHA, submission routing rules.
5. ✅ Updated § 0.1 environment block: removed stale
   `claude/festive-pare-f27273` reference (already merged via
   `c2be764`); added webpack fallback note for Codex detached
   worktrees (Turbopack symlink panic); kept worker startup since
   restaurant routes through worker.
6. ✅ Updated § 12 references to point at `PHASE_STATUS.md`,
   `PHASE_1_E2E_SMOKE.md`, `R003_LIVE_SMOKE_RUNBOOK.md`,
   `UI_MIGRATION_MAP.md` (with explicit clarifier: this walkthrough
   does NOT run R-003 live; R-003 runbook is for codex post-walkthrough).
7. ✅ Updated stale top-of-file status banner from "等 codex merge" to
   "🟢 ready to run — Phase 1 ~95% shipped".

**Strictly NOT touched**:
- `R003_LIVE_SMOKE_RUNBOOK.md` (codex's `88e7ecd` corrections preserved)
- `PHASE_STATUS.md` Phase 0A / 0B definitions (codex's "observed 22
  rows" + "向 25 补齐" language preserved)
- Any `app/api/**`, `lib/core/**`, `lib/execution-v2/**`,
  `worker/src/**`, `lib/booking-autopilot/**`
- Any code (this is doc-only)

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` clean

## 📩 Acks for codex's recent pushes

### `88e7ecd [fix-docs]` + `d0d5d32 [merge]` — Phase status docs landed + R-003 corrections ✅ CONSUMED THIS COMMIT

Codex merged `claude/phase-status-docs` (commit `1c9299d`) and then
pushed `88e7ecd` to fix two errors I had introduced:

1. **R-003 single-case command was wrong**. My v2 runbook still had a
   `--confirm-suite` ref under the multi-case warning + an `--output`
   flag that doesn't exist. Codex's `88e7ecd` aligns the actual command:
   `--case R-003 --live-openai --allow-failures` (no `--confirm-suite`,
   no `--output`); reports auto-write to `benchmark/runs/`.
2. **Browserbase assumption was wrong**. I phrased some checks as if
   Browserbase session was the live target. Reality: current path is
   Next dev + local worker + local Playwright/Computer Use. Browserbase
   is a switchable target, not the default. Codex rewrote § 0.2 / § 1.3
   / § 2.3 / § 6 to reflect actual local stack.
3. **Resy fixture description**. I wrote "5 case 完整集 R-001~R-005";
   actual fixture has 22 observed rows (doc target 25, but source of
   truth is the file, not the spec). Codex updated PHASE_STATUS to
   "observed 22 rows" + "向 25 补齐".

✅ Acknowledged. All three corrections are net improvements; my v2 was
based on incomplete first-hand info about the runner. Future runbook
updates touching these files: I'll defer to codex's master state since
the runner / fixture are codex's Track A file ownership. This branch
explicitly does NOT touch those files.

### `f9dd0ba [merge]` + earlier — Phase 1 smoke landed ✅ CONSUMED earlier

### `f423b56` cherry-pick + earlier — Path B hardening landed ✅ CONSUMED earlier

### `8e690e5 [merge]` + earlier — post-merge docs landed ✅ CONSUMED earlier

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions / status

### For this branch (`claude/founder-e2e-polish`)

- **Stop conditions calibration**: 我用 `🔴 立刻停 / 🟠 记下继续 / 🟡 不计入`
  三档分类。如果 codex 觉得某条应该跨档（例如 hydration mismatch warning
  应该升 🔴 而不是 🟠），告诉我，一行 doc PR 调。
- **Quick path 时间预算**: 10 分钟是含等 dev server / smoke run-time + 5
  个真人手动步。实际跑可能 8-12 分钟，看 cold/warm cache。如果觉得太挤，
  我可以拆成 7 分钟 minimal + 12 分钟 quick 两档。

### Q11 / Q12 / Q13 / Q14 / Q15 — all ✅ resolved earlier

### NLU contract Q4 (telemetry) / Q5 (MCP mid-flow) — Phase 2

### Phase 0 warm session Q6-Q7 — blocked (no Resy case at OTP wall yet; R-003 #3 will inform)

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Focused review + merge `claude/founder-e2e-polish` (this branch) | ⏳ pending |
| R-003 #3 live smoke decision + execution | Pending founder go/no-go on token spend; preflight green per `d88464e` |
| Warm session PoC | Blocked until R-003 #3 outcome (if `F-PROVIDER-OTP` → 启动) |

**Resolved this round** ✓
- Phase status doc package — landed via `d0d5d32` + `88e7ecd` corrections

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `docs(founder-e2e): quick path + stop conditions + R003 reference` | doc-only on `PHASE_1_FOUNDER_E2E.md` only. tsc clean. R003 runbook + PHASE_STATUS Phase 0A/0B definitions strictly untouched. |
| `1c9299d → d0d5d32` + `88e7ecd` | `merge + fix: phase status docs + R-003 runner alignment` | Merged earlier this round; codex's `88e7ecd` corrections fully absorbed. |
| `4f213ac → f9dd0ba` | `feat(phase-1-e2e): no-token founder walkthrough smoke` | Merged earlier. |
| `acec60c → f423b56` | `feat(phase-1-7): Path B hardening` | Cherry-picked earlier. |
| `dce583a → 8e690e5` | `docs(phase-1-7): post-merge cleanup` | Merged earlier. |

Archival branches (no further commits):
- `claude/phase-status-docs` (frozen at `3e37175`; superseded by `88e7ecd`; per codex directive do NOT merge)
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
- **No Phase 2 vertical implementation** (codex's directive 2026-05-03)
- **No new features**; doc/copy polish only until Phase 0 + 1 closed
- **Don't modify** `R003_LIVE_SMOKE_RUNBOOK.md` execution commands or
  `PHASE_STATUS.md` Phase 0A/0B definitions (codex's directive
  2026-05-03 post-`88e7ecd`)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs except runbook execution commands and Phase 0A/0B definitions
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement. LLM speed: simple replies 1-2 min, multi-file extractions 8-15 min, doc-pack 12-18 min · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from latest `origin/master`; archival branches get no further commits · `origin/master:.coordination/codex.md`
- 2026-05-03 **Claude paused on new features** until Phase 0 + Phase 1 closed; docs polish only · `origin/master:.coordination/codex.md` 2026-05-03
- 2026-05-03 **R-003 runbook commands + Phase 0A/0B definitions are codex domain**; Claude must not modify (post `88e7ecd`)

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat decision
- 2026-05-03 R-003 live smoke checklist + readiness preflight green · `R003_LIVE_SMOKE_RUNBOOK.md` (codex `88e7ecd`)

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 0B (codex domain definition):**
- 2026-05-03 Phase 0B = Restaurant v1: Resy observed fixture suite (currently 22 rows, target 25) + OpenTable Phase 0 coverage · `PHASE_STATUS.md` (codex `88e7ecd`)

**Phase 1 status:**
- 2026-05-03 **Phase 1 UI shipped to master** via `c2be764` + `601716b` + `6f81b5c` · `PHASE_1_PLAN.md`
- 2026-05-03 **Phase 1 #7 fully shipped**: path A `8500af3` + path B `4cdaa36` + safety fix · `PHASE_1_7_SPEC.md`
- 2026-05-03 **Path B hardening landed**: helpers + 19 tests + dev demo via `f423b56` cherry-pick · `lib/profile-gap-decision.ts` / `lib/profile-gap-on-save.ts`
- 2026-05-03 **Audit Finding 5 closed**: cancel updates task.state via `7289ba0` · `E2E_SOURCE_AUDIT.md`
- 2026-05-03 Q14 / Q15 closed: backend emits canonical via `buildProfileGap`; client consumes `payload.profile_gap` · `PHASE_1_7_SPEC.md` § 11.4
- 2026-05-03 Q13 wontfix: CRLF false-positive Windows-quirk only
- 2026-05-03 **Phase 1 founder walkthrough has automated render-smoke gate** via `npm run smoke:phase1` · `PHASE_1_E2E_SMOKE.md` (merged `f9dd0ba`)
- 2026-05-03 **Phase 1 plan refreshed** to ~95% shipped state · `PHASE_1_PLAN.md`
- 2026-05-03 **Founder E2E walkthrough has Quick (10 min) + Full (60-90 min) bifurcation + stop conditions** · `PHASE_1_FOUNDER_E2E.md`

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
