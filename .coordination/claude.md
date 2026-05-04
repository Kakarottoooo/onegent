# Claude — coordination state

> **Branch**: `claude/phase-1-5-quality-gate-orchestrator` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 09:00 UTC
> **Last commit**: `f9d35f0` (Phase 1.5 Quality Gate orchestrator) +
> in-flight `claude.md` self-update with AGENT QUICKSTART preamble.
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at
> `origin/codex/openai-chat-model-env:.coordination/codex.md`.

---

## 🧭 AGENT QUICKSTART — read this first if you're picking up cold

> **Why this section exists**: the user explicitly asked for a place
> where "any future agent (me, codex, a fresh Claude session, a
> different coding tool) can quickly grasp the whole project without
> reading every code file." This is that place. Codex is in parallel
> doing a `docs/` information-architecture reorg
> (`codex/docs-information-architecture`) that will move root-level
> `.md` files into a layered hierarchy; until that lands, the file
> pointers below reference the **current** root-level locations. After
> the reorg, re-read this file's "📍 Strategic decisions locked"
> section for the new paths.

### What is Onegent (1-paragraph product context)

A consumer travel-booking automation product. User chats in natural
language ("book me Charlie Bird Thursday 8pm party of 2"); the NLU
extracts an `IntentState`, the chat-commit pipeline creates a
`booking_job`, and a Stagehand-based browser-autopilot drives the
provider site (Resy / OpenTable / Booking.com / Expedia hotels +
flights / activities) up to but **never past** the final-confirm /
payment / OTP wall — those stay strictly human-tap. Hybrid positioning:
NOT pure-infra, NOT pure-consumer. Pricing v0.1 launched: free 3
bookings/mo + 1 Decision Room/mo · Pro $9/mo or $79/yr · Stripe
sandbox configured, full E2E verified on prod 2026-04-27.

### Architecture stack (memorize these 6 nouns)

1. **Next.js 16 on Vercel** — UI + API routes (`app/**`, `app/api/**`).
2. **Neon Postgres** — single shared DB; both Vercel and Railway
   worker connect via `POSTGRES_URL`.
3. **Clerk auth** — cookie-based session in browser; the natural-tuna
   dev instance has 3 test accounts (ziweiA/B/C) for Decision Room
   multi-user tests.
4. **Railway worker** — `worker/src/booking-autopilot/` polls Neon
   with `FOR UPDATE SKIP LOCKED`, drives Playwright/Stagehand. Same
   provider code as `lib/booking-autopilot/` (intentional double; see
   below). Sprint 1 #1 deployed.
5. **Stripe** — payment, both test + live keys configured. NEVER
   automate payment forms; stop at CVV.
6. **Stagehand + Playwright + chromium** — local browser automation;
   Browserbase is a switchable target, NOT default. Browserbase Pro
   upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo OR cofounder OR
   seed round (locked decision).

