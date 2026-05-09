# Activity Provider Skill Runtime

Status: Stage 0B design lane
Last updated: 2026-05-08

This document is the shared direction for the next execution-layer experiment.
All agents working on activity/events provider coverage should read this file
before editing code or docs.

## Decision

Freeze new provider expansion for restaurant, hotel, and flight during this
lane. Keep their current L1 closures, benchmarks, and safety fixes, but do not
add new provider surfaces unless the founder explicitly changes this plan.

Focus new execution-layer expansion on events and activities:

1. Ticketmaster
2. SeatGeek
3. StubHub
4. Eventbrite
5. AXS

The purpose is to test whether Onegent can move from one-off provider runtime
files toward a provider skill system that can be repaired quickly when websites
change.

## Why Activity First

Activity and ticketing providers are the best Stage 0B proving ground because
their user-controlled boundaries are clear:

- Allowed: open provider pages, inspect listing/event pages, filter by date or
  city, identify candidates, click through to ticket availability.
- Required stop: seat selection, login, account verification, payment, final
  purchase, final confirmation.

This makes activity suitable for evaluating Browser Harness as a recovery and
skill-discovery layer without taking payment or identity risks.

## Current Baseline

Current Onegent runtime already has an L1 dogfood closure for activity through
Ticketmaster. That path uses the existing local Stagehand/Playwright
`ticketmaster-rpa` provider runtime, not Browser Harness.

Browser Harness currently exists in Onegent only as:

- design input,
- no-live L2 benchmark modeling,
- failure owner classification,
- provider recovery documentation.

It is not production runtime today.

## No-Live Readiness Cockpit

Stage 0B readiness is tracked by a pure fixture gate before any browser lab
claim:

```bash
npx tsx scripts/activity-skill-readiness.ts --gate
npx tsx scripts/activity-skill-readiness.ts --json
```

The gate covers Ticketmaster, SeatGeek, StubHub, Eventbrite, and AXS URL
surfaces across exact events, artist/performer pages, listing/search pages,
grouping pages, malformed URLs, multi-URL review paths, and host
impersonation. It is intentionally no-live: a passing gate means the registry
and safe-next-action contracts are coherent, not that Browser Harness has
closed a real provider run.

## Browser Harness Use Policy

Do not vendor the Browser Harness repository into Onegent at this stage.

Use Browser Harness as an external tool or dev dependency for an isolated lab:

```text
Onegent repo
-> invokes browser-harness CLI or a thin local adapter in dev/spike mode
-> collects screenshots, page info, action logs, current URL, and candidate data
-> writes evidence artifacts
-> emits a patch proposal or skill update candidate
```

Do not copy Browser Harness core files into `lib/`, `worker/`, or app runtime.
Reasons:

- Browser Harness is a fast-moving tool; vendoring creates maintenance debt.
- Onegent should own task state, audit, evidence, and safety boundaries, not
  the low-level CDP harness.
- The first milestone is proof of recovery/skill value, not production coupling.

Allowed integration shapes for Stage 0B:

1. **External CLI lab**:
   `scripts/stage0b-activity-skill-lab-runner.ts --live` calls the
   external Browser Harness command and writes structured evidence.
2. **Thin adapter boundary**: a narrow TypeScript interface that shells out to
   the CLI in dev-only mode.
3. **No-live skill manifest first**: provider skills can be modeled and tested
   without launching a browser.

Disallowed in Stage 0B:

- Importing Browser Harness source into Onegent runtime.
- Letting Browser Harness modify production provider files automatically.
- Running Browser Harness inside the normal worker booking path.
- Continuing past login, CAPTCHA, OTP, account verification, seat selection,
  payment, or final purchase.
- Treating an unreproducible Browser Harness success as provider closure.

## Ticketmaster Skill Forge Safety Contract

The Ticketmaster skill-forge lane may automate only reversible provider-page
inspection and safe navigation before a user-controlled boundary. It may:

- open Ticketmaster artist, listing, search, and event pages,
- reuse a user-authorized provider session after the user has signed in once,
- use provider credentials stored in the user's Onegent profile when that
  provider/account scope is explicitly authorized,
- read Gmail only for the active provider-login OTP or verification code tied
  to the current task,
- collect page title, current URL, screenshots, visible candidates, and action
  logs,
- prefill non-payment profile fields that Onegent already owns, such as name,
  email, phone, party size, city, date, and budget preferences,
- prefill saved payment-card fields except CVV when the user has authorized
  this provider/payment scope,
- click safe provider CTAs such as `Find Tickets` only while still before hard
  stops,
- ask the user which visible event/date/time to use,
- resume after the user manually finishes login, verification, CAPTCHA, or seat
  selection, then inspect the resulting page again.

It must not:

- use unscoped credentials or credentials for a different provider/account,
- read unrelated email, search a mailbox broadly, or use an OTP outside the
  active provider-login task,
- solve CAPTCHA or human-verification challenges,
- select seats for the user,
- fill CVV or store plaintext payment secrets,
- submit payment,
- click `Place Order`, `Confirm Purchase`, or any final purchase action.

