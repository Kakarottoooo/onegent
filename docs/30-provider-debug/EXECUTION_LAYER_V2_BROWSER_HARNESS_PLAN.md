# Execution Layer V2 and Browser Harness Plan

Last updated: 2026-05-06

This is the no-live architecture plan for layering future executors under the
same Onegent task runtime. It is not a provider closure attempt and it is not a
Browser Harness installation guide.

## Hard Boundary

- No external provider/browser workflow.
- No Browser Harness install or browser attachment.
- No Computer Use call.
- No OpenAI live call.
- No payment, login, verification, OTP, CAPTCHA, or final booking flow.
- No automatic edits to provider adapters from Browser Harness output.

## Layer Model

`lib/execution-layer/types.ts` defines:

- `ExecutionLayer = provider_adapter | browser_harness | computer_use`
- `ExecutionEvent`
- `ExecutorResult`
- `ExecutorTerminalOutcome`
- `LayerEscalationReason`
- `LayerPolicy`
- `ExecutionAttempt` identity fields:
  `taskId`, `jobId`, `attemptId`, `planVersion`, `provider`, `layer`

The runtime identity must remain stable across layers. L2 and future L3 are
different executor layers for the same task/job/attempt chain, not new task
systems.

## No-Live Orchestrator

`lib/execution-layer/orchestrator.ts` exports `runNoLiveLayerOrchestrator`.
It accepts a sequence of mocked `ExecutorResult` objects and emits normalized
`ExecutionEvent` records for every stage.

The default path is:

1. Start L1 `provider_adapter`.
2. Stop on success, safe handoff, no availability with evidence, manual-review
   boundaries, safety boundaries, or classified provider/model/session blocks.
3. Escalate to L2 `browser_harness` only when L1 reports evidence-backed runtime
   drift.
4. Represent L3 `computer_use` as a planned layer, but keep it disabled in this
   no-live skeleton.

## Escalation Rules

Escalates from L1 to L2 only for these evidence-supported drift reasons:

- `selector_drift`
- `progress_stall`
- `iframe_miss`
- `click_miss`
- `field_fill_miss`
- `unknown_page_mutation`

Does not escalate for:

- `no_availability` when evidence shows true no availability.
- `provider_degraded`
- `network_blocked`
- `session_blocked`
- `model_env_blocked`
- `unsafe_boundary`
- `failed_unknown` or `insufficient_evidence`

If drift is reported without evidence, the orchestrator stops as
`insufficient_evidence` rather than guessing.

## Browser Harness JSONL Contract

`lib/execution-layer/browser-harness-contract.ts` defines the future bridge
shape. Expected JSONL events include:

```json
{
  "schemaVersion": 1,
  "bridge": "browser_harness_jsonl",
  "taskId": "task-id",
  "jobId": "job-id",
  "attemptId": "attempt-id",
  "planVersion": 1,
  "provider": "booking-com",
  "layer": "browser_harness",
  "eventId": "event-id",
  "ts": "2026-05-06T00:00:00.000Z",
  "type": "stage_changed",
  "stage": "stage_transition",
  "severity": "info",
  "message": "Moved from search results to room selection"
}
```

The bridge can also emit `patch_proposal` events. A patch proposal describes:

- discovered selectors
- selector strategy
- evidence references
- suggested focused tests
- rationale

Patch proposals are advisory only:

```json
{
  "canAutoApply": false,
  "productionMutation": "forbidden"
}
```

Browser Harness output must never auto-edit L1 provider code.

## Evidence Integration

`lib/execution-layer/evidence.ts` converts `ExecutionEvent` records into:

- existing `decisionLog` entries
- task timeline events
- screenshot policy decisions

The screenshot policy is event-driven:

- open page
- stage transition
- before meaningful action
- after meaningful action
- failure
- layer escalation
- terminal checkpoint

It does not use per-second screenshots.

## Future Runtime Bridge

The future L2 runtime bridge should be a subprocess/JSONL adapter around the
types above. The bridge should stream events and patch proposals back into the
same task runtime, not create a separate Browser Harness task system.

L3 Computer Use remains a represented future route. It needs a separate,
explicit approval path before any live model/browser call is added.
