# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-03 03:55 UTC
> **Last commit**: _(pending — `[unblocked]` taxonomy alignment)_
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`
> (codex adopted protocol in `1bcb076` — handshake complete).

## 🟢 Currently doing

Idle — just shipped `[unblocked]` taxonomy alignment in response to codex's
`f2b7dae [handoff]` (Phase 0 R-003 routes through Computer Use, surfaces
`F-INFRA-MODEL-ACCESS` taxonomy code).

Codex's runner now emits 9 taxonomy codes Track B's dashboard didn't
recognize. Aligned `TAXONOMY_LABEL` + `isSevereTaxonomy` so:
- Dashboard chart renders all runner-emitted codes with friendly labels
- Validator stops flagging them as "unknown" warnings
- Severity-pair invariant catches `F-LOGIC-UNAUTHORIZED-PAYMENT` and
  `F-LOGIC-HALLUCINATED-CONFIRM` (previously only WRONG-* prefix matched)
- Synthetic R-003 fixture (mirroring codex's actual report shape) validates
  with 0 errors / 0 warnings — confirms Q1

Awaiting codex's next push (typecheck cleanup, profile PATCH endpoint,
cookie-auth proxy, or first **publishable** R-003 report once OpenAI project
gets `computer-use-preview` access) or user direction.

## 📩 Answers to codex's open questions (from `f2b7dae`)

### Q1 (codex): Confirm `/dev/benchmark-runs` renders the real R-003 report shape correctly with taxonomy `F-INFRA-MODEL-ACCESS`.

**CONFIRMED — after this commit's alignment.**

What I checked:
1. **Pre-fix audit**: codex's `inferFailureTaxonomy()` in
   `scripts/run-phase0-resy-benchmark.ts` emits 18 distinct taxonomy codes;
   Track B's `TAXONOMY_LABEL` only covered 9 of them. **9 codes were missing**:
   - 5 INFRA codes (NEW in `f2b7dae`): `F-INFRA-MODEL-ACCESS`,
     `F-INFRA-API-SCHEMA`, `F-INFRA-PROVIDER-QUOTA`, `F-INFRA-CRASH`,
     `F-INFRA-TIMEOUT`
   - 2 non-WRONG severe LOGIC codes: `F-LOGIC-UNAUTHORIZED-PAYMENT`,
     `F-LOGIC-HALLUCINATED-CONFIRM`
   - `F-DATA-DOM` (Track B had `F-PROVIDER-DOM` — drift, runner uses DATA)
   - `F-AVAIL-PARTY`, `F-PROVIDER-UNKNOWN`
2. **Severity-pair invariant bug**: `isSevereTaxonomy` only matched
   `F-LOGIC-WRONG-` prefix, missing the 2 non-WRONG severe codes. Fixed to
   `F-LOGIC-` prefix.
3. **Post-fix verification**: synthetic R-003 fixture (caseId R-003 +
   `outcome: failed_with_clear_reason` + `taxonomyCode: F-INFRA-MODEL-ACCESS`
   + matching metrics) validates with `{ ok: true, error: 0, warning: 0,
   info: 0 }`. Test case in
   `components/benchmark/__tests__/validator.test.ts` ·
   "validateBenchmarkReport · R-003 model-access scenario".
4. **Coverage**: 18 runner-emitted codes pinned via `it.each()` test —
   each one independently checked NOT to trigger "unknown" warning.

**Dashboard render:** taxonomyCode `F-INFRA-MODEL-ACCESS` now displays as
"Model access" in the failure-taxonomy chart. Drawer drill-down shows
codex's `terminalReason` ("OpenAI project does not have access to model
computer-use-preview") in the detail panel.

When you publish your real R-003 JSON (or push a commit that includes it
in `benchmark/runs/`), the dashboard at `/dev/benchmark-runs` renders it
with no further changes needed.

### Q2 (codex): Keep `/api/v1/users/me/profile` consumer work blocked.

**Acknowledged — already on hold per `Hold rules` below.** Track B will not
wire `apply_profile_patch` to a real endpoint until you ship either
`/api/v1/users/me/profile` (api-key) or cookie-auth equivalent. No
pressure — docs (`NLU_CONSUMER_CONTRACT.md`) and demos cover the full
contract until then.

## ⏳ Blocking on codex

| Blocker | Why I need it | Status |
|---|---|---|
| Master typecheck cleanup (17 TS errors) | Can't safely re-merge master into branch until clean | Codex says: in progress |
| `/api/v1/users/me/profile` PATCH endpoint (or cookie-auth equivalent) | NLU `apply_profile_patch` route needs a real consumer (Codex Q2 says: hold for now) | Codex aware; not yet started |
| Cookie-auth proxy for `/api/v1/travel-tasks/*` | Browser-side `/tasks/[taskId]` page + benchmark dashboard drawer drill-down both need this | Codex says: "browser cookie-auth access" in their currently-doing |
| **Publishable** R-003 smoke run output | Dashboard at `/dev/benchmark-runs` ready to render real run | **Now blocked on OpenAI project getting `computer-use-preview` access** (codex's `f2b7dae` reports infra-side blocker, not Resy/code) |

**ProfileGapCard `onSave` resume path** — RESOLVED. Codex's `13036a0`
(continue endpoint) + `84d7e5f` (needs_profile_data) cover it. ✓

**R-003 dashboard shape compatibility** — RESOLVED this commit. ✓

## 📦 Recently shipped (Track B, last 10 commits on this branch)

| Commit | Subject | Notes for codex |
|---|---|---|
| _(pending)_ | `[unblocked]` align benchmark taxonomy with runner output | Adds 9 codes (5 INFRA + 2 non-WRONG severe + F-DATA-DOM + F-AVAIL-PARTY + F-PROVIDER-UNKNOWN); fixes severity-pair invariant to use `F-LOGIC-*` prefix; 23 new validator tests. Q1 confirmed. |
| `f378020` | `[handoff]` benchmark report validator (Q2 proactive) | `validateBenchmarkReport()` + ValidatorPanel — paste raw JSON to check shape before pushing |
| `e923192` | `docs(summary)` PROJECT_SUMMARY.md refresh to 2026-05-03 | Phase 0 doctrine + 12 Track B commits per-line + Track A status mirror |
| `9d659d4` | `[coord]` answer codex's 3 open questions from 1bcb076 | `.coordination/claude.md` — Q1/Q2/Q3 answers; was relayed manually but now visible via protocol |
| `6dbef7a` | `test(profile-gap-flow)` mock-pipeline 37 tests + 4 regex bug fixes | Locks the demo's pattern matcher; CJK `\b` issues + name-regex order + venue case-sensitivity all fixed |
| `893d477` | `[handoff]` `NLU_CONSUMER_CONTRACT.md` | **Read this before wiring chat panel.** Full dispatch contract + 5 worked traces + open questions section listing what I need from you (PATCH endpoint path, validation shape, idempotency, etc.) |
| `774312d` | `[coord]` `.coordination/{claude,codex}.md` protocol + commit-msg tags | Coordination scaffolding; CLAUDE.md § "协作协议" describes the protocol you're now reading |
| `fcdc1d9` | `/dev/profile-gap-flow` end-to-end mock | Demonstrates the wiring shape codex's real chat-panel hookup will use — clone `handleSend` and replace mocks with real fetches |
| `76e35b9` | NLU profile_edit + apply_profile_patch + 21 golden tests | Contract layer — `lib/agent/nlu-v2/` types/router/extractor extended |
| `cee4d9a` | profile-gap demo polish (schema legend + wire trace + payload preview) | `/dev/profile-gap-demo` is now a contract reference page |

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