The code contract lives in
`lib/activity-skills/ticketmaster-skill-forge.ts`. It maps observed
Ticketmaster surfaces to explicit checkpoints:

| Checkpoint | Runtime action |
| --- | --- |
| exact event before hard stops | Continue only to the next safe ticket CTA. |
| listing or multiple visible candidates | Ask the user which event/date/time to use. |
| login wall | Reuse authorized session or authorized profile credentials; otherwise pause for manual sign-in. |
| OTP / account verification | Read the active provider-login Gmail OTP only when explicitly authorized; otherwise pause for manual verification. |
| CAPTCHA | Pause for manual verification; never solve automatically. |
| seat selection | Pause for user seat choice; allow resume after user action. |
| payment fields | Prefill saved card fields except CVV when authorized, then stop before CVV/payment. |
| final confirmation | Stop before final confirmation; no automated resume. |
| provider degraded / 404 / unavailable | Capture evidence and stop. |
| missing URL/screenshot/action log | Collect more evidence before continuing. |

Gmail OTP implementation details live in
`docs/60-api-integrations/GMAIL_OTP_ASSIST.md`. The activity layer should treat
Gmail as an active-task OTP source only; it must not use Gmail as a broad
mailbox reader.

The controlled Browser Harness lab contract lives in
`lib/stage0b-skill-runtime/lab-runner.ts`. Ticketmaster, StubHub, and
Eventbrite expanded forge seed sets live in
`lib/stage0b-skill-runtime/ticketmaster-forge-plan.ts`,
`lib/stage0b-skill-runtime/stubhub-forge-plan.ts`, and
`lib/stage0b-skill-runtime/eventbrite-forge-plan.ts`.

```bash
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --plan ticketmaster-forge --limit 20
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --plan stubhub-forge --limit 10
npx tsx scripts/stage0b-activity-skill-lab-runner.ts --live --plan eventbrite-forge --limit 10
```

This is evidence collection, not production automation. Artist, venue,
category, and search pages must surface `provider_listing_needs_choice` unless
the lab proves exactly one visible candidate matches the user's constraints.
Exact event pages must show a safe ticket continuation or a known hard stop
before they can be treated as executable. Loading pages, empty ticket widgets,
404s, ad drift, or missing candidate evidence produce `skill_patch_needed` or
provider-degraded evidence, never silent closure.

The lab closes tabs it opens by default after evidence is captured. Operators
can pass `--keep-open` for a single case when a page needs manual inspection or
continued debugging. Do not leave bulk lab runs open in the shared Chrome
profile.

This keeps Onegent useful during provider execution while making authorization
the deciding boundary: scoped credentials, active-task Gmail OTP, and non-CVV
payment prefill can be delegated by the user; CAPTCHA, seat choice, CVV,
payment submission, and final confirmation stay user-controlled.

## Target Architecture

```text
Capture input
-> Travel Link Resolver
-> Activity Provider Skill Registry
-> Provider Skill
-> Activity Skill Lab / Browser Harness recovery
-> Evidence bundle
-> Safe next action or patch proposal
```

The long-term architecture is:

```text
L1 reviewed provider skills/runtime
L2 Browser Harness recovery and skill discovery
L3 Computer Use fallback for cases L1/L2 cannot handle
```

Browser Harness should help Onegent learn and repair provider skills. It should
not silently replace Onegent's task runtime, audit model, or safety policy.

## Provider Skill Contract

Each activity provider skill should eventually declare:

```ts
type ActivityProviderSkill = {
  provider: "ticketmaster" | "seatgeek" | "stubhub" | "eventbrite" | "axs";
  pageTypes: Array<
    | "exact_event"
    | "artist_or_performer"
    | "listing"
    | "grouping"
    | "search_results"
    | "unknown_provider_page"
  >;
  canHandleUrl(url: string): SkillUrlMatch;
  requiredInputs: string[];
  safeActions: string[];
  hardStops: string[];
  evidenceContract: string[];
};
```

Minimum evidence contract:

- provider
- page type
- input URL
- current URL after navigation
- title or visible event name
- visible city or venue when available
- visible date/time candidates when available
- screenshot path or screenshot id
- action log
- final state
- safe next action
- failure class when blocked

## Runtime Classification

For activity provider pages, the skill lab should classify outcomes as:

| Outcome | Meaning |
| --- | --- |
| `exact_event_ready` | URL or page uniquely identifies an event and can start provider execution. |
| `provider_listing_needs_choice` | Listing/artist/grouping page has multiple event candidates; ask the user. |
| `single_candidate_ready` | Listing page has one strong candidate matching user constraints. |
| `safe_handoff_reached` | Provider page reached a user-controlled continuation boundary. |
| `user_seat_selection_required` | Seat map or seat choice is visible; stop. |
| `account_session_required` | Login/account wall; stop. |
| `payment_or_final_action_required` | Payment/final confirmation; stop. |
| `provider_degraded` | Provider page degraded, blocked, or unavailable. |
| `insufficient_evidence` | Missing screenshot/log/currentUrl/candidate evidence. |
| `skill_patch_needed` | Browser Harness found a likely recovery rule that should become a reviewed patch. |

