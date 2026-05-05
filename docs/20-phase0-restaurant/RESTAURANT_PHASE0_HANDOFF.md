# Restaurant Phase 0 Handoff

> Purpose: let a fresh Codex/Claude session continue the restaurant execution work without relying on chat history.
> Scope: Resy + OpenTable restaurant booking execution, Phase 0A/0B, debug/observability, and coordination.
> Last updated: 2026-05-05 by Codex on `codex/phase-closure-orchestration-20260505`.

---

## 0. Current State

### Big Picture

Onegent is currently proving that a travel task runtime can complete a real restaurant reservation flow safely. The active wedge is restaurant booking, not hotels/flights/activities.

The immediate Phase 0A milestone is now met through OpenTable:

```text
restaurant request
-> provider selection
-> slot selection
-> profile/contact fill
-> stop before irreversible action or OTP
-> accurate task UI state + audit trail
```

2026-05-05 Sirrah OpenTable dogfood reached final review /
`ready_for_confirmation` with phone filled and stopped before
`Complete reservation` (`job=3bbe2ac4-c4cd-409f-8c11-6a83d2f81485`).
Do not expand Phase 2 promises yet; Phase 0B may now broaden restaurant
fixtures and Phase 1 still needs human walkthrough acceptance.

### Phase Status

| Phase | Status | Meaning |
|---|---:|---|
| Phase 0A Restaurant provider closure | Closed | OpenTable Sirrah reached safe final-review handoff; no final confirmation clicked. |
| Phase 0B Restaurant v1 | Entry gate met | Broaden OpenTable-first fixtures; keep Resy as provider/network/IP follow-up. |
| Phase 1 Task/UI runtime | ~90-95% | Task UI, ProfileGapCard, homepage inline profile gap, benchmark dashboard mostly landed. |
| Phase 1.5 stability/observability | Starting | Need probe-first workflow, artifact viewers, trace capture, clearer task states. |
| Phase 2+ | Frozen | No hotel/flight/activity implementation until restaurant and Phase 1 user path are stable. |

### Latest Codex Finding

Sirrah/OpenTable is the current Phase 0A positive closure evidence. Resy R-030
remains useful only as a follow-up provider/network diagnostic because the
founder observed Wi-Fi/IP availability differences versus mobile data. Do not
force Resy as the Phase 0A gate.

---

## 1. Start Here in a New Session

### Required First Commands

Use the e2e worktree unless the user explicitly says otherwise:

```powershell
cd C:\Users\Gzw19\onegent-e2e-20260503
git status --short
git branch --show-current
git log --oneline -8
```

Expected active Codex branch at the time of this document:

```text
codex/openai-chat-model-env
```

There may be untracked runtime logs:

```text
codex-next.log
codex-worker.log
```

Do not commit those logs unless the user explicitly asks for a log artifact.

### Read These Files First

Read in this order:

1. `docs/10-coordination/codex.md`
2. `docs/10-coordination/claude.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
5. `benchmark/restaurant-resy-phase0.json`
6. `scripts/probe-resy-availability.ts`
7. `scripts/run-phase0-resy-benchmark.ts`
8. `lib/booking-autopilot/providers/resy-com.ts`
9. `lib/booking-autopilot/providers/opentable-com.ts`
10. `worker/src/booking-autopilot/providers/resy-com.ts`
11. `worker/src/booking-autopilot/providers/opentable-com.ts`

If Claude's HUDDLE protocol has been merged, read `docs/10-coordination/HUDDLE.md` before the two per-agent files. If it is not present, use `docs/10-coordination/codex.md` as the live state source.

---

## 2. Hard Rules

### No Blind Live Runs

Do not run live OpenAI / Computer Use just to "see what happens".

Before any live run:

1. Run a no-token probe if the task depends on real availability.
2. Pick exactly one case.
3. Make sure the case has an actual target-window slot.
4. Ask for explicit approval to burn tokens.
5. Run visible when debugging browser behavior.

### No Final Booking Submit

The safe stopping point is one of:

```text
ready_for_confirmation
ready_to_review
OTP / verification required
safe_handoff
no_availability_correct
```

Do not click final irreversible booking/payment confirmation unless the user explicitly instructs it and the code path has a human-in-the-loop approval boundary.

### Mirror Worker Changes

When editing provider/runtime logic under:

```text
lib/booking-autopilot/**
```

mirror the corresponding change under:

```text
worker/src/booking-autopilot/**
```

Then run:

```powershell
npx tsx scripts/check-drift.ts
```

### Do Not Conflate Providers

OpenTable and Resy are currently different execution paths:

| Provider | Current path | Notes |
|---|---|---|
| OpenTable | Legacy Stagehand/local Playwright programmatic provider | Mostly deterministic ladder, not Computer Use. |
| Resy | Computer Use through Executor V2 / phase0 runner | More non-deterministic, must be probe-first and visible for debug. |

Do not assume a fix in OpenTable applies directly to Resy. Reuse the strategy pattern, not the selectors.

### Coordination Rules

Codex owns:

```text
lib/booking-autopilot/**
worker/src/**
lib/execution-v2/**
lib/core/**
scripts/run-phase0-resy-benchmark.ts
scripts/probe-resy-availability.ts
benchmark/restaurant-resy-phase0.json
```

Claude should normally own:

```text
app/dev/**
components/**
lib/benchmark/* viewer/parser helpers
docs
tests for UI/parser helpers
```

If assigning Claude work, give him dashboard/tests/docs/artifact viewer tasks, not provider/runtime code.

---

## 3. Current Active Tasks

### Task A: Resy Fill Closure

Goal:

```text
Choose a Resy case with real target-window availability
-> run one visible live case
-> observe whether it reaches contact form / OTP / review
-> classify result correctly
```

Current recommended case:

```text
R-030 Charlie Bird, 2026-05-08 20:00, party 2
```

Why:

```text
npm run probe:resy -- --case R-030
```

returned target-window matching slots.

Success criteria:

| Result | Accept? | Meaning |
|---|---|---|
| `ready_for_confirmation` | Yes | Best case. The agent filled required fields and stopped safely. |
| `safe_handoff` with OTP/verification | Yes | Acceptable Phase 0 transitional result. |
| `no_availability_correct` | Yes for cases without slot, not for R-030 if probe found slots | Correct only when probe/no-token evidence says no slot. |
| Wrong venue/time/party | No | Severe error. Stop and fix. |
| Final booking submitted without approval | No | Severe error. Stop and fix. |

### Task B: OpenTable State Accuracy

OpenTable can reach a phone verification gate. The task UI must not call this "payment-ready" when it is actually OTP or user review.

Success criteria:

```text
OpenTable phone verification gate
-> task shows ready_to_review / OTP required / safe handoff
-> not payment-ready / CVC
-> browser stays open long enough for user review
```

### Task C: Observability

Stop relying on pasted terminal logs.

The desired developer loop:

```text
probe dashboard
-> choose live-safe case
-> run one case
-> benchmark report
-> debug artifact viewer with screenshots/logs
-> fix based on concrete artifact
```

Claude is already building:

```text
/dev/resy-probe-runs
/dev/benchmark-runs artifact rail
/dev/debug-artifacts
HUDDLE coordination protocol
```

Codex should review/merge these after checking that they consume actual Codex output shapes.

### Task D: No-Live Artifact Classification

After a Resy or OpenTable run already has DB/log/screenshot evidence, use the
pure artifact analyzer before deciding whether to patch or retry:

```powershell
npx tsx scripts/analyze-restaurant-artifact.ts .tmp\restaurant-artifact-bundle.json
```

Read `docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md` for the bundle
shape and supported classes. The analyzer is no-live: it does not run providers,
OpenAI, workers, browser automation, payment, OTP/CAPTCHA/login bypass, or
final confirmation.

---

## 4. Existing Commands

### No-Token Resy Availability Probe

Probe all Resy cases:

```powershell
npm run probe:resy
```

Probe one case:

```powershell
npm run probe:resy -- --case R-030
```

Optional visible/browser mode:

```powershell
npm run probe:resy -- --case R-030 --visible --screenshot
```

Probe output is written to:

```text
benchmark/runs/resy-availability-probe-<timestamp>.json
```

These files are runtime artifacts and may be gitignored.

### Resy Live Benchmark

Only after approval:

```powershell
npx tsx scripts\run-phase0-resy-benchmark.ts --case R-030 --live-openai --allow-failures
```

For R-003 no-availability classification only:

```powershell
npx tsx scripts\run-phase0-resy-benchmark.ts --case R-003 --live-openai --allow-failures
```

Do not run the full suite until single-case behavior is stable.

### Static Verification

```powershell
npx tsc --noEmit --pretty false
npx tsx scripts/check-drift.ts
```

Provider-specific tests:

```powershell
npx vitest run lib/__tests__/resy-provider-mobile.test.ts
npx vitest run lib/__tests__/opentable-provider-policy.test.ts
```

Phase 1 smoke:

```powershell
npm run smoke:phase1
```

---

## 5. What Happened Before

### OpenTable Debug History

OpenTable started failing at the phone-only checkout gate. The page showed:

```html
<input id="phoneNumber" autocomplete="tel" type="tel" placeholder="Phone number">
<button id="complete-reservation" data-test="complete-reservation-button">Complete reservation</button>
```

Problems found:

1. The provider misread phone-only gate as email/CVC/payment readiness.
2. Some wrapper APIs exposed partial Playwright/Stagehand methods.
3. Coordinate fallback clicked below the phone field.
4. Some helpers accepted `verified=false` for phone fields.
5. The task UI sometimes reported "ready for payment" even when user confirmation/OTP was required.

Useful approaches:

1. Build a strategy ladder, not one brittle selector.
2. Log each strategy attempt with a stable prefix.
3. Require verification before declaring automation success.
4. Keep browser open for manual review.
5. Stop before final submit.

The OpenTable pattern to reuse for Resy is:

```text
strategy-01 stable selector
strategy-02 direct DOM setter
strategy-03 coordinate typing / visual fallback
strategy-04 manual handoff with artifact
```

Do not reuse OpenTable selectors on Resy.

### Resy Debug History

Resy uses Computer Use. The R-003 Buvette case previously failed before fill because no target-window slots were available. This was fixed at the classification level:

```text
R-003 -> no_availability_correct / F-AVAIL-NONE
```

That is correct behavior for R-003 right now. It does not prove the Resy fill path.

The next proof must use a case that the no-token probe says has a matching slot, currently R-030.

---

## 6. Expected Failure Modes and Best Responses

### Failure: Prompt / Request Gets Flagged

Do not try to bypass safety filters with more aggressive wording.

Switch to:

```text
no-token probe
visible browser local debug
artifact inspection
manual approval before live
```

Use plain wording:

```text
Run a single visible local QA case for the restaurant booking flow.
Stop before final booking confirmation or OTP submission.
Capture logs and screenshots.
```

### Failure: Case Has No Slot

Do not fix selectors. Do not rerun live.

Run:

```powershell
npm run probe:resy
```

Pick another exact-match case with `use_for_live_fill_test`.

### Failure: Wrong Venue

This is severe.

Stop. Check:

1. fixture `resySlug`
2. provider exact venue guard
3. probe exact slug matching
4. task prompt parsing

Do not let a wrong-venue run reach confirmation.

### Failure: Browser Window Closes Too Fast

Expected debug behavior should be:

```text
browser remains open 60 minutes for manual review when a guest form or verification gate was reached
```

If it closes early, inspect:

```text
provider safety-net keep-open code
worker timeout
task terminal state mapping
browser lifecycle cleanup in executor
```

### Failure: No Red Cursor / No Visible Click

For OpenTable, prior debug cursor existed in the programmatic provider. For Resy Computer Use, visible cursor behavior depends on the Computer Use/harness path and may not show the same red dot.

Do not assume "no red dot" means no action happened. Check screenshots/action traces. If there are no traces, prioritize observability before more live runs.

### Failure: Logs Not Available

Codex should run and read terminal logs directly when possible. The user should not be required to paste routine logs.

Use:

```powershell
Get-Content .\codex-next.log -Tail 200
Get-Content .\codex-worker.log -Tail 200
```

If services are started manually in visible terminals, ask the user only for screenshots when UI state matters.

---

## 7. What Another Agent Should Do Next

### If Continuing Codex Work

1. Verify current branch and status.
2. Read `docs/10-coordination/codex.md`.
3. Run:

```powershell
npm run probe:resy -- --case R-030
```

4. If R-030 still has matching slots, ask user approval for one visible live run.
5. Run only:

```powershell
npx tsx scripts\run-phase0-resy-benchmark.ts --case R-030 --live-openai --allow-failures
```

6. Watch logs and artifacts.
7. Classify result.
8. If it fails, do not rerun blindly. Fix based on artifact.

### If Assigning Claude Work

Give Claude this kind of task:

```text
Build UI/tests/docs around actual Codex output.
Do not touch provider/runtime/worker.
Use no-token probe output and debug artifacts.
```

Good Claude tasks:

1. `/dev/resy-probe-runs` schema sync to `scripts/probe-resy-availability.ts`
2. `/dev/debug-artifacts` viewer for provider screenshots and summaries
3. `/dev/benchmark-runs` artifact rail and strategy-log panel
4. docs for probe-first live-run protocol
5. parser/tests for probe reports

Bad Claude tasks right now:

1. editing Resy provider logic
2. editing OpenTable provider logic
3. changing the live benchmark runner
4. changing Computer Use prompts
5. running live OpenAI tests

---

## 8. Completion Criteria

### Resy Phase 0A Can Be Called Closed When

At least one exact-match Resy case with probe-confirmed slot reaches one of:

```text
ready_for_confirmation
safe_handoff with OTP/verification
ready_to_review before final irreversible action
```

and:

```text
wrong venue = 0
wrong time = 0
wrong party = 0
unauthorized final booking = 0
hallucinated confirmation = 0
```

### Restaurant Phase 0B Can Start When

1. Resy single-case fill closure is proven.
2. R-003 no-availability classification remains correct.
3. OpenTable phone/OTP/review state is accurately represented in the task UI.
4. Debug artifacts are available without manual log paste.

### Do Not Declare Success If

1. The UI says ready/payment but the provider page is still blank.
2. The browser reached a wrong venue.
3. A final submit happened without approval.
4. The only passing run was a one-off stochastic Computer Use run with no artifacts.

---

## 9. Recommended Commit Labels

When something meaningful lands:

```text
fix(resy): reach contact handoff on R-030
fix(resy): classify verification gate as safe handoff
feat(resy): add probe-first availability selector
feat(dev): show Resy probe artifacts in dashboard
[coord] report Resy live fill outcome
```

If a commit proves OpenTable or Resy closure, say so explicitly in the commit message. The user wants an easy rollback anchor.

Examples:

```text
fix(opentable): complete phone gate to OTP handoff
fix(resy): complete slot-to-verification handoff for R-030
```

---

## 10. Short Version

If you only read one page:

1. Do not run R-003 to test filling; it currently has no slot.
2. Use `npm run probe:resy -- --case R-030`.
3. If R-030 still has slots, run exactly one visible live case with approval.
4. Stop at OTP/review/confirmation boundary, never final submit.
5. If it fails, inspect artifacts and fix one concrete failure, not the whole system.
6. Let Claude build dashboards/docs/tests; Codex owns provider/runtime/live runner.
7. Update coordination before push.

