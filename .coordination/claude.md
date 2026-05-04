# Claude — coordination state

> **Branch**: `claude/restaurant-readiness-control-center` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 05:30 UTC
> **Last commit**: this commit (Restaurant Readiness Control Center — burn-token go/no-go aggregator)
> **Forked from**: `origin/codex/openai-chat-model-env @ 74867e8` (after Resy form strategy ladder)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file: `origin/codex/openai-chat-model-env:.coordination/codex.md`.

## 🟢 Currently doing

**Restaurant Readiness Control Center** — single-page burn-token go/no-go
aggregator at `/dev/restaurant-readiness`. Per codex's task brief (relayed
by founder after `74867e8 [coord] report Resy strategy ladder`).

**Why this is needed**: founder + codex now have 3 separate dev dashboards
(probe-runs / benchmark-runs / debug-artifacts). Three is one too many for
a single decision. This page is the **single front door** for "should we
burn an OpenAI token right now?": ONE verdict, recommended cases pre-baked
with copy commands, pointers to per-source dashboards when drilling in.

This commit (UI/loader/tests/docs only — strictly no provider/runtime/worker/runner):

1. ✅ **`lib/benchmark/restaurant-readiness.ts`** (524 LOC) — read-only
   loader that aggregates three independent data sources:
   - Latest `benchmark/runs/resy-availability-probe-*.json` (codex's
     probe runner output)
   - Latest `benchmark/runs/phase0-*.json` benchmark report
   - Latest `worker/.debug-screenshots/<provider>/<run>/summary.json`
     across the 5 allow-listed providers (resy / opentable / booking /
     expedia / hotels)
   - Schema mirrors codex's runner output verbatim — defined inline
     here, NOT imported from anything codex owns or anything on the
     in-flight `claude/resy-observability-suite` branch (this branch
     is self-contained per task scope)
   - Pure decision function `decideGoNoGo()` with 5 verdict states:
     `ready_for_single_live` / `needs_probe` / `blocked_no_slots` /
     `blocked_no_artifacts` / `unknown`
   - Warnings (informational; don't downgrade verdict): severe in
     latest benchmark, probe >24h stale, debug-artifact summary error
   - **Path-traversal proof**: walks fixed allow-listed dirs, no user
     input ever joins paths; `path.resolve` + prefix check defense in
     depth on per-provider artifact dirs
   - Always returns a well-formed `RestaurantReadinessSummary` even
     when files are missing/malformed — never throws

2. ✅ **`app/api/dev/restaurant-readiness/route.ts`** — dev-gated GET
   endpoint (`ENABLE_DEV_BENCHMARK_API=1` reused for prod flip), no
   query params (no traversal vector), `Cache-Control: no-store`.

3. ✅ **`app/dev/restaurant-readiness/page.tsx`** (438 LOC) — single
   page with:
   - **Verdict card** (top, 22px): `READY TO BURN ONE CASE` /
     `DO NOT BURN — NO SLOTS` / `NEEDS PROBE` / etc. Tone-coded
     border + gradient background. Includes `nextCommand` copy box
     when `ready_for_single_live`.
   - **Recommended live cases table**: caseId / restaurant / date /
     time / covers / matching slots count / exact venue match pill /
     per-row copy command.
   - **Latest benchmark panel** (left half): GATE PASS/FAIL chip +
     4-metric breakdown + severe count + first severe caseId + link
     to `/dev/benchmark-runs`.
   - **Latest debug artifacts panel** (right half): per-provider
     newest run + summary error label + link to `/dev/debug-artifacts`.
   - **Stop rules card**: 5 explicit conditions when NOT to burn
     (0 slots / no_availability_correct / strategy log failure /
     OTP wall / probe >24h).
   - **No "run live" button** by design — only copy-paste commands.
     Live spend stays a manual terminal step controlled by codex/founder.

4. ✅ **`lib/__tests__/restaurant-readiness.test.ts`** (414 LOC) —
   **17 vitest cases** (task asked for 15+):
   - decideGoNoGo (9 tests): all 5 verdict branches + benchmark severe
     warning + stale probe warning + ready+severe combo + summary-error
     warning + needs_probe early return
   - display constants (2 tests): all 5 verdict labels + tone mapping
   - buildReadinessSummary fs integration (6 tests): live-OK probe →
     ready + nextCommand exact-venue-match assertion, blocked_no_slots,
     malformed JSON tolerated, nextCommand-only-for-ready guard,
     debug-artifact summary error → warning, defensive needs_probe
     when no probe staged
   - Tests use real fs in `benchmark/runs/` + `worker/.debug-screenshots/`
     with TEST_*_PREFIX namespacing + afterEach cleanup. Same oxc
     workarounds (line comments instead of /** */; no postfix-bang)
     as in resy-probe-report.test.ts and debug-artifacts.test.ts.

5. ✅ **`/dev` landing**: added `/dev/restaurant-readiness` as the
   FIRST entry under PHASE_0_ROUTES with explicit "FIRST STOP before
   any live R-* token spend" copy.

6. ✅ **R003_LIVE_SMOKE_RUNBOOK.md** small ref: top-of-doc 2026-05-04
   note explaining R-003 isn't the default live case anymore (no slots
   → `no_availability_correct` only), pointing at
   `/dev/restaurant-readiness` for current recommendation. Execution
   commands strictly untouched per existing hold rule.

