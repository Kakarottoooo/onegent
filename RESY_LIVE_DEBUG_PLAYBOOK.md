# Resy live debug playbook

> **For**: founder · codex · Claude. Read **before** asking codex to spend
> a live OpenAI token on Phase 0A Resy.
> **Author**: Claude (Track B); codex authors the runner / provider; this
> doc only describes the founder-facing decision flow.
> **Last updated**: 2026-05-04 (post `49b5670` Resy form strategy ladder)

This doc captures how to read `/dev/resy-run-analysis` and translate
its output into one of three actions:

1. **Allow a single live case** (the dashboard verdict is `RUN` and the
   founder explicitly approves the token spend).
2. **Stop and ask codex to fix the provider** (verdict is `DO_NOT_RUN`
   because the strategy ladder has been exhausted).
3. **Gather more data first** (verdict is `NEED_PROBE` or
   `NEED_ARTIFACTS`).

What this doc is NOT
────────────────────
- Not a replacement for `R003_LIVE_SMOKE_RUNBOOK.md` (codex's
  pre-token-spend checklist on the runner side). This playbook sits
  on top of that runbook and decides whether to even reach it.
- Not a guide to bypass OTP / CAPTCHA / login walls. **We do not
  bypass any of those.** Per § 7.5 OTP transitional rule, `safe_handoff`
  with `F-PROVIDER-OTP` is acceptable per-case; the founder enters the
  code manually.
- Not a guide to handle payment. **Payment is never automated.**
  Phase 0A explicitly stops at `ready_for_confirmation`; the founder
  clicks the actual confirmation button.

---

## How to read /dev/resy-run-analysis

The page has six panels; read top-to-bottom.

### 1. Top verdict card

The big bold text is one of:

| Verdict | What it means | Next action |
|---|---|---|
| `RUN` | Probe says ≥1 case has matching slots; no recent severe failure on those cases. | Copy the pre-baked single-case live command (only renders when verdict = RUN) and ask codex to run it. |
| `DO_NOT_RUN` | Recent benchmark hit slot/form failure with strategies exhausted, OR last run had a severe outcome. | Stop. Ask codex to fix provider; rerunning won't help. |
| `NEED_PROBE` | No probe data yet (or no benchmark either). | Ask codex to run `npm run probe:resy` first. |
| `NEED_ARTIFACTS` | Benchmark exists but neither strategy lines nor debug screenshots present — can't analyze. | Rerun with logging enabled before next live spend. |

The **reason line** below the label spells out the exact data point that
drove the verdict. If it surprises you, drill into the case table.

### 2. Failure-stage funnel

Seven boxes (eight including `unknown`) showing how many cases land in
each stage. Read left-to-right as the live flow:

```
probe_no_slot  →  slot_api_available_dom_missing  →  slot_selection_failed
                   →  guest_form_reached  →  guest_form_incomplete
                       →  otp_or_login_required  →  ready_for_confirmation
```

The further right the count concentrates, the better the run got. Cases
in `unknown` need manual review of `terminalReason` in the benchmark report.

### 3. Latest case table

One row per case in the latest benchmark report (or per probe-only case
if no benchmark exists yet). Columns:

- **Case** — fixture caseId (e.g. R-030)
- **Source** — `benchmark` or `probe-only`
- **Outcome** — Phase 0 outcome bucket from the report
- **Stage** — failure stage classification + one-line reason
- **Strategies** — strategy chips: green = all-ok, red = all-fail,
  neutral = mixed/step-only
- **Probe** — what probe said about this case (cross-validation)
- **Artifacts** — links to per-case benchmark / task / debug-screenshots

### 4. Strategy ladder matrix

Rows: every unique strategy id seen across all cases (e.g.
`rs-slot-01-direct`, `rs-phone-04-mouse-keyboard`,
`rs-confirm-03-dom-frame`).

Columns: ok count · fail count · steps fired · fields filled ·
latest detail (success or failure) · which cases.

This is the panel codex will look at first when fixing a strategy:
it tells them which strategy is failing, in which case, with what
detail.

### 5. Founder inputs needed

Bullet list of manual actions the founder must take. Examples:

- **OTP / login code** — if the run hit `otp_or_login_required`,
  founder must paste the code from email/SMS.
