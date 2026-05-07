# Capture MVP Seams

Last updated: 2026-05-07

Scope: no-live audit for Stage 0 Capture -> TravelObject -> Task Runtime.

Ownership for this pass: this report only. No changes were made to
`app/page.tsx`, `app/capture`, `lib/capture`, provider runtime, live provider
flows, OpenAI calls, secrets, payment, login, verification, or final-confirm
paths.

## Read Set

- `docs/INDEX.md`
- `docs/00-start-here/PROJECT_SUMMARY.md`
- `docs/00-start-here/STAGE_0.md`
- `docs/00-start-here/PHASE_STATUS.md`
- `docs/10-coordination/README.md`
- `docs/10-coordination/HUDDLE.md`
- `lib/agent/nlu-v2/types.ts`
- `lib/agent/nlu-v2/unified.ts`
- `lib/agent/nlu-v2/index.ts`
- `lib/agent/nlu-v2/router.ts`
- `app/api/chat/parse/route.ts`
- `app/api/chat/commit/route.ts`
- `app/api/booking-jobs/route.ts`

## Existing Code To Reuse

1. Reuse NLU v2 as the text/request parser.
   - `lib/agent/nlu-v2/types.ts` already defines the canonical vertical
     vocabulary: `restaurant`, `hotel`, `flight`, `activity`, and `trip`.
   - `IntentState` already carries structured per-vertical fields,
     confidence, party mode, member names, profile patch payloads, and
     planning assumptions.
   - `lib/agent/nlu-v2/unified.ts` already performs a single state-plus-reply
     turn and then normalizes narrow known cases such as single activity ticket
     requests.
   - `lib/agent/nlu-v2/router.ts` is the deterministic product-action gate.
     Capture should not invent a second readiness rule for text input; it
     should call the same route layer or mirror its required-field contract.

2. Reuse the v1-compatible constraint projection.
   - `flattenScenarioFields` in `lib/agent/nlu-v2/index.ts` maps v2 fields back
     to legacy `collected_constraints` keys consumed by chat commit and task
     creation code.
   - This is the safest bridge for Capture MVP because it avoids a parallel
     field vocabulary while the existing task builders still expect legacy
     names like `departure_date`, `stars`, `check_in`, and `event_date`.

3. Reuse `/api/chat/parse` session persistence semantics for natural-language
   requests.
   - `app/api/chat/parse/route.ts` already validates message input, accepts
     `prev_nlu_state`, resolves contacts for multi-party requests, persists
     solo chat sessions, and returns `session_id`.
   - Capture should either call this route for text/request input or extract a
     shared parser helper later. For the MVP, avoid duplicating contact
     resolution or session NLU-state hydration.

4. Reuse chat commit's direct-booking and room/task payload builders before
   introducing new task creation shapes.
   - `app/api/chat/commit/route.ts` already converts NLU constraints into room
     context, creator constraint seeds, direct restaurant/hotel booking
     payloads, profile gaps, and plan queries.
   - The direct-booking builder returns a `booking_step` shape matching the
     client path that posts to `/api/booking-jobs`.
   - For Capture MVP, the first convert-to-task action should produce the same
     `BookingJobStep` body shape, not a Capture-specific provider payload.

5. Reuse `/api/booking-jobs` as the task enqueue boundary.
   - `app/api/booking-jobs/route.ts` requires `session_id` and non-empty
     `steps`, stamps new steps `pending`, applies `prepareWorkerQueueSteps`,
     optionally marks Cend-supported steps for core execution, and persists via
     `createBookingJob`.
   - Capture should stop at job creation by default. Starting the job via
     `/api/booking-jobs/[id]/start` belongs behind explicit user action or
     existing runtime controls.

6. Reuse task workspace/read-model semantics for post-create navigation.
   - Stage 0 and current docs define Queue as pending/not-started, Live as
     running, and History as terminal or ready-for-review.
   - Capture should attach created jobs to the source `session_id` and route
     users through the existing task workspace instead of creating a separate
     Capture task list.

## Proposed TravelObject Fields

The TravelObject should be a source-normalized product object, not a provider
runtime request. Keep it stable enough to preview, edit, test, and convert
into existing NLU/task shapes.

