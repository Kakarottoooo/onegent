# Warm Session Strategy — Phase 0 OTP bypass

> **Context**: BENCHMARK_RESTAURANT_100.md § 7.5 (Phase 0 OTP transitional rule).
> **Decision locked**: Option D — warm session first; Gmail OTP resume only as fallback.
> **Owners**: codex (PoC implementation) · Claude (spec + observability + tests).
> **Status**: 🔵 **BLOCKED** until R-003 reaches `F-PROVIDER-OTP` or `ready_for_confirmation` after exact-venue navigation repair.
> **Archive criteria**: when warm session reliably bypasses OTP for the 25-case Phase 0 suite OR the strategy is abandoned for Gmail OTP resume.

> ## ⏸ Status update — 2026-05-03 07:15 UTC (after second R-003 live smoke)
>
> **R-003 path no longer expected to reach OTP.** The case (Buvette next
> Thursday 8pm) appears to genuinely have no availability for the requested
> time, and codex's recent fixes (`a0ce2ee` exact-venue + `2cbddfc` no-time-
> ladder + URL time rewrite) mean the agent now correctly detects this and
> stops cleanly.
>
> Sequence so far:
> - R-003 #1 → drifted to /search (`F-PROVIDER-UNKNOWN`)
> - R-003 #2 → exact venue repair worked; CU reached Buvette and detected
>   no availability at 20:00/20:30/19:30; legacy time ladder kept burning
>   tokens until timeout (`F-INFRA-TIMEOUT`)
> - R-003 #3 (pending, post-`2cbddfc`) → most likely
>   `no_availability_correct + F-AVAIL-NONE` (the "agent did the right thing"
>   bucket)
>
> **Trigger condition for activating this doc has shifted**: warm session PoC
> only fires when a SUBSEQUENT case (R-006 / R-018 / etc., or a fresh Resy
> account) actually hits the OTP wall. R-003 specifically isn't going to be
> the trigger.
>
> Strategy doc remains technically correct — when SOME case hits OTP, this
> is the right approach. Activation timeline pushed to "after first
> Phase 0 case that does reach OTP", which may be never (Resy doesn't fire
> OTP on every session, only first-time-on-device).
>
> Decision tree update:
> - R-003 #3 = `no_availability_correct` → expand to R-006 (different venue,
>   different night). If R-006 reaches `ready_for_confirmation`, archive
>   this doc and proceed to subset → declare. If R-006 hits OTP, activate
>   this doc.
> - R-003 #3 = `ready_for_confirmation` → archive this doc, expand subset.

---

## TL;DR

Resy fires OTP **per browser session**, not per user account. If we can persist a logged-in browser context (cookies + localStorage + sessionStorage) and reload it on a new session, OTP only fires once per device, not per booking attempt.

**Good news**: the Computer Use executor (`lib/execution-v2/computer-use.ts`) uses **local Playwright chromium**, not Browserbase. Playwright ships `context.storageState()` for exactly this — save state, replay state, no special infra.

**PoC scope**: 2-3 days of work. Make-or-break by day 2: either Resy treats a replayed `storageState` as logged-in (warm session works → continue Phase 0 path) or it doesn't (anti-fingerprinting kicks in → fall back to Gmail OTP resume, 5d).

---

## Problem statement

Resy's reservation flow gates new browser sessions behind a one-time email/SMS verification. The flow:

```
fresh session → user.email → "we sent you a code" → enter 6-digit → continue
```

