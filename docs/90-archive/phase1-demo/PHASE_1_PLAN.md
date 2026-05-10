# Phase 1 Plan — From declared to first paying user

> **Date opened**: 2026-05-03
> **Last updated**: 2026-05-03 (post Phase 1 #7 path B + hardening + smoke)
> **Status**: 🟢 ~95% shipped; **#8 founder E2E walkthrough is the only remaining gate** (#5 OTP resume conditional, doesn't fire unless Phase 0A picks Gmail OTP fallback)
> **Owners**: codex (Track A, backend) · Claude (Track B, UI + observability)
> **Archive criteria**: when (a) `claude/festive-pare-f27273` is merged to master ✅ (done via `c2be764`), (b) a real (non-fixture) Resy task runs end-to-end through `/tasks/[taskId]` in production (gated on Phase 0A R-003 live smoke #3), AND (c) the first paying user successfully completes a booking. Then this file moves to `PROJECT_SUMMARY_ARCHIVE_*` and Phase 2 plan opens.

---

## 📌 Status snapshot (2026-05-03)

每个 deliverable 的当前状态。详细解释见后面 § Deliverables 表。

| # | Item | Status | Closure commit |
|---|---|---|---|
| 1 | Master typecheck cleanup | ✅ done | codex `3c95561` |
| 2 | `/api/v1/users/me/profile` PATCH | ✅ done | codex `48c80b2` |
| 3 | Cookie-auth proxy `/api/v1/*` | ✅ done | codex `48c80b2` |
| 4 | Track B Phase 1 UI merge | ✅ done | codex `c2be764` |
| 5 | OTP resume | ⏸ conditional pending | gated by Phase 0A path choice |
| 6 | `/tasks/[taskId]` real API wire | ✅ done | Claude `e098252` |
| 7 | ProfileGapCard hookup to homepage | ✅ done | Path A `8500af3` + Path B `4cdaa36` + safety + hardening `f423b56` |
| 8 | Founder E2E walkthrough | ⏳ pending | gated by user (60-90 min manual + 30s `npm run smoke:phase1` preflight) |

**Bonus shipped (not on the original list but landed during Phase 1)**:
- ✅ Q15 Option (i): backend emits `payload.profile_gap` (codex `7289ba0`)
- ✅ Audit Finding 5: cancel updates `task.state` (codex `7289ba0`)
- ✅ Path B safety: `dispatchProfilePatch → Promise<boolean>` blocks booking on failed save (codex during `4cdaa36`)
- ✅ Path B hardening: helper extraction + 19 tests + `/dev/path-b-demo` (Claude `f423b56` cherry-pick)
- ✅ no-token founder smoke harness `npm run smoke:phase1` (Claude `f9dd0ba`)

**进入 Phase 1 declared 的最后一道门**: 用户跑完 founder E2E walkthrough，满足 § Definition of done 的 6 条。

---

---

## TL;DR

**Phase 0** = "Computer Use can technically book Resy" (engineering gate).
**Phase 1** = "A real user, in production, can run one-sentence-task → ready_for_confirmation → one-tap confirm" (product gate).

The gap is mostly **plumbing** (cookie-auth, profile PATCH, page wiring) plus **OTP resume** if warm session didn't close the loop in Phase 0.

Phase 1 is **not** Phase 2's vertical expansion (OpenTable / hotels / flights). Phase 1 is "make the one Resy path that Phase 0 declared actually consumable by a paying user".

---

## Definition of done

A logged-in user, in production, on `master` branch:
1. Sends a Resy booking task via the homepage chat
2. Sees `/tasks/[taskId]` with live timeline + snapshots
3. Hits a profile gap (e.g. needs DOB) → ProfileGapCard inline → fills → continues
4. Lands at `ready_for_confirmation`
5. Taps "confirm" in their own browser → reservation goes through
6. The ENTIRE round-trip uses cookie auth (no API key in the browser)

If 1-6 work for at least one user (could be the founder testing on a personal account), Phase 1 is declared.

---

## Deliverables

| # | Item | Owner | Est | Depends on | Status |
|---|---|---|---|---|---|
| 1 | Master typecheck cleanup (17 TS errors) | codex | 1-3h | — | ✅ done (`3c95561`) |
| 2 | `/api/v1/users/me/profile` PATCH endpoint OR cookie-auth equivalent | codex | 4-8h | #1 | ✅ done (`48c80b2`) |
| 3 | Cookie-auth proxy for `/api/v1/*` (browser session → API-key validity inside the proxy layer) | codex | 4-8h | #1 | ✅ done (`48c80b2`) |
| 4 | `claude/festive-pare-f27273` → `master` merge | codex | 1h | #1 | ✅ done (`c2be764`) |
| 5 | OTP resume **if** Phase 0 used the soft-handoff path AND warm session strategy didn't close the gap | codex | 2-5d | Phase 0 result | ⏸ conditional (gated by Phase 0A R-003 #3 outcome) |
| 6 | `/tasks/[taskId]` production wire (replace 2 SWAP POINT comments with real fetch calls) | Claude | 2h | #2, #3 | ✅ done (`e098252`; cookie-auth Just Works for real UUIDs, demo IDs hit fixture short-circuit) |
| 7 | ProfileGapCard wire to homepage chat (replace mock NLU consumer with real PATCH dispatch) | Claude | 4h | #2, #3 | ✅ done — Path A `8500af3` (mid-conversation `apply_profile_patch` dispatcher) + Path B `4cdaa36` (booking-blocked inline `ProfileGapCard`) + Path B hardening `f423b56` (helpers + 19 tests + `/dev/path-b-demo`) |
| 8 | First real user E2E walkthrough (founder test on production) | user | 1h | All above | ⏳ pending — checklist in `docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md`; preflight via `npm run smoke:phase1` (`docs/90-archive/phase1-demo/PHASE_1_E2E_SMOKE.md`) |

**Total work-time**: ~15-25 person-hours codex + ~6h Claude + 1h user = ~3 days realistic IF OTP resume is not needed; **~2 weeks** if OTP resume is part of Phase 1.

**Actual calendar (retrospective)**: opened 2026-05-03, ~95% shipped same day via codex backend + Claude bulk UI/docs split. Founder E2E walkthrough is the gating manual step. OTP resume hasn't fired (Phase 0A still in flight; warm-session-first decision still standing).

**Calendar time**: depends on how many of these can run in parallel.

---

## Critical path

```
   #1 typecheck
       │
       ▼
   #2 PATCH endpoint ─────┐
   #3 cookie-auth proxy   │
       │                  │
       │     ┌────────────┘
       ▼     ▼
   #4 merge master
       │
       ▼
   #6 /tasks/[taskId] wire    (Claude — 2h)
   #7 ProfileGapCard wire     (Claude — 4h)
       │
       ▼
   #5 OTP resume (only if Phase 0 didn't close it)
       │
       ▼
   #8 Founder E2E test
       │
       ▼
   Phase 1 declared
```

`#2` and `#3` can run in parallel after `#1`. `#4` is gated on both. `#5` only fires if Phase 0 didn't already close the OTP loop (e.g. warm session strategy from `docs/90-archive/phase0-restaurant/WARM_SESSION_STRATEGY.md` failed).

---

## Phase 0 outcome → Phase 1 starting position

| Phase 0 closure path | What's already done | What Phase 1 still needs |
|---|---|---|
| **Path A**: warm session worked, no OTP resume | OTP bypass via Playwright `storageState` | #1, #2, #3, #4, #6, #7 |
| **Path B**: Gmail OTP resume implemented in Phase 0 | Full Gmail integration + persistent session | #1, #2, #3, #4, #6, #7 (no #5) |
| **Path C**: Phase 0 declared with OTP soft handoff (booking-ready < 80% accepted) | Spec § 7.5 transitional acceptance | #1-#4, #5 (must do OTP resume now), #6, #7 |

**Most likely**: Path A (warm session works) → cleanest, fastest Phase 1.

---

## Risks + mitigations

### R1: codex's typecheck cleanup uncovers larger issue

The 17 errors include `lib/core/execution/executor.ts(335,61)` (arg count) and 2 missing exports (`LiveLogLineEntry`). Suggests recent refactor left stragglers. If fixing reveals deeper architectural drift, #1 could blow out from 1-3h to 1-2 days.

**Mitigation**: codex audits before estimating final number. If > 1 day, defer #1 and address ONLY the merge-blocking errors with `// @ts-expect-error` markers; clean up properly in Phase 1.5.

### R2: Cookie-auth proxy needs new auth design

Currently `/api/v1/*` requires API-key header. For browser flows, options are:
- (a) Issue per-session signed token, browser sends as `Authorization: Bearer <token>`
- (b) Proxy `/api/v1/*` through a Clerk-authed `/api/me/*/v1/...` shim that mints API-key context server-side
- (c) Co-locate cookie-auth in the existing `/api/v1/*` handlers (sniff cookie OR API key)

**Mitigation**: codex picks the simplest viable option. Lean toward (c) — least new code, smallest blast radius. Document the decision in docs/90-archive/old-provider-plans/EXECUTOR_V2_PIVOT.md.

### R3: ProfileGapCard production wire has more edge cases than the mock

The mock at `/dev/profile-gap-flow` covers happy path + 9 preset chips. Production will hit:
- Partial saves (user dismisses mid-form)
- Validation errors from PATCH endpoint
- Race conditions (NLU dispatches concurrent patches from chat history)

**Mitigation**: Claude writes integration tests for the 6 failure modes documented in `docs/90-archive/phase2-product-areas/NLU_CONSUMER_CONTRACT.md` § "Failure modes". Backend-side validation contract (PATCH endpoint open question Q2) becomes a hard input here.

### R4: First-user E2E test reveals UX gaps

Phase 0 declared = engineering gate. Phase 1 founder test will surface things like "the snapshot rail is too narrow on mobile", "the cancel button is too easy to mis-click", "the ProfileGapCard fields render weird on iPad". These aren't blockers per se, but accumulating polish costs.

**Mitigation**: founder test is structured — explicit checklist of 6 user actions, each timestamped. Anything that takes the founder > 30s to figure out goes in a follow-up Phase 1.5 polish ticket. Don't gate Phase 1 declaration on UX perfection; fix what's broken, defer what's awkward.

### R5: Stripe live key + first payment

Phase 1 declaration is about engineering closure. Whether to switch Stripe sandbox → live keys is a separate decision. Defer to Phase 2 prep unless first paying user blocks on Stripe.

**Mitigation**: founder test in Phase 1 uses Stripe sandbox; live key swap waits for user demand signal.

---

## Out of scope (Phase 2+)

Per the locked Phase 0 doctrine ("不做" list) — these stay deferred to Phase 2 / Phase 3 / Phase 4:

- OpenTable Phase 0 expansion (Phase 2)
- Hotel verticals — Booking.com / Expedia (Phase 2)
- Flight verticals — Expedia / Google Flights (Phase 2)
- Activity vertical — Viator (Phase 2)
- Social Feed MVP (Phase 3)
- ChatGPT Apps / claude.ai marketplace (Phase 3, passive review)
- B2B Lane C cold outreach (Phase 3)
- Self-built browser farm (Phase 4, triggered by ≥500 paying users)
- Live Stripe key (when first user blocks on it)

---

## Open questions (carried from `docs/90-archive/phase2-product-areas/NLU_CONSUMER_CONTRACT.md`)

These need answers before #6, #7 can ship cleanly. Rough ETAs based on dependency:

1. **PATCH endpoint path**: `/api/users/me/profile` (cookie) vs `/api/v1/users/me/profile` (API-key) vs both? **Resolved when #2 + #3 ship.**
2. **Validation error shape**: what does the endpoint return when DOB is in the future, phone is too short, passport_country isn't ISO-3?
3. **Idempotency**: PATCH retried on network failure → silent 200 or 409 conflict?
4. **Telemetry**: `apply_profile_patch` dispatches emit a client event so we can measure extractor accuracy regressions?
5. **MCP path mid-flow state**: when chat surface is `tools/call` not browser, how do we ack the patch + leave booking state for the next call?

Plus 5 warm-session-specific questions in `docs/90-archive/phase0-restaurant/WARM_SESSION_STRATEGY.md` (Q6-Q10) that fire only if Phase 0 went down the warm-session path.

---

## Phase 1 → Phase 2 transition

When Phase 1 is declared, Phase 2 (vertical expansion) opens. Estimated calendar:

- OpenTable Phase 0 (separate gate, same methodology) — 2 weeks
- First hotel platform (Booking.com baseline) — 2-3 weeks
- Expedia hotels (cribs Booking patterns) — 1 week
- Flights (most complex due to DOB/passport/KTN) — 3-4 weeks
- Activities — 1 week

**Total Phase 2**: 3-4 months.

Phase 2 inherits this plan's ownership matrix (codex backend, Claude UI/observability) but each vertical can move independently — they don't depend on each other architecturally.

---

## Pointers

- **State doc**: `docs/00-start-here/PROJECT_SUMMARY.md`
- **Phase 0 spec**: `docs/90-archive/phase0-restaurant/BENCHMARK_RESTAURANT_100.md`
- **Pivot doc**: `docs/90-archive/old-provider-plans/EXECUTOR_V2_PIVOT.md`
- **NLU contract**: `docs/90-archive/phase2-product-areas/NLU_CONSUMER_CONTRACT.md`
- **OTP strategy** (conditional): `docs/90-archive/phase0-restaurant/WARM_SESSION_STRATEGY.md`
- **Coordination**: `docs/10-coordination/{codex,claude}.md`

---

*Maintained jointly by codex (Track A) and Claude (Track B). When Phase 1 is declared (definition above), this file moves to archive and `PHASE_2_PLAN.md` opens.*
