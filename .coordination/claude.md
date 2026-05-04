# Claude — coordination state

> **Branch**: `claude/resy-run-analysis-workbench` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 06:15 UTC
> **Last commit**: this commit (Resy Run Analysis Workbench — strategy ladder parser + failure-stage classifier + offline workbench)
> **Forked from**: `origin/codex/openai-chat-model-env @ 74867e8` (after Resy form strategy ladder)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file: `origin/codex/openai-chat-model-env:.coordination/codex.md`.

## 🟢 Currently doing

**Resy Run Analysis Workbench** at `/dev/resy-run-analysis` — offline
analysis tool that turns codex's `[resy][strategy …]` lines into a
per-strategy ladder matrix + classifies failure stage + tells founder
exactly what manual input is needed.

Why this is needed: after `49b5670 fix(resy): add form strategy ladder`,
every benchmark case's `terminalReason` carries a sequence of strategy
attempts. Reading those by hand from JSON is slow and lossy. This
workbench parses them once, surfaces them in a 2D matrix (strategy id
× ok/fail/step/filled), classifies which of 8 failure stages the run
landed at, and answers four founder questions on one screen.

This commit (UI/loader/tests/docs only — strictly no provider/runtime/
worker/runner mutation; complementary to existing Track B branches):

1. ✅ **`lib/benchmark/resy-run-analysis.ts`** (~720 LOC) — pure loader
   + parser:
   - `parseResyStrategyLines()` — exported pure parser for
     `[resy][strategy <id>] (ok|fail|step|filled|...) <detail>` grammar
   - `classifyFamily()` — `rs-slot-*` / `rs-phone-*` / `rs-confirm-*` /
     `other` (extensible to any future codex prefix)
   - `aggregateStrategyAttempts()` — group lines into per-strategy
     attempt rows (ok/fail/step/filled counts + latest detail)
   - `classifyFailureStage()` — exported pure classifier with 8 stages
     in priority order: `probe_no_slot`,
     `slot_api_available_dom_missing`, `slot_selection_failed`,
     `guest_form_reached`, `guest_form_incomplete`,
     `otp_or_login_required`, `ready_for_confirmation`, `unknown`
   - `decideVerdict()` — exported pure verdict function with 4 states:
     `RUN` / `DO_NOT_RUN` / `NEED_PROBE` / `NEED_ARTIFACTS`
   - `buildResyRunAnalysis()` — async fs aggregator; reads benchmark
     report + probe report + debug artifact index; never throws
   - Schema mirrors codex's `Phase0BenchmarkCaseResult` and
     `ProbeReport` shapes verbatim, defined inline (zero coupling to
     other in-flight Track B branches)

2. ✅ **`app/api/dev/resy-run-analysis/route.ts`** — dev-gated GET
   (reuses `ENABLE_DEV_BENCHMARK_API=1`); no path/query params (no
   traversal vector); always 200, never throws. Returns
   `ResyRunAnalysisSummary`.

3. ✅ **`app/dev/resy-run-analysis/page.tsx`** (~580 LOC) — single
   page with 6 panels:
   - **Verdict card** (top, 22px) — RUN / DO NOT RUN / NEED PROBE /
     NEED ARTIFACTS, tone-coded, with `nextSafeCommand` copy box only
     when verdict === RUN
   - **Failure-stage funnel** — 7 boxes left-to-right (probe → slot →
     form → OTP → confirm) plus a fallback `unknown` box; per-stage
     count populated from `failureStageDistribution`
   - **Latest case table** — case / source / outcome / stage chip /
     strategies (chip cluster) / probe verdict / artifact links
   - **Strategy ladder matrix** — rows = unique strategy ids, columns =
     ok / fail / steps / filled / latest detail / cases. Family-tinted.
     The single most useful surface for codex when fixing a strategy.
   - **Founder inputs needed** — bullet list of manual actions (OTP,
     CAPTCHA, final-confirm). Empty list = no founder action required.
   - **Footer** — generation timestamp + benchmark file + probe file +
     refresh button.
   - **No "run live" button** by design — only copy-paste commands.

