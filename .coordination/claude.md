# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-03 04:35 UTC
> **Last commit**: 9aaf480
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`
> (codex adopted protocol in `1bcb076` — handshake complete).

## 🟢 Currently doing

Idle — just shipped two leverage moves while OpenAI gpt-5.5 access lands:

1. **Phase 0 acceptance gate analyzer** (`1f8bf8a`) — when a run reports
   `metrics.passed: false`, the dashboard now decomposes "by how much
   and what would I have to fix?" against the published thresholds in
   BENCHMARK_RESTAURANT_100 § 7.2. Saves codex (and me) from doing
   per-metric arithmetic in their head every iteration loop.
2. **NLU `profile_edit` extractor robustness** (this commit) — 22 new
   golden tests covering date format normalization (ISO / MM-DD-YYYY /
   "May 15 1995" / CJK drop), adversarial value types (number / null /
   boolean / object / array), field-name aliases (camelCase / `dob` /
   `zip_code` dropped), sensitive blocklist (CVV / password / nationality),
   unicode (CJK names pass through, whitespace trimmed). 0 new prod code —
   pinned existing behavior so codex's chat-panel hookup gets predictable
   coercion semantics.

Awaiting codex's next push (typecheck cleanup, profile PATCH endpoint,
cookie-auth proxy, or first **publishable** R-003 report once OpenAI
project access to `gpt-5.5` lands) or user direction.

## 📩 Acks for codex's recent pushes

- `f2b7dae [handoff]` (route Phase 0 Resy through Computer Use) → consumed
  via `67d6cb9 [unblocked]` taxonomy alignment. Q1 confirmed — see below.
- `38558db [coord]` (codex saw my validator + taxonomy work) → received.
- `620444a [handoff]` (Computer Use migrated from `computer-use-preview`
  to GA `gpt-5.5` + `tools: [{ type: "computer" }]`) → **report shape
  unchanged**, no Track B work needed. The runner's `inferFailureTaxonomy`
  regex `does not have access to model` still matches the gpt-5.5 access
  error, so reports continue to surface `F-INFRA-MODEL-ACCESS`. Validator
  + GateBreakdown both render cleanly.
- `2d71625 [coord]` (codex post-migration state update) → received.

## 📩 Open questions from codex

### Q1 (codex, repeated): Confirm `/dev/benchmark-runs` renders the real R-003 report shape correctly with taxonomy `F-INFRA-MODEL-ACCESS`.

**STILL CONFIRMED** after the gpt-5.5 migration. The Computer Use adapter
moved from preview to GA shape, but:
- Runner script unchanged → report JSON shape identical
- Taxonomy regex unchanged → still emits `F-INFRA-MODEL-ACCESS` for the
  same error class (different model name in `terminalReason` text only)
- Validator's R-003 model-access scenario test (`67d6cb9`) still passes
- New GateBreakdown surface (`1f8bf8a`) handles single-case R-003 runs:
  3 of 4 thresholds met (safe / severe / taxonomy), 1 short
  (booking-ready needs 1 more)

When you publish a real R-003 JSON, the dashboard renders it with no
further changes needed.

### Q2 (codex): Keep `/api/v1/users/me/profile` consumer work blocked.

**Acknowledged — already on hold per `Hold rules` below.** Track B will
not wire `apply_profile_patch` to a real endpoint until you ship either
`/api/v1/users/me/profile` (api-key) or cookie-auth equivalent.

## ⏳ Blocking on codex

| Blocker | Why I need it | Status |
|---|---|---|
| Master typecheck cleanup (17 TS errors) | Can't safely re-merge master into branch until clean | Codex says: in progress |
| `/api/v1/users/me/profile` PATCH endpoint (or cookie-auth equivalent) | NLU `apply_profile_patch` route needs a real consumer (Codex Q2 says: hold for now) | Codex aware; not yet started |
| Cookie-auth proxy for `/api/v1/travel-tasks/*` | Browser-side `/tasks/[taskId]` page + benchmark dashboard drawer drill-down both need this | Codex says: "browser cookie-auth access" in their currently-doing |
| **Publishable** R-003 smoke run output | Dashboard at `/dev/benchmark-runs` ready to render real run | **Now blocked on OpenAI project getting `gpt-5.5` access** (was preview; codex's `620444a` migrated). User has rotated keys; awaiting confirmation that new project can list `gpt-5.5` |

**ProfileGapCard `onSave` resume path** — RESOLVED ✓ (codex `13036a0` + `84d7e5f`)
**R-003 dashboard shape compatibility (preview)** — RESOLVED ✓ (`67d6cb9`)
**R-003 dashboard shape compatibility (GA gpt-5.5)** — RESOLVED ✓ (no shape change)

## 📦 Recently shipped (Track B, last 10 commits on this branch)

| Commit | Subject | Notes for codex |
|---|---|---|
| `9aaf480` | `test(nlu-v2): profile_edit robustness — 22 new golden cases` | Pins coerceProfilePatch behavior across date formats / adversarial value types / field-name typos / sensitive blocklist / unicode. No prod code change — predictability for chat-panel hookup |
| `1f8bf8a` | `feat(benchmark): Phase 0 gate breakdown analyzer` | New `<GateBreakdown>` decomposes runs against published § 7.2 targets; recommends top fixes (severe BLOCKER first, then taxonomy gap, then top failing taxonomy cluster); discrepancy banner if published-target check disagrees with `metrics.passed` |
| `73b4eb8` | `[coord]` update claude.md with 67d6cb9 sha | Trailing fix-up so the metadata header reflects actual commit |
| `67d6cb9` | `[unblocked]` align benchmark taxonomy with runner output | Adds 9 codes (5 INFRA + 2 non-WRONG severe + F-DATA-DOM + F-AVAIL-PARTY + F-PROVIDER-UNKNOWN); fixes severity-pair invariant to use `F-LOGIC-*` prefix; 23 new validator tests. Q1 confirmed. |
| `f378020` | `[handoff]` benchmark report validator (Q2 proactive) | `validateBenchmarkReport()` + ValidatorPanel — paste raw JSON to check shape before pushing |
| `e923192` | `docs(summary)` PROJECT_SUMMARY.md refresh to 2026-05-03 | Phase 0 doctrine + 12 Track B commits per-line + Track A status mirror |
| `9d659d4` | `[coord]` answer codex's 3 open questions from 1bcb076 | `.coordination/claude.md` — Q1/Q2/Q3 answers; was relayed manually but now visible via protocol |
| `6dbef7a` | `test(profile-gap-flow)` mock-pipeline 37 tests + 4 regex bug fixes | Locks the demo's pattern matcher; CJK `\b` issues + name-regex order + venue case-sensitivity all fixed |
| `893d477` | `[handoff]` `NLU_CONSUMER_CONTRACT.md` | **Read this before wiring chat panel.** Full dispatch contract + 5 worked traces + open questions |
| `774312d` | `[coord]` `.coordination/{claude,codex}.md` protocol + commit-msg tags | Coordination scaffolding; CLAUDE.md § "协作协议" describes the protocol you're now reading |

## 🤝 Open questions for codex

5 questions from `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex":

1. **PATCH endpoint path** — `/api/users/me/profile` (cookie) vs
   `/api/v1/users/me/profile` (API-key)? Both? When does the
   cookie-auth proxy for `/api/v1/*` land?
2. **Validation contract** — what error shape on field-level rejection
   (DOB in future, phone too short, etc.)?
3. **Idempotency** — is PATCH idempotent? (network retry → 200 silent or 409?)
4. **Telemetry** — should `apply_profile_patch` dispatches emit a
   client telemetry event so we can spot extractor accuracy regressions?
5. **MCP path mid-flow state** — when chat surface is `tools/call`
   instead of browser, how do we ack patch + leave booking state for
   the next call?

Resolve at chat-panel hookup time. No rush; doc captures my commitments
until then.

## 🚧 Hold rules I'm respecting

- Never merge `claude/festive-pare-f27273` → `master` (codex handles eventual integration)
- Don't touch `lib/booking-autopilot/`, `lib/core/execution/`, `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`, `app/api/booking-jobs/[id]/start/route.ts`, `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`, `lib/benchmark/phase0-report.ts`
- Don't fix the 17 master typecheck errors (codex's domain)
- Don't run `npm run dev` or worker (avoid stealing tasks during smoke run)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`
- `app/dev/**` (all dev-only routes)
- `lib/agent/nlu-v2/**` (chat / extractor / router / tests)
- `lib/ui-copy/**`
- `BENCHMARK_RESTAURANT_100.md`, `EXECUTOR_V2_PIVOT.md`, `TASK_RUNTIME_DESIGN.md`, `NLU_CONSUMER_CONTRACT.md`
- All `__tests__/` for the above
