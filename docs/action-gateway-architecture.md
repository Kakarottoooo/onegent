# Onegent Action Gateway Architecture

## Purpose

Onegent Action Gateway is an MVP trust layer for AI agents executing high-risk
business workflows. It captures intended actions, classifies risk, evaluates
policy, requests approval, mock-executes approved actions, verifies the observed
demo result, and writes an audit trail.

This is not a production in-path enterprise gateway yet. It does not integrate
with real payment systems, email systems, ERPs, CRMs, vendor portals, or
production websites.

## Domain Model

- `ActionIntent`: what the source agent wants to do.
- `RiskAssessment`: risk level, score, reasons, triggered policies, and human
  approval requirement.
- `PolicyRule`: deterministic MVP policy rule metadata.
- `ApprovalRequest`: human review object for pending risky actions.
- `VerificationResult`: expected vs observed state comparison.
- `AuditEvent`: append-style event history for capture, policy, approval,
  mock execution, verification, and cancellation.

## Workflow

```text
Agent prepares action
-> POST /api/action-gateway/actions
-> ActionIntent captured
-> Risk assessed
-> Policies evaluated
-> If blocked: action is CANCELLED
-> If approval required: ApprovalRequest is PENDING
-> If low risk: system approves and mock-executes
-> Human approves or rejects
-> Approved action mock-executes
-> Mock verifier compares expected vs observed state
-> Audit timeline is displayed in /action-gateway/actions/:id
```

## Risk Engine

The MVP uses deterministic TypeScript logic in `lib/action-gateway/risk.ts`.

Rules:

- PAY is high risk by default.
- Amounts over $1,000 increase risk and require approval.
- Production actions require approval.
- PAY to an unknown vendor is critical risk.
- External SEND actions are high risk.
- UPDATE actions changing a numeric field by more than 20% are high risk.
- SUBMIT is medium risk by default and high risk when the amount is over $1,000.

## Policy Engine

Default policies live in `lib/action-gateway/policies.ts`.

Policy effects:

- `ALLOW`
- `REQUIRE_APPROVAL`
- `BLOCK`

Current policies:

1. Require approval for payments or commercial actions over $1,000.
2. Require approval for all production actions.
3. Block payments to unknown vendors.
4. Require approval for external emails.
5. Require approval for inventory updates greater than 20%.
6. Allow low-risk demo/staging submit actions.

## Approval Flow

`POST /api/action-gateway/actions/:id/approve`:

1. Marks the approval request as `APPROVED`.
2. Marks the action as `APPROVED`.
3. Writes an audit event.
4. Runs mock execution.
5. Runs mock verification.

`POST /api/action-gateway/actions/:id/reject`:

1. Marks the approval request as `REJECTED`.
2. Marks the action as `REJECTED`.
3. Writes an audit event.
4. Does not execute.

## Verification Flow

The MVP verifier compares:

- expected state: `ActionIntent.proposedAfterState`
- observed state: mock execution output or supplied `observedState`

If all fields match, the action becomes `VERIFIED`. If any field differs, it
becomes `FAILED_VERIFICATION`.

## Audit Trail

Audit events are created for:

- action captured
- risk assessed
- policy evaluated
- approval requested
- action approved
- action rejected
- mock execution started
- mock execution completed
- verification passed
- verification failed
- action cancelled

## Storage

The MVP uses `lib/action-gateway/store.ts`, an isolated in-memory demo store.
This is deliberate: the Action Gateway demo must run locally without paid
services, credentials, real enterprise systems, or irreversible actions.

Production replacement requirements:

- Postgres persistence.
- Tenant/workspace isolation.
- Authenticated reviewer identity.
- Immutable audit storage.
- Idempotency keys for agent submissions.
- Signed callback or webhook delivery.
- Real integration adapters with dry-run and approval boundaries.

## Current MVP Limitations

- In-memory state resets when the process restarts.
- No real vendor, email, ERP, CRM, or payment integration.
- No production credentials.
- No real browser automation against external systems.
- No immutable storage guarantees.
- No enterprise RBAC.
- No webhooks or SDK package yet.
- Verification is mock/state comparison only.
