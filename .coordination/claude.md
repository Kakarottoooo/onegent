# Claude — coordination state

> **Branch**: `claude/autonomous-founder-e2e-runner` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 06:50 UTC
> **Last commit**: this commit (Autonomous Founder E2E runner — `npm run e2e:founder`)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at
> `origin/codex/openai-chat-model-env:.coordination/codex.md`.

## 🟢 Currently doing

**Phase 1.5 Autonomous Founder E2E runner** — upgrade
`/dev/founder-e2e` from a pure manual workbench into a manual +
automated dual surface. Founder (or CI) can now run `npm run
e2e:founder` and get a 1-2 minute verdict + Markdown bug-report
that is paste-ready for codex / Claude. Branched from
`origin/codex/openai-chat-model-env @ 464d0c5`, cherry-picked the
prior `claude/phase-1-5-founder-qa-suite` (`a0bd2db`) baseline so
this branch supersedes it.

This commit ships:

1. **Schema v2 extension** in `lib/founder-e2e/checklist.ts`:
   - `RunSource` (`"manual" | "automated"`), `RunnerVerdict`
     (`"pass" | "needs_polish" | "fail"`), `RunnerMeta`
     (command / baseUrl / browser / durationMs / nodeVersion / label).
   - `pathId` widened to `"quick" | "full" | "auto"`.
   - `parseQaRun` now tolerates legacy `schemaVersion=1` payloads
     (old manual saves still load), and rejects malformed runner
     fields gracefully.
   - `recomputeRun` stamps current schemaVersion + computes
     `runnerVerdict` for automated runs.
   - `deriveRunnerVerdict` (pure) + `exitCodeForVerdict` (pure).

2. **`auto` checklist path** in `lib/founder-e2e/fixtures.ts`:
   15 step ids the runner targets 1:1 — health / self-render /
   demo render / dev API contract / security boundaries.
   `FOUNDER_E2E_EXIT_CRITERIA_AUTO` (5 criteria).

3. **`lib/founder-e2e/runner-report.ts`** — pure converter:
   `buildAutoRunFromProbes(probes, runnerMeta) → QaRun`,
   `summarizeRunForRunner`, `formatRunnerBanner`,
   `formatAutoRunMarkdown`, `buildScreenshotRelPath`,
   `isSafeRunnerAssetPath`, `normalizeBaseUrl`. Zero IO, fully
   tested.

