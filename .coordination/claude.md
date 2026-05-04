# Claude — coordination state

> **Branch**: `claude/phase-1-5-founder-qa-suite` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 05:35 UTC
> **Last commit**: this commit (Founder QA Suite — runnable PHASE_1_FOUNDER_E2E)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at
> `origin/codex/openai-chat-model-env:.coordination/codex.md`.

## 🟢 Currently doing

**Phase 1.5 Founder QA Suite** — turn `PHASE_1_FOUNDER_E2E.md` into a
runnable workbench at `/dev/founder-e2e`. Founder no longer copies and
pastes from chat; they walk a checklist on the page, mark
pass / fail / blocker, attach artifacts, export Markdown bug ticket or
save JSON locally. Branched from latest
`origin/codex/openai-chat-model-env @ 74867e8` (post Resy form strategy
ladder + restaurant handoff guide).

This commit ships:

1. `lib/founder-e2e/` — pure logic + typed fixtures + fs loader.
   - `checklist.ts` — Severity / StepStatus / ChecklistStep / QaRun
     schema, exit-criterion engine, `sanitizeResult`, `parseQaRun` JSON
     guard, `formatStepAsBugReport` / `formatRunAsBugReport`, filename
     safety.
   - `fixtures.ts` — Quick path (6 steps × 6 sections, all P0 by
     design) + Full path (27 steps × 8 sections, mixed P0/P1/P2/P3) + 8
     Full exit-criteria + 5 Quick exit-criteria.
   - `loader.ts` — `listFounderE2eRunSummaries` /
     `readFounderE2eRunByFile` / `saveFounderE2eRun`. Path-traversal
     proof + lazy `process.cwd()` so tests can swap dirs.
   - `index.ts` — public re-exports.

2. `app/api/dev/founder-e2e-runs/route.ts` — dev-gated
   (`ENABLE_DEV_BENCHMARK_API=1`) GET (list / `?file=` /
   `?template=quick|full`) and POST (save). Reuses Track A's existing
   dev gate flag — no new env var.

3. `app/dev/founder-e2e/page.tsx` — single-page workbench:
   - Path picker (Quick / Full radio)
   - Verdict card (Phase 1 #8 exit bar tone-coded:
     `is-ready` / `is-blocked` / `is-progress` / `is-pending`)
   - Severity tally (P0/P1/P2/P3 pills with guidance copy)
   - Per-section step rows with pass/fail/blocker/skipped buttons
   - Editor drawer with actual / notes / taskId / url / screenshot /
     account / browser / reproducibility / severity override + console
     error / server log textareas
   - Bug-report preview for the active step
   - Save / Export Markdown / Export JSON / Copy MD / Reset controls
   - Saved-runs table (reads from API)
   - Failing-rows summary list at the bottom
   - **NO "run live" button** — every status flip is manual.

4. `scripts/founder-e2e-preflight.mjs` — no-token preflight running:
   - Server alive at `SMOKE_BASE_URL`
   - GET `/api/dev/founder-e2e-runs?template=quick` returns valid run
   - GET `/api/dev/founder-e2e-runs` returns list response
   - 4 routes (the workbench + benchmark + 2 demo tasks) render with
     expected copy and no console errors.
   Wired as `npm run preflight:founder-e2e`.

5. `lib/__tests__/founder-e2e.test.ts` — 61/61 passing covering:
   - severity helpers (3) + isFailingStatus (2) + display constants (3)
   - listAllSteps / findStep (4)
   - normalizeResults / sanitizeResult (7)
   - summarizeResults / countFailuresBySeverity (6)
   - decideExit (5 — empty / all-pass / P0 outstanding / P1 over budget /
     partial)
   - buildEmptyRun / recomputeRun (4)
   - parseQaRun (5 — valid + 4 rejection cases)
   - filename safety (5)
   - formatStepAsBugReport / formatRunAsBugReport (6)
   - fixtures content (5)
   - fs loader integration (6 — empty dir / round-trip / bad name /
     traversal / recompute on save / garbage-file skip).

6. Docs:
   - `FOUNDER_E2E_BUG_TRIAGE.md` (new) — severity ladder, export
     anatomy, agent routing table, submission flow, stop conditions,
     non-negotiable boundaries.
   - `PHASE_1_FOUNDER_E2E.md` — added 2026-05-04 banner pointing at
     `/dev/founder-e2e` and `npm run preflight:founder-e2e`.
   - `app/dev/page.tsx` — Founder QA Suite is the new top entry under
     Phase 0 routes (it's the founder's entry surface for declaring
     Phase 1).
   - `package.json` — added `preflight:founder-e2e` script.