The no-live task-state contract lives in
`lib/activity-skills/runtime.ts`. It maps these outcomes to task workspace
state and the next safe action:

| Outcome | Task state | Workspace | Safe next action |
| --- | --- | --- | --- |
| `exact_event_ready` | `draft` | `queue` | Start provider execution. |
| `provider_listing_needs_choice` | `ready_for_confirmation` | `queue` | Ask the user which visible event to use. |
| `single_candidate_ready` | `draft` | `queue` | Start provider execution. |
| `safe_handoff_reached` | `ready_for_confirmation` | `history` | Hold for manual review. |
| `user_seat_selection_required` | `ready_for_confirmation` | `history` | Ask the user to select seats. |
| `account_session_required` | `awaiting_login` | `history` | Ask the user to sign in manually. |
| `payment_or_final_action_required` | `ready_for_confirmation` | `history` | Stop before payment or final action. |
| `provider_degraded` | `failed` | `history` | Capture provider-degraded evidence. |
| `insufficient_evidence` | `failed` | `history` | Collect required evidence. |
| `skill_patch_needed` | `failed` | `history` | Create a reviewed skill patch proposal. |

Only `exact_event_ready` and `single_candidate_ready` can map to executable
provider continuation, and only when the task-workspace evidence bundle is
complete. Seat selection, account/session, payment, purchase, and final
confirmation boundaries never map to executable continuation.

Minimum task-workspace evidence for every activity skill outcome:

- `provider`
- `page_type`
- `currentUrl`
- screenshot path or screenshot id
- action log
- visible candidate facts, such as event name, venue/city, date/time, and
  ticket/seat context when visible

Missing evidence blocks execution-ready outcomes and maps them to
`insufficient_evidence` until the bundle is complete.

## Initial URL Corpus

Stage 0B should start with a no-live corpus and then move to controlled lab
runs. The first corpus should include:

- Ticketmaster artist pages, event pages, search pages, and venue/listing
  pages.
- SeatGeek performer/listing pages and dated exact event pages.
- StubHub performer pages, grouping pages, and event pages if a deterministic
  event URL pattern is observed.
- Eventbrite event pages and city/category listing pages.
- AXS artist/event/listing pages.
- Host impersonation examples for every provider.
- Multi-URL messages that must route to review rather than silent direct
  execution.

## Success Criteria

Do not claim Stage 0B success from docs or a single happy path.

The first success threshold is:

```text
100 no-live activity URL fixtures
0 host impersonation escapes
0 exact-event false positives
0 listing pages treated as exact event evidence
0 unsafe boundary violations
20 controlled Browser Harness lab runs across Ticketmaster + SeatGeek
Evidence bundle produced for every lab run
At least 5 useful skill or patch proposals
```

The second threshold is:

```text
5 providers represented in skill manifests
50 controlled lab runs across all 5 providers
>= 90% of runs end in safe_handoff, needs_user_choice, or known safe block
0 wrong event/date/city continuations
0 login/payment/final-confirm actions
```

If these thresholds look healthy, promote the model to other verticals. If not,
return to the existing L1 Stagehand/Playwright, L2 Browser Harness recovery,
L3 Computer Use fallback strategy.

## Workstreams

### Workstream A: Shared Skill Contract

Owner: Codex or Goal agent.

Deliver:

- provider skill TypeScript types,
- no-live skill registry,
- URL/page-type resolver fixtures,
- no-live tests,
- docs updated from this runbook.

Do not launch Browser Harness in this workstream.

### Workstream B: Ticketmaster + SeatGeek + StubHub + Eventbrite Lab

Owner: Claude or activity-focused side agent.

Deliver:

- controlled Browser Harness lab script and runbook,
- 10 Ticketmaster runs,
- 10 SeatGeek runs,
- 10 StubHub runs,
- 10 Eventbrite runs,
- screenshots and JSONL action evidence,
- patch proposals only; no production runtime edits without review.

### Workstream C: AXS Corpus

Owner: Agent2 or Agent3.

Deliver:

- provider URL corpus,
- host impersonation fixtures,
- page-type classification tests,
- known hard stops and safe next actions.

Do not claim direct execution support unless a page type uniquely identifies an
event and evidence proves the boundary.

### Workstream D: Stage 0 Cockpit Integration

Owner: Goal agent.

Deliver:

- Stage 0 operator report includes Activity Skill Runtime readiness.
- Daily report lists provider coverage, lab run counts, unsafe-boundary count,
  wrong-target count, and patch proposal count.
- Private alpha intake can tag activity provider skill failures as benchmark
  seeds.

## Promotion Rule

Browser Harness discoveries become production behavior only after:

1. evidence bundle exists,
2. no-live fixture exists,
3. safety hard stops are tested,
4. the patch is reviewed by Codex,
5. a controlled dogfood run reaches a safe outcome.

Until then, Browser Harness output is evidence and patch proposal, not product
closure.