7. ✅ **PHASE_STATUS.md** Phase 0A 未完成 block updated to reflect
   readiness-driven retry selection. Phase 0A/0B definitions strictly
   untouched per existing hold rule.

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` — clean (exit 0)
- `npx vitest run lib/__tests__/restaurant-readiness.test.ts` — 17/17 passing

**Strictly NOT touched** (per task scope):
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `scripts/run-phase0-resy-benchmark.ts`
- `scripts/probe-resy-availability.ts`
- `lib/benchmark/phase0-report.ts` (codex source-of-truth — not even imported)
- `app/api/v1/**`
- Any OpenTable / Resy provider files
- Files on the in-flight `claude/resy-observability-suite` branch
  (`lib/benchmark/resy-probe-report.ts`, `lib/debug-artifacts.ts`,
  `app/dev/{resy-probe-runs,debug-artifacts}/**`,
  `app/api/dev/{resy-probe-runs,debug-artifacts}/**`,
  `RESY_AVAILABILITY_PROBE_PROTOCOL.md`) — this branch is **complementary**
  to that one (links to those routes when they merge), not duplicative

## 📩 Acks for codex's recent pushes

### `74867e8 [coord] report Resy strategy ladder` ✅ THIS BRANCH BUILDS ON IT
### `49b5670 fix(resy): add form strategy ladder` ✅ CONSUMED

Codex hardened Resy's confirmation modal and mobile/OTP form with:
- 4 strategies on confirmation modal (locator / role / DOM main / DOM frame)
- 5 strategies on mobile/OTP form (main locator / frame locator / main DOM /
  frame DOM / mouse+keyboard visualization fallback)
- Each strategy emits `[resy][strategy ...]` ok/step/filled lines so the
  next live failure is immediately attributable
- Mirrored to `worker/src/...`
- New/updated Resy mobile tests covering locator, DOM fallback,
  mouse+keyboard fallback, full-failure logging
- `npx vitest run lib/__tests__/resy-provider-mobile.test.ts` 5/5
- `npx tsc --noEmit --pretty false` clean
- `npx tsx scripts/check-drift.ts` clean
- `npm run probe:resy -- --case R-030` reconfirmed R-030 = 12 matching slots

The strategy ladder lines flow into `terminalReason` on phase0 benchmark
reports, which the readiness loader's `latestBenchmark` summary picks up
via severe/safe-failure counters; the per-strategy detail then surfaces
in `/dev/benchmark-runs` (codex's existing dashboard, not modified here).

### `024dd05 feat(resy): add no-token availability probe` ✅ CONSUMED EARLIER
### `1b7938e [coord] report R-003 availability classification` ✅ CONSUMED EARLIER
### `ff84707 fix(resy): classify R-003 availability-slot failure` ✅ CONSUMED EARLIER
### `149193b / 1ef97fb fix(resy): add phone verify strategy ladder` ✅ CONSUMED EARLIER
### `fdf0021 / 915833d fix(opentable): reject unverified phone-gate typing` ✅ CONSUMED EARLIER

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions / status

### For this branch (`claude/restaurant-readiness-control-center`)

- **Schema lockstep**: this branch defines its own inline mirror of your
  `ProbeReport` / `CaseProbeResult` / `Phase0BenchmarkReport` shapes
  (so it's independent of the in-flight `claude/resy-observability-suite`
  branch). If you change runner field names, ping me and I update the
  inline mirror in same commit.
- **Provider allow-list for debug artifacts**: hardcoded
  `[resy, opentable, booking, expedia, hotels]`. If you add a new
  provider that writes `worker/.debug-screenshots/<new>/`, also add to
  `PROVIDERS_ALLOWED` in `lib/benchmark/restaurant-readiness.ts`
  (one-line edit) OR I switch to dynamic readdir of the dir root.
- **Stale-probe threshold = 24h**: chosen because Resy slot availability
  rotates fast. Push back if you want 6h / 12h / 48h.
- **`nextCommand` template**: `npx tsx scripts\run-phase0-resy-benchmark.ts
  --case <id> --live-openai --allow-failures` (Windows backslash to
  match your runner's stdout). Tell me if hotel/flight runners use
  different command shapes.
- **`/dev/debug-artifacts` and `/dev/resy-probe-runs` cross-links**:
  this branch links to those routes assuming `claude/resy-observability-suite`
  merges. If you choose not to merge that branch, those links 404 —
  the readiness page still works (verdict / nextCommand / benchmark /
  artifacts panel all use this branch's loader, not those routes).

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Review + merge `claude/coord-huddle-protocol` (HUDDLE protocol) | ⏳ pending |
| Review + merge `claude/opentable-email-preference` | ⏳ pending |
| Review + merge `claude/resy-observability-suite` | ⏳ pending (recommended merge before THIS branch so cross-links resolve; OR merge this branch standalone — readiness page degrades gracefully) |
| Review + merge **this branch** (`claude/restaurant-readiness-control-center`) | ⏳ pending |
| R-030 live retry decision | Pending founder go/no-go on token spend |
| Warm session PoC | Blocked until R-030 outcome (if `F-PROVIDER-OTP` → 启动) |

**Resolved this round** ✓
- 3 dashboards collapsed to 1 front door — readiness control center

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `feat(dev): Restaurant Readiness Control Center — single-page burn-token go/no-go aggregator` | UI/loader/tests/docs only. tsc clean. 17/17 tests passing. Self-contained — no imports from in-flight Track B branches. |
| `df54c6b` (unmerged) | `claude/resy-observability-suite` | 3 dashboards + ArtifactRail. **Recommend merging before this branch** so the readiness page's cross-links resolve. |
| `1d8ca6a` (unmerged) | `claude/coord-huddle-protocol` | HUDDLE protocol. Independent. |
| `998aaea` (unmerged) | `claude/opentable-email-preference` | Doc-block + SMS guard. Independent. |

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
    `scripts/probe-resy-availability.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
  - **Files on `claude/resy-observability-suite`** (per task scope: no
    duplication; readiness branch is complementary)
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite / Computer Use / real booking submit
- Every new task starts from latest branch (here: `codex/openai-chat-model-env`
  per task brief; otherwise origin/master)
- **No "run live" button on readiness page** (per task explicit directive)
- **No new features**; observability + docs + tests only
- **Don't modify** `R003_LIVE_SMOKE_RUNBOOK.md` execution commands or
  `PHASE_STATUS.md` Phase 0A/0B definitions — only small references / 未完成 status block
- **Don't touch OpenTable provider code** (founder directive 2026-05-03)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `lib/benchmark/restaurant-readiness.ts` (Track B aggregator — codex consults schema; doesn't author)
- `app/api/dev/restaurant-readiness/**` (Track B)
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs except runbook execution commands and Phase 0A/0B definitions
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from latest `origin/master` (or codex working branch when consuming codex's in-flight work) · `origin/master:.coordination/codex.md`
- 2026-05-03 **Claude paused on new features** until Phase 0 + Phase 1 closed; observability + docs polish only · `origin/master:.coordination/codex.md` 2026-05-03
- 2026-05-03 **R-003 runbook commands + Phase 0A/0B definitions are codex domain**; Claude must not modify (post `88e7ecd`)

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat decision
- **2026-05-04 Probe-first protocol**: no token spent unless `/dev/resy-probe-runs` shows `use_for_live_fill_test` for the target case
- **2026-05-04 R-003 retry outcome = `no_availability_correct`** (NOT fill failure)
- **2026-05-04 R-030 = next recommended live case** (probe finding: 12 matching slots, exact venue match, party 2, 2026-05-08 20:00) · re-confirmed by codex `74867e8` post strategy ladder
- **2026-05-04 Resy form strategy ladder shipped** (codex `49b5670`): 4 strategies confirmation modal + 5 strategies mobile/OTP form, each emits `[resy][strategy ...]` traceable lines
- **2026-05-04 Restaurant Readiness Control Center** at `/dev/restaurant-readiness` is the FIRST stop before any live R-* spend; supersedes scattered probe / benchmark / debug-artifacts dashboards as the burn-token decision UI · this branch

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 0B (codex domain definition):**
- 2026-05-03 Phase 0B = Restaurant v1: Resy observed fixture suite (currently 22 rows, target 25) + OpenTable Phase 0 coverage · `PHASE_STATUS.md` (codex `88e7ecd`)

**Phase 1 status:**
- 2026-05-03 **Phase 1 ~95% shipped** · `PHASE_1_PLAN.md`

**Phase 2 freeze:**
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B + Phase 1 declared · `PHASE_STATUS.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) · `PROJECT_SUMMARY.md` cont. 2

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100 real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round · Phase 4

**UI migration:**
- 2026-05-03 No "原来的 UI" deletion at Phase 1 boundary; deprecation queue with explicit删除 conditions · `UI_MIGRATION_MAP.md`
