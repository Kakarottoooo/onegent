# Action Gateway Implementation Plan

## Existing Repo Summary

Onegent is a Next.js App Router application written in TypeScript. It uses npm,
React, Tailwind CSS, Vitest, Clerk, Vercel Postgres helpers, Playwright, and
Stagehand. The current codebase contains a mature travel execution runtime with
API routes under `app/api/**`, task/workspace UI under `app/**` and
`components/**`, provider execution code under `lib/booking-autopilot/**` and
`worker/src/**`, and tests under `lib/__tests__/**`.

## What Will Be Reused

- Next.js App Router and server route handlers.
- TypeScript domain modules in `lib/**`.
- Existing global CSS tokens and basic page layout conventions.
- Vitest for core behavior tests.
- The existing route/API style: small route handlers delegating to `lib/**`
  services.

## What Will Be Deprecated Or Moved To Legacy

Consumer travel execution is not deleted in this MVP. It is treated as a legacy
demo surface. The new product route is `/action-gateway`, and the homepage will
present Action Gateway as the main product. Existing travel pages can remain
accessible as legacy/demo routes, but they should not be the main product
positioning.

## New Modules To Add

- `lib/action-gateway/types.ts`: domain model contracts.
- `lib/action-gateway/policies.ts`: default policy definitions and policy
  evaluation.
- `lib/action-gateway/risk.ts`: deterministic MVP risk assessment.
- `lib/action-gateway/store.ts`: isolated demo-only in-memory store.
- `lib/action-gateway/service.ts`: capture, approval, rejection, mock execution,
  verification, and audit orchestration.
- `lib/action-gateway/demo-seeds.ts`: procurement and safety demo actions.
- `app/api/action-gateway/**`: API routes for capture, list, detail, approve,
  reject, verify, and seeding.
- `app/action-gateway/**`: dashboard, detail, and demo UI.

## Exact Files To Create Or Edit

Create:

- `lib/action-gateway/types.ts`
- `lib/action-gateway/policies.ts`
- `lib/action-gateway/risk.ts`
- `lib/action-gateway/store.ts`
- `lib/action-gateway/service.ts`
- `lib/action-gateway/demo-seeds.ts`
- `lib/__tests__/action-gateway.test.ts`
- `app/api/action-gateway/actions/route.ts`
- `app/api/action-gateway/actions/[id]/route.ts`
- `app/api/action-gateway/actions/[id]/approve/route.ts`
- `app/api/action-gateway/actions/[id]/reject/route.ts`
- `app/api/action-gateway/actions/[id]/verify/route.ts`
- `app/api/action-gateway/demo/seed/route.ts`
- `app/action-gateway/page.tsx`
- `app/action-gateway/actions/[id]/page.tsx`
- `app/action-gateway/actions/[id]/ApprovalPanel.tsx`
- `app/action-gateway/demo/page.tsx`
- `docs/action-gateway-architecture.md`
- `docs/action-gateway-customer-validation.md`
- `docs/action-gateway-api-example.md`

Edit:

- `README.md`
- `app/page.tsx`
- optionally `components/BrandStrip.tsx` if the top-level navigation needs a
  clearer Action Gateway label.

## Storage Strategy

The repository has a Postgres-backed data layer, but this MVP must run locally
without real vendors, credentials, paid services, or irreversible actions. The
Action Gateway MVP will therefore use an isolated in-memory demo store with a
clear comment that it is not production persistence. The service layer will keep
storage behind a small module so it can be replaced by Postgres later.

## Test Strategy

Use Vitest against the public service API. Cover:

1. PAY over 1000 requires approval.
2. Production actions require approval.
3. Unknown vendor payment is blocked.
4. External SEND requires approval.
5. Large inventory UPDATE requires approval.
6. Low-risk demo SUBMIT auto-verifies through mock execution.
7. Approving an action creates audit events and mock execution.
8. Rejecting an action prevents mock execution.
9. Verification passes when expected and observed state match.
10. Verification fails when observed state differs.

## Manual Demo Instructions

1. Run `npm run dev`.
2. Open `/action-gateway`.
3. Open `/action-gateway/demo`.
4. Click "Seed demo actions".
5. Open the procurement demo action:
   "Procurement agent wants to submit a $4,850 purchase order."
6. Review risk, policy trigger, before/after state, and audit timeline.
7. Approve it.
8. Confirm mock execution and verification move the action to `VERIFIED`.

No real payment, email, external form, ERP, CRM, vendor portal, credential, or
production website is touched.
