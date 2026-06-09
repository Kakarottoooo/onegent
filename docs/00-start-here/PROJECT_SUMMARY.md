# Onegent Project Summary

Last updated: 2026-06-09

Onegent is pivoting from a consumer travel execution agent into a B2B AI Agent
Action Gateway MVP: a trust layer for AI agents executing high-risk business
actions.

## Current Product

Main product route:

```text
/action-gateway
```

Onegent captures an intended action from an AI agent, classifies risk,
evaluates policy, routes risky actions to human approval, runs mock execution
only when allowed, verifies expected vs observed demo state, and displays an
audit timeline.

Initial action types:

- `SUBMIT`
- `PAY`
- `SEND`
- `UPDATE`

The first polished demo is procurement:

```text
Procurement agent wants to submit a $4,850 purchase order.
```

The dedicated walkthrough route is:

```text
/action-gateway/walkthrough/procurement
```

The vendor is approved, the amount exceeds the $1,000 approval threshold, a
human reviewer approves, Onegent updates only the local Mock ERP state, verifies
the PO status changed from `DRAFT` to `SUBMITTED`, and exports an audit packet.

## What This MVP Is Not

- Not a generic agent platform.
- Not a consumer travel/hotel/restaurant booking product.
- Not a generic LLM eval or observability dashboard.
- Not a production payment, email, ERP, CRM, vendor, or browser automation
  gateway.
- Not allowed to perform irreversible real-world actions.

## Current Implementation

Core code:

- `lib/action-gateway/types.ts`
- `lib/action-gateway/risk.ts`
- `lib/action-gateway/policies.ts`
- `lib/action-gateway/store.ts`
- `lib/action-gateway/service.ts`
- `lib/action-gateway/demo-seeds.ts`
- `lib/action-gateway/mock-procurement.ts`
- `lib/action-gateway/procurement-walkthrough.ts`

Routes:

- `/action-gateway`
- `/action-gateway/demo`
- `/action-gateway/walkthrough/procurement`
- `/action-gateway/actions/:id`
- `/mock-systems/procurement/purchase-orders/:id`
- `/api/action-gateway/actions`
- `/api/action-gateway/actions/:id`
- `/api/action-gateway/actions/:id/audit-packet`
- `/api/action-gateway/actions/:id/approve`
- `/api/action-gateway/actions/:id/reject`
- `/api/action-gateway/actions/:id/verify`
- `/api/action-gateway/demo/seed`
- `/api/action-gateway/demo/procurement`
- `/api/action-gateway/demo/procurement/reset`

Storage is intentionally in-memory and demo-only so the MVP runs locally
without real credentials or external systems.

## Current Docs

- `docs/action-gateway-implementation-plan.md`
- `docs/procurement-walkthrough-plan.md`
- `docs/action-gateway-architecture.md`
- `docs/action-gateway-api-example.md`
- `docs/action-gateway-customer-validation.md`

## Legacy Boundary

The previous travel/consumer agent is retained as a legacy demo:

```text
/legacy/consumer-agent
```

It should not be treated as the primary product surface for new work.