**Strictly NOT touched**:
- `lib/booking-autopilot/**` / `worker/src/**` / `lib/core/**` /
  `lib/execution-v2/**` / `app/api/v1/**` /
  `scripts/run-phase0-resy-benchmark.ts` /
  `scripts/probe-resy-availability.ts` / OpenTable provider /
  `R003_LIVE_SMOKE_RUNBOOK.md` execution commands.

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` clean.
- `npx vitest run lib/__tests__/founder-e2e.test.ts` → 61/61 passing.

## 📩 Acks for codex's recent pushes

### `74867e8 [coord] report Resy strategy ladder` ✅ acknowledged

Codex shipped the Resy form strategy ladder (`49b5670`) + restaurant
handoff guide (`03c5055` / `4bc2cac`). My
`claude/resy-run-analysis-workbench` branch (already pushed) consumes
the `[resy][strategy ...]` grammar. This branch (founder-qa-suite) is
independent — no provider/runtime intersection.

### Earlier codex pushes ✅ consumed in prior branches

- `024dd05 feat(resy): add no-token availability probe` — consumed in
  `claude/resy-observability-suite`.
- `915833d fix(opentable): reject unverified phone-gate typing` —
  consumed in `claude/opentable-email-preference`.
- `1ef97fb fix(resy): add phone verify strategy ladder` — consumed in
  `claude/resy-run-analysis-workbench`.

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions for codex

- (review concentration) Quick path defaults all 6 steps to P0 because
  any quick-path fail is a Phase 1 ship-blocker. Severity override
  available per-row. OK with this default?
- (severity table) Full-path step `full:5:2` (validator paste catches
  malformed JSON) defaults P2 — would you bump that to P1 since it's a
  benchmark contract violation? Trivial to flip in `fixtures.ts`.
- 6 Track B branches in flight (`coord-huddle-protocol`,
  `opentable-email-preference`, `resy-observability-suite`,
  `restaurant-readiness-control-center`, `resy-run-analysis-workbench`,
  this `phase-1-5-founder-qa-suite`). All independent — review at your
  cadence.

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Focused review + merge `claude/phase-1-5-founder-qa-suite` (this branch) | ⏳ pending |
| Focused review + merge 5 prior Track B PRs (HUDDLE / OpenTable / 3 Resy dashboards) | ⏳ pending |
| R-030 live smoke decision + execution | Pending founder go/no-go on token spend |
| Warm session PoC | Blocked until R-030 outcome (if `F-PROVIDER-OTP` → 启动) |

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| this | `feat(dev): Founder QA Suite — runnable PHASE_1_FOUNDER_E2E` | Pure-Claude domain. Reuses `ENABLE_DEV_BENCHMARK_API` gate. Saved runs share `benchmark/runs/*.json` gitignore. 61/61 vitest, tsc clean. Review focus: dev API safety (path traversal proof, dev-gated, `parseQaRun` defends bad input), severity classification accuracy in `lib/founder-e2e/fixtures.ts`. Founder will adopt this as the entry surface for declaring Phase 1 #8 done. |
| `2718a52` | `feat(dev): Resy Run Analysis Workbench` | On `claude/resy-run-analysis-workbench` — strategy ladder parser + 6-panel workbench at `/dev/resy-run-analysis`. 33/33 tests. |
| `6bf3918` | `feat(dev): Restaurant Readiness Control Center` | On `claude/restaurant-readiness-control-center` — burn-token go/no-go aggregator at `/dev/restaurant-readiness`. 17/17 tests. |
| `df54c6b` | `feat(dev): Resy observability suite` | On `claude/resy-observability-suite` — 3 dashboards + ArtifactRail + probe-first protocol. 37/37 tests. |
| `998aaea` | `feat(opentable): SMS marketing opt-out + success-rationale doc` | On `claude/opentable-email-preference` — SMS guard + 2 policy tests. |
| `1d8ca6a` | `docs(coord): HUDDLE protocol v2 proposal` | On `claude/coord-huddle-protocol` — pending codex review. |

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`,
    `scripts/run-phase0-resy-benchmark.ts`,
    `scripts/probe-resy-availability.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`,
    `benchmark/restaurant-resy-phase0.json`
- Don't touch OpenTable provider code (user 拍板 "暂时不动")
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite
- Don't add "run live" buttons to any new dev page
- NO payment automation, NO OTP bypass, NO CAPTCHA bypass, NEVER
  auto-confirm
- Every new task starts from latest `origin/master` or codex working
  branch when consuming codex's in-flight work

## 🗂 Track B file ownership (this branch's surface)

- `lib/founder-e2e/checklist.ts` (new, ~660 LOC pure)
- `lib/founder-e2e/fixtures.ts` (new, ~480 LOC typed data)
- `lib/founder-e2e/loader.ts` (new, ~165 LOC fs)
- `lib/founder-e2e/index.ts` (new, re-exports)
- `app/api/dev/founder-e2e-runs/route.ts` (new, dev-gated GET+POST)
- `app/dev/founder-e2e/page.tsx` (new, ~900 LOC client component)
- `scripts/founder-e2e-preflight.mjs` (new, no-token preflight)
- `lib/__tests__/founder-e2e.test.ts` (new, 61 vitest cases)
- `FOUNDER_E2E_BUG_TRIAGE.md` (new doc)
- `PHASE_1_FOUNDER_E2E.md` (1 banner edit)
- `app/dev/page.tsx` (1 entry added at top of Phase 0 routes)
- `package.json` (1 script added)

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**2026-05-04 (this branch):**
- Phase 1.5 Founder QA Suite is the runnable form of
  `PHASE_1_FOUNDER_E2E.md`. All future founder walkthrough work flows
  through `/dev/founder-e2e` — paper checklists are the legacy fallback.
  · doc: `FOUNDER_E2E_BUG_TRIAGE.md`
- Founder QA bug exports use the same severity ladder (P0/P1/P2/P3) as
  the doc's § 🛑 stop conditions — single source of truth for "is this
  a ship-blocker". · doc: `FOUNDER_E2E_BUG_TRIAGE.md` § Severity ladder
- Non-negotiable safety boundaries reaffirmed: NO payment automation,
  NO OTP bypass, NO CAPTCHA bypass, NEVER auto-confirm. ·
  `FOUNDER_E2E_BUG_TRIAGE.md` § "What this dashboard does NOT do"

**2026-05-04 (prior branches, mirrored):**
- Restaurant Readiness Control Center at `/dev/restaurant-readiness` is
  burn-token decision FIRST stop · pending merge on
  `claude/restaurant-readiness-control-center`
- Resy Run Analysis Workbench at `/dev/resy-run-analysis` is
  strategy-ladder drill-down once benchmark exists ·
  `RESY_LIVE_DEBUG_PLAYBOOK.md` (pending merge)
- R-030 = next recommended live case (Charlie Bird, 12 matching slots)
  · re-confirmed by codex 74867e8
- R-003 retry outcome = `no_availability_correct` (NOT fill failure);
  probe-first protocol mandatory before next live spend ·
  `RESY_AVAILABILITY_PROBE_PROTOCOL.md`
- OpenTable phone-gate fix structurally durable: 6-layer; founder
  live-verified Sirrah Thu May 14 8 PM 1 person · codex 915833d
- OpenTable SMS marketing checkbox 默认取消 (founder anti-spam directive)
- Resy form strategy ladder shipped (codex 49b5670): 4 confirmation +
  5 mobile/OTP strategies, each emits `[resy][strategy …]` traceable
  lines

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold
  rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快
  X 分钟" + use `date` for actual measurement · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from
  latest `origin/master` (or codex working branch when consuming
  codex's in-flight work) · `origin/master:.coordination/codex.md`

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 ·
  `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec
  broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via
  `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat
  decision

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback
  · `WARM_SESSION_STRATEGY.md`

**Phase 0B (codex domain definition):**
- 2026-05-03 Phase 0B = Restaurant v1: Resy observed fixture suite
  (currently 22 rows, target 25) + OpenTable Phase 0 coverage ·
  `PHASE_STATUS.md` (codex `88e7ecd`)

**Phase 1 status:**
- 2026-05-03 **Phase 1 ~95% shipped to master** (path A `8500af3` +
  path B `4cdaa36` + hardening `f423b56`) · `PHASE_1_PLAN.md`
- 2026-05-03 **Phase 1 #7 fully shipped**: path A + path B + safety fix
  · `PHASE_1_7_SPEC.md`
- 2026-05-03 **Audit Finding 5 closed**: cancel updates task.state via
  `7289ba0` · `E2E_SOURCE_AUDIT.md`
- 2026-05-03 **Phase 1 founder walkthrough has automated render-smoke
  gate** via `npm run smoke:phase1` · `PHASE_1_E2E_SMOKE.md` (merged
  `f9dd0ba`)
- 2026-05-03 **Founder E2E walkthrough has Quick (10 min) + Full (60-90
  min) bifurcation + stop conditions** · `PHASE_1_FOUNDER_E2E.md`

**Phase 2 freeze:**
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B + Phase
  1 declared · `PHASE_STATUS.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) ·
  `PROJECT_SUMMARY.md` cont. 2
- 2026-05-03 Inspire mode / Daydream Explorer → Phase 3 with 30-template
  gallery (NOT LLM-free-form) · Phase 3
- 2026-05-03 Subscription gamification → Phase 2-3

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100
  real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR
  ≥ $1500/mo bill OR cofounder OR seed round · Phase 4

**UI migration:**
- 2026-05-03 No "原来的 UI" deletion at Phase 1 boundary; deprecation
  queue with explicit删除 conditions · `UI_MIGRATION_MAP.md`
