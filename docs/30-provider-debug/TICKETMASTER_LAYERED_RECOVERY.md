# Ticketmaster Layered Recovery

> Last updated: 2026-05-07.
> For: anyone reading or extending the Activity / Ticketmaster runtime.
> Read after: `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
> and `docs/30-provider-debug/FAILURE_TAXONOMY.md`.

This doc captures Activity / Ticketmaster learnings as **L1 / L2 recovery
rules** so the next agent can:

1. Recognize each Ticketmaster surface and the recovery options that are safe
   on it.
2. Decide whether the v1 L1 provider runtime is enough, or whether an L2
   (Browser Harness) adapter would help, without re-debugging the layered
   stack from scratch.
3. Stop at the same boundaries the v1 runtime already stops at, and treat
   them as success, not failure.

Browser Harness is **L2 design input only** in this document. It is not in
the production runtime today. Do not promote it into v1 until the shared L2
contract exists. The 2026-05-07 founder dogfood closure was reached through
v1 `ticketmaster-rpa`, not Browser Harness.

## Why this doc exists

The 2026-05-07 founder dogfood request was "book The Lion King in New York
on May 30". The latest traced job is `46028ee4-c644-4df7-bee5-7bcb7d2713f9`.
Logs show:

```text
Stage progression
  artist_calendar
    -> calendar view opened
    -> May 30 2:00 PM slot selected
  artist_calendar (event drawer overlay)
    -> right-side Find Tickets drawer click
  event_seat_map
    -> /event/<id> URL reached, canvas seat map rendered
  user_seat_selection_required (safe handoff)
    -> Reserve still disabled; browser held open for manual review