The OTP is checked against the **current device fingerprint + cookies**. If the same device has already verified once, subsequent sessions skip OTP for some TTL (observed: 7-30 days, depends on Resy's heuristics).

Currently, every R-003 invocation:
1. `chromium.launch()` — fresh browser process
2. `browser.newPage()` — fresh context (cookies blank)
3. Navigates to Resy → Resy sees blank cookies → fires OTP
4. CU agent gets stuck at OTP wall → Phase 0 reports `safe_handoff + F-PROVIDER-OTP`

This is what codex's `bd72f56` reported. The runner's outcome bucketing (`d1fd102`) now correctly classifies it as `safe_handoff` per § 7.5, but the 4-metric Phase 0 gate still requires **booking-ready ≥ 80%** — meaning at least 20/25 cases must clear OTP.

---

## What's already in the code

`lib/execution-v2/computer-use.ts:62`:

```ts
browser = await chromium.launch({
  headless: process.env.ONEGENT_COMPUTER_USE_HEADLESS !== "false",
});
const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
```

This uses Playwright's default behavior: every launch = isolated context, no persistence.

**The fix is one Playwright API call**: `browser.newContext({ storageState })`. We need:

1. Storage layer to **save** the post-OTP state (DB blob or filesystem)
2. Storage layer to **load** the saved state into the new context
3. Decision logic: which Resy account is this booking? Load that account's state.
4. Refresh logic: if the state expires, re-OTP and re-save (every 7-30 days).

---

## 3 approach options

### Option 1: Playwright `storageState` JSON (RECOMMENDED) ⭐

Use Playwright's built-in API directly.

**Save**:
```ts
const context = await browser.newContext();
const page = await context.newPage();
// ... user verifies OTP via Computer Use ...
const state = await context.storageState();
// state = { cookies: [...], origins: [{ origin, localStorage }] }
await db.update(resy_session_states)
  .set({ state_json: state, refreshed_at: new Date() })
  .where(eq(resy_session_states.account_email, accountEmail));
```

**Load**:
```ts
const stored = await db.query.resy_session_states.findFirst({
  where: eq(resy_session_states.account_email, accountEmail),
});
const context = await browser.newContext({
  storageState: stored?.state_json ?? undefined,
});
```

**Pros**:
- 0 new dependencies
- Playwright-supported, well-documented
- JSON-serializable → easy DB storage
- Works identically local + Browserbase (Browserbase exposes the same Playwright `BrowserContext` API)

**Cons**:
- Resy might detect "fresh User-Agent + replayed cookies" as suspicious (anti-fingerprinting)
- TTL is implicit (Resy decides when to re-OTP)
- Storage state is sensitive — full account access bundle

**Estimate**: 1.5-2 days
- 0.5 day: schema + migration for `resy_session_states` table
- 0.5 day: save/load helpers + integration with `runComputerUse()`
- 0.5 day: per-account routing (which account does this booking belong to?)
- 0.5 day: tests + benchmark validation

---

### Option 2: Persistent userDataDir (Chrome profile)

Use Playwright's `chromium.launchPersistentContext(userDataDir)` instead of `chromium.launch() + newContext()`.

**Pros**:
- Closer to "same browser device", less fingerprinting risk
- Existing pattern in `lib/booking-autopilot/stagehand-executor.ts` (`shouldUseRealChrome` path)

**Cons**:
- Worker process needs filesystem access to persist user data dirs (Railway has ephemeral filesystem; Phase 1 cutover broke when worker restarted)
- One profile per Resy account = filesystem fan-out
- Concurrency: only one process at a time can use a profile (Stagehand executor already hit `ECONNREFUSED` issues — see `lib/booking-autopilot/stagehand-executor.ts:823-829`)
- Doesn't work cleanly with Browserbase (their session lifecycle is short-lived)

**Estimate**: 2-3 days (more risk, more cleanup)

---

### Option 3: Browserbase persistent context (if upgrading to Pro)

Browserbase Pro plan offers persistent contexts via their API.

**Pros**:
- Browserbase manages the persistence layer, no DB schema needed
- Designed for this exact use case (replayable sessions)

**Cons**:
- **Requires Browserbase Pro subscription** ($99/mo per the roadmap in PROJECT_SUMMARY.md "Browserbase Infra 演进路线图")
- Decision was deferred to "early stage 100-500 users" — not now
- Locks us further into Browserbase (route B self-built farm needs migration path)
- Computer Use executor today doesn't even use Browserbase — would need full re-plumbing

**Estimate**: 2 days impl + the Pro subscription cost decision = blocked on a strategic call

---

## Recommended PoC plan (Option 1)

3-step staircase. Stop at any step that fails; fall back to Gmail OTP resume.

### Step 1: Manual capture (4 hours)

Goal: prove that a Playwright `storageState` JSON, captured from a manually OTP-verified Resy session, can be replayed into a NEW Playwright context and Resy treats it as logged in.

```bash
# 1. Open chromium manually, log into Resy with one account, complete OTP.
# 2. Run a one-shot script:
npx tsx scripts/capture-resy-state.ts --email user@example.com --output /tmp/resy-state.json

# 3. Run a one-shot replay:
npx tsx scripts/replay-resy-state.ts --state /tmp/resy-state.json --probe https://resy.com/account
# Expected: probe returns logged-in HTML (no OTP redirect, no "verify your identity")
```

**Pass criteria**: probe sees logged-in account name in DOM. **Fail criteria**: probe sees OTP page or login redirect.

If it passes → step 2. If it fails → Resy fingerprints against User-Agent / IP / TLS / Canvas fingerprint, can't fix cheaply, abort to Gmail OTP resume.

### Step 2: Wire into Computer Use executor (1 day)

If step 1 passes:

1. Add schema: `resy_session_states` table (account_email PK, state_json JSONB, refreshed_at)
2. Helper: `loadResySessionState(accountEmail)` / `saveResySessionState(accountEmail, state)`
3. Modify `runComputerUse()`:
   ```ts
   const state = await loadResySessionState(input.profile.email);
   const context = await browser.newContext({
     storageState: state?.state_json ?? undefined,
     viewport: DEFAULT_VIEWPORT,
   });
   const page = await context.newPage();
   ```
4. After successful flow (OTP completed by user), capture and save:
   ```ts
   const newState = await context.storageState();
   await saveResySessionState(input.profile.email, newState);
   ```

5. Re-run R-003 with a populated state → expect `ready_for_confirmation` (not `safe_handoff`)

### Step 3: Run small Resy subset (1 day)

If step 2 produces `ready_for_confirmation` for R-003:

1. Pick 5 cases from BENCHMARK_RESTAURANT_100 § 4 (R-003, R-006, R-007, R-014, R-019)
2. Run `--live-openai` with each, sequentially (not concurrent — same account)
3. Expect: 5/5 reach ready_for_confirmation OR safe_handoff (no failed_unknown / severe)
4. If 5/5 work → expand to full 25-case Phase 0 subset → declare Phase 0
5. If 1+ fails on something other than OTP → fix that failure (separate ticket); warm session is still validated

---

## Risks + mitigations

### R1: Resy detects replayed state as suspicious

**Symptom**: After Step 1, probe page shows OTP or login redirect even though cookies look intact.

**Mitigation**:
- Pin User-Agent + viewport + locale to match the capture session
- Use the SAME User-Agent both at capture and replay (capture stores it; replay sets it via `newContext({ userAgent })`)
- IP: if running locally both times, same residential IP. If running from Railway, this matters more — pin Browserbase IP region or accept higher OTP frequency.

**If still fails**: abandon warm session, go Gmail OTP resume.

### R2: Storage state expires faster than expected

**Symptom**: Step 2 works for 24-48h then re-fires OTP.

**Mitigation**:
- Add `refreshed_at` column; if older than 5 days, treat as "needs refresh" — fall back to OTP soft-handoff (the Phase 0 § 7.5 path) for that one booking, then re-save the post-OTP state.
- Eventually: backgrond job to refresh accounts proactively before TTL.

### R3: Multi-account confusion

**Symptom**: Two different bookings for two different Resy accounts; loading the wrong state would log the agent into the wrong account.

**Mitigation**:
- Always look up state by `accountEmail` (a property of the booking task, not global)
- If `accountEmail` is missing on the task, abort to OTP soft-handoff path (no warm session attempt)

### R4: Storage state JSON contains live credentials

The cookie set after OTP includes Resy's session token. Anyone with DB read access could replay it.

**Mitigation**:
- Encrypt `state_json` at rest using `lib/encryption.ts` (already exists for profile data)
- Match existing pattern: per-row encryption with the user's master key derived from auth context

### R5: Resy ToS

Reusing a logged-in cookie across automated sessions is technically a session, not an OAuth bypass — most sites consider this acceptable. But Resy's ToS could explicitly prohibit automation.

**Status**: review Resy ToS before launch (B2C-Tier user-action-on-behalf-of arguably falls under user-controlled automation). Not a Phase 0 blocker.

---

## Open questions for codex

When the PoC starts, codex needs to answer:

**Q6 (re-asked from `2909d80`)**: Browserbase session resumption — only relevant if we move to Browserbase later. For LOCAL Playwright (which is the current CU executor), Option 1 is fine; no Browserbase dependency.

**Q7 (re-asked)**: Cookie storage strategy — proposal: encrypted in `lib/db.ts` per-account (table `resy_session_states`); reuses `lib/encryption.ts` per-row encryption pattern. OK to proceed with this default unless concerns.

**NEW — Q8**: Does CU's prompt currently teach the agent "if you see a logged-in account, skip the login flow and go straight to search"? If not, and warm session lands a logged-in user on Resy's home page, the CU agent might still try to log in (redundant action, possibly resets state). Test in PoC step 1.

**NEW — Q9**: How should we route which Resy account is used for which booking? Options:
- (a) one Resy account per Onegent user (account_email = user.email)
- (b) shared "service account" pool (one Resy account serves multiple users)
- (c) explicitly user-bound only

Recommended: (a) for now; (b) is a Phase 4 optimization.

**NEW — Q10**: Where in the runner's flow should "save state after success" happen? Likely candidates:
- After `outcome === "ready_for_confirmation"` (cleanest — confirmed flow)
- After `outcome === "safe_handoff" && taxonomyCode !== "F-PROVIDER-OTP"` (also clean)
- NEVER on `failed_*` outcomes (state could be corrupted)

---

## Fallback: Gmail OTP resume (5 days)

Activated only if Option 1 step 1 or step 2 fails:

1. Fix Gmail OAuth refresh + token storage (codex hit `token_expired 401` in `bd72f56`) — 0.5-1 day
2. Persistent browser session across OTP wait (Browserbase session resumption API check) — 1-2 days
3. OTP read subroutine (Gmail API + regex extract from "From: Resy" emails) — 0.5-1 day
4. Code injection via Computer Use `type` action + verify completion — 0.5-1 day
5. Tests + benchmark validation — 0.5-1 day

**Total**: 2.5-5 days.

This path is harder because it requires keeping the SAME browser tab alive across the OTP wait (5-30s normally, but model-driven retries could push to 1-3 min). Computer Use sessions don't have an explicit "pause and resume" API; we'd need careful state machine work.

---

## Estimate summary

| Path | Best case | Realistic |
|---|---|---|
| Option 1 step 1 alone (validation) | 4 hours | 4 hours |
| Option 1 full PoC (steps 1+2+3) | 1.5 days | 2-3 days |
| Fallback: Gmail OTP resume (after Option 1 fails) | 2.5 days | 5 days |
| Worst case: Option 1 fails AND Gmail fails (need third path) | unknown | ≥ 1 week |

**Decision tree**:
- After Option 1 step 1: ~4 hours invested, know if path D viable
- After Option 1 step 2: ~1.5 days invested, know if R-003 reaches ready_for_confirmation
- After Option 1 step 3: ~2.5 days invested, know if Phase 0 declarable

---

## Pointers

- **Spec**: `BENCHMARK_RESTAURANT_100.md` § 7.5 (transitional acceptance rule that triggered this strategy)
- **Current CU executor**: `lib/execution-v2/computer-use.ts:62` (where storageState wiring goes)
- **Existing encryption**: `lib/encryption.ts` (per-row pattern to mirror for `state_json`)
- **Coordination**: `.coordination/claude.md` § "Open questions for codex" (Q6-Q10 above will move there if codex wants async review)
- **Fallback plan**: this doc § "Fallback: Gmail OTP resume"

---

*Written 2026-05-03 by Claude (Track B) while codex (Track A) ran the single R-003 live smoke. When R-003 lands, this doc tells us what to do based on the outcome:*

- *`ready_for_confirmation` → ignore this doc, expand to suite, archive*
- *`safe_handoff + F-PROVIDER-OTP` → execute PoC step 1*
- *anything else → triage that failure first, this doc waits*
