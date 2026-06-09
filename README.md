# Onegent

Onegent is now an **Action Gateway for AI Agents**: an MVP trust layer for
capturing, reviewing, approving, verifying, and auditing high-risk business
actions before agents touch real systems.

## Onegent Action Gateway MVP

### What it is

Onegent Action Gateway helps teams evaluate AI-agent actions such as:

- `SUBMIT`: submit a purchase order or operational form.
- `PAY`: approve or pay an invoice.
- `SEND`: send an important email or message.
- `UPDATE`: update inventory, CRM, ERP, or operational records.

The MVP workflow is:

```text
Agent prepares action
-> Onegent captures the intent
-> Onegent assesses risk
-> Onegent evaluates policy
-> Human approves or rejects when required
-> Approved actions run mock execution only
-> Onegent verifies expected vs observed demo state
-> Onegent displays an audit timeline
```

### What it is not

This MVP is not:

- a generic agent platform;
- a consumer travel booking product;
- a generic LLM eval or observability dashboard;
- a production payment, email, ERP, CRM, vendor, or browser automation gateway;
- a system that performs irreversible real-world actions.

### How to run locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000/action-gateway
```

The Action Gateway MVP uses an isolated in-memory demo store, so it can run
without real vendor credentials, payment systems, email systems, or production
websites.

### How to seed demo actions

Open:

```text
http://localhost:3000/action-gateway/demo
```

Click **Seed five demo actions**.

The seed creates:

1. A $4,850 purchase order to an approved vendor requiring approval.
2. A $250 demo submit action that can be allowed and mock-verified.
3. A payment to an unknown vendor that is blocked.
4. An external email `SEND` action requiring approval.
5. An inventory `UPDATE` changing quantity by more than 20%, requiring approval.

### How to run tests

```bash
npm run test -- lib/__tests__/action-gateway.test.ts lib/__tests__/procurement-walkthrough.test.ts
```

Broader validation:

```bash
npx tsc --noEmit --pretty false
npm run check-drift
npm run gate:phase1 -- --allow-known-drift
npm run build
```

### How to run the procurement demo

1. Start the app with `npm run dev`.
2. Open `/action-gateway/walkthrough/procurement`.
3. Click **Start demo / Capture action**.
4. Review the HIGH risk score, policy, and approval request.
5. Approve the action.
6. Confirm the local Mock ERP purchase order moves from `DRAFT` to `SUBMITTED`.
7. Confirm verification passes against the local mock state.
8. Export or copy the audit packet.

### Safety limitations

- No real purchase is made.
- No real email is sent.
- No real external form is submitted.
- No real ERP, CRM, inventory, vendor, or payment system is modified.
- No credentials or user secrets are required.
- No external provider portal is scraped.
- Storage is in-memory and demo-only.

## Docs

- [Implementation plan](./docs/action-gateway-implementation-plan.md)
- [Procurement walkthrough plan](./docs/procurement-walkthrough-plan.md)
- [Architecture](./docs/action-gateway-architecture.md)
- [API example](./docs/action-gateway-api-example.md)
- [Customer validation script](./docs/action-gateway-customer-validation.md)
- [Docs index](./docs/INDEX.md)

## Legacy consumer demo

The previous consumer/travel agent surface is retained as a legacy demo at:

```text
/legacy/consumer-agent
```