```

This is the success path. The activity dogfood was accepted as closed. The
remaining items are runtime polish: external ad tabs stealing focus, the
seat-selection checkpoint not being explicit in the task UI, and stale
running/loading jobs after local browser/CDP disconnects. These are
classified, not patched in this branch (the runtime is mirror-safe; one
deterministic fix per evidence trail).

## L1 stages (current `ticketmaster-rpa` runtime)

The pure stage classifier is `classifyTicketmasterStage(snap)` in
`lib/booking-autopilot/providers/ticketmaster-rpa.ts`. It runs on a
`TicketmasterStageSnapshot` collected from the live page and returns one of
six stages.

| Stage | URL hint | DOM hint | Worker action | Recovery layer |
|---|---|---|---|---|
| `artist_calendar` | `/artist/<id>`, `*-tickets/` | none required | Locator + evaluate calendar slot click; then drawer Find Tickets click | L1 (programmatic) |
| `event_seat_map` | `/event/<id>` | `<canvas>` seat map, "Your Tickets" panel, or Reserve button present | Wait for user to pick a seat; poll Reserve enable | L1 (programmatic) |
| `ticket_selected` | `/event/<id>` | seat map + Reserve button enabled + section/row/seat label present | Click Reserve, advance to checkout | L1 (programmatic) |
| `account` | `auth.ticketmaster.com`, `/identity`, `/login`, `/signin`, "create account" | Sign-in heading, email input on `/checkout` | Hand off to user; do not enter credentials | L1 stop, user takes over |
| `checkout` | `checkout.ticketmaster.com`, `payments.ticketmaster.com`, `*/checkout` | order summary, conditions checkbox | Pass payment gate (tick conditions, click Proceed to Payment), select Credit/Debit Card radio; stop before CVV | L1 (programmatic) |
| `unknown` | unmatched TM URL | no hints | Caller decides; usually re-snapshot after a small wait | L1 retry |

**Account always wins.** If account signals are present, the classifier
returns `account` even when seat-map / Reserve signals are also there
(Ticketmaster sometimes layers a sign-in modal over the seat map).

**Stage transitions matter, not just the current snapshot.** A run that
goes `artist_calendar -> account` is a handoff, not a regression; a run
that stays at `artist_calendar` for the full poll budget is a fill failure.

## Known recovery triggers (rule -> action)

These are the deterministic recovery rules the v1 runtime already follows.
They are listed here so the next agent does not re-derive them from log
diving.

### Calendar surface (`artist_calendar`)

| Trigger | Action | Evidence in code |
|---|---|---|
| Calendar view not visible (only "Show events in calendar view" link) | `openCalendarViewWithLocators` clicks the toggle once; if it throws, fall through to the list view path | `ticketmaster-rpa.ts` `openCalendarViewWithLocators` |
| Target month not in current view | `navigateToTargetMonth` clicks month TAB directly first, then carousel scrollers; capped at 12 hops to avoid infinite loops on a bad DOM match | `ticketmaster-rpa.ts` `navigateToTargetMonth` |
| Calendar slot scan would hang the step | `clickCalendarSlot` runs a string-source `evaluateAndTagBestSlot` IIFE first, then a Playwright locator click against a `data-onegent-tm-pick` attr; both gated by a 6 s wallclock budget | `ticketmaster-rpa.ts` `evaluateAndTagBestSlot`, `clickCalendarSlotWithLocators` |
| Date not in task text (resident shows like Wicked / Hamilton) | `clickFirstAvailableSlot` picks the earliest visible time-slot button | `ticketmaster-rpa.ts` `clickFirstAvailableSlot` |
| Stagehand v3 strips `locator.scrollIntoViewIfNeeded` / `boundingBox` / `evaluate` | `safeScrollIntoView`, `locatorLooksVisible` typeof-guard each path; on full strip, assume visible and let `click({force:true})` gate | `ticketmaster-rpa.ts` `safeScrollIntoView`, `locatorLooksVisible` |
| Calendar slot click triggers an external ad / sponsor tab | (no existing mitigation) -- see § *External ad tab handling rule* below | -- |

### Event drawer Find Tickets surface

The right-side "Event information" drawer renders ~1-2 s after a calendar
slot click. The Find Tickets button text often has a trailing chevron or
unicode arrow ("Find Tickets >" / "Find Tickets ›" / "Find Tickets❯").

| Trigger | Action | Evidence in code |
|---|---|---|
| Trailing-chevron text variant | `looksLikeFindTicketsLabel` uses `startsWith` semantics over `["find tickets", "buy tickets", "get tickets"]`; never anchored regex | `ticketmaster-rpa.ts` `looksLikeFindTicketsLabel` |
| Visually-hidden event details inside the button label | The label parser collapses whitespace and matches on the leading prefix; full label is captured in trace for debugging | `ticketmaster-rpa.ts` `looksLikeFindTicketsLabel` (test: `Find Tickets The Lion King (New York, NY) 5/30/26, 2:00 PM`) |
| "Event information" header in body but no drawer button matched in main DOM | `clickFindTicketsWithDomScan` enforces a "must have Event information panel" gate, then prefers candidates inside `aside`, `[role="dialog"]`, `[aria-modal]` ancestors; falls back to right-half-of-viewport heuristic | `ticketmaster-rpa.ts` `clickFindTicketsWithDomScan` |
| Drawer renders late on slow hosts | `clickFindTickets` polls up to 16 s with mixed `:has-text` locator + DOM scan strategies | `ticketmaster-rpa.ts` `clickFindTickets` |
| Drawer is showing a stale / wrong-date event | `clickFindTicketsWithDomScan` now passes the parsed `TargetDateTime` into the in-page IIFE and rejects any candidate whose drawer scope text does not match month+day or time. Pure helper `drawerMatchesTarget` mirrors the same logic for unit tests | `ticketmaster-rpa.ts` `drawerMatchesTarget`, `clickFindTicketsWithDomScan` (target arg threaded through `clickFindTickets`) |

**Event drawer Find Tickets rule (canonical):**

> Always click the Find Tickets / Buy Tickets / Get Tickets candidate
> that lives inside the *Event information* drawer panel on the main
> Ticketmaster page. Never click a Find Tickets-shaped button that lacks
> an `Event information` ancestor; those are usually navigation links to
> the artist landing page or sponsored cards in the rail.

This rule was reaffirmed by commit `53def53 fix(ticketmaster): keep find
tickets click on main drawer` and is the basis for the
`hasEventInfoPanel` gate inside `clickFindTicketsWithDomScan`.

### Event page / seat map surface (`event_seat_map`)

The seat map is a `<canvas>` (or, rarely, a `[data-testid*="seat" i]` /
`[class*="seat-map" i]` element) rendered ~3-7 s after the page loads.
`waitForEventPage` polls for `/event/` URL or seat map element with a
20 s timeout.

The Reserve Tickets button is **disabled** until the user picks a seat.
`pollReserveTickets` watches three conditions:

1. Stage transitions to `account` (TM forces auth between Find Tickets
   and Reserve) -- abandon polling, return `"account"`.
2. `hasReserveButton && reserveEnabled` -- click via `clickReserveTickets`
   (cheap-evaluate, locator-click, locator-evaluate fallback chain),
   return `"clicked"`.
3. Neither condition met within 8 minutes -- return `"timeout"`.

**Event page / seat map checkpoint rule (canonical):**

> Treat `event_seat_map` with Reserve disabled as the
> `user_seat_selection_required` safe handoff. The runtime returns
> `paused_payment` (current code path: `stagehand-executor.ts` Ticketmaster
> branch -> `rpaResult.handoff_ready=true` -> `status: "paused_payment"`),
> the local browser is held open via `holdBrowserOpenForManualReview`,
> and the task UI should render "Ready for review -- continue on site",
> not "Failed".

This is **not** a runtime regression. It is the success boundary for an
activity job whose user has not yet picked seats.

### Account / sign-in surface (`account`)

`account` is reachable from any other stage. `classifyTicketmasterStage`
prefers it whenever:

- URL is on `auth.ticketmaster.com`, `/identity`, `/login`, `/signin`, or
  contains "create account".
- Body has a `Sign in or create account` heading.
- An email input is visible on a `/checkout` URL or any page with sign-in
  semantics.

**Account / session checkpoint rule (canonical):**

> Stop the worker and return `BrowserTaskStatus = "needs_login"` (not
> `paused_payment`) so the upstream task-state mapper at
> `lib/api-v1/run-travel-task-attempt.ts` renders the user-facing
> `TravelTaskState = "awaiting_login"` bucket — the accurate label for "user
> needs to sign in" — instead of conflating the boundary with the seat
> selection / payment review boundary (`ready_for_confirmation`). The
> classifier in `lib/booking-autopilot/providers/ticketmaster-status.ts`
> enforces this distinction: `user_seat_selection_required ->
> paused_payment -> ready_for_confirmation`, but
> `user_login_required -> needs_login -> awaiting_login`.
>
> Never enter credentials. Never call `waitForAuthClear` for more than 10
> minutes; if the user does not return, the worker should release the browser
> via the normal hold-open timeout, not block forever.

Cookies in `.ticketmaster-cookies.json` reduce the chance of an account
boundary mid-flow but are not part of the production v1 runtime contract
(see `lib/booking-autopilot/providers/ticketmaster-com.ts` setup; cookies
are a local dogfood opt-in, not a default).

### Checkout / payment surface (`checkout`)

After Reserve Tickets clicks, the URL transitions to either
`checkout.ticketmaster.com/...` or `payments.ticketmaster.com/...`. The
runtime then runs `passPaymentGate` and `selectCreditCardRadio`, both of
which stop **before** CVV / final confirm.

| Trigger | Action | Evidence in code |
|---|---|---|
| Conditions of Purchase checkbox required | `passPaymentGate` ticks it via in-page click; collects 4 ancestor levels of label text to match `agree|terms|conditions of purchase|purchase polic` | `ticketmaster-rpa.ts` `passPaymentGate` step 1 |
| Proceed to Payment disabled state | `passPaymentGate` polls for 10 s; logs disabled state every 2 s while waiting | `ticketmaster-rpa.ts` `passPaymentGate` step 2 |
| Payment method radios required (Credit/Debit Card vs PayPal) | `selectCreditCardRadio` clicks the Credit/Debit Card label; falls back to clicking the radio input directly | `ticketmaster-rpa.ts` `selectCreditCardRadio` |
| CVV / final confirm reached | **Stop**; do not enter card details, do not click final confirm | not implemented (intentional) |

## External ad tab handling rule

**Symptom (observed in the 2026-05-07 dogfood):** clicking certain
Ticketmaster surfaces can open a sponsor / ad tab in the same browser
context. Without a tab filter, a future poll iteration could end up
driving the wrong tab (e.g. a third-party promo URL) instead of the
provider page.

**Rule:**

> The active page that drives the Ticketmaster RPA must be on a
> Ticketmaster-owned host: `*.ticketmaster.com`, `*.ticketmaster.ca`,
> `auth.ticketmaster.com`, `checkout.ticketmaster.com`, or
> `payments.ticketmaster.com`. Any other host is an external ad tab and
> must be ignored or closed; the worker must not click, type, or
> screenshot inside it. If the only remaining tab is a non-Ticketmaster
> host, classify the run as `external_ad_tab_opened` (related class on
> `provider_logic_failure`) and surface a safe handoff so the user can
> close the ad tab and continue manually.

Implemented v1 (post-2026-05-07 dogfood): after the RPA returns, the
executor scans `stagehand.context.pages()` for any Ticketmaster-domain tab
via `pickPrimaryTicketmasterUrl(...)` (preference order: checkout > /event/
> /artist/ or *-tickets/ > auth > other TM). When the active page drifted
to a non-TM host but a TM tab is still alive, the executor:

- emits a `[tm-rpa] Active page drifted off Ticketmaster (...) — using it as
  the handoff URL` trace line for evidence,
- swaps in the surviving TM URL as the result `handoffUrl` so the user has
  a concrete recovery target instead of the original `input.startUrl`,
- and substitutes a more actionable summary
  ("Close the ad tab and continue on the open Ticketmaster page") in place
  of the generic ad-tab fallback.

What is still NOT done in v1 (deferred, evidence-needed):

- The executor never CLOSES the ad tab. Closing tabs is a destructive action
  and we have no captured failing job that proves it is needed; the surviving
  TM URL is enough for the user to recover manually.
- The executor never SWITCHES the driving Page to the surviving TM tab.
  Switching mid-flow on `raw` is more invasive than this branch warrants
  without a reproducible failure.

## Local browser / CDP disconnect handling rule

**Symptom (mentioned in 2026-05-07 dogfood polish list):** when the local
Stagehand-driven browser closes mid-run (user closes Chrome window, OS
sleep, USB Wi-Fi reconnect, etc.), the worker step can be left in
`booking_jobs.status='running' / steps[0].status='pending'` without a
terminal write. The task UI shows a stale "loading" forever.

This is **infrastructure**, not a Ticketmaster regression. It belongs in
the same family as `infra_db_transient` (both are runtime-env transients
that leave a stuck job needing reconciliation, not a provider patch).

**Rule:**

> Classify the run as `local_browser_disconnected_stale_job` (related
> class on `model_env_transient`). Run the artifact-only stuck-job audit
> in `lib/runtime-forensics/stuck-job-audit` to confirm the run reached a
> safe boundary (or never reached the provider) before any DB
> reconciliation. Do not patch `ticketmaster-rpa` based on this evidence;
> the Ticketmaster site itself was not involved in the failure.

The recovery procedure is the same as the existing
`infra_db_transient_lost_terminal_write` flow in
`docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` § 6.5: read-only
audit, screenshot confirmation, founder-approved manual UPDATE, no batch
mutation. Use the existing terminal-code value when reconciling.

## When L2 Browser Harness would help

Browser Harness's relevant strengths for the Ticketmaster surfaces are:

1. **Selector self-healing on virtualized list views.** The 2026-05-06
   spike (`docs/spikes/ticketmaster-harness-spike-20260506.md` on the
   `claude/ticketmaster-browser-harness-spike-20260506` worktree) found
   that the artist list view requires a 1200 px scroll to expose
   `<a href*="/event/<EVENT_ID>">` anchors. An L2 adapter can scroll +
   re-probe with `js()` and emit a patch proposal that updates the L1
   selector strategy, instead of an L1 author having to re-discover this
   in production.
2. **Date-encoded URL match.** Each visible event anchor has the date
   embedded in the path (`/<show-slug>-<MM-DD-YYYY>/event/<EVENT_ID>`).
   That is a much more reliable match than scoring calendar slot
   `aria-label` text. An L2 adapter that can switch to a list-view path
   with direct `page.goto(href)` would unblock the calendar-mode failure
   modes on a fresh DOM revision.
3. **Seat map render race detection.** The seat map is a `<canvas>`, not
   an iframe (the v1 selector list happens to handle both). L2 can
   instrument the canvas-render delay and tell the L1 author whether the
   timeout budget needs tightening or relaxing on a given DOM revision.
4. **Drawer Find Tickets confirmation.** `js()` can enumerate every
   `<a>/<button>` whose text starts with `find tickets` / `buy tickets`
   plus its full ancestor path, confirming that the Event information
   drawer rule still holds. Drift here would surface as an L2 patch
   proposal, not a silent click on a wrong button.

Use L2 specifically when:

- A run failed at L1 with a deterministic selector miss (`Calendar slot
  not matched`, `Find Tickets button not found within 16s`,
  `Reserve Tickets click strategies all missed`) AND
- A founder-approved manual repro reproduces the same DOM, AND
- The L1 fix is not obvious from the screenshot + worker log alone.

## When L2 must NOT continue

L2 Browser Harness must not continue past the same boundaries that v1 L1
already respects.

- `account` -- never sign in for the user. The L2 adapter should hand off
  to the live browser the same way v1 does, and emit `safe_boundary_reached`
  with `otp_or_login_required` / `safe_provider_boundary` related class.
- `checkout` past Proceed to Payment -- never enter CVV, never click
  final purchase / final confirm / final reserve. L2 stops at the same
  point as `selectCreditCardRadio`.
- Anything resembling a CAPTCHA / bot-wall -- do not bypass; classify as
  `provider_network_degraded` and stop.
- A non-Ticketmaster host (external ad tab) -- do not screenshot, do not
  click, do not type. Classify as `external_ad_tab_opened` and stop.
- A run already at `user_seat_selection_required` -- L2 must not pick a
  seat for the user. The seat selection is intentional human input.

L2 may **never** widen the safety boundary beyond v1. If a future L2
adapter proposes to "log in for the user" or "skip the conditions
checkbox" because it would be faster, reject the proposal.

## Classifications introduced in this doc

These were added to `lib/operator-failure-taxonomy/categories.ts` as
`relatedClasses` entries on the existing four categories. The four-way
taxonomy is locked; new failure modes are routed to the right category as
related classes, not as new top-level categories.

| Class | Category | Severity | Used when |
|---|---|---|---|
| `external_ad_tab_opened` | `provider_logic_failure` | patchable | Provider opened an external ad/sponsor tab during a click; worker started driving the wrong tab. The fix is a tab filter in the worker, not a Ticketmaster change. |
| `user_seat_selection_required` | `safe_boundary_reached` | info | Activity / Ticketmaster seat map visible, Reserve still disabled because the user has not yet picked a seat. The worker is intentionally polling. |
| `local_browser_disconnected_stale_job` | `model_env_transient` | wait | Local browser / CDP target disconnected mid-run; the worker step left in running/loading without a terminal write. Not a provider regression. |

## Cross-references

- `docs/30-provider-debug/FAILURE_TAXONOMY.md` -- the four-way operator
  taxonomy and the worked examples used during triage.
- `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` -- DB +
  worker log + screenshot triage order, plus the stuck-job recovery
  template.
- `docs/90-archive/old-provider-plans/EXECUTOR_V2_PIVOT.md` -- background on Computer
  Use as the v2 default and on the L1/L2 split this doc plugs into.
- `docs/spikes/ticketmaster-harness-spike-20260506.md` (separate
  worktree, branch `claude/ticketmaster-browser-harness-spike-20260506`)
  -- Browser Harness evidence pack for Ticketmaster artist + event
  surfaces. **Design input only.**
- `lib/booking-autopilot/providers/ticketmaster-rpa.ts` -- v1 production
  runtime. Mirror at `worker/src/booking-autopilot/providers/ticketmaster-rpa.ts`
  must stay byte-identical (`npm run check-drift`).
- `lib/__tests__/ticketmaster-rpa-stage.test.ts` -- pure stage classifier
  no-live tests.
- `lib/__tests__/ticketmaster-rpa-date.test.ts` -- pure target-date
  parser no-live tests.
- `lib/__tests__/ticketmaster-layered-recovery.test.ts` -- this doc's
  classification + worked-example regression tests.

## Hard rules

- This doc does not authorize a live provider run.
- This doc does not authorize a Browser Harness production deploy.
- This doc does not authorize entering credentials, OTP, CAPTCHA,
  payment, CVV, or final confirmation.
- Do not mirror an L1 rule into the worker tree without a passing
  `npm run check-drift`.
- Do not promote a related class to a top-level category. The four-way
  taxonomy in `lib/operator-failure-taxonomy/categories.ts` is locked.