4. **`scripts/run-founder-e2e.ts`** — autonomous runner:
   - Health check → 14 playwright probes (chromium headless by
     default, `--headed` opt-in).
   - Render assertions on `/dev/founder-e2e` self + 7 demo
     pages + 2 dev dashboards.
   - Dev API contract probes (template / list / traversal /
     bad-payload).
   - Security probes (PATCH `/profile` payment guard /
     unauthenticated `/tasks/<uuid>` ownership leak).
   - Writes `<runId>-auto.json` + `<runId>-auto.md` under
     `benchmark/runs/`.
   - Failure screenshots saved under
     `benchmark/runs/founder-e2e-assets/<runId>/`.
   - Exit codes: 0 pass / 0 needs_polish / 1 fail / 2 server
     unreachable / 3 chromium missing.
   - Flags: `--base-url`, `--headed`, `--json`, `--output-dir`,
     `--save-to-api`, `--label`. `--start-server` is reserved.
   - Strict refusal to silently start a dev server (would conflict
     with codex's local worker).

5. **`/dev/founder-e2e` page enhancements**:
   - Path picker now includes `"auto"` (the autonomous path).
   - Saved-runs table gains Source / Verdict / Duration / Base URL /
     Command columns + per-row Open button (loads a saved run
     into the workbench so spotlight / screenshots render).
   - New `AutomatedRunSpotlight` panel surfacing runner metadata
     (command, baseUrl, browser, duration, node, label) +
     screenshot links for failing rows.
   - New tone-coded source / verdict tags.

6. **`lib/__tests__/founder-e2e-runner.test.ts`** — 71 new pure
   tests on top of the existing 61 = **132/132 vitest passing**:
   - Auto path content sanity (6)
   - `buildAutoRunFromProbes` shape + verdict + metadata + safety (10)
   - `deriveRunnerVerdict` for every state (7 — including the
     all-pending → undefined edge case)
   - `exitCodeForVerdict` (4 — pass/needs_polish/fail/undefined)
   - `summarizeRunForRunner` (2)
   - `formatRunnerBanner` (3) + `formatAutoRunMarkdown` (2)
   - `buildScreenshotRelPath` + `isSafeRunnerAssetPath` (10) —
     including backslash, traversal, wrong-prefix, segment-count
     defenses
   - `normalizeBaseUrl` (7)
   - Schema parse for source / runnerMeta / runnerVerdict / `pathId="auto"`
     / legacy v1 (11)
   - `recomputeRun` legacy stamping (1)
   - `buildEmptyRun` source defaults + meta passthrough (2)
   - Display constants (2)
   - Severity-default sanity in fixtures (2)

7. **Docs**:
   - `AUTONOMOUS_FOUNDER_E2E.md` (new) — how to run, success
     criteria, how to read failures, what the runner can NOT
     automate, why no live providers / OpenAI, triage flow.
   - `PHASE_1_FOUNDER_E2E.md` — top banner now flags the runner
     as the recommended first step (`npm run e2e:founder`),
     manual workbench / Quick / Full as second-tier follow-up.

8. **Wiring**:
   - `package.json` adds `e2e:founder` /
     `e2e:founder:headed` / `e2e:founder:json` scripts.
   - `.gitignore` adds `benchmark/runs/*.md` + `benchmark/runs/founder-e2e-assets/`.

**Strictly NOT touched**:

- `lib/booking-autopilot/**` / `worker/src/**` / `lib/core/**` /
  `lib/execution-v2/**` / `app/api/v1/**` /
  `scripts/run-phase0-resy-benchmark.ts` /
  `scripts/probe-resy-availability.ts` / OpenTable / Resy
  provider code / `R003_LIVE_SMOKE_RUNBOOK.md` execution commands.
- The runner is no-token, no-provider, no-OTP, no-CAPTCHA,
  no-payment, no-final-confirm by design and there is no flag to
  flip those off.

**Verified pre-push**:

- `npx tsc --noEmit --pretty false` clean.
- `npx vitest run lib/__tests__/founder-e2e.test.ts lib/__tests__/founder-e2e-runner.test.ts`
  → 132/132 passing.

## 📩 Acks for codex's recent pushes

### `464d0c5 [fix] preserve flight constraints after confirm` ✅ acknowledged

Read but does not intersect with this branch (flight-side
NLU/commit fix). My runner's render checks include
`/tasks/demo-failed`, `/tasks/demo-ready-for-confirmation`,
`/tasks/demo-executing` which are restaurant fixtures — codex's
flight fix lives outside that surface.

### `74867e8 [coord] report Resy strategy ladder` ✅ acknowledged earlier

### Earlier codex pushes ✅ consumed in prior branches

(See prior `claude/phase-1-5-founder-qa-suite` / `claude/resy-*`
branches for individual ack history.)

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions for codex

- Severity defaults in `auto` path's render checks (P0 for
  `/dev/founder-e2e` self + `/tasks/demo-awaiting-profile` —
  Phase 1 #7 path B regression — and P1 for the rest). OK with
  this calibration?
- The runner's `auto:security:unauthorized-task` probe relies on
  HTML heuristics (look for restaurant content in the body to
  detect leaks). If you ship a `Cache-Control: private` 401 JSON
  response for `/tasks/<uuid>` instead of a server-rendered card,
  let me know — I'll switch the probe to check status code first.
- 7 Track B branches in flight (`coord-huddle-protocol`,
  `opentable-email-preference`, `resy-observability-suite`,
  `restaurant-readiness-control-center`, `resy-run-analysis-workbench`,
  `phase-1-5-founder-qa-suite`, this
  `autonomous-founder-e2e-runner`). All independent. This branch
  supersedes `phase-1-5-founder-qa-suite` (cherry-picked then
  extended).

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Focused review + merge `claude/autonomous-founder-e2e-runner` (this branch) | ⏳ pending |
| 6 prior Track B PRs review | ⏳ pending |
| R-030 live smoke decision + execution | Pending founder go/no-go on token spend |
| Warm session PoC | Blocked until R-030 outcome (if `F-PROVIDER-OTP` → 启动) |

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| this | `feat(dev): autonomous Founder E2E runner — npm run e2e:founder` | Pure-Claude domain. 132/132 vitest, tsc clean. Cherry-picks `a0bd2db` (founder-qa-suite) then extends. Review focus: dev API safety holds (path traversal, dev-gated, parser tolerance for v1+v2), runner stays no-token/no-provider, severity defaults make sense, exit codes appropriate for CI (0 needs_polish + 1 fail). |
| `a0bd2db` | `feat(dev): Founder QA Suite — runnable PHASE_1_FOUNDER_E2E` | Cherry-picked into this branch. Available also on `claude/phase-1-5-founder-qa-suite`. |
| `2718a52` | `feat(dev): Resy Run Analysis Workbench` | On `claude/resy-run-analysis-workbench`. |
| `6bf3918` | `feat(dev): Restaurant Readiness Control Center` | On `claude/restaurant-readiness-control-center`. |
| `df54c6b` | `feat(dev): Resy observability suite` | On `claude/resy-observability-suite`. |
| `998aaea` | `feat(opentable): SMS marketing opt-out + success-rationale doc` | On `claude/opentable-email-preference`. |
| `1d8ca6a` | `docs(coord): HUDDLE protocol v2 proposal` | On `claude/coord-huddle-protocol`. |

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
- Don't touch OpenTable or Resy provider code
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI / Computer Use / 25-case suite
- Don't add "run live" buttons to any new dev page
- Runner is forbidden from: live providers / payment / OTP / CAPTCHA /
  final-confirm / starting dev server
- Every new task starts from latest `origin/master` or codex working
  branch when consuming codex's in-flight work

## 🗂 Track B file ownership (this branch's surface)

- `lib/founder-e2e/checklist.ts` (extended: schema v2 +
  RunSource / RunnerMeta / RunnerVerdict + auto pathId +
  deriveRunnerVerdict + exitCodeForVerdict)
- `lib/founder-e2e/fixtures.ts` (extended: AUTO_PATH +
  FOUNDER_E2E_EXIT_CRITERIA_AUTO + getExitCriteriaForPath('auto'))
- `lib/founder-e2e/loader.ts` (extended: FounderRunSummary gains
  source / runnerVerdict / baseUrl / command / durationMs;
  saveFounderE2eRun accepts legacy v1)
- `lib/founder-e2e/runner-report.ts` (NEW, pure converter)
- `lib/founder-e2e/index.ts` (re-exports runner-report)
- `app/dev/founder-e2e/page.tsx` (extended: auto path picker,
  enhanced saved-runs table, AutomatedRunSpotlight, Open button)
- `scripts/run-founder-e2e.ts` (NEW, autonomous runner)
- `lib/__tests__/founder-e2e-runner.test.ts` (NEW, 71 cases)
- `AUTONOMOUS_FOUNDER_E2E.md` (NEW)
- `PHASE_1_FOUNDER_E2E.md` (1 banner edit)
- `package.json` (3 scripts added)
- `.gitignore` (assets dir + .md ignored)

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**2026-05-04 (this branch):**
- **Phase 1.5 founder E2E flow has TWO surfaces, not one**:
  autonomous runner (`npm run e2e:founder`) for "today's build
  doesn't crash + contracts hold" + manual workbench
  (`/dev/founder-e2e`) for "I as founder walked the experience".
  Recommended order: runner first, manual second only if runner
  passes. · doc: `AUTONOMOUS_FOUNDER_E2E.md`
- **Runner schema is QaRun v2** with `source`, `runnerMeta`,
  `runnerVerdict` extensions. Old v1 manual saves still load
  (parser tolerant). · `lib/founder-e2e/checklist.ts`
- **Verdict tier is canonical**: `pass` / `needs_polish` / `fail`
  + exit codes 0 / 0 / 1. CI integrations should treat
  `needs_polish` as informational, not failing. ·
  `AUTONOMOUS_FOUNDER_E2E.md` § Success criteria
- **Runner is no-token / no-provider / no-OTP / no-CAPTCHA /
  no-payment / no-final-confirm / no-auto-server-start** — these
  are immutable safety boundaries, not flags. ·
  `AUTONOMOUS_FOUNDER_E2E.md` § Why no live providers
- **Failure screenshots are local-only** (gitignored under
  `benchmark/runs/founder-e2e-assets/`). Founder pastes
  screenshot path into chat manually if needed.

**2026-05-04 (prior branches, mirrored):**
- Phase 1.5 Founder QA Suite is the runnable form of
  `PHASE_1_FOUNDER_E2E.md`. ·
  `claude/phase-1-5-founder-qa-suite` (a0bd2db, cherry-picked here)
- Restaurant Readiness Control Center at
  `/dev/restaurant-readiness` is burn-token decision FIRST stop ·
  `claude/restaurant-readiness-control-center`
- Resy Run Analysis Workbench at `/dev/resy-run-analysis` is
  strategy-ladder drill-down · `claude/resy-run-analysis-workbench`
- R-030 = next recommended live case (Charlie Bird, 12 matching
  slots) · re-confirmed by codex 74867e8
- R-003 retry outcome = `no_availability_correct` (NOT fill
  failure); probe-first protocol mandatory · codex 024dd05
- OpenTable phone-gate fix structurally durable: 6-layer ·
  codex 915833d
- OpenTable SMS marketing checkbox 默认取消 (founder anti-spam directive)
- Resy form strategy ladder shipped (codex 49b5670)

**Team / role allocation:**
- 2026-05-03 codex 30-40% / Claude 60-70% with hold rules ·
  `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch
  from latest `origin/master` or codex working branch.

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 ·
  `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes broadening ·
  `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via
  `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume
  fallback · `WARM_SESSION_STRATEGY.md`

**Phase 1 status:**
- 2026-05-03 **Phase 1 ~95% shipped to master** ·
  `PHASE_1_PLAN.md`
- 2026-05-03 **Founder E2E walkthrough has Quick (10 min) +
  Full (60-90 min) bifurcation + stop conditions** ·
  `PHASE_1_FOUNDER_E2E.md`
- **2026-05-04 Phase 1 founder E2E now has autonomous runner
  surface in addition to manual workbench** ·
  `AUTONOMOUS_FOUNDER_E2E.md`

**Phase 2 freeze:**
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B +
  Phase 1 declared · `PHASE_STATUS.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning · `PROJECT_SUMMARY.md` cont. 2
- 2026-05-03 Inspire mode → Phase 3 · Phase 3
- 2026-05-03 Subscription gamification → Phase 2-3

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A + B 做; C 显式不做; trigger ≥ 100
  real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger · Phase 4

**UI migration:**
- 2026-05-03 No "原来的 UI" deletion at Phase 1 boundary ·
  `UI_MIGRATION_MAP.md`
