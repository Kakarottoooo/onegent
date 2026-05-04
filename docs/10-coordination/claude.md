# Claude — coordination state

> **Branch**: `claude/runtime-forensics-workbench` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 10:30 UTC
> **Last commit**: this commit (Provider Runtime Forensics workbench — `lib/runtime-forensics/` + `/dev/runtime-forensics` + 213 tests)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `docs/10-coordination/codex.md` and on
> `origin/codex/openai-chat-model-env`.
>
> **Note**: AGENT QUICKSTART preamble (project bible for new sessions)
> lives on `claude/integrated-preview-review-20260504 @ 31b30de` —
> separate cleanup PR pending codex review/merge. This branch is a
> focused feature PR; codex can merge both independently.

---

## 🟢 Currently doing

**Provider Runtime Forensics workbench** — read-only triage workbench
for "worker/provider just failed, what happened?" debugging. Branched
from `origin/codex/integrated-preview-20260504 @ 6e0294c`.

This commit ships:

1. **`lib/runtime-forensics/` pure module** (8 files, ~1900 LOC):
   - `types.ts` — `FailureClass` (8 classes), `JobLikeInput` /
     `StepLikeInput` / `DecisionLogEntryLike` duck types,
     `ForensicsReport`, `ForensicsSummary`, severity / tone tables.
   - `step-shape.ts` — detects `Worker received legacy-shape step
     (missing __source marker)` across job-level errorMessage,
     terminalReason, step.error, and rawWorkerLogExcerpt. Returns
     per-step audit row + roll-up + dedup'd quotes.
   - `classifier.ts` — pattern-based weighted scorer with **38
     regex rules** across 8 classes. Aggregates per-field signals
     (errorMessage / terminalReason / terminalCode / step.error /
     decisionLog text / raw worker log excerpt). Tie-break on
     severity ordering (P0 > P1 > P2 > info > P3). Stable + pure.
   - `decision-log.ts` — compact summary: byLevel histogram, top-8
     events, head-6/tail-6 excerpts, 12 notable phrase detectors
     (probe-first / strategy-ladder / fallback / retry-exhausted /
     timeout / captcha / 2FA / selector-not-found / etc).
   - `report.ts` — orchestrator. `buildForensicsReport(job, opts)`
     returns full report; `buildForensicsSummary(report)` returns
     compact row for table. Auto-derives `taskPagePath` with safe-
     id check.
   - `markdown.ts` — `formatForensicsBugReport(report)` →
     paste-ready markdown for chat with codex/Claude. Includes V1
     caveat about source-of-truth being DB + worker log +
     screenshots.
   - `loader.ts` — file IO. `aggregateForensics({filter, limit,
     attachWorkerLog})` scans `benchmark/runs/*.json` (excluding
     `phase1-quality-gate-` / `founder-e2e-` prefixes), parses
     each, extracts JobLikeInput records via duck-cast.
     `readWorkerLogExcerpt({filterSubstring, maxBytes})` reads the
     log path `WORKER_LOG_PATH` env override (default
     `./codex-worker.log`); graceful null on missing file.
     Path-traversal defense via `isSafeForensicsArtifactName` +
     prefix-check after `path.resolve`.
   - `index.ts` — barrel.

2. **8 failure classifications** (per spec):
   - `legacy_shape_missing_source` (**P0** — red verdict, locked per
     founder direction; symptom of worker-gating regression at
     `app/api/booking-jobs/[id]/start/route.ts` M5 force-gate)
   - `provider_no_availability` (info — not a fill failure)
   - `provider_form_incomplete` (P1)
   - `otp_or_login_required` (info — expected boundary)
   - `checkout_reached_manual_review` (info — safe handoff success)
   - `model_or_env_blocked` (P1 — env / token / chromium)
   - `network_or_provider_5xx` (P2)
   - `unknown` (P2 — needs human triage)

