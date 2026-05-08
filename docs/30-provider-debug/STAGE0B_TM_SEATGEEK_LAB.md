# Stage 0B — Ticketmaster + SeatGeek Skill Lab Runbook

Status: Stage 0B Workstream B (Claude / activity-focused side agent owner)
Last updated: 2026-05-08

This runbook is the controlled Browser Harness lab procedure for
Ticketmaster + SeatGeek **only**. It exists to evidence whether Onegent's
provider-skill model can recover from website changes safely without
turning Browser Harness into production runtime.

Read `docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md` first.
This file is the operating procedure and schema appendix for it.

---

## 1. Purpose and scope

The lab answers exactly four questions per run:

1. Does the activity skill resolver's classification (`exact_event` /
   `artist_or_performer` / `listing` / `search_results`) match what Browser Harness
   actually sees?
2. Can Onegent reach a safe boundary (safe handoff, user choice, hard
   stop) without entering forbidden surfaces (login, seat selection,
   payment, OTP, CAPTCHA, final confirm)?
3. Does the page render structural changes that should become a reviewed
   patch (selector drift, page-flow change, new page type)?
4. Is there enough evidence — screenshot + JSONL log + final URL — to
   defend the run as conclusive instead of "we tried but I'm not sure"?

Out of scope for Stage 0B:
- StubHub, Eventbrite, AXS (Workstream C corpus only).
- Any production wiring to `lib/booking-autopilot/**`, `worker/**`, or
  `app/api/booking-jobs/**`.
- Vendoring Browser Harness into this repo.
- Running real bookings end-to-end. Hard stops fire well before that.

---

## 2. Hard stops — the lab MUST halt before any of these

The lab is allowed to navigate, scroll, take screenshots, and read DOM
text. It is NOT allowed to act past any of:

| Hard stop | Lab response |
|---|---|
| `login_or_signin_wall` | Halt with `account_session_required`. |
| `captcha_or_challenge` | Halt with `provider_degraded`. |
| `otp_or_phone_verification` | Halt with `account_session_required`. |
| `seat_selection_required` | Halt with `user_seat_selection_required`. |
| `payment_form_visible` | Halt with `payment_or_final_action_required`. |
| `final_confirm_button` | Halt with `payment_or_final_action_required`. |
| `cookie_consent_blocking_render` | Halt with `provider_degraded`. |
| `harness_error_or_disconnect` | Halt with `provider_degraded` or `insufficient_evidence`. |

All hard stops MUST emit a `LabEvent` with `action: "halt_at_hard_stop"`,
the exact `hardStop` reason, and a screenshot before the run finishes.

The runner is forbidden from typing into any input element, from clicking
"Sign in", "Continue to checkout", "Confirm purchase", or any selector
that visibly resembles those actions. Selector drift on these is a hard
stop, not a recovery opportunity.

---

## 3. Prerequisites (operator setup)

The lab is operator-driven — there is no automation that runs
unattended. Before any run:

1. Browser Harness CLI is installed **outside** this repo. Confirm with
   `which browser-harness` (or the harness team's equivalent). Do NOT
   add a dependency entry under `package.json`.
2. The harness uses a fresh, anonymous browser profile. No production
   cookies, no Onegent OAuth, no user PII. The runner asserts the
   profile path is empty and refuses to start otherwise.
3. The local `.stage0b-evidence/` directory exists and is gitignored at
   the repo root (operators add the entry to their `.gitignore` if a
   new clone). Per-run subdirectories are named `<run_id>/`.
4. Network is on a normal residential link, not VPN'd through the
   product runtime. The lab is reproducing what a logged-out user sees.
5. Operator has read this runbook end to end.

If any prerequisite fails, the runner refuses to start.

---

## 4. JSONL event format

Per-run evidence is a JSONL file at
`.stage0b-evidence/<run_id>/events.jsonl`. One line per event. Lines are
written append-only as actions complete; an interrupted run still
produces a parseable file up to the last completed event.

### 4.1 Required fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `timestamp` | ISO 8601 string | yes | Wall-clock at event emit. |
| `run_id` | UUID string | yes | Stable per run. |
| `seq` | integer ≥ 1 | yes | Monotonic per run. |
| `provider` | `"ticketmaster" \| "seatgeek"` | yes | Stage 0B scope. |
| `page_type` | `TravelLinkPageType` | yes | From `lib/capture/travel-link-resolver`. |
| `action` | `LabAction` | yes | See § 4.3. |
| `currentUrl` | string | yes | Real URL at action time (may differ from input). |
| `outcome` | `"ok" \| "degraded" \| "halted" \| "error"` | yes | Per-action verdict. |

### 4.2 Conditional / optional fields

| Field | When required | Notes |
|---|---|---|
| `screenshotPath` | `action === "screenshot"` (required) | Relative path under `.stage0b-evidence/<run_id>/`. |
| `hardStop` | `action === "halt_at_hard_stop"` (required) | One of the reasons in § 2. |
| `visible_facts` | optional | Title / performer / city / venue / dates / times / candidate count / candidate labels / candidate links. Absence = "not observed", NEVER "absent on page". |
| `notes` | optional | Free-form. |

### 4.3 LabAction values

`navigate` · `screenshot` · `inspect` · `follow_safe_link` · `scroll` ·
`halt_at_hard_stop` · `complete`

The runner MUST emit at least one `screenshot` event and exactly one
`complete` event per run. The `complete` event is the final line.

### 4.4 Example record

```jsonl
{"timestamp":"2026-05-08T10:11:12.345Z","run_id":"7af3-...","seq":1,"provider":"seatgeek","page_type":"exact_event","action":"navigate","currentUrl":"https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493","outcome":"ok"}
{"timestamp":"2026-05-08T10:11:14.001Z","run_id":"7af3-...","seq":2,"provider":"seatgeek","page_type":"exact_event","action":"screenshot","currentUrl":"https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493","screenshotPath":"01-event-page.png","visible_facts":{"title":"Nashville SC vs Inter Miami","city":"Nashville","venue":"GEODIS Park","visible_dates":["2026-05-09"],"visible_times":["8:00 PM"],"candidate_count":1,"candidate_labels":["Nashville SC vs Inter Miami, May 9, 8:00 PM"],"candidate_links":["https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493"]},"outcome":"ok"}
{"timestamp":"2026-05-08T10:11:16.220Z","run_id":"7af3-...","seq":3,"provider":"seatgeek","page_type":"exact_event","action":"halt_at_hard_stop","currentUrl":"https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493","hardStop":"seat_selection_required","outcome":"halted"}
{"timestamp":"2026-05-08T10:11:16.500Z","run_id":"7af3-...","seq":4,"provider":"seatgeek","page_type":"exact_event","action":"complete","currentUrl":"https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493","outcome":"ok"}
```

The matching `lib/stage0b-skill-runtime/event-writer.ts` builder
validates each record against this schema before serializing.

---

## 5. L2RecoveryResult schema (per-run summary)

Each run also emits a single `result.json` next to `events.jsonl`. The
shape is `L2RecoveryResult` from `lib/stage0b-skill-runtime/types.ts`:

```ts
type L2RecoveryResult = {
  run_id: string;
  started_at: string;       // ISO
  finished_at: string;      // ISO
  provider: "ticketmaster" | "seatgeek";
  classification:           // see § 5.1
    | "exact_event_ready"
    | "single_candidate_ready"
    | "provider_listing_needs_choice"
    | "safe_handoff_reached"
    | "user_seat_selection_required"
    | "account_session_required"
    | "payment_or_final_action_required"
    | "provider_degraded"
    | "insufficient_evidence"
    | "skill_patch_needed";
  safe_next_action:         // derived from classification
    | "start_task"
    | "ask_user_choice"
    | "user_handoff_required"
    | "review_capture"
    | "review_patch_proposal";
  skill_patch_needed: boolean;
  skill_patch_proposal?: SkillPatchProposal;  // see § 8 below
  evidence: {
    input_url: string;
    final_url: string;
    final_page_type: TravelLinkPageType;
    jsonl_path: string;     // relative path to events.jsonl
    event_count: number;
    screenshot_paths: string[];
    visible_facts: LabVisibleFacts;
    hard_stops: LabHardStopReason[];
  };
  notes?: string;
};
```

### 5.1 Classification → safe_next_action mapping

Locked in `lib/stage0b-skill-runtime/l2-recovery-result.ts:RECOVERY_OUTCOMES`.
Tests in `lib/__tests__/stage0b-skill-runtime.test.ts` pin the table.

| Classification | Safe next action | Meaning |
|---|---|---|
| `exact_event_ready` | `start_task` | URL/page uniquely identifies an event; provider runtime can start. |
| `single_candidate_ready` | `start_task` | Listing has exactly one obvious candidate matching the user's constraints. |
| `provider_listing_needs_choice` | `ask_user_choice` | Listing/artist/grouping has 2+ candidates; user picks. |
| `safe_handoff_reached` | `user_handoff_required` | Provider page reached a user-controlled continuation boundary. |
| `user_seat_selection_required` | `user_handoff_required` | Seat picker visible. Lab MUST stop. |
| `account_session_required` | `user_handoff_required` | Login/account wall visible. Lab MUST stop. |
| `payment_or_final_action_required` | `user_handoff_required` | Payment / final-confirm visible. Lab MUST stop. |
| `provider_degraded` | `review_capture` | Page degraded / blocked / unavailable. |
| `insufficient_evidence` | `review_capture` | Missing screenshot/log/currentUrl. Inconclusive. |
| `skill_patch_needed` | `review_patch_proposal` | Structural change observed; reviewed patch should land first. |

`skill_patch_needed` MUST come with a populated `skill_patch_proposal`.
The builder enforces this; the runner cannot ship one without the other.

---

## 6. Run procedure

Controlled runner commands:

```bash
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --dry-run
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --dry-run --plan ticketmaster-forge --limit 20
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --provider ticketmaster --limit 10
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --provider seatgeek --limit 10
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --id tm-01
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --plan ticketmaster-forge --id tmf-01 --stop-on-error
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --plan ticketmaster-forge --id tmf-08 --keep-open
```

The live runner shells out to the external `browser-harness` CLI. It
opens the selected URL, waits for load, inspects visible DOM text,
optionally clicks exactly one safe ticket CTA when the page is an exact
event or a listing has one candidate, screenshots the resulting page,
and writes `.stage0b-evidence/<run_id>/events.jsonl` plus `result.json`.
It is forbidden from typing, filling inputs, pressing keys, or clicking
login, checkout, payment, or final purchase controls.

By default the live runner closes the lab tab it opened after screenshot and
JSONL evidence are written. This prevents Chrome tab buildup during 20-case
runs. Use `--keep-open` only when the operator intentionally wants to inspect
or continue from the live page after the run. Raw evidence remains the source of
truth either way.

`--plan stage0b` is the original 10 Ticketmaster + 10 SeatGeek plan.
`--plan ticketmaster-forge` is the Ticketmaster-only skill-forge plan in
`lib/stage0b-skill-runtime/ticketmaster-forge-plan.ts`. It contains 20
Ticketmaster seed URLs across artist, exact event, search, category, and venue
surfaces. Use it before promoting any Ticketmaster skill rule because it
exercises the founder-observed artist/listing cases where Onegent must ask the
user for event/date/time rather than silently choosing.

1. Operator picks a `LabTestPlanEntry` from `STAGE0B_TEST_PLAN`
   (`lib/stage0b-skill-runtime/test-plan.ts`) or from
   `TICKETMASTER_SKILL_FORGE_PLAN`
   (`lib/stage0b-skill-runtime/ticketmaster-forge-plan.ts`).
2. Operator confirms § 3 prerequisites.
3. Operator calls Browser Harness CLI (external) with the entry's URL.
4. Harness wrapper writes JSONL events to
   `.stage0b-evidence/<run_id>/events.jsonl` using `buildLabEvent` /
   `serializeLabEvent`. Screenshots land alongside it under
   `.stage0b-evidence/<run_id>/screenshots/`.
5. The wrapper enforces every hard stop in § 2. Before any click that
   would advance past a hard stop, the wrapper halts and emits the
   matching `halt_at_hard_stop` event.
6. After the harness completes (cleanly or via halt), the wrapper writes
   `result.json` using `buildL2RecoveryResult`.
7. Operator copies the run id into the cockpit / report at
   `docs/30-provider-debug/provider-closure-reports/`. Operator does
   NOT push raw screenshots or JSONL into git — evidence stays local.
8. Operator opens any `skill_patch_needed` proposals as standalone
   commits / PRs against Onegent reviewed by Codex.

---

## 7. 20-URL test plan

The plan lives in `lib/stage0b-skill-runtime/test-plan.ts` and is
double-checked against the URL resolver inside the Stage 0B no-live
test (`lib/__tests__/stage0b-skill-runtime.test.ts`). The two halves:

For Ticketmaster skill-forge work, use the separate
`TICKETMASTER_SKILL_FORGE_PLAN`. It is also pinned by no-live tests and is
selected with `--plan ticketmaster-forge`. Its classifications are stricter
than the resolver: an exact-event URL is not considered `exact_event_ready`
until the live lab observes a safe ticket continuation or reaches a known hard
stop. A loading page, 404, empty ticket widget, or exact-event page with no
candidate/hard-stop evidence becomes `skill_patch_needed` with a reviewed patch
proposal instead of a false success.

The runner's hard-stop detector must remain specific. Broad page text such as
`section` or `row` is not enough to call `user_seat_selection_required`; artist
and listing pages often contain those words in unrelated event cards. Seat
selection requires a strong seat-map signal, ticket/seat CTA, or section + row
context on an actual ticket/seat surface.

The same rule applies to payment boundaries. Venue FAQ copy such as "what
payment types are accepted" is not a payment form. `payment_form_visible`
requires a visible card/billing/CVV input or clear checkout/order-summary
context.

### 7.1 Ticketmaster (10)

| ID | Class | URL gist |
|---|---|---|
| `tm-01` | artist | Kacey Musgraves /artist/1668663 with `?ac_link=` |
| `tm-02` | artist | Foster The People /artist/1478293 with `?ac_link=` |
| `tm-03` | artist | Westminster Kennel Club Dog Show /artist/847597 |
| `tm-04` | artist | Monster Jam /artist/1542376 |
| `tm-05` | artist | Disney On Ice (find-your-tickets slug) /artist/1742147 |
| `tm-06` | exact event | Lion King NYC /event/Z1r9uZrrZbpZ1Avr9ea |
| `tm-07` | exact event | Hamilton NYC /event/A1B2C3D4E5F6 |
| `tm-08` | search | /search?q=lil%20wayne |
| `tm-09` | listing | /category/concerts |
| `tm-10` | artist | Sabrina Carpenter /artist/2932128 (high-traffic) |

### 7.2 SeatGeek (10)

| ID | Class | URL gist |
|---|---|---|
| `sg-01` | dated event | Nashville SC MLS 2026-05-09-8-pm /17921493 |
| `sg-02` | dated event | Chris Stapleton concert (date in segment 1) /17990981 |
| `sg-03` | dated event | Leanne Morgan comedy /18140651 |
| `sg-04` | dated event | Comedy AM-suffix dated /18234567 |
| `sg-05` | listing | The R and B Tour (no date) |
| `sg-06` | listing | Hamilton listing (no date) |
| `sg-07` | listing | 5-digit ID without date — defensive |
| `sg-08` | listing | Root host (no path) |
| `sg-09` | dated event | Same as sg-01 without query string |
| `sg-10` | dated event | World Cup soccer /18555111 |

The full plan with `expected_resolver_page_type` /
`expected_resolver_execution_mode` / human-readable `reason` is in the
TS file. The cockpit reads the same plan via the Stage 0B no-live
helpers — there is no second source of truth.

---

## 8. Outcome table template

After the 20 runs complete, the operator fills:

```text
Run id      | Plan id | Provider | URL gist     | Classification             | Safe next action       | Patch?
----------- | ------- | -------- | ------------ | -------------------------- | ---------------------- | ------
<uuid>      | tm-01   | tm       | kacey-mus..  | provider_listing_needs_..  | ask_user_choice        | n
<uuid>      | tm-02   | tm       | foster-..    | provider_listing_needs_..  | ask_user_choice        | n
<uuid>      | tm-06   | tm       | lion-king..  | safe_handoff_reached       | user_handoff_required  | n
<uuid>      | sg-01   | sg       | nashville..  | safe_handoff_reached       | user_handoff_required  | n
<uuid>      | sg-05   | sg       | r-and-b..    | provider_listing_needs_..  | ask_user_choice        | n
...
```

Per the Stage 0B success thresholds in
`ACTIVITY_PROVIDER_SKILL_RUNTIME.md § Success Criteria`:

- 20 lab runs across TM + SeatGeek with evidence bundles for each.
- 0 host impersonation escapes (covered by no-live fixtures pre-flight).
- 0 exact-event false positives (resolver disagreed with the harness).
- 0 listing pages treated as exact event evidence.
- 0 unsafe-boundary violations (login / seat / payment / final).
- ≥ 5 useful skill_patch proposals across the 20 runs.

---

## 9. Patch proposal flow (preview)

A `skill_patch_proposal` is a *proposal*, never a code change. See
`docs/30-provider-debug/STAGE0B_PATCH_PROPOSAL_TEMPLATES.md` for five
worked examples.

The proposal payload, also typed in `types.ts:SkillPatchProposal`:

```ts
type SkillPatchProposal = {
  kind: "selector_drift" | "page_flow_change" | "new_page_type"
       | "missing_filter" | "stricter_safe_handoff" | "host_pattern_extension";
  title: string;
  observed_evidence: string;     // What the harness saw.
  patch_target: string;          // Onegent file path the proposal would touch.
  proposed_change: string;       // Plain-English change.
  risk: "low" | "medium" | "high";
  evidence_event_seqs: number[]; // Cross-references to LabEvent.seq.
};
```

Ship rule: a proposal can only land via a Codex-reviewed PR with a
matching no-live fixture. The harness never edits production files.

---

## 10. Browser Harness invocation status for THIS branch

The integrated Stage 0B runner now supports real local `--live` Browser
Harness execution through `scripts/stage0b-activity-skill-lab-runner.ts`.
This source tree still commits only code, docs, and no-live tests; raw
provider evidence is created only when an operator runs the live command
locally, and that output stays under `.stage0b-evidence/`.

Browser Harness was **not** run in the branch that authored this
runbook. This file ships the schema, the helpers, the plan, and the
patch-proposal template; the actual lab runs are an operator-driven
follow-up. See the `Branch / commit / evidence paths` section of the
authoring branch's report for the explicit "no harness run" claim.
