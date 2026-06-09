# Procurement Walkthrough Plan

## Existing Implementation Summary

- API routes already exist under `app/api/action-gateway/**` for action capture, list/detail, approve, reject, verify, and generic demo seed.
- Storage is an in-memory `ActionGatewayState` in `lib/action-gateway/store.ts`. It is demo-only and resets on server restart.
- UI routes already exist for `/action-gateway`, `/action-gateway/actions/[id]`, and `/action-gateway/demo`.
- Domain modules already exist in `lib/action-gateway/`: `types`, `risk`, `policies`, `service`, `store`, and `demo-seeds`.
- Tests exist in `lib/__tests__/action-gateway.test.ts` for policy, approval, rejection, mock execution, and verification.
- Demo seed logic already creates a procurement-like action, but it is a general demo list, not a guided deterministic walkthrough.

## New Walkthrough Route

Add `/action-gateway/walkthrough/procurement` as a dedicated guided demo page.

The page should let a founder complete the full story from one place:

1. Agent proposes a $4,850 purchase order.
2. Onegent assesses HIGH risk and applies policy.
3. Human approves or rejects.
4. Approved actions update only the local Mock ERP purchase order.
5. Verification checks the local Mock ERP observed state.
6. The founder can export/copy an audit packet.

## API Changes Needed

- `GET /api/action-gateway/demo/procurement` returns the current deterministic walkthrough state.
- `POST /api/action-gateway/demo/procurement/reset` resets the walkthrough and creates the deterministic mock PO plus ActionIntent.
- `GET /api/action-gateway/actions/:id/audit-packet` returns a demo audit packet JSON payload.

Existing approve/reject endpoints should be reused.

## Mock Procurement System Changes Needed

Add a local mock procurement module that stores a deterministic purchase order:

- ID: `PO-DEMO-4850`
- Status: `DRAFT` before approval, `SUBMITTED` after mock execution
- Vendor: `Acme Industrial Supply`
- Amount: `4850 USD`
- Vendor approved: `true`
- Line item: `Replacement motor for Line 3`

Add a read-only mock system page at `/mock-systems/procurement/purchase-orders/[id]`.

## Audit Packet Changes Needed

Add an audit packet builder that includes:

- action intent
- risk assessment
- triggered policies
- approval result
- mock execution summary
- verification result
- audit events
- demo disclaimer

Generating the packet should append an `AUDIT_PACKET_GENERATED` audit event.

## Test Plan

- Resetting the procurement walkthrough creates one deterministic PO in `DRAFT` and one action in `NEEDS_REVIEW`.
- Approving the action updates the local Mock ERP PO to `SUBMITTED` and verification passes.
- Rejecting the action leaves the PO in `DRAFT` and does not execute.
- Audit packet generation includes the demo disclaimer, review payload, execution summary, and audit event.

## Manual Demo Instructions

1. Start the app.
2. Open `/action-gateway/walkthrough/procurement`.
3. Click `Start demo / Capture action`.
4. Show HIGH risk, policy, and pending approval.
5. Click approve to run mock execution and verification.
6. Open the Mock ERP link to show the local PO state.
7. Export or copy the audit packet.

No real integrations, vendor portals, payments, emails, credentials, scraping, or external systems are involved.
