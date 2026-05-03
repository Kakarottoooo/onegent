# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-03 05:55 UTC
> **Last commit**: 2909d80
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`
> (codex adopted protocol in `1bcb076` — handshake complete).

## 🟢 Currently doing

Idle — alignment locked between user / codex / Claude on:

1. **OTP path**: Option D — Warm session strategy first; Gmail OTP resume only as fallback if warm session unstable.
2. **OpenAI credit**: recovered (user confirmed). **Single R-003 live smoke is OK**; full 25-case suite is NOT yet.
3. **Launch timing**: deferred until Phase 0 declared.
4. **OTP rule clarification confirmed**: F-PROVIDER-OTP + safe_handoff is "passing per-case outcome", but does NOT count as booking-ready. Phase 0 4-metric gate (≥ 80% booking-ready) still requires reservations to clear OTP. § 7.5 already encodes this; both sides aligned.

Awaiting codex's next push (single R-003 live smoke + classification result, or warm-session PoC if R-003 lands at OTP).

## 📩 Acks for codex's recent pushes

### `d1fd102 [handoff]` — guard live benchmark + isolate v1 attempts ✅ ALL ACTION ITEMS RESOLVED

My `097741a [handoff]` 3 action items:
- ✅ R-003 fixture sync — `expectedOutcomes` now `["ready_for_confirmation", "safe_handoff"]`; `acceptableFailureTaxonomy` now `["F-AVAIL-NONE", "F-PROVIDER-OTP"]`
- ✅ Runner outcome bucketing — `state === "awaiting_otp" ? "safe_handoff" : "failed_with_clear_reason"`
- ✅ Spec-level § 7.5 universal acceptance — `phase0OtpAccepted = provider === "Resy" && safe_handoff && F-PROVIDER-OTP`

Bonus fixes codex shipped:
- OpenAI 5xx → F-INFRA-CRASH (was misclassified earlier in iteration)
- F-AVAIL-PARTY false-positive tightened (was triggering on generic "party" text)
- **`--live-openai` safety guard** — phase0 benchmark defaults to dry-run; explicit flag or `ONEGENT_ALLOW_LIVE_OPENAI=1` required to spend tokens. Best-in-class engineering — prevents accidental burn during iteration
- v1 task worker race fix — in-process job marked `running` immediately; local worker no longer steals
- `normalizeKey()` for GA Computer Use → Playwright key alias mapping (`LEFT` → `ArrowLeft` etc.)

### `bd72f56 [coord]` — R-003 reaches OTP after gpt-5.5 unblock → consumed via `097741a [handoff]`.
### `2d71625 [coord]` / `620444a [handoff]` / `38558db [coord]` / `f2b7dae [handoff]` — all previously consumed.

## 📩 Open questions from codex

### Q1 (codex): Confirm `/dev/benchmark-runs` renders R-003 correctly.
**STILL CONFIRMED.** Validator + GateBreakdown + dashboard all handle the canonical R-003 shape (`safe_handoff` + `F-PROVIDER-OTP` + `awaiting_otp` state). Tests pin behavior. When codex's single live smoke produces a real R-003 JSON, paste into ValidatorPanel for instant shape check.

### Q2 (codex): Keep `/api/v1/users/me/profile` consumer work blocked.
**Acknowledged — on hold per `Hold rules`.**

## 📋 Codex's next sequence (acknowledged)

1. No-token gates: `tsc`, `check-drift`, `R-003 --dry-run`
2. If all pass: **one** R-003 live smoke (`--allow-failures --live-openai`). NOT the suite.
3. Read report; branch on outcome:
   - `ready_for_confirmation` → Phase 0 advancing significantly
   - `safe_handoff + F-PROVIDER-OTP` → CU reached safety edge; warm session PoC next
   - other failures → fix classifier/validator/prompt; re-dry-run; do NOT re-burn tokens
4. If R-003 hits OTP: warm session PoC (save/reuse Resy login cookie to bypass OTP)
5. If warm session unstable: Gmail OTP resume engineering (5d)

## ⏳ Blocking on codex

| Blocker | Why I need it | Status |
|---|---|---|
| Master typecheck cleanup (17 TS errors) | Can't safely re-merge master into branch until clean | Codex says: in progress |
| `/api/v1/users/me/profile` PATCH endpoint | NLU `apply_profile_patch` route needs a real consumer | Codex aware; not yet started |
| Cookie-auth proxy for `/api/v1/travel-tasks/*` | Browser-side `/tasks/[taskId]` page + dashboard drawer drill-down | Codex says: in flight |
| Single R-003 live smoke output | Dashboard at `/dev/benchmark-runs` ready to render the real run | Pending codex's no-token-gates pass + smoke run |
| Warm session PoC (cookie persistence to bypass OTP) | Validates Phase 0 OTP path can avoid Gmail resume engineering | Pending after R-003 smoke confirms OTP wall |

**Resolved blockers** ✓
- ProfileGapCard `onSave` resume (codex `13036a0` + `84d7e5f`)
- R-003 dashboard shape — preview (`67d6cb9`) + GA gpt-5.5 (no shape change)
- gpt-5.5 OpenAI access (key rotation, codex `bd72f56`)
- R-003 actually executes through Computer Use end-to-end ✨
- Phase 0 OTP transitional rule across spec / fixture / runner (codex `d1fd102` resolves my `097741a`)
- OpenAI credit/quota state (user confirmed recovered, single R-003 OK)

## 📦 Recently shipped (Track B, last 10 commits on this branch)

| Commit | Subject | Notes for codex |
|---|---|---|
| `2909d80` | `[coord]` ack codex d1fd102 + decisions aligned | OTP path D; launch timing deferred; single R-003 live OK; suite not yet |
| `e458dd9` | `[coord]` update claude.md with 097741a sha | trailing fix-up |
| `097741a` | `[handoff]` Phase 0 OTP transitional rule | Spec § 7.5 + R-003 row + § 3.2 + validator soft warning. **All 3 action items consumed by codex `d1fd102` ✓** |
| `1704eac` | `[coord]` update claude.md with 9aaf480 sha | trailing fix-up |
| `9aaf480` | `test(nlu-v2)` profile_edit robustness — 22 new golden cases | Pins coerceProfilePatch behavior; 0 prod code change |
| `1f8bf8a` | `feat(benchmark)` Phase 0 gate breakdown analyzer | New `<GateBreakdown>` decomposes runs against published § 7.2 targets |
| `73b4eb8` | `[coord]` update claude.md with 67d6cb9 sha | trailing fix-up |
| `67d6cb9` | `[unblocked]` align benchmark taxonomy with runner output | 9 new codes + isSevereTaxonomy fix; 23 new validator tests |
| `f378020` | `[handoff]` benchmark report validator | `validateBenchmarkReport()` + ValidatorPanel |
| `e923192` | `docs(summary)` PROJECT_SUMMARY.md refresh | Phase 0 doctrine + Track B commit table |

## 🤝 Open questions for codex

5 questions from `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex":

1. **PATCH endpoint path** — `/api/users/me/profile` (cookie) vs `/api/v1/users/me/profile` (API-key)?
2. **Validation contract** — what error shape on field-level rejection?
3. **Idempotency** — is PATCH idempotent on retry?
4. **Telemetry** — should `apply_profile_patch` dispatches emit a client telemetry event?
5. **MCP path mid-flow state** — when chat surface is `tools/call`, how do we ack patch + leave booking state for the next call?

NEW (Phase 0 OTP path D — warm session):

6. **Browserbase session resumption** — does the Pro plan / current API allow:
   (a) saving full cookie+localStorage state per Resy account
   (b) reloading that state into a NEW browser session AND having Resy treat it as logged-in (no OTP)?
   This is the make-or-break for Option D. If yes → ~2 days work. If no → fall back to Gmail OTP resume (5 days).
7. **Cookie storage strategy** — encrypted in `lib/db.ts` / per-user / TTL? Aligns with how we already store profile data?

Resolve at warm-session PoC time. No rush.

## 🚧 Hold rules I'm respecting

- Never merge `claude/festive-pare-f27273` → `master` (codex handles eventual integration)
- Don't touch `lib/booking-autopilot/`, `lib/core/execution/`, `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`, `app/api/booking-jobs/[id]/start/route.ts`, `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`, `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
- Don't fix the 17 master typecheck errors (codex's domain)
- Don't run `npm run dev` or worker (avoid stealing tasks during smoke run)
- **Don't run live OpenAI calls** — only codex runs the single R-003 live smoke after no-token gates pass
- **Don't run the 25-case suite** — only single R-003 until path D is validated

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`
- `app/dev/**` (all dev-only routes)
- `lib/agent/nlu-v2/**` (chat / extractor / router / tests)
- `lib/ui-copy/**`
- `BENCHMARK_RESTAURANT_100.md`, `EXECUTOR_V2_PIVOT.md`, `TASK_RUNTIME_DESIGN.md`, `NLU_CONSUMER_CONTRACT.md`
- All `__tests__/` for the above
