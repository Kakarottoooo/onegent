# Strategic Ledger — long-term cross-phase memory (immutable, never trimmed)

> **For**: codex / claude — consult before any non-current-phase work
> **Maintained by**: whichever agent owns the change (codex for Track A
> decisions, claude for Track B)
> **Append-only**: existing entries don't get rewritten; mistakes get a new
> superseding row dated later. No silent edits.

This file is the **declarative memory layer**. It stays small enough to scan
in 60 seconds (~50 lines target). It complements:

- `docs/10-coordination/HUDDLE.md` — working memory (cap 2000 words, rolls)
- `docs/10-coordination/{codex,claude}.md` — per-agent ack history + file
  ownership manifest (long; survives across sessions)
- `docs/INDEX.md` — entry point for any new agent session

Add to STRATEGIC_LEDGER when:
- Phase scope / freeze decision (e.g. "Phase 2 frozen until X")
- Architecture choice that touches multiple components (e.g. "Computer Use
  as default executor")
- Product positioning lock (consumer / infra / hybrid)
- Spec-level rule whose violation = bug elsewhere (e.g. § 7.5 OTP transitional)
- Trigger conditions for big infra moves (e.g. Browserbase Pro upgrade
  thresholds)
- Documentation-architecture rules (where new files live, what entry order
  agents follow)

Don't add to STRATEGIC_LEDGER when:
- Day-to-day task assignment (HUDDLE 📨 Inbox)
- A specific commit's status (per-agent ack history)
- Open question / blocker (HUDDLE or per-agent file)

---

## Documentation architecture

- **2026-05-04** Docs are organized under `docs/` by purpose (00-start-here,
  10-coordination, 20-phase0-restaurant, 30-provider-debug, 40-phase1,
  50-product-areas, 60-api-integrations, 90-archive). Root markdown stays
  limited to repo-level entrypoints (`AGENTS.md`, `CLAUDE.md`, `README.md`,
  `CHANGELOG.md`) · `docs/INDEX.md`
- **2026-05-04** New agents (Codex, Claude, or any other coding-agent
  session) start with `docs/INDEX.md`, not full-codebase reading. Read
  smallest set that matches the task · `docs/INDEX.md` § Start Here
- **2026-05-04** Quality Gate orchestrator at
  `docs/40-phase1/PHASE_1_QUALITY_GATE.md` — `npm run gate:phase1` is the
  one-command Phase 1 verdict (tsc + targeted vitest + check-drift +
  optional smoke / e2e:founder). Required before pushing a Track B
  branch · `lib/quality-gate/`

## Team / role allocation

- **2026-05-03** Role allocation: codex 30-40% / Claude 60-70% with hold
  rules · `CLAUDE.md` § 协作协议
- **2026-05-03** Time-prediction protocol: every task starts with
  "预计最快 X 分钟" + actual measured with `date`. LLM speed: simple
  replies 1-2 min, multi-file extractions 8-15 min, doc-pack 12-18 min ·
  chat decision
- **2026-05-03** Branch hygiene: every new task cuts a fresh branch from
  latest `origin/master`; archival branches get no further commits ·
  `docs/10-coordination/codex.md`
- **2026-05-03** Claude paused on new features; doc/copy polish only until
  Phase 0 + Phase 1 closed · `docs/10-coordination/codex.md`
- **2026-05-03** R-003 runbook commands + PHASE_STATUS Phase 0A/0B
  definitions are codex domain; claude must not modify (post `88e7ecd`)
- **2026-05-03** HUDDLE protocol adopted: shared 2k-word working memory at
  `docs/10-coordination/HUDDLE.md`; session-start必读, push前必更 ·
  `CLAUDE.md` § 协作协议
- **2026-05-03** Codex owns runtime / provider / core / debug work. Claude
  owns large UI / dashboard / docs / tests / observability implementation
  unless explicitly delegated otherwise · `CLAUDE.md` § 协作协议

## Phase 0 / engineering doctrine

- **2026-05-02** Computer Use as default executor ·
  `docs/30-provider-debug/EXECUTOR_V2_PIVOT.md`
- **2026-05-03** Phase 0 OTP transitional rule § 7.5 ·
  `docs/20-phase0-restaurant/BENCHMARK_RESTAURANT_100.md`
- **2026-05-03** Q11 R-003 expectedOutcomes: option (a) explicit spec
  broadening · `docs/20-phase0-restaurant/BENCHMARK_RESTAURANT_100.md` § 4
- **2026-05-03** Coordination protocol via
  `docs/10-coordination/{codex,claude}.md` + `docs/10-coordination/HUDDLE.md`
  · `CLAUDE.md` § 协作协议
- **2026-05-03** Don't introduce 3rd-party browser-agent tools (MultiOn /
  Skyvern / browser-use) · chat decision
- **2026-05-03** R-003 live smoke checklist + readiness preflight green ·
  `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md` (codex `88e7ecd`)
- **2026-05-03** No blind live provider runs. Use no-token probes
  (`npm run probe:resy`) and explicit founder approval before burning
  model tokens · `docs/20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md`
- **2026-05-03** Safe provider stopping points are: review, confirmation
  handoff, OTP handoff, payment handoff, or correct no-availability.
  NEVER automate payment, OTP, CAPTCHA, or final irreversible
  confirmation · `docs/20-phase0-restaurant/BENCHMARK_RESTAURANT_100.md`
  § 7.5