**Double booking-autopilot rule (READ THIS, IT'S A SHARP CORNER)**:
`lib/booking-autopilot/` and `worker/src/booking-autopilot/` are
intentional duplicates. M5 force-gate routes restaurant/hotel/flight/
activity to the worker by default; lib/ is the in-process Vercel
fallback. **Any change to a provider in one MUST be mirrored in the
other**. CI guard: `npm run check-drift` (see `scripts/check-drift.ts`).
The drift detector is wired into GitHub Actions; PRs with drift fail.

### Track A vs Track B (the agent split)

| Side | Owner | Domain | Hold against the OTHER side |
|---|---|---|---|
| **Track A** | codex | `lib/booking-autopilot/**`, `lib/core/**`, `lib/execution-v2/**`, `worker/src/**`, `app/api/v1/**`, `app/api/booking-jobs/**`, `scripts/run-phase0-resy-benchmark.ts`, `scripts/probe-resy-availability.ts`, OpenTable / Resy / Expedia / Booking provider code, runtime / executor / state machine, Stripe / Clerk security boundaries, benchmark fixtures + `lib/benchmark/phase0-report.ts`, all live-OpenAI / Computer Use invocations | Don't touch from Track B |
| **Track B** | Claude (me) | `app/dev/**`, `app/api/dev/**`, `components/**`, `lib/agent/nlu-v2/**`, `lib/profile-gap-*`, `lib/founder-e2e/**`, `lib/quality-gate/**`, `scripts/run-founder-e2e.ts`, `scripts/run-phase1-quality-gate.ts`, `scripts/smoke-phase1.mjs`, all dashboards + observability + tests + docs, `lib/__tests__/**` (mostly) | Don't touch from Track A |

Allocation: codex 30-40% / Claude 60-70% (locked 2026-05-03). Claude
ships in bulk; codex reviews edges + auth + risk surface and merges
to master.

**Coordination protocol** (`CLAUDE.md` § 协作协议):
- `.coordination/codex.md` — codex writes, Claude reads. Lives on
  master + codex working branch.
- `.coordination/claude.md` — Claude writes (this file), codex reads.
  Lives on Claude's current branch.
- 5 commit-msg tags: `[handoff]` `[blocked]` `[unblocked]` `[shared]`
  `[coord]`. Optional but useful for `git log --oneline` scans.
- HUDDLE protocol v2 is in-flight on `claude/coord-huddle-protocol`
  but not yet merged.

### Phase status snapshot (as of 2026-05-04)

| Phase | State | One-line |
|---|---|---|
| **Phase 0A** | active | R-003 retry done (no_availability_correct, NOT fill failure). R-030 next live retry pending founder go/no-go on token spend. Probe runner (`npm run probe:resy`) shipped. Codex's strategy ladder (49b5670) covers 4 confirmation + 5 mobile/OTP. |
| **Phase 0B** | partly active | Restaurant v1 = Resy 22 observed rows → target 25 + OpenTable Phase 0 coverage. Codex domain. |
| **Phase 1** | ~95% shipped | 8 of 8 deltas in master (typecheck, PATCH, cookie-auth, UI merge, real /tasks/[taskId] wire, profile-gap path A+B, hardening, audit finding 5). #8 founder walkthrough sign-off pending — founder-e2e workbench AND autonomous runner now both available (waiting on codex review of 2 Track B PRs). |
| **Phase 1.5** | UX polish bucket | NEW: Quality Gate orchestrator just shipped on this branch (`f9d35f0`); founder QA workbench + autonomous runner pending review. |
| **Phase 2** | FROZEN | Vertical expansion (more providers / hotels deeper / flights). No leakage to master until Phase 0B + Phase 1 declared. |
| **Phase 3** | deferred | Inspire mode + 30-template gallery + B2B Lane C. |
| **Phase 4** | speculative | Data flywheel A+B do, C explicitly skip. Trigger ≥ 100 real bookings. |

### What every agent must know about safety (NON-NEGOTIABLE)

These are not opinions or flags. They're **build-time constraints**
enforced in code:

- **NO live OpenAI / Computer Use** automated runs except via codex's
  benchmark runner (`scripts/run-phase0-resy-benchmark.ts --case <id>
  --live-openai`) explicitly authorized by the user.
- **NO external booking provider live navigation** outside codex's
  benchmark runs. The autonomous founder e2e runner + the quality
  gate stay strictly local + mocked.
- **NO payment automation**, ever. Stop at CVV programmatically; stop
  at "Confirm" / "Pay" / final-tap. The provider modules enforce this.
- **NO OTP bypass**. Path D (warm session via Playwright storageState)
  is the strategy; Gmail OTP resume is fallback. Phone/SMS OTP is
  out-of-band, user types it.
- **NO CAPTCHA bypass**. Treat as terminal failure with clear UI.
- **NO auto dev-server / worker startup** from any script. Both
  conflict with codex's local worker session. `--start-server` is
  reserved-and-rejected on the founder e2e runner and the quality
  gate runner.
- **NO new "run live" buttons** in any dashboard. The user explicitly
  banned these.

If a future task description seems to ask for any of the above,
**stop and ask the user** — the user knows these are non-negotiable
and will tell you to do something different.

### Useful commands (script inventory)

```bash
# Build + verify
npx tsc --noEmit --pretty false           # typecheck
npm run test                              # vitest (default — runs all)
npm run check-drift                       # lib ↔ worker drift detector
npm run gate:phase1                       # NEW: one-command Phase 1 verdict
npm run gate:phase1 -- --include-smoke    #   + dev-server smoke
npm run gate:phase1 -- --include-e2e      #   + autonomous founder e2e
npm run gate:phase1 -- --allow-known-drift # downgrade pre-existing drift
npm run smoke:phase1                      # no-token Phase 1 surfaces smoke

# Manual + autonomous QA
npm run preflight:founder-e2e             # dev-server probe before walkthrough
npm run e2e:founder                       # autonomous Playwright runner
                                          #   (optional/--include-e2e on gate)

# Live (codex domain — DO NOT INVOKE FROM TRACK B)
npm run probe:resy                        # availability probe (no token)
npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003 --live-openai --allow-failures
                                          # live single-case — user-authorized only

# Dev
npm run dev > ./dev.log 2>&1              # Next dev (port 3000)
cd worker && npm run dev > ../worker.log 2>&1  # local worker (tsx watch)
```

### Key entry points (file pointers)

> **Caveat**: codex is reorganizing the root-level `.md` files into
> `docs/`. After the reorg lands, the doc paths below will move; the
> code paths stay.

**Frontend**:
- `app/page.tsx` — homepage chat (the consumer surface; path A + B).
- `app/tasks/[taskId]/page.tsx` — real task detail.
- `app/dev/page.tsx` — dev landing (lists all `/dev/*` routes).
- `app/dev/founder-e2e/` — manual QA workbench (Track B branch).
- `app/dev/phase1-quality-gates/` — Quality Gate dashboard (this branch).
- `app/dev/benchmark-runs/` — Phase 0 benchmark runs viewer.
- `app/dev/resy-probe-runs/` — Resy availability probe dashboard
  (Track B PR `claude/resy-observability-suite`, not yet merged).

**NLU + chat pipeline**:
- `lib/agent/nlu-v2/{types,extractor,router,chat,index}.ts` — 3-layer
  conversational pipeline (chat / extractor / router).
- `app/api/chat/parse/route.ts` — homepage NLU entry point.
- `app/api/chat/commit/route.ts` — commit IntentState → booking_job.
- `lib/profile-gap-decision.ts` + `lib/profile-gap-on-save.ts` —
  Phase 1 #7 path A/B helpers.

**Booking automation**:
- `lib/booking-autopilot/stagehand-executor.ts` — Vercel in-process
  executor (fallback path).
- `worker/src/booking-autopilot/stagehand-executor.ts` — Railway
  worker executor (default for restaurant/hotel/flight/activity).
- `lib/booking-autopilot/providers/{resy,opentable,expedia,booking-com,hotels-com}-com.ts`
  — provider modules (mirrored in worker/src/).
- `lib/booking-autopilot/ai-loop/fill-form.ts` — `fillGuestFormWithAI`,
  `fillFlightGuestFormWithAI`, `auditAndRefillEmptyFields`.
- See `CLAUDE.md` § "Booking Automation Architecture" for the
  3-layer pattern (programmatic nav + AI fill + AI audit).

**State machine + execution**:
- `lib/core/execution/{executor,recovery,recovery-providers}.ts` —
  generic step runner. **Codex domain.**
- `lib/execution-v2/` — Computer Use as default executor (post-pivot).
  **Codex domain.**

**Quality gates + observability** (Track B):
- `lib/founder-e2e/{checklist,fixtures,loader,runner-report,index}.ts`
  — manual + autonomous founder E2E (on 2 unmerged Track B PRs).
- `lib/quality-gate/{report,loader,runner-helpers,index}.ts` —
  Phase 1.5 Quality Gate (this branch).
- `scripts/run-founder-e2e.ts` — autonomous founder runner.
- `scripts/run-phase1-quality-gate.ts` — Quality Gate runner.

**Strategy / runbook docs (root-level today, moving into `docs/`)**:
- `PROJECT_SUMMARY.md` — high-level state + architecture (oversized;
  codex plans to compress in reorg phase 2).
- `PHASE_STATUS.md` — phase completion + blockers.
- `PHASE_1_PLAN.md` / `PHASE_1_FOUNDER_E2E.md` / `PHASE_1_E2E_SMOKE.md`
  / `PHASE_1_QUALITY_GATE.md` (NEW) — Phase 1 specs + walkthroughs.
- `BENCHMARK_RESTAURANT_100.md` — Phase 0 acceptance gate spec
  (codex domain).
- `R003_LIVE_SMOKE_RUNBOOK.md` — codex's live retry runbook.
- `WARM_SESSION_STRATEGY.md` — OTP path D doc (BLOCKED on R-003 outcome).
- `EXECUTOR_V2_PIVOT.md` — why Computer Use as default.
- `NLU_CONSUMER_CONTRACT.md` — chat panel ↔ NLU v2 contract.
- `FEATURE_MAP.md` — product/page/button map.
- `RESTAURANT_PHASE0_HANDOFF.md` — codex's restaurant handoff guide.

### Branch landscape (8 Track B PRs awaiting codex review)

| Branch | Tip | What it ships |
|---|---|---|
| `claude/coord-huddle-protocol` | `1d8ca6a` | HUDDLE.md + STRATEGIC_LEDGER.md + CLAUDE.md § 协作协议 v2 |
| `claude/opentable-email-preference` | `998aaea` | SMS marketing checkbox auto-uncheck + 2 policy tests |
| `claude/resy-observability-suite` | `df54c6b` | /dev/resy-probe-runs + ArtifactRail + /dev/debug-artifacts polish |
| `claude/restaurant-readiness-control-center` | `6bf3918` | /dev/restaurant-readiness burn-token go/no-go aggregator |
| `claude/resy-run-analysis-workbench` | `2718a52` | /dev/resy-run-analysis 6-panel strategy-ladder workbench |
| `claude/phase-1-5-founder-qa-suite` | `a0bd2db` | /dev/founder-e2e manual QA workbench (superseded by next) |
| `claude/autonomous-founder-e2e-runner` | `ad11731` | autonomous `npm run e2e:founder` Playwright + dashboard upgrade |
| `claude/phase-1-5-quality-gate-orchestrator` | `f9d35f0` | THIS BRANCH — `npm run gate:phase1` orchestrator + dashboard |

All independent (no inter-PR dependencies). Codex reviews per branch
on his cycle. None merged to master yet (counts checked
2026-05-04). Codex is currently on `codex/docs-information-architecture`
in a parallel worktree doing the docs reorg.

### Session-start ritual (run this every time you pick up cold)

```bash
git fetch origin
git --no-pager show origin/codex/openai-chat-model-env -- .coordination/codex.md
                                          # NOT `<rev>:<path>` — PowerShell colon trap
git --no-pager show origin/master -- .coordination/codex.md
                                          # codex.md on master is canonical for shipped work
cat .coordination/claude.md               # this file
git --no-pager log --oneline -10          # recent commits
git --no-pager branch -r | grep claude/   # check Track B branch list
```

Then: ask the user what task to pick up. **Don't assume from
context** — claude.md describes what's true at last-write, the user
may have shifted priority since.

### When to update which file (maintenance rules)

| Trigger | Update |
|---|---|
| Start a new task | `.coordination/claude.md` § 🟢 Currently doing |
| Finish a task | Move to § 📦 Recently shipped, clear § 🟢 |
| Hit a blocker | Add to § ⏳ Blocking on codex with concrete ask |
| Codex unblocks me | Remove from § ⏳, ack in § 📦 with `[unblocked]` |
| Lock a strategic decision | Add to § 📍 Strategic decisions locked + pointer to canonical doc |
| New phase milestone | `PHASE_STATUS.md` (until codex moves it to `docs/00-start-here/`) |
| Provider debug learning | Will go into `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` post-reorg |
| Project history compaction | `PROJECT_SUMMARY_ARCHIVE_<quarter>.md` |

**Don't write the same info to two places.** Pick the most-specific
location (phase plan / runbook / coordination) and put it there once.

### What the user values (calibration cues)

Pulled from `CLAUDE.md` § 沟通与协作原则:

1. **先讨论，再执行**. The user often expresses tasks ambiguously —
   ask clarifying questions before launching into 1000+ LOC.
2. **多方案+ 名人参照**. At decision points, give 2-3 options with
   tradeoffs + cite a named expert (Linus / Kent Beck / Paul Graham
   / etc.) for one of them.
3. **追根溯源 + 主动汇报状态**. Don't fix surface symptoms; find root
   cause. Report status proactively, even unprompted.
4. **只谈任务，不谈时间**. Never say "today/tomorrow/tonight". Just
   talk about tasks and their completion.
5. **永远不建议暂停推进**. Don't suggest "let's stop for tonight" or
   "freeze this" or "I think you've done enough" — the only valid
   pause is a real external blocker.

UI quality bar: Apple / Linear / Stripe tier for user-facing surfaces;
don't ship simple-and-done. Dev surfaces (`/dev/*`) can be functional-
leaning but still need to be readable.

Git: every completed task → `git add <files>` + descriptive commit
+ `git push` immediately. Don't wait for explicit "commit" prompt.

---

## 🟢 Currently doing

**Phase 1.5 Quality Gate orchestrator** — turn the scattered Phase 1
verification commands (tsc / vitest / smoke / e2e:founder / check-drift)
into one repeatable, savable, viewable gate. Founder runs `npm run
gate:phase1` and gets a single verdict + paste-ready markdown report
without having to remember a half-dozen commands. Branched from
`origin/codex/openai-chat-model-env @ f1341ee` per user direction.

This commit ships:

1. **`lib/quality-gate/`** module:
   - `report.ts` — pure types + verdict logic + markdown formatter +
     filename safety. ~620 LOC, zero IO.
   - `loader.ts` — file IO with lazy `getQualityGateRunsDir()` (mirrors
     the founder-e2e fix for cwd-swap tests) + path-traversal guards.
   - `runner-helpers.ts` — argv parser + `defineChecks(flags)` pure
     function + `statusSymbol` / `makeRunIdFromIso` / `normalizeBaseUrl`.
   - `index.ts` — barrel.

2. **`scripts/run-phase1-quality-gate.ts`** — orchestrator
   (subprocess only):
   - Probes dev server with HEAD + 2.5s timeout (only when an
     `--include-*` flag asked for it).
   - Runs each `CheckSpec` via `child_process.spawn` with
     `shell:true` (cross-platform); per-check timeouts; bounded
     stdout/stderr capture; truncates to `GATE_TAIL_BYTES` on exit.
   - Builds a `QualityGateRun` via the pure `buildQualityGateRun`,
     writes `.json` + `.md`, optionally POSTs to the dev API.
   - Emits a terminal banner OR a JSON dump (under `--json`).
   - `--start-server` is rejected (would collide with codex's local
     worker / Next dev session).

3. **Required vs optional check matrix** (per founder lock-in
   2026-05-04):
   - **Required (verdict-blocking)**: `tsc`, 7 targeted vitest files
     including the new `vitest:flight-time-filter` (Phase 1 founder
     bug regression canary), `vitest:quality-gate` self-test, and
     `check-drift`. P0 severity for shipping-critical IDs; P1 for
     `check-drift`.
   - **Optional** (only when `--include-smoke` / `--include-e2e`):
     `preflight:founder-e2e`, `e2e:founder`, `smoke:phase1`. Need
     dev server.
   - **`--allow-known-drift`** (or env
     `QUALITY_GATE_KNOWN_DRIFT=1`): downgrades a `check-drift` fail
     to `known_existing_failure`, keeping the gate from going
     permanently red while pre-existing drift in
     `lib/booking-autopilot/dry-run.ts` ↔ `worker/src/...` is
     codex's domain.

4. **5-state verdict + 4 exit codes**:
   - `pass` (exit 0) — every check pass.
   - `needs_polish` (exit 0) — informational; required pass but
     optional fail/skip OR known_existing_failure OR a non-env
     required skip (e.g. test file missing on this branch).
   - `fail` (exit 1) — any required check failed.
   - `env_blocked` (exit 2) — `--include-*` flag set + dev server
     down. Operator asked for it; env can't deliver.
   - `(internal error)` (exit 3) — orchestrator itself blew up;
     `--start-server` hits this.

5. **Dev API + dashboard**:
   - `app/api/dev/phase1-quality-gates/route.ts` — GET list,
     GET ?file=…, POST save. Dev-gated via existing
     `ENABLE_DEV_BENCHMARK_API` pattern (mirrors
     `/api/dev/benchmark-runs/route.ts`). Defense-in-depth path
     traversal: `isSafeQualityGateFileName` regex + `path.resolve`
     prefix check + `parseQualityGateRun` schema validation on
     POST.
   - `app/dev/phase1-quality-gates/page.tsx` — client component:
     copy-command rail, latest-run verdict card, expandable
     per-check stdout/stderr, paste-ready markdown textarea,
     saved-runs table with click-to-load. No live booking / token
     / payment buttons.

6. **158 tests**, all passing:
   - `lib/__tests__/quality-gate-report.test.ts` — 130+ tests on
     pure logic: tail truncation / classify / verdict matrix /
     sanitize / build / summarize / parse / filename safety /
     markdown formatting / loader fs (under tmp cwd swap) /
     display constants.
   - `lib/__tests__/quality-gate-runner.test.ts` — 28 tests on
     argv parsing, `defineChecks` flag combinations,
     `statusSymbol`, `makeRunIdFromIso`, `normalizeBaseUrl`.

7. **Docs + UX wiring**:
   - `PHASE_1_QUALITY_GATE.md` — runbook + verdict ladder +
     severity ladder + triage routing + safety rails.
   - `PHASE_STATUS.md` § "Phase 1.5" — Quality Gate paragraph
     added.
   - `app/dev/page.tsx` — `/dev/phase1-quality-gates` added as
     the **first** Phase 0/1 critical-path entry.
   - `package.json` — `gate:phase1` + `gate:phase1:json` scripts
     using existing `npx tsx` pattern.
   - `.gitignore` — `benchmark/runs/*.md` added next to existing
     `*.json` rule.

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` clean.
- `npx vitest run lib/__tests__/quality-gate-*.test.ts` — 158/158
  passing.

**Strictly NOT touched** (hold rules respected):
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- `scripts/run-phase0-resy-benchmark.ts`
- `scripts/probe-resy-availability.ts`
- OpenTable / Resy / Expedia / Booking.com provider code
- Any live OpenAI / Computer Use / payment / OTP / CAPTCHA /
  final-confirm interaction (the orchestrator enforces these as
  build-time boundaries — no flag overrides them)

## 📍 Strategic decisions locked

- 2026-05-04 Phase 1.5 has TWO surfaces: **autonomous Quality
  Gate** (`npm run gate:phase1` for build-time signals) +
  **manual founder E2E workbench** (`/dev/founder-e2e` for human
  walkthrough). The Quality Gate is the FIRST thing to run on a
  Track B branch; the founder E2E surfaces the human-judgment
  side. · doc: `PHASE_1_QUALITY_GATE.md` (this branch) +
  `AUTONOMOUS_FOUNDER_E2E.md` (claude/autonomous-founder-e2e-runner)
- 2026-05-04 Quality Gate verdict ladder: `pass` /
  `needs_polish` / `fail` / `env_blocked` with exit codes
  0/0/1/2. CI-friendly — green on `needs_polish` so optional /
  known issues don't block PRs.
- 2026-05-04 `known_existing_failure` escape hatch via
  `--allow-known-drift` is the correct response to pre-existing
  codex-domain drift; do NOT overwrite codex files to "fix"
  drift on Track B branches. (Active today: `dry-run.ts`
  lib↔worker.)
- 2026-05-04 Quality Gate **safety rails are non-negotiable**:
  no live OpenAI, no provider, no payment, no OTP, no CAPTCHA,
  no auto-server-start. These are build-time constraints, not
  flags.
- 2026-05-04 `vitest:flight-time-filter` is the Phase 1
  founder-bug canary — locked into the required set per founder
  direction.
- 2026-05-03 Phase 1.5 Founder QA Suite & autonomous founder e2e
  runner are pending codex review (branches
  `claude/phase-1-5-founder-qa-suite` +
  `claude/autonomous-founder-e2e-runner`). This Quality Gate
  does NOT depend on them; it detects them at runtime via
  vitest target globs + package.json script presence.
- 2026-05-03 Track B file ownership (still active):
  `lib/quality-gate/**`, `app/dev/**`, `app/api/dev/**`,
  `scripts/run-phase1-quality-gate.ts`, `lib/founder-e2e/**`,
  `components/**`, `lib/agent/nlu-v2/**`, `lib/profile-gap-*`,
  docs.
- 2026-05-03 Codex 30-40% / Claude 60-70% allocation; Claude
  does bulk implementation, codex reviews edges + auth + risk
  surface. · `CLAUDE.md` § 协作协议
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 ·
  `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B +
  Phase 1 declared · `PHASE_STATUS.md`

## ⏳ Blocking on codex

(none for this branch directly — the Quality Gate is fully
self-contained.)

Cross-branch:
- 7 prior Track B PRs awaiting review/merge:
  `coord-huddle-protocol` / `opentable-email-preference` /
  `resy-observability-suite` /
  `restaurant-readiness-control-center` /
  `resy-run-analysis-workbench` /
  `phase-1-5-founder-qa-suite` /
  `autonomous-founder-e2e-runner`. None are blockers for this
  branch; all are independent.
- Drift in `lib/booking-autopilot/dry-run.ts` ↔
  `worker/src/booking-autopilot/dry-run.ts` is codex's call to
  resolve (or accept and document). The Quality Gate's
  `--allow-known-drift` flag is the documented workaround in the
  meantime.

## 📦 Recently shipped

| Commit | Subject | Notes for codex |
|---|---|---|
| (this) | `feat(quality-gate): Phase 1.5 orchestrator + dashboard + 158 tests` | New `npm run gate:phase1`. Pure logic in `lib/quality-gate/`; orchestrator in `scripts/run-phase1-quality-gate.ts`; dashboard at `/dev/phase1-quality-gates`. No code in your domain touched. Dev API gated by `ENABLE_DEV_BENCHMARK_API`. Self-tests `vitest:quality-gate` are themselves a required check. |

## 🤝 Open questions for codex

- **Drift policy**: do you want me to auto-pass
  `--allow-known-drift` in CI for Track B PRs that don't touch
  booking-autopilot/worker files? Or should every Track B PR
  fail-loud until you fix the underlying drift?
- **Severity calibration**: I locked `check-drift` as P1
  (required + not in shipping-critical set). If you want to
  push it to P0 (block-everything), one constant flip in
  `SHIPPING_CRITICAL_IDS`. Conversely, if you prefer it as a P2
  optional, change its `requirement` to `optional` in
  `defineChecks()`.
- **Smoke vs E2E default**: I made both opt-in
  (`--include-smoke` / `--include-e2e`) so the default gate
  stays env-independent. If you want one of them in the default
  required set when dev server IS up, easy to switch.

## 🚧 Hold rules I'm respecting

- No edits to provider / runtime / executor / benchmark domains.
- No new "run live" buttons anywhere.
- No automatic dev-server / worker startup.
- No payment / OTP / CAPTCHA / final-confirm interaction (gate
  enforces; rails documented in `PHASE_1_QUALITY_GATE.md`).
- New Phase 0 features paused; this is observability + dev
  ergonomics work only.

## 🗂 Track B file ownership (touched on this branch)

- `lib/quality-gate/{report,loader,runner-helpers,index}.ts`
  (NEW)
- `lib/__tests__/quality-gate-{report,runner}.test.ts` (NEW)
- `scripts/run-phase1-quality-gate.ts` (NEW)
- `app/api/dev/phase1-quality-gates/route.ts` (NEW)
- `app/dev/phase1-quality-gates/page.tsx` (NEW)
- `app/dev/page.tsx` (added entry to PHASE_0_ROUTES)
- `package.json` (added 2 scripts)
- `.gitignore` (added `benchmark/runs/*.md`)
- `PHASE_1_QUALITY_GATE.md` (NEW)
- `PHASE_STATUS.md` (added Phase 1.5 § Quality Gate paragraph)
- `.coordination/claude.md` (this file)
