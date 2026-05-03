# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-03 15:25 UTC
> **Last commit**: this commit ([coord] post Phase 1 UI ship — branch caught up to master)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`
> (codex adopted protocol in `1bcb076` — handshake complete).

## 🟢 Currently doing

🎉 **Phase 1 UI shipped to master via codex `c2be764`.** All Track B
Phase 1 surface code (88 files, ~21,700 LOC additions) now lives on
`master`. Coord protocol upgrade also shipped.

**This commit's housekeeping**:
- `git merge origin/master` into `claude/festive-pare-f27273` to catch
  branch up. Auto-merge by 'ort' strategy. 0 manual conflicts.
- 3 paths touched in merge:
  - `app/tasks/[taskId]/page.tsx` — auto-merged, codex re-applied my
    `handleCancel` `taskId` deps fix on his side; both versions matched
  - `.claude/settings.local.json` — codex excluded from master per his
    discretion; local settings stay local
  - `.coordination/codex.md` — codex's own file (`d92d9f6` updates)
- `npm run check-drift` on this branch flags Q13 CRLF false positive
  ONLY (`lib/booking-autopilot/dry-run.ts ↔ worker/src/...`). Codex's
  Linux/Mac run reports clean — same Q13 root cause.

**Idle / awaiting direction.** Per codex's "next step":
- Codex will do a no-token founder E2E walkthrough (verifies
  `/tasks/[taskId]`, benchmark dashboard, ProfileGapCard render — no
  live OpenAI burn). Pending.
- I authored `PHASE_1_FOUNDER_E2E.md` (~559 LOC, 12-section manual QA
  script) for the user to run when ready.

**Possible next Track B work** (waiting for user direction):
- (a) Phase 1 #7 — wire `apply_profile_patch` intent into `app/page.tsx`
  homepage chat (replace legacy `InlineBookingProfileGate` with
  `ProfileGapCard` flow) — ~30 min
- (b) `/tasks/[taskId]` forward-compat polish — use
  `evData.profileGap.message` and `evData.profileGapScenario` (more
  precise than `task.terminalReason` / `task.scenario`) — ~20 min
- (c) Phase 2 plan draft (hotel / flight / activity vertical) — ~25 min

## 📍 Strategic decisions locked

> Per CLAUDE.md § "协作协议" · "Strategic decisions section" — long-term
> memory layer for cross-phase / direction-setting decisions. Codex
> reads this before starting any non-current-phase work to verify no
> conflict with locked direction.

Format: `[YYYY-MM-DD] decision · phase · doc § section`

**Team / role allocation:**
- 2026-05-03 Role allocation locked — codex 30-40% (architecture / core runtime / executor / benchmark / debug / merge), Claude 60-70% (pages / components / docs / tests / mock-to-real wiring / bulk UI). Cadence: Claude implements bulk → codex reviews contracts + risk → codex merges / fixes core conflicts. Hold rules unchanged (Claude doesn't touch `lib/core/execution/**` / `lib/execution-v2/**` / `worker/src/**` / `app/api/v1/**` unless explicitly delegated). · all phases · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol — every Claude task starts with "预计最快 X 分钟" estimate (best-case, no-conflict path). Codex follows same convention. · all phases · doc: chat decision (this session)

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor; legacy_stagehand becomes fallback only · Phase 0 · doc: `EXECUTOR_V2_PIVOT.md` § Why we pivoted
- 2026-05-03 Phase 0 OTP transitional rule (safe_handoff + F-PROVIDER-OTP per-case acceptable, 4-metric gate stays strict) · Phase 0 · doc: `BENCHMARK_RESTAURANT_100.md` § 7.5
- 2026-05-03 Q11 (R-003 expectedOutcomes spec gap) → option (a) explicit spec broadening, NOT runner auto-derive. Future similar gaps: same pattern (explicit > implicit). · Phase 0 · doc: `BENCHMARK_RESTAURANT_100.md` § 4 R-003 row + `benchmark/restaurant-resy-phase0.json`
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` git-based bus + 5 commit-msg tags · all phases · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools (MultiOn / Skyvern / browser-use / browser-harness / TuriX-CUA); revisit only with measured pain post-Phase-0 · Phase 0+ · chat decision

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session strategy first (Playwright `storageState`, no Browserbase Pro needed); Gmail OTP resume only as fallback if warm session fails · Phase 0/1 · doc: `WARM_SESSION_STRATEGY.md`

**Phase 1 status:**
- 2026-05-03 Phase 1 UI shipped to master via codex `c2be764` — 88 files / ~21,700 LOC. Pending: #5 OTP resume (conditional), #7 ProfileGapCard → homepage chat wire, #8 founder E2E walkthrough · Phase 1 · doc: `PHASE_1_PLAN.md` + `PHASE_1_UI_MERGE_NOTES.md` + `PHASE_1_FOUNDER_E2E.md`

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

## ⏳ Blocking on codex

| Blocker | Why I need it | Status |
|---|---|---|
| Founder E2E no-token walkthrough | Validates Phase 1 UI shipped to master actually renders / mutates correctly before user runs PHASE_1_FOUNDER_E2E.md | Codex says: in flight |
| Q13 CRLF normalization in `lib/booking-autopilot/dry-run.ts` ↔ `worker/src/booking-autopilot/dry-run.ts` | Windows clones flag false-positive drift; would prefer `.gitattributes` enforcement of LF | Pending — non-blocking; codex aware |
| Single R-003 live smoke (post `2cbddfc` token-burn fix) | Validates Phase 0 OTP path D readiness; dashboard ready | Pending codex's no-token gates pass + go decision |

**Resolved this round** ✓
- Phase 1 #1 master typecheck cleanup (codex `3c95561`)
- Phase 1 #4 branch → master merge (codex `c2be764`)
- Phase 1 #6 `/tasks/[taskId]` real API wire (Claude `e098252`, in master)
- Q11 R-003 expectedOutcomes spec gap (both sides aligned)
- Q12 `lib/live-log-store.ts` drift (codex `3c95561`)
- ProfileGapCard `onSave` resume (codex earlier)
- gpt-5.5 OpenAI access + GA Computer Use migration (codex earlier)
- Phase 0 OTP transitional rule (Claude `097741a` + codex `d1fd102`)

## 🤝 Open questions for codex

### Q13 — CRLF/LF false positive on Windows for `dry-run.ts` pair (open, non-blocking)

`lib/booking-autopilot/dry-run.ts` is LF-only; `worker/src/booking-autopilot/dry-run.ts` is CRLF. `diff -rq` (used by `npm run check-drift`) flags this as drift on Windows. Codex's Linux/Mac runs report clean — git's autocrlf normalizes during checkout there, but Windows clones ship CRLF for one of the two paths.

Real fix (codex domain — `worker/src/**` is in my hold rule):
- Add `.gitattributes` rule forcing both paths to LF (`*.ts text eol=lf` or `lib/**/*.ts text eol=lf` + `worker/src/**/*.ts text eol=lf`)
- Or: pick canonical side, run `dos2unix` once, commit, let `.gitattributes` enforce going forward

Until normalized, Windows users (me) see this drift; CI runs (Linux) don't. Not blocking any work.

### NLU consumer 5 questions (Phase 1 #7 prep)

From `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex":

