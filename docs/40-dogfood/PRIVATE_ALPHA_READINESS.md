# Private Alpha Readiness

Last updated: 2026-05-07

This is a Stage 0 readiness artifact for a small private alpha with 10-20
high-intent users. It is a no-live planning and operating checklist. It does
not authorize provider workflows, live OpenAI calls, Computer Use, secrets,
payment, login, verification, or final-confirmation flows.

For the concrete submission schema, scoring contract, forbidden collection
rules, and fixture conversion workflow, use
`docs/40-dogfood/PRIVATE_ALPHA_INTAKE_PROTOCOL.md`.

## Stage 0 Goal

Run a small, founder-supervised alpha that tests whether real travel users
trust Onegent's task intake, evidence, recovery posture, and safe handoff
model before broad launch.

Stage 0 is successful when Onegent can repeatedly turn real user requests into
clear tasks, preserve the user's intent, show useful evidence, and stop at the
right review or continuation boundary. It is not successful merely because a
provider path worked once.

## Alpha Cohort

Target 10-20 users who have near-term travel intent and can give direct
feedback within 24 hours of a task run.

Good-fit users:

- Have a concrete trip, reservation, event, or itinerary need in the next
  2-8 weeks.
- Are willing to share constraints up front: dates, budget, location,
  preferences, traveler count, and hard exclusions.
- Can review task evidence and say whether Onegent picked the right target.
- Understand that irreversible provider actions stay user-controlled.
- Are comfortable with founder-supervised product QA, not a self-serve launch.

Avoid users who mainly want:

- fully autonomous purchase completion;
- urgent same-day travel support;
- account, loyalty, payment, or verification handling;
- broad inspiration browsing with no concrete task;
- edge-case international itineraries before core repeatability improves.

## Readiness Checklist

Before inviting users:

- Confirm each accepted task type has a clear intake template and owner.
- Prepare a short consent note explaining that this is supervised private
  alpha, not broad availability.
- Define which verticals are allowed for Stage 0 and which are founder-only.
- Keep a visible stop list: payment, OTP, CAPTCHA, login, billing submission,
  final booking, final purchase, and irreversible confirmation.
- Prepare a manual fallback path for every accepted task.
- Prepare a lightweight issue log with task id, user, vertical, request,
  expected target, outcome, evidence status, and follow-up owner.
- Decide the daily cap before inviting users. Start with 2-3 tasks per day
  until repeated failure classes are understood.

For each task:

- Capture the original user request verbatim.
- Normalize intent into structured parameters before any execution attempt.
- Confirm ambiguous constraints with the user before proceeding.
- Record what success means for that task.
- Preserve evidence: status, selected target, current URL or equivalent page
  state, screenshots when available, logs, and why the task stopped.
- Stop at the user-controlled review or continuation boundary.
- Do not retry the same failure blindly. Root-cause the first failure from
  evidence before deciding whether a second attempt is useful.

After each task:

- Classify the outcome as `ready_for_review`, `correct_terminal_boundary`,
  `needs_user_clarification`, `runtime_failure`, `provider_boundary`, or
  `insufficient_evidence`.
- Ask the user whether the selected target and explanation were correct.
- Log whether the handoff boundary was clear.
- Add one concrete follow-up if the task exposed a repeated issue.

## Task Intake Rubric

Accept tasks that score well on all four dimensions.

| Dimension | Accept | Clarify first | Reject for Stage 0 |
| --- | --- | --- | --- |
| Intent | User wants a specific booking, reservation, event, route, or stay | User has broad preferences but no target date, place, or constraints | User only wants open-ended inspiration |
| Constraints | Dates, location, party/travelers, budget, and key preferences are known | One or two required fields are missing | Core facts are unknown or contradictory |
| Safety boundary | User understands they approve final actions | User needs boundary explanation | User expects Onegent to handle payment, login, OTP, CAPTCHA, or final confirmation |
| Evidence value | Outcome can be judged from task evidence and user feedback | Evidence target is unclear but can be defined | Success depends on account-private state or irreversible actions |

Stage 0 priority tasks:

- restaurant reservation discovery or hold-to-review flows;
- hotel shortlists or review-boundary selection with exact dates and guests;
- flight option narrowing with exact airports, dates, and traveler constraints;
- activity/event selection where seat or final purchase stays user-controlled;
- itinerary packaging that turns user preferences into task-ready requests.

## Success Metrics

Measure weekly across the 10-20 user cohort:

- Intake completion rate: percent of accepted users whose request becomes a
  structured task without founder rewriting.
- Right-target rate: percent of tasks where the user confirms Onegent selected
  the correct provider item, route, hotel, restaurant, event, or option.
- Evidence completeness: percent of tasks with enough evidence to explain
  status, target, stop reason, and next action.
- Safe-handoff clarity: percent of users who can state what they must review or
  complete next without extra explanation.
- Recovery discipline: percent of failures with a recorded root cause before
  any retry.
- Repeat-use signal: percent of users who submit a second real task within two
  weeks.
- Willingness-to-pay signal: percent of users who say they would pay for the
  task result or ask to keep using the product after the alpha.

Initial Stage 0 target:

- 10-20 users invited.
- At least 30 real tasks reviewed.
- At least 80% evidence completeness.
- Zero wrong-target final handoffs.
- Zero stale terminal `running` states after task completion or failure.
- Zero payment, login, OTP, CAPTCHA, billing submission, or final-confirmation
  handling by Onegent.

## What Not To Launch Yet

Do not launch:

- broad public self-serve access;
- claims of autonomous booking completion;
- payment, credential, OTP, CAPTCHA, loyalty-account, or final-confirmation
  handling;
- unsupported verticals without no-live benchmark coverage and founder review;
- provider retry automation that lacks evidence-backed failure classification;
- marketing promises around reliability before 5/10/20-case vertical batches
  show repeatability;
- MCP/API access for outside agents until task create/status/continue/cancel
  semantics are stable enough for real delegation.

The launchable promise for Stage 0 is narrower: Onegent helps high-intent users
turn travel requests into executable tasks, gathers evidence, and stops cleanly
before actions that should remain under user control.