- **2026-05-04** Provider runtime bugs are debugged from DB evidence
  (`booking_jobs.steps[0].error`, `decisionLog`, `params`), worker logs
  (`codex-worker.log`), and debug screenshots
  (`worker/.debug-screenshots/`). Task-card UI logs alone are not
  enough · `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`

## Phase 0 OTP path

- **2026-05-03** OTP path D: warm session first; Gmail OTP resume fallback
  · `docs/20-phase0-restaurant/WARM_SESSION_STRATEGY.md`

## Phase 0B (codex domain definition)

- **2026-05-03** Phase 0B = Restaurant v1: Resy observed fixture suite
  (currently 22 rows, target 25) + OpenTable Phase 0 coverage ·
  `docs/00-start-here/PHASE_STATUS.md` (codex `88e7ecd`)

## Phase 1 status

- **2026-05-03** Phase 1 UI shipped to master via `c2be764` + `601716b` +
  `6f81b5c` · `docs/40-phase1/PHASE_1_PLAN.md`
- **2026-05-03** Phase 1 #7 fully shipped: path A `8500af3` + path B
  `4cdaa36` + safety fix · `docs/90-archive/completed-plans/PHASE_1_7_SPEC.md`
- **2026-05-03** Path B hardening landed: helpers + 19 tests + dev demo
  via `f423b56` cherry-pick · `lib/profile-gap-decision.ts` /
  `lib/profile-gap-on-save.ts`
- **2026-05-03** Audit Finding 5 closed: cancel updates task.state via
  `7289ba0` · `docs/90-archive/completed-plans/E2E_SOURCE_AUDIT.md`
- **2026-05-03** Q14 / Q15 closed: backend emits canonical via
  `buildProfileGap`; client consumes `payload.profile_gap` ·
  `docs/90-archive/completed-plans/PHASE_1_7_SPEC.md` § 11.4
- **2026-05-03** Q13 wontfix: CRLF false-positive Windows-quirk only
- **2026-05-03** Phase 1 founder walkthrough has automated render-smoke gate
  via `npm run smoke:phase1` ·
  `docs/40-phase1/PHASE_1_E2E_SMOKE.md` (merged `f9dd0ba`)
- **2026-05-03** Phase 1 plan refreshed to ~95% shipped state ·
  `docs/40-phase1/PHASE_1_PLAN.md`
- **2026-05-03** Founder E2E walkthrough has Quick (10 min) + Full
  (60-90 min) bifurcation + stop conditions ·
  `docs/40-phase1/PHASE_1_FOUNDER_E2E.md` (merged `3043a29`)
- **2026-05-04** Phase 1.5 has TWO surfaces: autonomous Quality Gate
  (`npm run gate:phase1`) + manual founder E2E workbench
  (`/dev/founder-e2e`). Quality Gate is FIRST stop on a Track B
  branch · `docs/40-phase1/PHASE_1_QUALITY_GATE.md`
- **2026-05-04** `vitest:flight-time-filter` is the Phase 1 founder-bug
  regression canary; locked into the Quality Gate required set ·
  `lib/quality-gate/runner-helpers.ts` (`SHIPPING_CRITICAL_IDS`)

## Phase 2 freeze

- **2026-05-03** Phase 2 vertical expansion FROZEN until Phase 0B + Phase 1
  declared · `docs/00-start-here/PHASE_STATUS.md`

## Phase 2-3 product positioning

- **2026-05-03** Hybrid positioning (NOT pure-infra, NOT pure-consumer) ·
  `docs/00-start-here/PROJECT_SUMMARY.md` cont. 2
- **2026-05-03** Inspire mode / Daydream Explorer → Phase 3 with 30-template
  gallery (NOT LLM-free-form) · Phase 3
- **2026-05-03** Subscription gamification → Phase 2-3

## Phase 4 data flywheel

- **2026-05-03** Data flywheel: Layer A (✅) + B (✅) + C (❌); trigger ≥ 100
  real bookings

## Infra

- **2026-04-30** Browserbase Pro upgrade trigger: ≥ 500 paying users OR
  ≥ $1500/mo bill OR cofounder OR seed round · Phase 4

## UI migration

- **2026-05-03** No "原来的 UI" deletion at Phase 1 boundary; deprecation
  queue with explicit删除 conditions · `docs/40-phase1/UI_MIGRATION_MAP.md`

---

## Update protocol

When you decide a new strategic lock:

1. Pick the right H2 section (or add a new one if none fits)
2. Append a new line: `- **YYYY-MM-DD** [decision in one sentence] · [pointer to canonical doc]`
3. Don't rewrite older lines. If a decision is reversed, add a new line
   that supersedes it (e.g. `2026-06-15 Reversed: now X · supersedes 2026-05-03 entry`)
4. Commit with `[shared]` or `[coord]` tag so the other side notices

When you start a non-current-phase task (e.g. "I'll prep Phase 4 flywheel"),
read this file top-to-bottom first to make sure no entry conflicts with what
you're about to write.

This is the canonical strategic ledger. There is no other copy. Earlier
versions at root and in `coord-huddle-protocol` PR have been merged here.