4. ✅ **`lib/__tests__/resy-run-analysis.test.ts`** — **33 vitest cases**
   (task asked for 25+):
   - parseResyStrategyLines (8): all kinds + ignores opentable + null
     handling + leading punctuation
   - classifyFamily (3): rs-slot/phone/confirm + other prefixes
   - classifyFailureStage (8): all 8 priority branches incl.
     ready_for_confirmation early-out, OTP wins over phone-form,
     probe-vs-benchmark slot mismatch, etc.
   - decideVerdict (5): NEED_PROBE / RUN / DO_NOT_RUN-severe /
     OTP-founder-input / NEED_ARTIFACTS
   - display constants (2): VERDICT_LABEL exhaustive +
     FAILURE_STAGE_FUNNEL ordering
   - aggregateStrategyAttempts (2): grouping + empty
   - buildResyRunAnalysis fs integration (5): empty dirs / valid
     parse / malformed JSON / nextSafeCommand gating / artifact links

5. ✅ **`/dev` landing**: added `/dev/resy-run-analysis` as the FIRST
   entry under PHASE_0_ROUTES with explicit "answers four questions"
   blurb.

6. ✅ **`RESY_LIVE_DEBUG_PLAYBOOK.md`** (new doc) — how to read the
   workbench, when to allow a single live retry, when to STOP and ask
   codex to fix, founder-input checklist, explicit non-negotiable
   safety boundaries (no payment automation, no OTP bypass, no CAPTCHA
   bypass, never auto-confirm). Cross-links to all related docs.

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` — clean (exit 0)
- `npx vitest run lib/__tests__/resy-run-analysis.test.ts` — 33/33 passing

**Strictly NOT touched** (per task scope):
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `scripts/run-phase0-resy-benchmark.ts`
- `scripts/probe-resy-availability.ts`
- Any OpenAI / live runner invocation
- No new live-trigger button on any page (explicit task directive)
- Files on in-flight Track B branches (this branch is self-contained,
  not duplicative; cross-links to those routes work when they merge,
  page degrades gracefully if they 404)

## 📩 Acks for codex's recent pushes

### `74867e8 [coord] report Resy strategy ladder` ✅ THIS BRANCH BUILDS ON IT
### `49b5670 fix(resy): add form strategy ladder` ✅ CONSUMED THIS COMMIT

The form strategy ladder commit ships:
- 4 strategies on confirmation modal (locator / role / DOM main / DOM frame)
- 5 strategies on mobile/OTP form (main locator / frame locator / main DOM /
  frame DOM / mouse+keyboard visualization fallback)
- Each emits `[resy][strategy <id>] (ok|fail|step|filled) <detail>` —
  this branch's parser consumes that grammar verbatim.
- Mirrored to `worker/src/...`
- New `lib/__tests__/resy-provider-mobile.test.ts` 5/5 passing
- `npx tsx scripts/check-drift.ts` clean
- Probe re-confirms R-030 = 12 matching slots after ladder ship

### `024dd05 feat(resy): add no-token availability probe` ✅ CONSUMED EARLIER
### `1b7938e / ff84707` Resy availability classification ✅ CONSUMED EARLIER
### `149193b / 1ef97fb fix(resy): phone verify ladder` ✅ CONSUMED EARLIER

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions / status

### For this branch (`claude/resy-run-analysis-workbench`)

- **Strategy line grammar fidelity**: parser tolerates several variants
  (`ok` / `ok step X` / `fail Y` / `step Z` / `filled W` / leading `:`/
  `-` punctuation). If codex's actual emitter uses a stricter format,
  the parser will still match — and any line that doesn't is silently
  ignored (not failed). Tell me if you want strict mode.
- **Family prefix list**: hardcoded `rs-slot` / `rs-phone` / `rs-confirm`
  → family bucket; everything else → `other`. If you add e.g.
  `rs-availability` or `rs-cookie`, tell me which family they belong to.
- **Funnel order**: I picked an opinionated left-to-right ordering
  (probe → slot → form → OTP → confirm). Push back if the funnel
  should be re-ordered.
- **OTP doesn't downgrade verdict**: per § 7.5 transitional rule,
  `safe_handoff` w/ `F-PROVIDER-OTP` is acceptable per-case. I encode
  this by having `otp_or_login_required` NOT trigger `DO_NOT_RUN`
  alone — but it does add an explicit "OTP code" entry to
  `founderInputs`. Tell me if you want different.

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Review + merge `claude/coord-huddle-protocol` (HUDDLE protocol) | ⏳ pending |
| Review + merge `claude/opentable-email-preference` | ⏳ pending |
| Review + merge `claude/resy-observability-suite` | ⏳ pending (recommended merge before THIS branch so cross-links resolve) |
| Review + merge `claude/restaurant-readiness-control-center` | ⏳ pending (this branch's upstream sibling — readiness gives the verdict; this gives the strategy detail) |
| Review + merge **this branch** (`claude/resy-run-analysis-workbench`) | ⏳ pending |
| R-030 live retry decision | Pending founder go/no-go on token spend |
| Warm session PoC | Blocked until R-030 outcome (if `F-PROVIDER-OTP` → 启动) |

**Resolved this round** ✓
- Strategy log emission landed (codex `49b5670`) → workbench parses + visualizes

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `feat(dev): Resy Run Analysis Workbench — strategy ladder parser + failure-stage classifier + offline workbench` | UI/loader/tests/docs only. tsc clean. 33/33 tests passing. Parser consumes codex's `[resy][strategy …]` grammar verbatim. |
| `6bf3918` (unmerged) | `claude/restaurant-readiness-control-center` | Single-page burn-token go/no-go aggregator. This branch's sibling. |
| `df54c6b` (unmerged) | `claude/resy-observability-suite` | 3 dashboards + ArtifactRail. Independent. |
| `1d8ca6a` (unmerged) | `claude/coord-huddle-protocol` | HUDDLE protocol. Independent. |
| `998aaea` (unmerged) | `claude/opentable-email-preference` | OpenTable doc-block + SMS guard. Independent. |

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
    `scripts/probe-resy-availability.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
  - **Files on other in-flight Track B branches** (zero overlap policy)
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite / Computer Use / real booking submit
- **No "run live" button on any new page** (per task explicit directive)
- **No payment automation, no OTP bypass, no CAPTCHA bypass, never auto-confirm**
  (encoded in playbook + UI surfaces only show what's needed, never act)
- Every new task starts from latest branch (here: `codex/openai-chat-model-env`
  per task brief; otherwise `origin/master`)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `lib/benchmark/restaurant-readiness.ts` (Track B aggregator)
- `lib/benchmark/resy-run-analysis.ts` (Track B parser + workbench)
- `app/api/dev/restaurant-readiness/**`, `app/api/dev/resy-run-analysis/**` (Track B)
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs except runbook execution commands and Phase 0A/0B definitions
- `RESY_LIVE_DEBUG_PLAYBOOK.md` (Track B; codex consults but doesn't author)
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from latest origin/master (or codex working branch when consuming codex's in-flight work) · `origin/master:.coordination/codex.md`
- 2026-05-03 **Claude paused on new features** until Phase 0 + Phase 1 closed; observability + docs polish only
- 2026-05-03 **R-003 runbook commands + Phase 0A/0B definitions are codex domain**

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools
- **2026-05-04 Probe-first protocol** mandatory before next live R-* retry
- **2026-05-04 R-003 retry outcome = `no_availability_correct`** (NOT fill failure)
- **2026-05-04 R-030 = next recommended live case** (probe finding: 12 matching slots, exact venue match, party 2, 2026-05-08 20:00) · re-confirmed by codex `74867e8`
- **2026-05-04 Resy form strategy ladder shipped** (codex `49b5670`): 4 strategies confirmation modal + 5 strategies mobile/OTP form, each emits `[resy][strategy ...]` traceable lines
- **2026-05-04 Restaurant Readiness Control Center** at `/dev/restaurant-readiness` is the FIRST stop before any live R-* spend
- **2026-05-04 Resy Run Analysis Workbench** at `/dev/resy-run-analysis` is the strategy-ladder drill-down once a benchmark exists; complements readiness · this branch
- **2026-05-04 Non-negotiable safety boundaries** for any Phase 0+ work: no payment automation, no OTP bypass, no CAPTCHA bypass, never auto-confirm — encoded in `RESY_LIVE_DEBUG_PLAYBOOK.md`

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 0B (codex domain definition):**
- 2026-05-03 Phase 0B = Restaurant v1: Resy observed fixture suite + OpenTable Phase 0 coverage

**Phase 1 status:**
- 2026-05-03 **Phase 1 ~95% shipped** · `PHASE_1_PLAN.md`

**Phase 2 freeze:**
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B + Phase 1 declared

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer)

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100 real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round

**UI migration:**
- 2026-05-03 No "原来的 UI" deletion at Phase 1 boundary; deprecation queue with explicit删除 conditions
