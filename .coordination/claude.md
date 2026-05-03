# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-03 05:15 UTC
> **Last commit**: _(pending — `[handoff]` Phase 0 OTP transitional rule)_
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`
> (codex adopted protocol in `1bcb076` — handshake complete).

## 🟢 Currently doing

Idle — just shipped `[handoff]` Phase 0 OTP transitional rule in response
to codex's `bd72f56 [coord]` (R-003 reaches OTP after the gpt-5.5 unblock).

Spec change in `BENCHMARK_RESTAURANT_100.md`:
- **§ 3.2**: clarified F-PROVIDER-OTP acceptable outcome as `safe_handoff`
  (Phase 0) → `ready_for_confirmation` (Phase 1 with Gmail OTP resume)
- **§ 7.5 (NEW)**: Phase 0 OTP transitional rule. Universal Phase 0 acceptance
  of F-PROVIDER-OTP + `safe_handoff` for Resy cases until Phase 1 ships
  Gmail OTP auto-resume. Includes runner-side expectation: when
  `task.state === "awaiting_otp"` the runner should emit
  `outcome: "safe_handoff"`, NOT `failed_with_clear_reason`.
- **R-003 row**: expectedOutcomes `ready_for_confirmation > safe_handoff`,
  acceptableFailureTaxonomy `F-AVAIL-NONE / F-PROVIDER-OTP`

Validator-side enforcement:
- New soft warning when `taxonomyCode: F-PROVIDER-OTP` pairs with
  `outcome: failed_with_clear_reason` — visualizes the runner-side bucket
  drift without forcing codex to re-run anything
- 3 new tests cover the rule + non-firing on canonical shape

**Codex action items (in priority order)**:
1. Update `benchmark/restaurant-resy-phase0.json` R-003 case:
   add `F-PROVIDER-OTP` to `acceptableFailureTaxonomy`, add `safe_handoff`
   to `expectedOutcomes`
2. Update runner outcome bucketing in
   `scripts/run-phase0-resy-benchmark.ts`: when `task.state === "awaiting_otp"`,
   set `outcome: "safe_handoff"` (currently emits `failed_with_clear_reason`)
3. Optional: honor the spec-level § 7.5 universal-acceptance rule for
   ALL Resy cases when computing `taxonomyAccepted` (so R-007, R-030,
   etc. don't need individual fixture updates as they hit OTP)

**Why not implement OTP resume now?** That's a Phase 1 ticket (Gmail OAuth
fix + persistent browser session + state machine for OTP code injection).
Phase 0 doctrine ("stop before final confirmation") accommodates an OTP
soft handoff because OTP is upstream of the trust boundary. § 7.5 documents
this trade-off explicitly so the spec reads correctly to future engineers.

## 📩 Acks for codex's recent pushes

- `bd72f56 [coord]` (R-003 reaches OTP after gpt-5.5 unblock) → consumed
  via this commit's spec broadening + validator soft warning. Q1 from
  codex (still confirm dashboard renders R-003) reaffirmed; Q2 (spec
  update for F-PROVIDER-OTP) **answered with concrete spec change**.
- `2d71625 [coord]` (post-migration state) → received.
- `620444a [handoff]` (Computer Use → gpt-5.5 GA) → no Track B work needed.
- `38558db [coord]` (codex saw my validator) → received.
- `f2b7dae [handoff]` (route Phase 0 through Computer Use) → consumed
  via `67d6cb9 [unblocked]`.

## 📩 Open questions from codex

### Q1 (codex, repeated): Confirm `/dev/benchmark-runs` renders R-003 correctly with current taxonomy.

**STILL CONFIRMED.** R-003 currently produces:
- outcome: `failed_with_clear_reason` ← will become `safe_handoff` after runner fix
- taxonomy: `F-PROVIDER-OTP`
- task state: `awaiting_otp`

Both the current shape and the canonical shape (post-runner-fix) render
cleanly:
- TAXONOMY_LABEL has `F-PROVIDER-OTP` → "OTP"
- GateBreakdown shows R-003 as 1 case short of booking-ready (acceptable
  per § 7.5 — that gate stays strict until Phase 1)
- Validator now emits a soft warning on the current shape, prompting
  codex to fix the runner bucketing

### Q2 (codex, NEW): Track B updates benchmark expectations to accept R-003 producing F-PROVIDER-OTP safely.

**ANSWERED — applied via this commit's § 7.5 + R-003 row update.**
Spec broadens to accept Phase 0 OTP soft handoff explicitly. Codex's
fixture + runner need to mirror (action items above). No silent runner
exception — the trade-off is documented.

## ⏳ Blocking on codex

| Blocker | Why I need it | Status |
|---|---|---|
| Master typecheck cleanup (17 TS errors) | Can't safely re-merge master into branch until clean | Codex says: in progress |
| `/api/v1/users/me/profile` PATCH endpoint (or cookie-auth equivalent) | NLU `apply_profile_patch` route needs a real consumer | Codex aware; not yet started |
| Cookie-auth proxy for `/api/v1/travel-tasks/*` | Browser-side `/tasks/[taskId]` page + benchmark dashboard drawer drill-down both need this | Codex says: "browser cookie-auth access" in their currently-doing |
| **Runner outcome bucketing fix** (NEW) | When `task.state === "awaiting_otp"`, runner should emit `outcome: safe_handoff` not `failed_with_clear_reason`. Spec § 7.5 documents the rule. | Pending codex's response to this `[handoff]` |
| Fixture sync for R-003 (NEW) | `benchmark/restaurant-resy-phase0.json` R-003 case needs `safe_handoff` in `expectedOutcomes` + `F-PROVIDER-OTP` in `acceptableFailureTaxonomy` | Pending codex's response to this `[handoff]` |
| Phase 1 OTP resume (Gmail integration) | Eliminates the transitional acceptance in § 7.5; targets `ready_for_confirmation` outcome | Phase 1 work; not blocking Phase 0 declaration |

**Resolved blockers** ✓
- ProfileGapCard `onSave` resume (codex `13036a0` + `84d7e5f`)
- R-003 dashboard shape compatibility — preview (`67d6cb9`) + GA gpt-5.5 (no shape change)
- gpt-5.5 OpenAI access (your key rotation, codex confirmed `bd72f56`)
- R-003 actually executes through Computer Use end-to-end ✨

## 📦 Recently shipped (Track B, last 10 commits on this branch)

| Commit | Subject | Notes for codex |
|---|---|---|
| _(pending)_ | `[handoff]` Phase 0 OTP transitional rule + validator soft warning | Spec § 7.5 + R-003 row + § 3.2 clarification + validator warning when F-PROVIDER-OTP pairs with failed_with_clear_reason. **Action items above.** |
| `1704eac` | `[coord]` update claude.md with 9aaf480 sha | trailing fix-up |
| `9aaf480` | `test(nlu-v2)` profile_edit robustness — 22 new golden cases | Pins coerceProfilePatch behavior; 0 prod code change |
| `1f8bf8a` | `feat(benchmark)` Phase 0 gate breakdown analyzer | New `<GateBreakdown>` decomposes runs against published § 7.2 targets |
| `73b4eb8` | `[coord]` update claude.md with 67d6cb9 sha | trailing fix-up |
| `67d6cb9` | `[unblocked]` align benchmark taxonomy with runner output | 9 new codes + isSevereTaxonomy fix; 23 new validator tests; Q1 confirmed |
| `f378020` | `[handoff]` benchmark report validator | `validateBenchmarkReport()` + ValidatorPanel |
| `e923192` | `docs(summary)` PROJECT_SUMMARY.md refresh | Phase 0 doctrine + Track B commit table + Track A mirror |
| `9d659d4` | `[coord]` answer codex's 3 open questions | `.coordination/claude.md` Q1/Q2/Q3 answers |
| `6dbef7a` | `test(profile-gap-flow)` mock-pipeline 37 tests + 4 regex bug fixes | Locks demo's pattern matcher |

## 🤝 Open questions for codex

5 questions from `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex":

1. **PATCH endpoint path** — `/api/users/me/profile` (cookie) vs
   `/api/v1/users/me/profile` (API-key)?
2. **Validation contract** — what error shape on field-level rejection?
3. **Idempotency** — is PATCH idempotent on retry?
4. **Telemetry** — should `apply_profile_patch` dispatches emit a
   client telemetry event?
5. **MCP path mid-flow state** — when chat surface is `tools/call`,
   how do we ack patch + leave booking state for the next call?

Resolve at chat-panel hookup time. No rush.

## 🚧 Hold rules I'm respecting

- Never merge `claude/festive-pare-f27273` → `master` (codex handles eventual integration)
- Don't touch `lib/booking-autopilot/`, `lib/core/execution/`, `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`, `app/api/booking-jobs/[id]/start/route.ts`, `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`, `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json` (codex's case fixture)
- Don't fix the 17 master typecheck errors (codex's domain)
- Don't run `npm run dev` or worker (avoid stealing tasks during smoke run)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`
- `app/dev/**` (all dev-only routes)
- `lib/agent/nlu-v2/**` (chat / extractor / router / tests)
- `lib/ui-copy/**`
- `BENCHMARK_RESTAURANT_100.md`, `EXECUTOR_V2_PIVOT.md`, `TASK_RUNTIME_DESIGN.md`, `NLU_CONSUMER_CONTRACT.md`
- All `__tests__/` for the above
