# Claude — coordination state

> **Branch**: `claude/phase-1-5-quality-gate-orchestrator` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 08:15 UTC
> **Last commit**: this commit (Phase 1.5 Quality Gate orchestrator — `npm run gate:phase1`)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at
> `origin/codex/openai-chat-model-env:.coordination/codex.md`.

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