- **CAPTCHA solve** — we never bypass; a human completes the challenge.
- **Final confirmation click** — Phase 0A stops at
  `ready_for_confirmation`; founder makes the actual booking decision.

If this list is empty, the run can proceed without manual founder action.

### 6. Footer

Generation timestamp + which benchmark file + which probe file the
analysis used. Click `Refresh` to re-aggregate after codex pushes a
new run.

---

## When is a single live case ALLOWED?

**ALL of the following must hold:**

1. ✅ Top verdict says `RUN`.
2. ✅ Probe is fresh (< 24h old) — checked by the readiness page; if
   stale, rerun probe first.
3. ✅ Founder explicitly approves the token spend (this doc is not
   approval; the founder must say "yes go".)
4. ✅ Strategy ladder for the recommended case shows no exhausted
   family — if `rs-slot-*` already has all attempts in fail state for
   the same case, fix first, don't rerun.
5. ✅ R003_LIVE_SMOKE_RUNBOOK § 0–§ 1 checklist passes (codex's domain).
6. ✅ Codex's `.coordination/codex.md` is not in the middle of an
   in-flight provider patch on the same code path.

If any one fails → STOP.

---

## When STOP — don't burn another token

| Condition | Why |
|---|---|
| Verdict is `DO_NOT_RUN` for the same case as the last run | Strategy ladder needs a fix, not a retry. |
| Stage funnel concentrates at `slot_selection_failed` AND `rs-slot-*` ladder has all attempts failed | Provider needs the next strategy added (codex domain), not another live token. |
| Stage funnel concentrates at `guest_form_incomplete` AND every `rs-phone-*` shows fail across multiple cases | Form schema may have changed; codex needs a no-token reproduction first. |
| Last run hit OTP **3+ times across different cases** | This is the Warm session strategy trigger (`WARM_SESSION_STRATEGY.md`); don't keep paying tokens to discover OTP exists. |
| Founder inputs list contains "CAPTCHA solve" | We don't bypass CAPTCHA; running again will just hit it again. |
| Latest benchmark `severe = true` for any case | Severe outcomes are spec violations; codex must root-cause before next live. |

---

## What founder must provide (checklist)

Before approving a token spend the founder should be able to provide:

- [ ] **Email access** — for OTP code paste (Resy emails the code to
      `gzw13979725269@gmail.com` per the test profile).
- [ ] **Phone access** — for SMS OTP fallback. **We do not auto-fetch
      SMS codes**; founder reads them from the device.
- [ ] **Booking decision** — at `ready_for_confirmation`, founder
      decides if the slot is acceptable and clicks confirm. **We never
      auto-confirm.**
- [ ] **Payment method** — if booking requires holding card, founder
      enters details directly. **We never store / auto-fill payment.**

These are non-negotiable safety boundaries even if the code path *could*
technically automate them.

---

## What this dashboard does NOT do

- Does not run live OpenAI calls. Read-only.
- Does not bypass OTP / CAPTCHA / login. Read-only.
- Does not auto-confirm bookings. Read-only.
- Does not handle payment. Read-only.
- Does not provide a "run live" button — only copy commands. Live spend
  stays a manual terminal step that codex / founder explicitly invoke.
- Does not modify provider / runtime / runner code. Track B observability
  only.

---

## Related dashboards

- `/dev/restaurant-readiness` — single-screen go/no-go (this dashboard's
  upstream consumer).
- `/dev/resy-probe-runs` — probe runs detail (this branch's upstream data
  source for "is there a slot").
- `/dev/benchmark-runs` — benchmark report detail (this branch's upstream
  data source for "did the live run pass").
- `/dev/debug-artifacts` — worker debug screenshots viewer.

---

## Related docs

- `R003_LIVE_SMOKE_RUNBOOK.md` — codex's pre-token-spend checklist
- `RESY_AVAILABILITY_PROBE_PROTOCOL.md` — probe-first protocol context
- `BENCHMARK_RESTAURANT_100.md` § 7.5 — OTP transitional rule
- `WARM_SESSION_STRATEGY.md` — Phase 0 OTP path D PoC plan
- `PHASE_STATUS.md` — Phase 0A overall status