3. **Dev API at `app/api/dev/runtime-forensics/route.ts`**:
   - GET list with filters: `?provider` / `?status` / `?taskId` /
     `?sessionId` / `?primaryClass`.
   - GET single: `?id=<jobId>` — re-aggregates with
     `attachWorkerLog=true` and returns full report + summary +
     paste-ready markdown.
   - Dev-gated via existing `ENABLE_DEV_BENCHMARK_API` pattern.
   - Read-only — no POST, no retry endpoint.
   - **Always returns 200 with empty list** when artifacts missing
     — never throws, never crashes the dashboard.

4. **`/dev/runtime-forensics` dashboard**:
   - V1 artifact-based caveat banner (orange).
   - Filter rail: provider / status / classification.
   - Job table with red `🚨` outline for legacy-shape rows.
   - Detail drawer: top signals + step shape + raw terminal fields
     + decision log summary + cross-references + paste-ready
     markdown textarea.
   - Empty state shows: benchmark-runs scanned count, worker log
     path hint (with codex's path mentioned for override
     guidance), loader notes.
   - **NO** live/retry/run buttons. **NO** dev-server start. Read-only.

5. **213 vitest tests passing** across 5 test files:
   - `runtime-forensics-classifier.test.ts` — 88 tests (pattern
     table, decisionLogTextOf, pushFieldSignals, all 8 classes,
     multi-signal disambiguation, confidence buckets, garbage-
     input survival, provider-fixture sanity, stability).
   - `runtime-forensics-step-shape.test.ts` — 38 tests
     (errorMentionsLegacyShape, extractLegacyShapeQuote, truncate,
     audit empty/garbage/counts/legacy-shape detection from 4
     sources, dedup, row content, Expedia regression fixture).
   - `runtime-forensics-decision-log.test.ts` — 23 tests (empty/
     garbage, counts, all 12 notable phrases, dedup, pickExcerpts,
     stable order).
   - `runtime-forensics-report.test.ts` — 33 tests (display
     tables, basic, classification embedded, notes, summary, age
     derivation, markdown formatter, V1 caveat, P0 callout, cross-
     refs, idempotence).
   - `runtime-forensics-loader.test.ts` — 31 tests (path-safety
     unit tests, env override, payload-extraction, filter, fs
     integration with tmp cwd, empty-state, worker log filter
     mode, byte cap, never-throws-on-garbage).

6. **Doc updates**:
   - `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
     — added § 1.5 "Where to look (canonical evidence sources)"
     table + § 1.6 "Forensics workbench" with classification
     ladder + safety rules + "page is a triage tool, not source
     of truth" caveat.
   - `app/dev/page.tsx` — added `/dev/runtime-forensics` as the
     **first** Phase 0/1 critical-path entry.

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` → exit 0
- `npx vitest run lib/__tests__/runtime-forensics*.test.ts` →
  213/213 passing
- No live providers / OpenAI / payment / OTP / CAPTCHA invoked.

**Strictly NOT touched** (hold rules respected):
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- All provider modules
- All live OpenAI / Computer Use / payment / OTP / CAPTCHA paths

## ⏳ Blocking on codex

(none from this branch directly.)

Cross-branch: 8 prior Track B PRs + the
`claude/integrated-preview-review-20260504` cleanup + this branch all
await codex review/merge. They are independent.

## 📦 Recently shipped (this round)

| Commit | Subject | Notes for codex |
|---|---|---|
| (this) | `feat(runtime-forensics): workbench + classifier + 213 tests` | New `lib/runtime-forensics/` pure module + dev API + dashboard. V1 is artifact-based — pure parser handles raw string excerpts and duck-typed input; no DB integration in this PR. Future enhancement: codex can add a DB source path that produces the same `JobLikeInput`. |

Earlier (other branches awaiting your review):
- `claude/integrated-preview-review-20260504 @ 31b30de` — R1 5-file
  move + R2 STRATEGIC_LEDGER consolidation + R3 claude.md preamble
  restore + R4 INDEX scan. Already pushed; awaits review/merge into
  integration preview.
