# Goal Handoff - Task Workspace Performance

Last updated: 2026-05-06

Branch: `codex/goal-task-workspace-performance`

Base: `origin/codex/phase-closure-orchestration-20260505` at
`027c59a1db55c18923c9e3a7b8d4e16cdf05fa4c`.

## Current State

This branch is pure app/runtime engineering. It does not run or change provider
automation. The Tasks workspace now renders from compact task rows plus summary
counters, then loads full task detail only when one task is expanded, focused,
or modified.

## What Is New

- `GET /api/booking-jobs/compact-list`
  - returns compact list rows for `/tasks`;
  - excludes `steps`, `decisionLog`, profile data, logs, screenshots, and
    `autonomy_settings`;
  - includes counts, active/completed/failed flags, workspace bucket,
    latest status label, provider/scenario hints, and share metadata.
- `/tasks`
  - initial load calls summary + compact list only;
  - detail fetch is per-job and lazy;
  - expanded active rows can refresh detail, but completed/history rows do not
    poll detail by default;
  - live timeline/snapshot endpoints remain scoped to the visible live panel.
- Client-side request helpers dedupe inflight list/detail/summary fetches and
  support force refresh after mutation.
- Snapshot metadata fetches are deduped briefly, and snapshot images use lazy
  loading.
- `scripts/measure-app-performance.ts` measures endpoint latency and response
  bytes for bootstrap, task summary, compact list, and optional detail/timeline
  endpoints.

## Changed Files

- `app/api/booking-jobs/compact-list/route.ts`
- `app/api/booking-jobs/route.ts`
- `app/tasks/page.tsx`
- `app/tasks/task-data-client.ts`
- `components/task-timeline/SnapshotStream.tsx`
- `components/task-timeline/use-snapshots.ts`
- `docs/00-start-here/SYSTEM_DESIGN.md`
- `docs/10-coordination/goal.md`
- `lib/__tests__/booking-jobs-read-model.test.ts`
- `lib/__tests__/task-data-client.test.ts`
- `lib/booking-jobs/read-model.ts`
- `lib/db.ts`
- `scripts/measure-app-performance.ts`

## Validation

Completed local validation:

- `npx vitest run lib/__tests__/booking-jobs-read-model.test.ts lib/__tests__/task-data-client.test.ts`
  passed, 8 tests.
- Relevant task/booking-job tests:
  `npx vitest run lib/__tests__/booking-jobs-read-model.test.ts lib/__tests__/task-data-client.test.ts lib/__tests__/booking-jobs-db-errors.test.ts lib/__tests__/booking-jobs-modify.test.ts lib/__tests__/booking-jobs-worker-enqueue.test.ts lib/__tests__/status.test.ts lib/__tests__/status-pending-local.test.ts lib/__tests__/app-bootstrap.test.ts lib/__tests__/browser-snapshot-store.test.ts`
  passed, 51 tests.
- `npx tsc --noEmit --pretty false` passed.
- `npm run check-drift` passed.
- `npm run gate:phase1 -- --allow-known-drift` passed 9/9
  (`2026-05-06T08-00-24-113Z`).
- `npm run build` passed.
- `git diff --check` passed.

## Safety

No external provider flow, browser agent, live booking run, payment, login,
verification, OTP/CAPTCHA handling, or final confirmation is part of this work.
