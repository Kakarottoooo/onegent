# Private Alpha Intake Protocol

Last updated: 2026-05-07

This is the operational intake contract for Stage 0 private alpha. It is
no-live. It does not authorize provider workflows, browser agents, OpenAI live
calls, workers, payment, login, verification, CAPTCHA, final confirmation, or
provider-account handling.

## Who Qualifies

Invite high-intent users who have a real travel need in the next 2-8 weeks and
can judge whether Onegent understood the request.

Good fits:

- A specific restaurant, hotel, flight, activity, or itinerary need.
- Concrete constraints: dates, location, budget, party/travelers, preferences,
  and hard exclusions.
- Willingness to review the normalized task before execution.
- Willingness to say whether they would trust Onegent to continue and whether
  they would pay for the result.

Avoid:

- Users expecting Onegent to handle account login, payment, verification, or
  final confirmation.
- Same-day urgent travel.
- Open-ended inspiration with no date, place, or task goal.
- Requests that depend on private account state or provider credentials.

## What To Collect

For every submission, capture:

- `rawInput`: exact user request, pasted URL text, screenshot reference, or
  direct manual request text after removing sensitive values.
- `sourceType`: `pasted_url`, `pasted_text`, `screenshot_reference`, or
  `manual_request` (`text`, `url`, `screenshot`, `mixed`, `raw_text`,
  `screenshot_description`, and `mixed_url_instruction` remain accepted
  legacy aliases).
- `expectedTaskType`: restaurant, hotel, flight, activity, trip, ambiguous,
  profile, or chitchat.
- `submittedIntent` / `userGoal`: what the user wants Onegent to accomplish.
- `travelObject` or `travelObjectProduced`: the normalized Capture Travel
  Object, or a boolean marker when the object is referenced elsewhere.
- `safeNextAction`: task-ready, clarify, save-only, compare-only, or
  group-decision next step.
- `taskReadyStatus`: `task_ready`, `needs_clarification`, `needs_review`,
  `save_only`, `compare_only`, `group_decision`, or `blocked`.
- `evidenceLink` / `evidenceLinks`: safe local doc/report/task references.
- `userValueSignal`: strong, medium, weak, or none.
- `wouldContinue`, `wouldReuse`, `wouldPay`, or `wouldPayOrReuse`: optional
  yes/no/unknown value signals.
- `failureReason` / `blockedReason`: why the submission cannot proceed, if
  blocked.
- `owner`: capture, NLU, planner, task-readiness, task-workspace,
  provider-runtime, product/manual-boundary, or alpha-ops when already known.
- `notes`: non-sensitive context only.

The TypeScript contract lives in `lib/capture/private-alpha.ts`.

Run the no-live evaluator:

```bash
npx tsx scripts/private-alpha-intake.ts --gate
npx tsx scripts/private-alpha-intake.ts --input alpha-submissions.json --json
npx tsx scripts/private-alpha-intake.ts --input alpha-submissions.md --markdown
```

## What Not To Collect

Never collect or paste into fixtures:

- passwords or provider credentials;
- CVV, security code, card number, or billing secrets;
- OTP, SMS, email verification, CAPTCHA, or human-check values;
- provider cookies, browser storage, bearer tokens, or session dumps;
- screenshots or logs containing sensitive account/payment data.

If a user submits sensitive content, classify the submission as
`reject_sensitive`, do not turn it into a fixture, and record only the safe
reason label.

Do not ingest raw secrets, payment details, login credentials, OTP, CAPTCHA,
provider cookies, provider storage, bearer tokens, or account-private payloads.
If the user sends them, delete the value from the working note and retain only
the finding label, such as `verification_code` or `card_number`.

## Scoring

Each submission is scored on six booleans:

| Field | Meaning |
| --- | --- |
| `understood` | Onegent can identify the user's intended task type. |
| `travelObjectCreated` | The request produced a Capture Travel Object. |
| `taskReady` | Required fields are present or the missing fields are clear. |
| `safeNextAction` | The next step respects hard stops and user control. |
| `evidenceComplete` | The submission has enough source/task metadata to debug. |
| `userValue` | The user would trust Onegent to continue or would pay. |

Verdicts:

- `ready_for_fixture`: safe and complete enough to become a benchmark fixture.
- `needs_clarification`: missing task goal, expected type, or safe next action.
- `reject_sensitive`: contains forbidden sensitive content.

## Turning Failures Into Fixtures

When an alpha submission fails safely:

1. Keep the raw input and non-sensitive source metadata.
2. Assign an owner: capture, NLU, planner, task-readiness, task-workspace,
   provider-runtime, product/manual-boundary, or alpha-ops.
3. Add or update a Capture Benchmark fixture with the same source shape.
4. Link the alpha id as the dogfood id.
5. Keep the fixture no-live and deterministic.

The pure converter is `buildPrivateAlphaFixtureSeeds(...)` in
`lib/capture/private-alpha.ts`. It emits safe-miss seeds by default so misses
can become benchmark fixtures without storing secrets or provider artifacts.

Do not mark private alpha `green` from docs, fixtures, or benchmark tooling
alone. Green requires real submissions with successful Travel Object creation,
safe next action, evidence completeness, and user value signal.