- 8 prior Track B PRs (already merged into
  `codex/integrated-preview-20260504`):
  `coord-huddle-protocol`, `opentable-email-preference`,
  `resy-observability-suite`, `restaurant-readiness-control-center`,
  `resy-run-analysis-workbench`, `phase-1-5-founder-qa-suite`
  (superseded), `autonomous-founder-e2e-runner`,
  `phase-1-5-quality-gate-orchestrator`.

## 🤝 Open questions for codex

- **DB integration timing**: V1 is filesystem-only. Parser already
  accepts duck-typed `JobLikeInput`, so adding a DB source is a
  loader-only enhancement. Want me to ship that as a follow-up, or
  do you prefer to own the DB query path? It touches `lib/db.ts`
  which is shared.
- **`legacy_shape_missing_source` severity is locked at P0** per
  spec. Classifier weight is 1.0 across multiple phrase variants
  (`Worker received legacy-shape step`, `missing __source marker`,
  `step lacks __source`, `unstamped step`, `executor marker missing`).
  Confirm phrasing — if your worker emits a different exact string,
  add it to the pattern table.
- **Worker log path**: defaults to `./codex-worker.log`; override
  via `WORKER_LOG_PATH`. Documented codex's path
  (`C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log`) in the
  empty-state hint. If you want a different default, easy change.
- **Notable phrases in decision log**: I included 12 patterns
  (probe-first, strategy ladder, fallback, retry-exhausted,
  timeout, captcha, 2FA, selector-not-found, etc). Let me know if
  any decision-log events you log frequently aren't surfacing.

## 🚧 Hold rules I'm respecting

- Never merge to master directly.
- Don't touch `lib/booking-autopilot/`, `lib/core/execution/`,
  `lib/execution-v2/`, `worker/src/**`, `app/api/v1/**`,
  `app/api/booking-jobs/**`, `scripts/run-phase0-resy-benchmark.ts`,
  `scripts/probe-resy-availability.ts`, all provider code.
- Don't run `npm run dev` or worker.
- Don't run live OpenAI / Computer Use / payment / OTP / CAPTCHA.
- **No new live/retry/run buttons** — locked rule, this dashboard
  obeys.
- **No new features outside the spec** — this PR is exactly what
  the spec asked for; if scope expands, we discuss first.

## 🗂 Track B file ownership (touched on this branch)

NEW:
- `lib/runtime-forensics/{types,step-shape,classifier,decision-log,report,markdown,loader,index}.ts`
- `lib/__tests__/runtime-forensics-{classifier,step-shape,decision-log,report,loader}.test.ts`
- `app/api/dev/runtime-forensics/route.ts`
- `app/dev/runtime-forensics/page.tsx`

MODIFIED:
- `app/dev/page.tsx` (added route entry to PHASE_0_ROUTES first)
- `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
  (added § 1.5 + § 1.6)
- `docs/10-coordination/claude.md` (this file)

Long-term Track B file ownership (steady-state):
- `components/profile-gap/**`, `components/benchmark/**`,
  `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/api/dev/**`, `app/tasks/[taskId]/**`,
  `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`,
  `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`,
  `lib/founder-e2e/**`, `lib/quality-gate/**`,
  `lib/runtime-forensics/**`
- `scripts/smoke-phase1.mjs`, `scripts/run-founder-e2e.ts`,
  `scripts/run-phase1-quality-gate.ts`,
  `scripts/founder-e2e-preflight.mjs`
- All Phase 1 / Phase 1.5 / strategy `.md` docs except runbook
  execution commands and Phase 0A/0B definitions
- All `lib/__tests__/**` for the above

## 📍 Strategic decisions

This branch adds 1 long-term decision worth recording in
`docs/10-coordination/STRATEGIC_LEDGER.md` once codex merges (R2
cleanup branch carries the canonical ledger update):

- **2026-05-04** Provider Runtime Forensics workbench is the
  **first stop** for worker/provider failure triage. V1 is
  filesystem artifact-based. `legacy_shape_missing_source` is
  always P0. Source of truth remains DB + worker log +
  screenshots — workbench is a triage tool, not authority. ·
  doc: `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
  § 1.5 + § 1.6
