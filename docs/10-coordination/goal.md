# Goal Handoff - Execution Layer V2 No-Live Skeleton

Last updated: 2026-05-06

Branch: `codex/execution-layer-v2-harness`

Base: `v1-provider-closure-baseline` at
`31dd0355b045c972bf8607bd349da19b5e27bd59`.

## Current State

This branch adds a no-live architecture/runtime skeleton for layered executors.
It does not run or change live provider automation. L1 remains the current
provider adapter path; L2 Browser Harness and L3 Computer Use are represented as
runtime layers under the same task identity and evidence model.

## What Is New

- `lib/execution-layer/types.ts` defines `ExecutionLayer`, `ExecutionEvent`,
  `ExecutorResult`, `ExecutorTerminalOutcome`, `LayerEscalationReason`,
  `LayerPolicy`, and `ExecutionAttempt` identity fields.
- `lib/execution-layer/orchestrator.ts` adds a no-live `LayerOrchestrator` that
  consumes mocked executor results, starts with L1, and emits normalized events.
- `lib/execution-layer/policy.ts` locks the escalation rules: only
  evidence-backed runtime drift can move from L1 to L2.
- `lib/execution-layer/browser-harness-contract.ts` defines the future JSONL
  event and patch-proposal contract. Patch proposals are advisory and cannot
  auto-apply provider changes.
- `lib/execution-layer/evidence.ts` converts layer events into existing
  `decisionLog` and task timeline shapes and centralizes the event-driven
  screenshot policy.
- `docs/00-start-here/SYSTEM_DESIGN.md` now describes the layered executor
  architecture.
- `docs/30-provider-debug/EXECUTION_LAYER_V2_BROWSER_HARNESS_PLAN.md` documents
  the Browser Harness integration plan and no-live boundary.

## Escalation Rules Implemented

Escalates L1 to L2 only for evidence-backed runtime drift:

- `selector_drift`
- `progress_stall`
- `iframe_miss`
- `click_miss`
- `field_fill_miss`
- `unknown_page_mutation`

Does not escalate for true no availability with evidence, provider degraded,
network blocked, session blocked, model/env blocked, unsafe boundary,
insufficient evidence, or unknown failure.

## Tests

Focused no-live coverage lives in
`lib/__tests__/execution-layer-v2.test.ts`.

Covered cases:

- L1 success stops without escalation.
- True no availability with evidence does not escalate to L2.
- Selector drift escalates L1 to L2.
- L2 success preserves task/job/attempt identity and emits `layer_escalated`.
- Provider degraded is classified, not blindly escalated.
- Browser Harness patch proposal never mutates L1 automatically.
- Future L3 route is represented but not invoked.
- Events include task/job/attempt/plan/provider/layer/stage/severity/message.

## Safety

No external provider workflow, Browser Harness install, browser attach,
Computer Use call, OpenAI live call, payment, login, verification, OTP/CAPTCHA
handling, or final confirmation was part of this work.
