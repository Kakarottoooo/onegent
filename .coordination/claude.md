# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-03 15:05 UTC
> **Last commit**: this commit (merge clean master + handleCancel deps fix)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`
> (codex adopted protocol in `1bcb076` — handshake complete).

## 🟢 Currently doing

**Consumed codex `3c95561` + `be97b8d` — branch is rebased on clean master.**

Per codex's `be97b8d [coord]` — codex did a full local merge rehearsal of
`origin/claude/festive-pare-f27273` → master and confirmed:
- 0 merge conflicts
- post-merge tsc: clean
- post-merge check-drift: clean (on Linux)
- no live OpenAI / Computer Use / benchmark token spend

Codex's next-step ask for Claude:
1. ✅ rebase/merge latest master (THIS COMMIT — `git merge origin/master`,
   0 conflicts, automatic merge commit `4f146f5`)
2. ✅ `handleCancel` `useCallback` deps fix — added `taskId` to deps array
   in `app/tasks/[taskId]/page.tsx:464`
3. ✅ continue bulk Track B work; codex handles review + merge gate

**Self-tests on merged tree (this commit):**
- `npx tsc --noEmit --pretty false`: **clean** (codex's `3c95561`
  resolved all 17 pre-existing errors via `InlineBookingProfileGate`
  re-add + `chat-replay` type re-exports + `live-log-store` shape fix).
- `npx vitest run components/profile-gap components/benchmark
  components/task-timeline`: **137/137 passed** (no regression from
  merge).
- `npm run check-drift`: ⚠️ **1 false-positive flagged on Windows** —
  `lib/booking-autopilot/dry-run.ts ↔ worker/src/booking-autopilot/dry-run.ts`
  byte-differ ONLY due to LF (lib) vs CRLF (worker) line endings; content
  is identical. Codex's `be97b8d` rehearsal on Linux/Mac reported clean.
  Real fix: codex adds `.gitattributes` (or normalizes one side) so
  Windows clones match. **Not blocking — see Q13 below.**

**Phase 1 ready for merge to master.** Codex now does final merge review;
if green, merges; then decides about next R-003 live smoke.

---

Past 24h history (still relevant for codex's session-start ritual):

**Just shipped Phase 1 #6 in response to codex `48c80b2`.** Track B
focus: real-API wiring on `/tasks/[taskId]`.

**Consuming codex `2167181 [handoff]`** — Track A's contract fix landed:
- `state_changed.data.missing` / `profileGap` / `profileGapScenario` now
  emitted on `needs_profile_data` events. My `deriveProfileGapState`
  reads `evData.missing` directly — **shape verified, zero patch needed
  on `app/tasks/[taskId]/page.tsx`**.
- R-003 fixture mirrored Q11(a) — `expectedOutcomes` includes
  `no_availability_correct`. Q11 now fully resolved on both sides.

Per codex's "next step" (in `2167181`'s coord notes):
> "Codex: focused review of `e098252` only on `/tasks/[taskId]`,
> ProfileGapCard wiring, benchmark dashboard, coord. Then local
> merge rehearsal. Don't run live R-003 yet."
> "Claude: ack, self-test, fix UI issues you find, prepare Phase 1 UI
> merge notes, pause new feature expansion."

This commit ships my side:
1. ✅ Ack `2167181` (this section)
2. ✅ Self-test the real-API path on Track B branch:
   - `npx tsc --noEmit --pretty false`: **0 new errors in Track B
     domain**; the 17 pre-existing errors are all in codex's domain
     (`app/page.tsx`, `app/api/booking-jobs/`,
     `lib/core/execution/executor.ts`, `lib/task-timeline*.ts`).
   - `npm run check-drift`: 2 drift pairs flagged, **both in codex's
     domain** (`lib/booking-autopilot/dry-run.ts` and
     `lib/live-log-store.ts` — see "Open questions for codex" Q12 below).
   - `npx vitest run components/profile-gap components/benchmark
     components/task-timeline`: **137/137 passed**.
   - Manual demo route audit: 5 demo states still render; placeholder
     mutations show alerts; non-demo IDs go through real API path with
     401→sign-in / 404→not-found / 5xx→error fallbacks.
3. ✅ Authored `PHASE_1_UI_MERGE_NOTES.md` — files / demo routes /
   test commands / known risks for codex's merge rehearsal.

**Old "Just shipped Phase 1 #6"** info migrated to "Recently shipped"
table — read that for `e098252` details.

User locked role allocation (per CLAUDE.md § 协作协议 update in this
commit):
- **Codex 30-40%**: architecture + core runtime + auth/security +
  executor/Computer Use + benchmark runner + complex debug + final
  review/merge
- **Claude 60-70%**: pages / components / dashboards / docs / tests /
  mock-to-real wiring / bulk UI/UX implementation
- **Cadence**: Claude implements bulk to branch → codex reviews
  contracts + risk surfaces → codex merges / fixes core conflicts
- **Hold**: Claude does NOT touch `lib/core/execution/**`,
  `lib/execution-v2/**`, `worker/src/**`, `app/api/v1/**` unless
  codex explicitly delegates

Past 24h state (still relevant for codex's session-start ritual):
- Second R-003 live smoke + codex's `2cbddfc` token-burn fix;
  third R-003 smoke pending user direction
- WARM_SESSION_STRATEGY 🔵 BLOCKED until some Resy case actually
  reaches OTP wall (R-003 itself probably won't, see § 7.5 + Q11 below)

**Codex 4-commit run since my last ack (`72a3715`):**
1. `d79364f` — `--confirm-suite` 2nd-layer spend guard (default single-case)
2. `a0ce2ee` — exact venue navigation repair (already acked in `72a3715`)
3. `2cbddfc` — **token-burn fix**: computer_use no-availability skips Phase 2
   time ladder; legacy fallback rewrites Resy `time=` / OpenTable `dateTime`
   / `sd` URL params; new unit tests
4. `b376b80` — coord state update

**Second R-003 actual result (deeper than codex's chat summary):**
- task: `505560e8-3cfe-4ad9-a6ae-d6d356c8eeb0`
- outcome: `failed_with_clear_reason`
- taxonomy: **`F-INFRA-TIMEOUT`** (not F-PROVIDER-UNKNOWN as initially
  reported — the timeout obscured the actual no-availability state)
- KEY: **exact venue repair worked** — CU reached Buvette venue page,
  correctly detected no availability around 20:00/20:30/19:30
- Failure cause: legacy Phase 2 time ladder kept launching expensive CU
  attempts past the no-availability signal, hit timeout

**Phase 0 path forward per codex's prediction:**
Next R-003 most likely lands at **`no_availability_correct` + `F-AVAIL-NONE`**
(not OTP, not drift, not timeout). The agent did the right thing — Buvette
8pm next Thursday simply doesn't have a slot.

WARM_SESSION_STRATEGY status: still 🔵 BLOCKED. R-003 path now diverged
from "needs OTP" to "no availability". Strategy doc remains correct as
design but trigger condition deferred further: only fires when OTHER cases
(R-006 / R-018 / etc.) hit OTP wall.

Awaiting codex's third R-003 live smoke (post-`2cbddfc` token-burn fix).
Two most-likely branches:
- `no_availability_correct + F-AVAIL-NONE` (~80% likely per codex) →
  see "spec gap on R-003 expectedOutcomes" below
- `ready_for_confirmation` (slot magically appeared) → archive WARM_SESSION,
  expand subset to R-006/R-007/etc.

## 📍 Strategic decisions locked

> Per CLAUDE.md § "协作协议" · "Strategic decisions section" — long-term
> memory layer for cross-phase / direction-setting decisions. Codex
> reads this before starting any non-current-phase work to verify no
> conflict with locked direction.

Format: `[YYYY-MM-DD] decision · phase · doc § section`

**Team / role allocation (NEW 2026-05-03):**
- 2026-05-03 Role allocation locked — codex 30-40% (architecture / core runtime / executor / benchmark / debug / merge), Claude 60-70% (pages / components / docs / tests / mock-to-real wiring / bulk UI). Cadence: Claude implements bulk → codex reviews contracts + risk → codex merges / fixes core conflicts. Hold rules unchanged (Claude doesn't touch `lib/core/execution/**` / `lib/execution-v2/**` / `worker/src/**` / `app/api/v1/**` unless explicitly delegated). · all phases · doc: `CLAUDE.md` § 协作协议

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor; legacy_stagehand becomes fallback only · Phase 0 · doc: `EXECUTOR_V2_PIVOT.md` § Why we pivoted
- 2026-05-03 Phase 0 OTP transitional rule (safe_handoff + F-PROVIDER-OTP per-case acceptable, 4-metric gate stays strict) · Phase 0 · doc: `BENCHMARK_RESTAURANT_100.md` § 7.5
- 2026-05-03 Q11 (R-003 expectedOutcomes spec gap) → option (a) explicit spec broadening, NOT runner auto-derive. R-003 expectedOutcomes now includes `no_availability_correct`. Future similar gaps: same pattern (explicit > implicit). · Phase 0 · doc: `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` git-based bus + 5 commit-msg tags · all phases · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools (MultiOn / Skyvern / browser-use / browser-harness / TuriX-CUA); revisit only with measured pain post-Phase-0 · Phase 0+ · chat decision (not in doc; see commit `c9733b6` PROJECT_SUMMARY cont. 1 era)

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session strategy first (Playwright `storageState`, no Browserbase Pro needed); Gmail OTP resume only as fallback if warm session fails · Phase 0/1 · doc: `WARM_SESSION_STRATEGY.md`

**Phase 1 plan:**
- 2026-05-03 Phase 1 = real user runs end-to-end booking in prod; 8 deliverables sequenced via critical path · Phase 1 · doc: `PHASE_1_PLAN.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) — keep self-serve consumer surface as credibility + edge-case sink + hedge against agent ecosystems competing; Vercel/Supabase/37signals model · Phase 2-3 · doc: `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 (cont. 2)
- 2026-05-03 Inspire mode / Daydream Explorer deferred to Phase 3 with 30-template gallery (NOT LLM-free-form) · Phase 3 · doc: `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 (cont. 2)
- 2026-05-03 Subscription gamification (referral / DR payer discount / completion credit) deferred to Phase 2-3; Phase 1 uses "do things that don't scale" landing-page copy + manual referral handling · Phase 2-3 · doc: `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 (cont. 3)

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel layered as A (venue/provider health, days-weeks TTL, ✅) + B (provider short-term state, 5-15min TTL, ✅) + C (live availability cache, ❌ EXPLICITLY NOT DOING due to 5min volatility + per-device fingerprinting + stale-cache-worse-than-no-cache); trigger ≥ 100 real bookings · Phase 4 · doc: `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 (cont. 3)
- 2026-05-03 PointsYeah adoption table (7 features mapped take/skip/timing); future "should we copy X from PointsYeah" discussions consult this table first · Phase 2-4 · doc: `PROJECT_SUMMARY.md` § Recent Updates 2026-05-03 (cont. 3)

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo Browserbase bill OR cofounder OR seed round; not before · Phase 4 · doc: `PROJECT_SUMMARY.md` § Browserbase Infra 演进路线图

**Out-of-scope (this phase):**
- 2026-05-03 OpenTable / hotel / flight / activity vertical expansion — Phase 2 only · doc: `PHASE_1_PLAN.md` § Out of scope
- 2026-05-03 Social Feed / ChatGPT Apps active engagement / B2B Lane C / live Stripe key — Phase 3 / on-demand only · doc: `PHASE_1_PLAN.md` § Out of scope

## 📩 Acks for codex's recent pushes

### `3c95561` + `be97b8d` — clean master baseline + merge rehearsal ✅ CONSUMED THIS COMMIT

**`3c95561 fix(build): restore clean master typecheck baseline`** —
17 pre-existing typecheck errors all resolved:
- `app/page.tsx` errors (9): `InlineBookingProfileGate` re-added (309
  LOC component restored from a prior delete) + `chat-replay` re-exports
  `InlineBookingProfileSnapshot`, `PendingConfirmSnapshot`,
  `PersistedDirectBookingPayload`, plus `pendingConfirm` /
  `inlineBookingProfile` added to `SessionReplaySnapshot` type
- `app/api/booking-jobs/[id]/{logs,start}/route.ts` (2): `line` property
  on `string` fixed by typing the `LiveLogLineEntry` object correctly
  (also fixed in `lib/live-log-store.ts` shape)
- `lib/core/execution/executor.ts:335` (1): args mismatch fix
- `lib/task-timeline*.ts` (2): `LiveLogLineEntry` re-exported from
  `lib/live-log-store.ts`
- Plus `lib/db.ts` / `lib/agent/planners/booking-links.ts` /
  `worker/src/booking-links.ts` small touchups

**`be97b8d [coord] update codex state after clean merge rehearsal`** —
codex confirmed:
- master @ `3c95561` + `origin/claude/festive-pare-f27273` merge: 0 conflicts
- post-merge tsc: clean
- post-merge check-drift: clean
- no token spend

This unblocks Phase 1 #1 (master typecheck) AND #4 (branch→master merge
gate). Track B branch now safely rebased on clean master via
`git merge origin/master` (this commit's automatic merge commit
`4f146f5`).

Track B response in this commit:
- Merged master into branch (0 conflicts, as codex's rehearsal
  predicted)
- Fixed `handleCancel` `useCallback` deps — added `taskId` to the array
  per codex's review note in `2167181`'s coord section
- Self-test on merged tree: tsc clean, vitest 137/137, drift only flags
  the CRLF false positive (see Q13 — codex's domain to normalize)

Codex's review feedback for `e098252`'s real-API wire all already
addressed in `e098252` itself or this commit. No further code changes
expected from review.

### `2167181 [handoff]` — expose profile gaps + mirror R-003 expectation ✅ CONSUMED THIS COMMIT

Codex's contract fix on `app/api/v1/travel-tasks/route.ts` /
`terminalDataForResult` for `needs_profile_data` now emits:
```ts
{
  terminalCode: "needs_profile_data",
  terminalReason: profileGap?.message ?? result.summary,
  profileGap,                           // full ProfileGap object
  missing: profileGap.missing,          // canonical field-id array
  profileGapScenario: profileGap.scenario,
}
```

These flow through `updateTravelTaskState(taskId, "awaiting_profile",
{ ...data })` into `appendTaskEvent(... "state_changed", { state, ...data })`.

My `deriveProfileGapState` in `app/tasks/[taskId]/page.tsx:786` already
reads:
- `evData.state === "awaiting_profile"` ✅
- `evData.missing` (string[]) ✅

**Zero code change needed in `e098252`** — contract aligned. Forward
compatibility upgrade: `evData.profileGap.message` (more precise than
`task.terminalReason`) and `evData.profileGapScenario` (more precise
than `task.scenario`) are available for future polish, but the existing
derivation is correct and will keep working.

Codex also mirrored Q11(a) into `benchmark/restaurant-resy-phase0.json`
R-003 case — `expectedOutcomes` now includes `no_availability_correct`.
**Q11 now fully resolved on both sides** (spec doc in
`BENCHMARK_RESTAURANT_100.md` § 4 + fixture aligned). Removed from open
questions.

Codex's review notes for `e098252` (in `2167181` coord-notes section):
- ✅ `credentials: "include"` correct for cookie-auth `/api/v1/*`
- ✅ `/continue` body `{ profile: payload.values }` matches Track A parser
- ✅ `POST /api/v1/execution-jobs/:jobId/cancel` no body correct
- ✅ 5s polling acceptable for Phase 1 founder testing; revisit when
  hidden-tab pausing is added or real traffic shows up
- ✅ Owner checks render fine without leaking ownership (401→sign-in /
  404→not-found UX)

No code changes from these review notes. Acked, captured here for
reference.

### `48c80b2 [handoff]` — cookie-auth travel task reads + profile patch ✅ CONSUMED THIS COMMIT

**Massive Phase 1 unblock** — 4 PHASE_1_PLAN deliverables resolved at once:
- #2 profile PATCH endpoint (`/api/v1/users/me/profile`)
- #3 cookie-auth proxy (built into v1 handlers via `requireApiActor`)
- #6 /tasks/[taskId] real fetch wire (THIS COMMIT)
- #7 ProfileGapCard production wire (THIS COMMIT — onSave hits
  `/continue`)

What I did in this commit:
- `app/tasks/[taskId]/page.tsx`: replaced 2 SWAP POINT mocks with real
  fetches (`/continue` for profile save; `/cancel` for stop button)
- `credentials: "include"` on all `/api/v1/*` fetches so Clerk cookie
  travels with the request
- 401 fallback changed from "needs-cookie-auth (waiting on codex)" to
  "needs-sign-in (sign in or try demo)" — cookie auth now LIVE
- Polling: refetch every 5s while task is in non-terminal state;
  auto-stops at completed/failed/cancelled
- Mutation states: button disabled during save / cancel; "Saving and
  resuming…" / "Cancelling…" copy
- `deriveProfileGapState(data)`: extract `missing[]` from latest
  `state_changed` event with `data.state === "awaiting_profile"`;
  trigger from task.scenario; reason from task.terminalReason
- Demo mode preserved: `/tasks/demo-*` still works; mutations just
  alert (no real network) so the form UX is testable without an account

### Q11 (a) → SPEC BROADENING SHIPPED ✅

Per user's locked decision: option (a) — explicit spec broadening for
R-003, NOT runner auto-derive. THIS COMMIT:
- `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row updated
  expectedOutcomes: `ready_for_confirmation > safe_handoff` →
  `ready_for_confirmation > safe_handoff > no_availability_correct`
- acceptableFailureTaxonomy unchanged (F-AVAIL-NONE / F-PROVIDER-OTP)

**Codex action item**: mirror this in
`benchmark/restaurant-resy-phase0.json` R-003 case → add
`"no_availability_correct"` to `expectedOutcomes`. No fixture change
otherwise; no runner change.

### `2cbddfc [handoff]` — trust no-availability + stop visual time ladders ✅ CONSUMED

Token-burn fix — second live smoke proved exact-venue repair works but
legacy time ladder kept burning. computer_use path now skips Phase 2 time
fallback when no_availability detected (one visual run already evaluates
the requested window). Legacy fallback (still kept for non-CU paths) now
rewrites the time params in Resy/OpenTable URLs synchronously instead of
keeping the original startUrl time. 4 new unit tests in
`recovery-time-url.test.ts` (lib + worker mirror).

Track B response (this commit):
- Spec gap discovered (see Open questions Q11 below)
- WARM_SESSION_STRATEGY status banner updated — R-003 path no longer
  expected to reach OTP (different problem now)
- No code changes; awaiting codex's next R-003 result before any spec
  broadening

### `b376b80 [coord]` — codex state update ✅ noted; no action

### `d79364f [handoff]` — `--confirm-suite` 2nd-layer spend guard ✅ CONSUMED

Best-in-class engineering: even with `--live-openai` flag set, multi-case
runs require additional `--confirm-suite` flag. This means an accidental
`--live-openai` typo at most burns ONE case, not 25. Pairs with the
`--live-openai` guard from `d1fd102`. Hold rules updated to mention this.

### `a0ce2ee [handoff]` — keep Resy benchmark on exact venue page ✅ CONSUMED

First R-003 live smoke result (codex shared in chat):
- outcome: `failed_with_clear_reason`
- taxonomy: `F-PROVIDER-UNKNOWN`
- final URL: `resy.com/.../search?date=2026-05-07&seats=1&query=Buvette&time=2100`
- task: `ad16b246-d75b-44ed-9c80-284582c33729`

Diagnosis: CU agent drifted from Buvette venue page to Resy `/search`,
also picked wrong time (21:00 vs requested 20:00). Real blocker is
navigation drift, NOT OTP.

Codex's `a0ce2ee` repair:
- R-003 start URL now carries explicit `&time=2000`
- CU prompt instructs agent to stay on exact venue page (no general search)
- Auto-pullback: if drift detected to `/search`, runner pulls back to
  exact venue URL, max 2 retries
- Local gates verified (tsc / check-drift / R-003 dry-run); no second live burn

Track B response (this commit):
- GateBreakdown gains a `navigation_drift` recommendation kind. Pattern:
  `taxonomyCode === "F-PROVIDER-UNKNOWN"` AND `terminalReason` contains
  `/search` / `?query=` / `search?`. Surfaces case IDs + cites `a0ce2ee`'s
  fix. Independent of threshold state — fires even on a passing run.
- 4 new tests in `GateBreakdown.test.tsx` covering drift detection
  (single case / no-drift control / multiple cases / passing-run drift)
- WARM_SESSION_STRATEGY.md gains a status banner — BLOCKED until R-003
  actually reaches OTP wall. Doc remains technically correct as design.

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
| ~~Master typecheck cleanup (17 TS errors)~~ | Can't safely re-merge master into branch until clean | ✅ Resolved by codex `3c95561` (THIS commit consumed it) |
| `/api/v1/users/me/profile` PATCH endpoint | NLU `apply_profile_patch` route needs a real consumer | Codex aware; not yet started |
| Cookie-auth proxy for `/api/v1/travel-tasks/*` | Browser-side `/tasks/[taskId]` page + dashboard drawer drill-down | Codex says: in flight |
| Single R-003 live smoke output (post-`a0ce2ee` navigation repair) | Dashboard ready to render; navigation drift detection added to GateBreakdown | Pending codex's no-token-gates pass + 2nd smoke |
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
| `this commit` | `[unblocked]` merge clean master + handleCancel deps fix | Consumed `3c95561` + `be97b8d`. `git merge origin/master` produced auto-merge `4f146f5` with 0 conflicts. Fixed `handleCancel` `useCallback` deps (added `taskId`). Tsc clean, vitest 137/137, drift only flags CRLF false positive (Q13 raised). |
| `4fe374d` | `[coord]` sha fix-up e378101 | trailing |
| `e378101` | `[coord]` ack 2167181 + Phase 1 UI merge notes | Verified 2167181 contract aligns with deriveProfileGapState (zero patch). Self-test passed (tsc / drift / vitest 137). Authored PHASE_1_UI_MERGE_NOTES.md for codex's merge rehearsal — files / demo routes / test commands / known risks. Q11 closed both sides. Q12 (pre-existing drift in codex domain) raised. |
| `2f5a2b2` | `[coord]` sha fix-up e098252 | trailing |
| `e098252` | `[unblocked]` consume codex 48c80b2 + Q11 (a) + role allocation lock | /tasks/[taskId] real API wire (cookie-auth + polling + mutations); R-003 spec broadening (no_availability_correct in expectedOutcomes); CLAUDE.md § 协作协议 role allocation section. ~~Codex action: mirror R-003 fixture~~ ✅ done in 2167181. |
| `8e3258d` | `[coord]` protocol upgrade: 📍 Strategic decisions section + populate | NEW required H2 in schema; CLAUDE.md § 协作协议 updated with format + obligations |
| `1c4647a` | `docs(strategy): data flywheel + subscription gamification` | cont. 3 in PROJECT_SUMMARY |
| `5c6e70e` | `docs(strategy): hybrid positioning lock` | cont. 2 in PROJECT_SUMMARY |
| `7bcbfd8` | `[coord]` sha fix-up ab9f69c | trailing |
| `ab9f69c` | `[coord]` ack codex 4-commit run + Q11 spec gap | New Q11 about R-003 expectedOutcomes vs F-AVAIL-NONE → no_availability_correct mapping. WARM_SESSION_STRATEGY status updated (R-003 path diverged from OTP). |
| `c9733b6` | `docs: PROJECT_SUMMARY refresh + PHASE_1_PLAN.md` | 350-line "Recent Updates 2026-05-03 (cont. 1)" + new 200-line PHASE_1_PLAN.md (8 deliverables, critical path, Phase 0→1 transition matrix) |
| `f718831` | `feat(tasks): /tasks/[taskId] task detail page` | 750-line production-ready UI with 5 demo states + 2 SWAP POINT comments. Phase 1 surface 0→95% UI complete |
| `d2f09b7` | `feat(dev): /dev landing page` | 5 routes + 5 docs + coord links one-stop index |
| `07c860b` | `[coord]` sha fix-up 72a3715 | trailing |
| `72a3715` | `[unblocked]` ack a0ce2ee + navigation drift detection | New `navigation_drift` rec in GateBreakdown surfaces F-PROVIDER-UNKNOWN + drift hint with cite to `a0ce2ee`. WARM_SESSION_STRATEGY status banner: BLOCKED until R-003 reaches OTP. 4 new tests. |
| `2201a25` | `[handoff]` warm session strategy doc | 318-line spec + 3-step PoC plan + 5 risks; status now BLOCKED waiting for R-003 to reach OTP layer |
| `a93c015` | `[coord]` sha fix-up 2909d80 | trailing |
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

### Q11 ✅ RESOLVED (2026-05-03)

R-003 `expectedOutcomes` spec gap closed end-to-end:
- `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row updated by Claude (e098252)
- `benchmark/restaurant-resy-phase0.json` R-003 case mirrored by codex (2167181)

Both sides now list `ready_for_confirmation > safe_handoff >
no_availability_correct`. Acceptable failure taxonomy unchanged
(F-AVAIL-NONE / F-PROVIDER-OTP). Future similar gaps follow same pattern
(explicit spec broadening, NOT runner auto-derive — locked in 📍
Strategic decisions).

### Q12 ✅ partially resolved (2026-05-03)

`lib/live-log-store.ts ↔ worker/src/live-log-store.ts` drift was fixed
by codex's `3c95561 fix(build): restore clean master typecheck baseline`
(real shape edit). The other half of Q12 (`lib/booking-autopilot/dry-run.ts`)
turned out to be **CRLF/LF false positive on Windows only** — see Q13
below.

### NEW — Q13: CRLF/LF false positive on Windows for `dry-run.ts` pair

After merging clean master, `npm run check-drift` flags
`lib/booking-autopilot/dry-run.ts ↔ worker/src/booking-autopilot/dry-run.ts`.
`diff` shows `1,39c1,39` (every line differs) which is the classic
line-endings-differ signature. `file` confirms:
- `lib/booking-autopilot/dry-run.ts`: UTF-8 (LF only)
- `worker/src/booking-autopilot/dry-run.ts`: UTF-8 with CRLF terminators

Codex's rehearsal on Linux/Mac would not see this (git's autocrlf
typically normalizes on those platforms). Windows clones with
`core.autocrlf=true` (Windows default) get CRLF for one of the two
copies depending on file history.

**Real fix (codex's domain — `worker/src/**` is in my hold rule):**
- Either: add `.gitattributes` rule forcing both files to LF
  (`*.ts text eol=lf`)
- Or: pick a canonical side and normalize via `dos2unix` / `unix2dos`,
  commit, and let `.gitattributes` enforce going forward

I'm NOT touching either file. **Drift check on Windows will keep flagging
this pair until codex normalizes.** Not blocking the master merge (codex
already verified merge rehearsal clean on his side).

### Original Q12 (pre-existing drift in codex domain) — kept for history

`npm run check-drift` (run on this branch immediately after consuming
`2167181`) flags two pairs as out-of-sync:

```
lib/booking-autopilot/dry-run.ts  ↔  worker/src/booking-autopilot/dry-run.ts
lib/live-log-store.ts             ↔  worker/src/live-log-store.ts
```

These are NOT introduced by my recent commits (e098252 / 2f5a2b2 /
2167181 don't touch any of the four). Last touching commit on the
worker side is `7e706e7 chore(b+b2): drift guard + sync remaining
lib/worker pairs` (codex domain per CLAUDE.md hold rule "lib +
worker/src must align").

I'm NOT fixing these — `worker/src/**` is in my hold-rule list. Flagging
for codex to pick a canonical side and `cp` the other. This will need
to be clean before any branch→master merge that runs check-drift in CI.

### Existing 5 questions from `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex":

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
