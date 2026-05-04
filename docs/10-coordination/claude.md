# Claude — coordination state

> **Branch**: `claude/integrated-preview-review-20260504` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 09:30 UTC
> **Last commit**: integration cleanup (R2 STRATEGIC_LEDGER merge + R3 claude.md preamble restore + R4 INDEX cross-ref scan)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at
> `docs/10-coordination/codex.md` (this branch) and on
> `origin/codex/openai-chat-model-env`.

---

## 🧭 AGENT QUICKSTART — read this first if you're picking up cold

> **Why this section exists**: any future agent (me, codex, fresh
> Claude session, a different coding tool) needs to grasp the whole
> project in one read without scanning every code file. This is that
> place. The integration preview branch
> `codex/integrated-preview-20260504` has merged 8 Track B PRs + the
> docs/ reorganization, so the file pointers below are the **current,
> canonical** locations. Start with `docs/INDEX.md` for the
> task-routing table; then read this preamble; then the
> "🟢 Currently doing" section below for what the active branch is
> shipping.

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
   seed round (locked decision · STRATEGIC_LEDGER § Infra).

**Double booking-autopilot rule (READ THIS, IT'S A SHARP CORNER)**:
`lib/booking-autopilot/` and `worker/src/booking-autopilot/` are
intentional duplicates. M5 force-gate routes restaurant/hotel/flight/
activity to the worker by default; lib/ is the in-process Vercel
fallback. **Any change to a provider in one MUST be mirrored in the
other**. CI guard: `npm run check-drift` (see `scripts/check-drift.ts`).
The drift detector is wired into GitHub Actions; PRs with drift fail.
Pre-existing drift on `dry-run.ts` is acknowledged; gate runner has
`--allow-known-drift` flag for Track B PRs that don't touch
booking-autopilot.

### Track A vs Track B (the agent split)

| Side | Owner | Domain | Hold against the OTHER side |
|---|---|---|---|
| **Track A** | codex | `lib/booking-autopilot/**`, `lib/core/**`, `lib/execution-v2/**`, `worker/src/**`, `app/api/v1/**`, `app/api/booking-jobs/**`, `scripts/run-phase0-resy-benchmark.ts`, `scripts/probe-resy-availability.ts`, OpenTable / Resy / Expedia / Booking provider code, runtime / executor / state machine, Stripe / Clerk security boundaries, benchmark fixtures + `lib/benchmark/phase0-report.ts`, all live-OpenAI / Computer Use invocations | Don't touch from Track B |
| **Track B** | Claude (me) | `app/dev/**`, `app/api/dev/**`, `components/**`, `lib/agent/nlu-v2/**`, `lib/profile-gap-*`, `lib/founder-e2e/**`, `lib/quality-gate/**`, `scripts/run-founder-e2e.ts`, `scripts/run-phase1-quality-gate.ts`, `scripts/smoke-phase1.mjs`, all dashboards + observability + tests + docs, `lib/__tests__/**` (mostly) | Don't touch from Track A |

Allocation: codex 30-40% / Claude 60-70% (locked 2026-05-03 ·
STRATEGIC_LEDGER § Team / role allocation). Claude ships in bulk;
codex reviews edges + auth + risk surface and merges to master.

**Coordination protocol** (`CLAUDE.md` § 协作协议):
- `docs/10-coordination/codex.md` — codex writes, Claude reads.
- `docs/10-coordination/claude.md` — Claude writes (this file),
  codex reads.
- `docs/10-coordination/HUDDLE.md` — shared 2k-word working memory.
- `docs/10-coordination/STRATEGIC_LEDGER.md` — append-only long-term
  decision log (canonical; never trimmed).
- 5 commit-msg tags: `[handoff]` `[blocked]` `[unblocked]` `[shared]`
  `[coord]`. Optional but useful for `git log --oneline` scans.

### Phase status snapshot (as of 2026-05-04)

| Phase | State | One-line |
|---|---|---|
| **Phase 0A** | active | R-003 retry done (no_availability_correct, NOT fill failure). R-030 next live retry pending founder go/no-go on token spend. Probe runner (`npm run probe:resy`) shipped. Codex's strategy ladder (49b5670) covers 4 confirmation + 5 mobile/OTP. |
| **Phase 0B** | partly active | Restaurant v1 = Resy 22 observed rows → target 25 + OpenTable Phase 0 coverage. Codex domain. |
| **Phase 1** | ~95% shipped | 8 of 8 deltas in master (typecheck, PATCH, cookie-auth, UI merge, real /tasks/[taskId] wire, profile-gap path A+B, hardening, audit finding 5). #8 founder walkthrough sign-off pending — founder-e2e workbench AND autonomous runner now both available. |
| **Phase 1.5** | UX polish + Quality Gate | Quality Gate orchestrator shipped (`npm run gate:phase1`); founder QA workbench + autonomous runner shipped. All merged into integration preview branch. |
| **Phase 2** | FROZEN | Vertical expansion. No leakage to master until Phase 0B + Phase 1 declared. |
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
npm run gate:phase1                       # one-command Phase 1 verdict
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

> **Caveat**: paths below reflect the **post-reorg** layout from
> `codex/integrated-preview-20260504`. If you're reading this on
> master before the integration lands, some `docs/` paths still
> point at root locations. Always cross-check with `docs/INDEX.md`.

**Frontend**:
- `app/page.tsx` — homepage chat (the consumer surface; path A + B).
- `app/tasks/[taskId]/page.tsx` — real task detail.
- `app/dev/page.tsx` — dev landing (lists all `/dev/*` routes).
- `app/dev/founder-e2e/` — manual QA workbench.
- `app/dev/phase1-quality-gates/` — Quality Gate dashboard.
- `app/dev/restaurant-readiness/` — burn-token go/no-go aggregator.
- `app/dev/resy-run-analysis/` — strategy-ladder drill-down.
- `app/dev/resy-probe-runs/` — Resy availability probe dashboard.
- `app/dev/benchmark-runs/` — Phase 0 benchmark runs viewer.
- `app/dev/debug-artifacts/` — worker debug screenshots viewer.

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
  — manual + autonomous founder E2E.
- `lib/quality-gate/{report,loader,runner-helpers,index}.ts` —
  Phase 1.5 Quality Gate.
- `scripts/run-founder-e2e.ts` — autonomous founder runner.
- `scripts/run-phase1-quality-gate.ts` — Quality Gate runner.

**Strategy / runbook docs** (under `docs/`):
- `docs/INDEX.md` — entrypoint for any new agent session.
- `docs/00-start-here/PROJECT_SUMMARY.md` — high-level state +
  architecture.
- `docs/00-start-here/PHASE_STATUS.md` — phase completion + blockers.
- `docs/00-start-here/FEATURE_MAP.md` — product/page/button map.
- `docs/40-phase1/PHASE_1_PLAN.md` /
  `docs/40-phase1/PHASE_1_FOUNDER_E2E.md` /
  `docs/40-phase1/PHASE_1_E2E_SMOKE.md` /
  `docs/40-phase1/PHASE_1_QUALITY_GATE.md` /
  `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` /
  `docs/40-phase1/FOUNDER_E2E_BUG_TRIAGE.md` —
  Phase 1 specs, walkthroughs, gate, autonomous runner, severity
  ladder.
- `docs/20-phase0-restaurant/BENCHMARK_RESTAURANT_100.md` — Phase 0
  acceptance gate spec (codex domain).
- `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md` — codex's
  live retry runbook.
- `docs/20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md` —
  probe-first protocol.
- `docs/20-phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md` — Resy
  live-debug playbook.
- `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md` — codex's
  restaurant handoff guide.
- `docs/20-phase0-restaurant/WARM_SESSION_STRATEGY.md` — OTP path D
  doc (BLOCKED on R-003 outcome).
- `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` —
  generic provider runtime debug.
- `docs/30-provider-debug/EXECUTOR_V2_PIVOT.md` — why Computer Use as
  default.
- `docs/50-product-areas/NLU_CONSUMER_CONTRACT.md` — chat panel ↔
  NLU v2 contract.

### Branch landscape (after integration preview)

| Branch | Tip | What |
|---|---|---|
| `master` | `be97b8d` | last clean stable; missing all 8 Track B PRs that landed in the integration preview |
| `codex/integrated-preview-20260504` | `6e0294c` | merges all 8 Track B PRs + codex's docs reorg. The integration target. |
| `codex/openai-chat-model-env` | `f1341ee` | codex's working branch (Resy/OpenTable/Expedia provider hardening) |
| `claude/integrated-preview-review-20260504` | this branch | review + integration cleanup of the integration preview |

The 8 source PRs (now merged into the integration preview):
- `claude/coord-huddle-protocol` (HUDDLE.md + STRATEGIC_LEDGER.md)
- `claude/opentable-email-preference` (SMS marketing checkbox)
- `claude/resy-observability-suite` (3 dashboards)
- `claude/restaurant-readiness-control-center` (burn-token gate)
- `claude/resy-run-analysis-workbench` (strategy-ladder drill-down)
- `claude/phase-1-5-founder-qa-suite` (manual QA workbench;
  superseded by autonomous-founder-e2e-runner)
- `claude/autonomous-founder-e2e-runner` (autonomous runner)
- `claude/phase-1-5-quality-gate-orchestrator` (Quality Gate)

### Session-start ritual (run this every time you pick up cold)

```bash
git fetch origin
cat docs/INDEX.md                         # task-routing table first
cat docs/10-coordination/HUDDLE.md        # 2k-word working memory
git --no-pager show origin/codex/openai-chat-model-env -- docs/10-coordination/codex.md
                                          # codex side latest
cat docs/10-coordination/claude.md        # this file
git --no-pager log --oneline -10          # recent commits
git --no-pager branch -r | grep claude/   # check Track B branch list
```

Then: ask the user what task to pick up. **Don't assume from
context** — claude.md describes what's true at last-write, the user
may have shifted priority since.

### When to update which file (maintenance rules · also in INDEX.md)

| Trigger | Update |
|---|---|
| Start a new task | `docs/10-coordination/claude.md` § 🟢 Currently doing |
| Finish a task | Move to § 📦 Recently shipped, clear § 🟢 |
| Hit a blocker | Add to § ⏳ Blocking on codex with concrete ask |
| Codex unblocks me | Remove from § ⏳, ack in § 📦 with `[unblocked]` |
| Lock a strategic decision | Add to `docs/10-coordination/STRATEGIC_LEDGER.md` |
| New phase milestone | `docs/00-start-here/PHASE_STATUS.md` |
| Provider debug learning | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` |
| Project history compaction | `docs/90-archive/PROJECT_SUMMARY_*` |
| Plan completed | Move to `docs/90-archive/completed-plans/` |

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

**Integration preview review + cleanup** of
`codex/integrated-preview-20260504`. Codex merged 8 Track B PRs +
his docs reorg into a single integration branch. I'm on
`claude/integrated-preview-review-20260504` doing dogfood + integration
bug fixes.

This branch has shipped:

1. **First commit `ac51c87`** — moved 5 stray root `.md` files into
   their canonical `docs/` subdirs per the rule documented in
   `docs/INDEX.md`:
   - `PHASE_1_QUALITY_GATE.md` → `docs/40-phase1/`
   - `AUTONOMOUS_FOUNDER_E2E.md` → `docs/40-phase1/`
   - `FOUNDER_E2E_BUG_TRIAGE.md` → `docs/40-phase1/`
   - `RESY_AVAILABILITY_PROBE_PROTOCOL.md` → `docs/20-phase0-restaurant/`
   - `RESY_LIVE_DEBUG_PLAYBOOK.md` → `docs/20-phase0-restaurant/`
   - cross-ref fix in `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` for
     the spanning `../20-phase0-restaurant/` references.

2. **This commit** — R2 + R3 + R4 cleanup:
   - **R2**: merged root `STRATEGIC_LEDGER.md` (rich, ~140 lines)
     into the canonical `docs/10-coordination/STRATEGIC_LEDGER.md`
     (was a 26-line stub). Preserved all rich-version metadata +
     update protocol + phase-sectioned entries; absorbed 5 unique
     2026-05-04 entries from the stub into the merged file's
     "Documentation architecture" + "Phase 0 / engineering doctrine"
     sections; `git rm` root duplicate. Single canonical ledger.
   - **R3**: restored AGENT QUICKSTART preamble (the 11-section
     project bible) into this file from
     `claude/phase-1-5-quality-gate-orchestrator @ 01f116a`. Branch
     metadata + "Currently doing" updated to integration-preview
     state. Old founder-e2e-polish acks/blockers archived (those
     PRs are merged via the integration branch).
   - **R4**: scanned `docs/INDEX.md` cross-refs; no path updates
     needed (INDEX uses bare canonical-file paths and they all
     resolve in `docs/`). Verified root `.md` only contains repo-
     level entrypoints (`AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`,
     `README.md`).

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` clean.
- `npm run gate:phase1 -- --allow-known-drift` exit 0; verdict
  `needs_polish` (only check-drift downgraded; 8/8 other required
  pass).
- Root `.md` inventory matches the INDEX rule.
- `grep -rn "<<<<<<< " .` returns no merge-conflict markers.

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
  final-confirm interaction
- Did NOT edit `docs/INDEX.md`, `docs/10-coordination/codex.md`,
  `docs/10-coordination/HUDDLE.md`, `docs/10-coordination/README.md`
  (codex domain).

## ⏳ Blocking on codex

(none from this branch directly. Integration branch + this review
both await codex review/merge.)

## 📦 Recently shipped

| Commit | Subject | Notes for codex |
|---|---|---|
| (this) | `[coord] R2 STRATEGIC_LEDGER merge + R3 claude.md preamble restore + R4 link scan` | Single canonical STRATEGIC_LEDGER at `docs/10-coordination/`; AGENT QUICKSTART preamble restored to claude.md; root .md back to entrypoints-only. tsc + gate green. No code in your domain touched. |
| `ac51c87` | `[coord] move 5 stray root .md files into docs/ per INDEX rule` | Filled the gap in codex's reorg — 5 PRs landed at root post-reorg; this commit moved them into the docs/ structure they were meant to live in. |

Earlier (Track B PRs now merged via integration preview):
- `claude/coord-huddle-protocol @ 1d8ca6a` — HUDDLE.md +
  STRATEGIC_LEDGER.md (initial); merged via integration `c5c4233`.
- `claude/opentable-email-preference @ 998aaea` — SMS marketing
  guard; merged via integration `81f4845`.
- `claude/resy-observability-suite @ df54c6b` — 3 dashboards; merged
  via integration `d2a8a45`.
- `claude/restaurant-readiness-control-center @ 6bf3918` — gate
  aggregator; merged via integration `9dcb514`.
- `claude/resy-run-analysis-workbench @ 2718a52` — workbench; merged
  via integration `4be4131`.
- `claude/phase-1-5-founder-qa-suite @ a0bd2db` — manual workbench;
  superseded; merged via integration (no separate row needed).
- `claude/autonomous-founder-e2e-runner @ ad11731` — autonomous
  runner; merged via integration `0c4a028`.
- `claude/phase-1-5-quality-gate-orchestrator @ 01f116a` — Quality
  Gate; merged via integration `c3dba22`.

## 🤝 Open questions for codex

- **Drift policy**: should Track B PRs auto-pass `--allow-known-drift`
  in CI, or fail-loud until the booking-autopilot drift is resolved?
- **Severity calibration**: `check-drift` is currently P1 (required +
  not in shipping-critical set). One constant flip in
  `SHIPPING_CRITICAL_IDS` to push it to P0 if you want.
- **Smoke vs E2E default**: both opt-in (`--include-smoke` /
  `--include-e2e`); easy to flip if you want one of them required
  when dev server is up.
- **R3 done conservatively**: I rewrote `docs/10-coordination/claude.md`
  rather than mechanically restoring `01f116a` content, so that branch
  metadata + "Currently doing" reflect THIS branch's reality.
  Strategic-decisions content has been moved entirely into
  `STRATEGIC_LEDGER.md` per the maintenance rule "don't write the
  same info to two places". If you prefer claude.md to keep its own
  full Strategic-decisions section as a snapshot, easy to add back.

## 🚧 Hold rules I'm respecting

- Never merge to master directly.
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `app/api/booking-jobs/**`,
    `scripts/run-phase0-resy-benchmark.ts`,
    `scripts/probe-resy-availability.ts`,
    `docs/20-phase0-restaurant/BENCHMARK_RESTAURANT_100.md`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
- Don't run `npm run dev` or worker (would interfere with codex E2E).
- Don't run live OpenAI calls.
- Don't run 25-case suite.
- **No Phase 2 vertical implementation** (codex's directive 2026-05-03).
- **No new features**; integration cleanup + observability + docs
  polish only until Phase 0 + 1 closed.
- **Don't modify** `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
  execution commands or `docs/00-start-here/PHASE_STATUS.md` Phase
  0A/0B definitions (codex's directive 2026-05-03 post-`88e7ecd`).

## 🗂 Track B file ownership (touched on this branch)

This branch:
- `docs/10-coordination/claude.md` (this file; rewrite)
- `docs/10-coordination/STRATEGIC_LEDGER.md` (rich-version merge;
  canonical)
- `STRATEGIC_LEDGER.md` (root; deleted)

Earlier commit on this branch (`ac51c87`):
- `docs/40-phase1/{PHASE_1_QUALITY_GATE, AUTONOMOUS_FOUNDER_E2E, FOUNDER_E2E_BUG_TRIAGE}.md` (renamed from root)
- `docs/20-phase0-restaurant/{RESY_AVAILABILITY_PROBE_PROTOCOL, RESY_LIVE_DEBUG_PLAYBOOK}.md` (renamed from root)
- `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` (1 cross-ref line)

Long-term Track B file ownership (steady-state):
- `components/profile-gap/**`, `components/benchmark/**`,
  `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/api/dev/**`, `app/tasks/[taskId]/**`,
  `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`,
  `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`,
  `lib/founder-e2e/**`, `lib/quality-gate/**`
- `scripts/smoke-phase1.mjs`, `scripts/run-founder-e2e.ts`,
  `scripts/run-phase1-quality-gate.ts`,
  `scripts/founder-e2e-preflight.mjs`
- All Phase 1 / Phase 1.5 / strategy `.md` docs except runbook
  execution commands and Phase 0A/0B definitions
- All `lib/__tests__/**` for the above

## 📍 Strategic decisions

Long-term decisions are now consolidated in
`docs/10-coordination/STRATEGIC_LEDGER.md` (canonical, append-only).
Read that file before any non-current-phase work — it covers Team /
role allocation, Documentation architecture, Phase 0 / engineering
doctrine, Phase 0 OTP path, Phase 0B / 1 / 2 / 3 / 4, Infra, UI
migration. The 2026-05-04 entries added on this branch include:
docs/ purpose-based hierarchy, INDEX.md as new-agent entry point,
Quality Gate as Phase 1 first stop, flight-time-filter as the
founder-bug regression canary, no-blind-live-runs probe-first
policy, safe provider stopping points (review / confirm handoff /
OTP handoff / payment handoff / no-availability), provider runtime
debug-from-evidence policy.