```ts
type TravelObjectSourceType = "text" | "url" | "screenshot" | "video" | "request";

interface TravelObject {
  id: string;
  source: {
    type: TravelObjectSourceType;
    raw_text?: string;
    url?: string;
    upload_id?: string;
    captured_at: string;
  };
  classification: {
    categories: Array<"restaurant" | "hotel" | "flight" | "activity">;
    scenario: "restaurant" | "hotel" | "flight" | "activity" | "trip" | null;
    confidence: number;
    direct_booking?: boolean;
  };
  entities: {
    restaurant?: RestaurantFields;
    hotel?: HotelFields;
    flight?: FlightFields;
    activity?: ActivityFields;
    trip?: TripIntentState;
  };
  constraints: Record<string, unknown>;
  missing_fields: string[];
  assumptions: string[];
  possible_actions: Array<{
    type: "ask_clarification" | "preview_task" | "create_task" | "create_room";
    label: string;
    disabled_reason?: string;
  }>;
  task_readiness: {
    ready: boolean;
    reason: "ready" | "missing_fields" | "unsupported_source" | "low_confidence" | "needs_review";
    next_missing_fields: string[];
  };
  provenance: {
    parser: "nlu-v2" | "url-parser" | "screenshot-ocr" | "manual";
    nlu_state?: IntentState;
    nlu_action?: RouterAction;
    session_id?: string;
  };
}
```

Field notes:

- `entities` should reuse the existing NLU v2 field interfaces rather than
  creating Capture-only names.
- `constraints` should be the `flattenScenarioFields` output used by current
  commit/task paths.
- `possible_actions` should be derived from `routeIntent`, not LLM prose.
- `task_readiness.ready` means "safe to create a pending task," not "safe to
  execute provider runtime."
- `provenance.nlu_state` keeps replay/debug continuity with chat sessions and
  future mutable task state.

## Integration Risks

1. Schema drift between TravelObject and NLU v2.
   - Risk: Capture invents separate fields like `destination`, `when`, or
     `vendor` that later need lossy mapping into `IntentState`.
   - Mitigation: use NLU field interfaces and `flattenScenarioFields` output
     as the canonical MVP bridge.

2. Premature execution from Capture.
   - Risk: a "Convert to task" button accidentally starts provider runtime or
     jumps into `/start`.
   - Mitigation: MVP should create a pending booking job only. Execution stays
     behind existing task workspace controls and hard-stop rules.

3. Direct-booking false positives.
   - Risk: URL or screenshot extraction may infer a venue/property from weak
     page text and set `direct_booking`.
   - Mitigation: set activity execution from the structured Travel Link
     Resolver contract, not model prose. Exact event pages can start direct
     provider-entry tasks. Artist, performer, grouping, search, and listing
     pages can start provider-page tasks only with user-choice boundaries.
     Provider-start pages are not exact event evidence: missing date/city in
     the original utterance is not no-availability proof, and runtime must use
     provider-rendered listings plus safe user checkpoints before selecting an
     event/date/city/seat. Impersonating hosts stay review-only.

4. Confidence overuse.
   - Risk: high model confidence is treated as task readiness even while
     required fields are missing.
   - Mitigation: readiness must be deterministic: `routeIntent` action plus
     required-field checks decide readiness; confidence only affects review
     copy or low-confidence blocking.

5. Source/session orphaning.
   - Risk: tasks created from Capture do not remain attached to the originating
     chat/session, breaking evidence and task workspace discovery.
   - Mitigation: require `session_id` for convert-to-task, mirroring
     `/api/booking-jobs`.

6. Screenshot and URL parsing can exceed text NLU scope.
   - Risk: screenshot OCR or URL metadata generates partial facts with no
     durable provenance.
   - Mitigation: store source metadata and parser provenance on TravelObject;
     convert only after extracted fields are visible for user review.

7. Multi-party Decision Room leakage.
   - Risk: Capture turns a "with friends" source into a solo task or creates a
     room without stable member semantics.
   - Mitigation: reuse parse/commit member resolution and `routeIntent`
     party-mode gates. If member identity is unresolved, TravelObject should
     be clarification-ready, not task-ready.

## Exact Next Tests To Add

No-live tests only.

Status update for this branch: the broad Stage 0 benchmark layer lives in
`lib/capture/benchmark.ts` and `scripts/capture-benchmark.ts`. It uses
deterministic fixture parser states, not live OpenAI extraction. The narrower
unit tests below remain useful as future builder/API hardening, but the
current benchmark already locks:

- 500+ raw homepage fixture inputs across restaurant, hotel, flight, activity,
  trip, ambiguous, refine, profile, and chitchat.
- source shapes for text, URL, screenshot descriptions, mixed URL+instruction,
  vague inspiration, exact task-ready requests, group decision requests,
  save-only, compare-only, and provider URL impersonation.
- founder dogfood examples for Lion King, Japanese/Chinese cuisine,
  NYC hotel date/budget, Nashville to New York flight, and Sirrah/OpenTable.
- task-ready versus needs-clarification behavior.
- source metadata preservation and artifact-contract completeness. Stage 0
  Alpha Readiness v3 closed the prior four intentional
  `artifact_incomplete` fixtures (`restaurant-artifact-gap-01`,
  `hotel-artifact-gap-01`, `flight-artifact-gap-01`, and
  `activity-artifact-gap-01`) by recording task-readiness evidence in the
  deterministic artifact contract.
- real activity provider URL shapes from founder dogfood and common ticketing
  sites: Ticketmaster artist/event links, StubHub performer/grouping links,
  and SeatGeek listing/dated-event links. These fixtures lock provider,
  page type, execution mode, provider page id, title hint, and user-choice
  metadata without fetching live webpages.

Run:

```bash
npx tsx scripts/capture-benchmark.ts --vertical all --count 50 --json
npx tsx scripts/capture-benchmark.ts --vertical all --gate
npx tsx scripts/stage0-operator-report.ts --json
```

1. `lib/agent/nlu-v2/__tests__/capture-travel-object-text.test.ts`
   - Given a restaurant natural-language request with city/date/time/party,
     assert NLU produces `IntentState.restaurant`, `routeIntent` returns
     `show_confirm_card`, and TravelObject readiness is `ready`.
   - Given a hotel request missing checkout/nights, assert readiness is
     `missing_fields` with `check_out`.
   - Given an activity request like "The Lion King in New York on May 30",
     assert the single-activity normalization remains `activity`, not `trip`.

2. `lib/__tests__/capture-travel-object-projection.test.ts`
   - Assert TravelObject `constraints` equals `flattenScenarioFields` output
     for restaurant, hotel, flight, and activity examples.
   - Assert hotel `star_rating` projects to `stars` and flight `date` projects
     to `departure_date`.

3. `lib/__tests__/capture-task-readiness.test.ts`
   - Assert `routeIntent` actions map to Capture actions:
     `ask_clarification` -> disabled `create_task`;
     `show_confirm_card kind=plan` -> enabled `create_task`;
     `show_confirm_card kind=room` -> `create_room`;
     `continue_chat` -> no task action.
   - Assert confidence alone cannot make an object task-ready when required
     fields are missing.

4. `app/api/booking-jobs/__tests__/capture-create-pending-job.test.ts`
   - Mock DB/auth and POST a Capture-derived `steps` array to
     `/api/booking-jobs`.
   - Assert every step is persisted with `status: "pending"`.
   - Assert no fetch to `/api/booking-jobs/[id]/start` happens in this route.
   - Assert missing `session_id` and empty `steps` return 400.

5. `lib/__tests__/capture-direct-booking-guard.test.ts`
   - Restaurant with explicit `restaurant_name` plus required fields can expose
     `direct_booking`.
   - Cuisine-only restaurant search cannot expose `direct_booking`.
   - Hotel with explicit `hotel_name` plus stay dates can expose
     `direct_booking`.
   - Generic hotel neighborhood search cannot expose `direct_booking`.

6. `lib/__tests__/capture-provenance.test.ts`
   - Text source preserves `raw_text`, `captured_at`, `nlu_state`,
     `nlu_action`, and `session_id`.
   - URL/screenshot stubs preserve source metadata and stay
     `needs_review` until extracted entities are reviewed.

## Recommended MVP Sequence

1. Add a small TravelObject builder around NLU v2 for text/request input.
2. Add fixture-only tests for the builder and readiness mapping.
3. Add URL/screenshot stub TravelObjects with source metadata and
   `needs_review`, but do not execute them.
4. Add convert-to-pending-task using the existing `/api/booking-jobs` shape.
5. Route the created task to the existing Task Workspace queue view.

This keeps Capture MVP aligned with Stage 0 without creating a second NLU,
task, or provider execution path.
