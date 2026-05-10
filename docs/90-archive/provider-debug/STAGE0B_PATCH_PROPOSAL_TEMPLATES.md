# Stage 0B — Skill Patch Proposal Templates

Status: Stage 0B Workstream B
Last updated: 2026-05-08

A `skill_patch_proposal` is the artifact the lab emits when Browser
Harness sees a structural change that should become a reviewed Onegent
patch. **Proposals are reviewed and shipped by humans / Codex.** The lab
never edits production runtime files.

This file is five worked examples of proposals the operator might write
after a Stage 0B lab run. They are TEMPLATES — they describe the shape,
the observed-evidence form, and the Onegent files the proposed change
would touch. Each example also notes why it stops short of being a real
patch on its own.

The matching TypeScript type is `SkillPatchProposal` in
`lib/stage0b-skill-runtime/types.ts`.

Common rules for every proposal:

- `patch_target` is informational only. The lab MUST NOT modify the file.
- `risk` is set by the operator and dictates the review path:
  - `low` — selector / regex extension behind a no-live test.
  - `medium` — new page type / new safe handoff.
  - `high` — anything that would relax a hard stop (forbidden in
    Stage 0B without explicit founder approval).
- `evidence_event_seqs` cross-references `LabEvent.seq` values in the
  run's `events.jsonl` so a reviewer can locate the screenshot and DOM
  text that motivated the proposal.

---

## Example 1 — `selector_drift` (low risk)