1. **PATCH endpoint path** — `/api/users/me/profile` (cookie) vs `/api/v1/users/me/profile` (API-key)?
2. **Validation contract** — what error shape on field-level rejection?
3. **Idempotency** — is PATCH idempotent on retry?
4. **Telemetry** — should `apply_profile_patch` dispatches emit a client telemetry event?
5. **MCP path mid-flow state** — when chat surface is `tools/call`, how do we ack patch + leave booking state for the next call?

Resolve before Phase 1 #7 implementation. Low-priority right now since Phase 1 #7 hasn't started.

### Phase 0 warm session 2 questions (Q6-Q7, blocked status)

6. **Browserbase session resumption** — does the Pro plan / current API allow:
   (a) saving full cookie+localStorage state per Resy account
   (b) reloading that state into a NEW browser session AND having Resy treat it as logged-in (no OTP)?
7. **Cookie storage strategy** — encrypted in `lib/db.ts` / per-user / TTL? Aligns with how we already store profile data?

Resolve at warm-session PoC time. Currently blocked because R-003 won't trigger OTP; trigger condition deferred to other Resy cases.

## 📦 Recently shipped (Track B, last 6 commits since master merge)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `[coord]` post Phase 1 UI ship — branch caught up to master | Merge `origin/master` into branch (auto-merge clean). Coord state pruned. Strategic decisions retained. Q11 / Q12 marked resolved. Q13 CRLF still open. |
| `0497f25` | merge: bring origin/master into branch | Trivial 3-way merge; 3 files auto-merged (handleCancel deps already matched between branches; .claude/settings.local.json kept local; codex.md is codex's). |
| `2e6554e` | docs(phase-1): founder E2E walkthrough script | NEW `PHASE_1_FOUNDER_E2E.md` (~559 LOC, 12 sections). Manual QA script for the founder to run before shipping Phase 1. Includes pre-flight, 5 demo states, real flow with ownership boundary tests, profile PATCH curl tests, benchmark dashboard, mock profile-gap-flow, DR regression, bug template, exit criteria. |
| `b832d37` | `[coord]` sha fix-up 1c87c65 | trailing |
| `1c87c65` | `[unblocked]` merge clean master + handleCancel deps fix | Consumed codex `3c95561` + `be97b8d`. Added `taskId` to `handleCancel` `useCallback` deps. (Codex re-applied same fix during his merge — both copies match.) |
| `4fe374d` | `[coord]` sha fix-up e378101 | trailing |
| `e378101` | `[coord]` ack 2167181 + Phase 1 UI merge notes | Verified 2167181 contract (state_changed.data shape) aligns with deriveProfileGapState (zero patch). Authored `PHASE_1_UI_MERGE_NOTES.md` (88-file inventory + risks + checklist). Q11 closed both sides. |

## 🚧 Hold rules I'm respecting

- Never merge `claude/festive-pare-f27273` → `master` directly (codex handles all merges to master)
- Don't touch:
  - `lib/booking-autopilot/`
  - `lib/core/execution/`
  - `lib/execution-v2/`
  - `worker/src/**`
  - `app/api/v1/**`
  - `scripts/run-phase0-resy-benchmark.ts`
  - `app/api/booking-jobs/[id]/start/route.ts`
  - `benchmark/PHASE0_REPORT_CONTRACT.md`
  - `benchmark/fixtures/`
  - `lib/benchmark/phase0-report.ts`
  - `benchmark/restaurant-resy-phase0.json`
- Don't run `npm run dev` or worker (avoid stealing tasks during smoke run)
- **Don't run live OpenAI calls** — only codex runs the single R-003 live smoke after no-token gates pass
- **Don't run the 25-case suite** — only single R-003 until path D is validated
- Cross-boundary commits MUST tag `[delegated by codex]` or `[delegated by user]` per role allocation rules

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**` (all dev-only routes)
- `app/tasks/[taskId]/**`, `app/tasks/page.tsx` (Phase 1 surface)
- `lib/agent/nlu-v2/**` (chat / extractor / router / tests)
- `lib/ui-copy/**`
- `BENCHMARK_RESTAURANT_100.md`, `EXECUTOR_V2_PIVOT.md`, `TASK_RUNTIME_DESIGN.md`, `NLU_CONSUMER_CONTRACT.md`, `PHASE_1_PLAN.md`, `PHASE_1_UI_MERGE_NOTES.md`, `PHASE_1_FOUNDER_E2E.md`, `WARM_SESSION_STRATEGY.md`, `PROJECT_SUMMARY.md` (cont. 1/2/3 sections)
- All `__tests__/` for the above
