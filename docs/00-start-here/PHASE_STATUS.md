# Phase Status

Last updated: 2026-06-09

## Current Phase

```text
Action Gateway MVP
```

Onegent is pivoting to a B2B trust layer for AI agents executing high-risk
business actions. The current goal is to make the local MVP credible enough for
customer validation and design-partner conversations.

## Phase Goal

Build and validate the first usable Action Gateway flow:

```text
agent action intent
-> capture
-> risk assessment
-> policy evaluation
-> approval request
-> approve/reject
-> mock execution
-> verification
-> audit timeline
```

The MVP must remain safe:

- no real payments;
- no real emails;
- no real vendor/ERP/CRM updates;
- no real production website automation;
- no irreversible external action.

## Current Scope

| Lane | Status | Notes |
| --- | --- | --- |
| Domain model | In progress | ActionIntent, RiskAssessment, PolicyRule, ApprovalRequest, VerificationResult, AuditEvent. |
| Risk and policy engine | In progress | Deterministic rules for SUBMIT, PAY, SEND, UPDATE. |
| API routes | In progress | Capture/list/detail/approve/reject/verify/seed. |
| UI | In progress | `/action-gateway`, `/action-gateway/demo`, `/action-gateway/actions/:id`. |
| Procurement demo | In progress | $4,850 PO requiring approval and mock verification. |
| Tests | In progress | Core policy, approval, rejection, and verification behavior. |
| Customer validation | Ready for calls | Script in `docs/action-gateway-customer-validation.md`. |

## Legacy Boundary

The previous travel/consumer product is now a legacy demo at:

```text
/legacy/consumer-agent
```

Do not use old travel Stage 0/Stage 0B plans as the default direction for new
work. They are historical implementation context only.

## Nearest Done Criteria

The MVP is ready for initial customer validation when:

1. `/action-gateway` dashboard works locally.
2. Demo actions can be seeded.
3. Manual mock actions can be captured.
4. Risk/policy decisions are visible.
5. Pending approvals can be approved or rejected.
6. Approved actions run mock execution only.
7. Verification and audit timeline are visible.
8. Tests cover the core business logic.
9. README and Action Gateway docs explain run/test/demo/safety limits.