**Scenario.** Run `tm-01` (Kacey Musgraves `/artist/1668663`). The
harness navigated to the artist page, took screenshot 01, and inspected
the DOM. The "Find Tickets" buttons that the existing
`lib/booking-autopilot/providers/ticketmaster-rpa.ts` runtime expects
were rendered with a new class name. The harness still successfully
identified the buttons via a fallback heuristic ("button text starts
with 'Find Tickets'"), so the run reached `safe_handoff_reached` — but
the runtime's primary selector is now stale.

**Proposal payload.**

```json
{
  "kind": "selector_drift",
  "title": "Ticketmaster artist 'Find Tickets' button class drift",
  "observed_evidence": "On 5 sequential events on /artist/1668663 the button text matched 'Find Tickets' but the wrapper element used class 'tm-cta--secondary' instead of the historical 'tm-find-tickets'. Screenshot 02 highlights the rendered button and screenshot 03 shows the DOM tree.",
  "patch_target": "lib/booking-autopilot/providers/ticketmaster-rpa.ts (looksLikeFindTicketsLabel + DOM scan)",
  "proposed_change": "Add the new wrapper class to the runtime's selector list AND keep the existing text-prefix fallback. Add a no-live fixture test using the captured DOM snippet so the regression is pinned even if the class drifts again.",
  "risk": "low",
  "evidence_event_seqs": [2, 3, 4, 5, 6]
}
```

**Why this stops short of being a real patch.** The runtime is in
`lib/booking-autopilot/**`, which is forbidden territory for a Stage 0B
lab branch. Codex (or the activity owner) opens the PR using the
operator's evidence bundle.

---

## Example 2 — `page_flow_change` (medium risk)

**Scenario.** Run `sg-05` (The R and B Tour listing,
`https://seatgeek.com/the-r-and-b-tour-tickets`). Historical SeatGeek
listing pages rendered a left-rail city/date filter. On the run, the
filter was missing — SeatGeek collapsed listings into a vertical card
stream with no filter UI. The harness still saw 12 candidate cards and
correctly classified the run as `provider_listing_needs_choice`, but
the existing executor copy assumes the filter exists.

**Proposal payload.**

```json
{
  "kind": "page_flow_change",
  "title": "SeatGeek listing pages may render without left-rail city/date filter",
  "observed_evidence": "events.jsonl seq 2 records 12 candidate cards but 0 filter controls. Screenshot 02 captures the full listing render. The current executor instructions tell the user to filter by date; the page no longer has that affordance for new tour layouts.",
  "patch_target": "lib/capture/direct-provider-url.ts (buildDirectActivityTask copy for SeatGeek listing) + ACTIVITY_PROVIDER_SKILL_RUNTIME.md",
  "proposed_change": "Update the SeatGeek listing instruction copy to say 'scroll the listing and pick a date row' instead of 'use the city/date filter'. Add a no-live fixture asserting the new copy is present when provider=seatgeek and pageType=listing.",
  "risk": "medium",
  "evidence_event_seqs": [2, 3]
}
```

**Why this stops short of being a real patch.** Updating
`buildDirectActivityTask` is in scope for Capture, but the proposed
copy change should land via a Codex-reviewed PR with a matching no-live
test and a HUDDLE entry so other agents do not duplicate the work.

---

## Example 3 — `new_page_type` (medium risk)

**Scenario.** Run `tm-09` (`/category/concerts`). The harness landed on
a new "Editorial Collection" page Ticketmaster has begun rolling out —
tile cards, no `/artist/` or `/event/` ids. The current resolver
classifies this URL as `provider_listing` and returns
`provider_start`. The harness inspected the page and observed it is
neither a search results page (no query) nor a traditional listing (no
event rows), but rather a new editorial page-type with curated
collections.

**Proposal payload.**

```json
{
  "kind": "new_page_type",
  "title": "Ticketmaster /category/* editorial collection pages — new page type",
  "observed_evidence": "events.jsonl seq 4 inspects DOM and finds no /artist/ or /event/ ids. The page renders 8 'collection' cards each linking to a curated subset (e.g. 'Country Tours', 'Stadium Shows'). screenshot 02 shows the layout. The cards do not match search_results or provider_listing semantics.",
  "patch_target": "lib/capture/travel-link-resolver.ts (TravelLinkPageType union + Ticketmaster handler)",
  "proposed_change": "Add a new `editorial_collection` page type to TravelLinkPageType. Resolver returns provider_start + needs_user_choice with a hint that the user should pick a collection card before the executor begins. Add 3+ no-live fixtures in the resolver test suite covering the observed URL shapes.",
  "risk": "medium",
  "evidence_event_seqs": [3, 4, 5]
}
```

**Why this stops short of being a real patch.** Adding a new union
member is a typing-level change with downstream consumers
(`task-boundary.ts`, `direct-provider-url.ts`, capture benchmark
fixtures). The proposal lists the consumers; the actual edits go
through a Codex-reviewed PR.

---

## Example 4 — `stricter_safe_handoff` (medium risk)

**Scenario.** Run `tm-06` (Lion King exact event). The lab navigated to
the event page, observed the seat-map iframe, and correctly halted with
`user_seat_selection_required`. While inspecting the DOM, the harness
noticed an "Express Checkout" CTA that was not behind a sign-in wall —
clicking it would have skipped the seat-map and gone directly to a
payment form. The harness did NOT click it (per § 2 of the runbook),
but this is a new boundary the existing runtime is not aware of.

**Proposal payload.**

```json
{
  "kind": "stricter_safe_handoff",
  "title": "Ticketmaster event page 'Express Checkout' CTA is a new payment-flow entry point",
  "observed_evidence": "events.jsonl seq 3 captures the DOM, screenshot 02 highlights the 'Express Checkout' button rendered above the seat map, with no sign-in wall in between. The button's data-test-id is 'express-checkout-cta'. Clicking it would advance past § 2's hard stops without first showing the seat picker — that is a payment_or_final_action_required boundary.",
  "patch_target": "lib/booking-autopilot/providers/ticketmaster-rpa.ts (event-page click guard)",
  "proposed_change": "Add 'express-checkout-cta' (and the human-text fallback 'Express Checkout') to the runtime's hard-stop selector list so the production runtime never advances past it. Add a no-live test asserting the runtime classifies any DOM containing this CTA as paused_payment.",
  "risk": "medium",
  "evidence_event_seqs": [3, 4]
}
```

**Why this stops short of being a real patch.** Touches
`lib/booking-autopilot/**` (forbidden in this branch). Codex opens the
PR. This proposal also imposes a stricter hard stop, which is the
direction Stage 0B prefers — the opposite (relaxing a hard stop) is
forbidden without explicit founder approval.

---

## Example 5 — `host_pattern_extension` (low risk)

**Scenario.** Run `sg-09` (Nashville SC dated event without query
string). The lab navigated and observed a 302 redirect from
`seatgeek.com` to `m.seatgeek.com` because the harness's user-agent
spoofed mobile. The resolver currently maps `m.seatgeek.com` correctly
because it ends with `.seatgeek.com`, so the run still classified
correctly. But the harness also discovered that during high-traffic
events SeatGeek rotates the path numeric prefix to `eid-<id>`. The
existing `SEATGEEK_EVENT_ID_RE` regex still matched, but the proposal
operator wants to pin the new path shape with a fixture.

**Proposal payload.**

```json
{
  "kind": "host_pattern_extension",
  "title": "SeatGeek high-traffic redirect uses 'eid-<id>' path prefix",
  "observed_evidence": "events.jsonl seq 1 navigated to https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493 and the harness observed a follow_safe_link redirect to https://m.seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/eid-17921493. Resolver match succeeded but the new path shape is not in the no-live fixture set.",
  "patch_target": "lib/__tests__/capture-url-resolver-v2.test.ts (add fixture) + optionally tighten SEATGEEK_EVENT_ID_RE",
  "proposed_change": "Add 2 no-live fixtures: one for the m.seatgeek.com host and one for the eid-<id> path prefix. The regex changes only if a new fixture demonstrates the existing regex misses; otherwise the change is fixture-only.",
  "risk": "low",
  "evidence_event_seqs": [1, 2]
}
```

**Why this stops short of being a real patch.** Fixture-only changes
are landable in a Capture branch with one no-live PR; this template
documents the proposal so an operator can lift it directly into a
follow-up branch alongside the JSONL evidence.
