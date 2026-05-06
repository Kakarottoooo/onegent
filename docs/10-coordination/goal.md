# Goal Handoff - App Shell Performance Pass

Last updated: 2026-05-06

Branch: `codex/goal-app-shell-performance-pass`

Base: `origin/codex/phase-closure-orchestration-20260505` at
`0ff272cdbe779a6d7d42af38519dc3807a770e36`.

## Current State

This branch is pure app/runtime performance engineering. It does not run or
change provider automation. The app shell, Rooms, Contacts, and Calendar now
follow the same compact-first pattern already used by `/tasks`.

## What Is New

- GlobalNav reuses `/api/app/bootstrap` for task action count and compact
  account display data instead of issuing a separate task-summary request on
  first paint.
- Notification inbox UI, task timeline panels, and the Contacts DM pane are
  lazy client boundaries.
- `GET /api/rooms/compact-list` returns room list cards without full context,
  synthesis, proposal, vote, or message payloads.
- `GET /api/contacts/bootstrap` returns profile, contacts, and counts only.
  Groups, blocks, requests, suggestions, and DMs load after the shell or when
  the relevant section opens.
- `GET /api/calendar/jobs` returns calendar-specific task rows with minimized
  step fields and excludes decision logs, errors, policies, screenshots, and
  runtime logs.
- Calendar route entry renders the month shell immediately, checks Google
  connection status separately, reads cached month rows separately, and only
  performs Google network sync when the user clicks `Sync now`.
- `scripts/measure-app-performance.ts` now probes shell, tasks, rooms,
  contacts, and calendar endpoint bytes/latency.

## Changed Files

- `app/api/calendar/google/status/route.ts`
- `app/api/calendar/jobs/route.ts`
- `app/api/contacts/bootstrap/route.ts`
- `app/api/rooms/compact-list/route.ts`
- `app/calendar/page.tsx`
- `app/contacts/page.tsx`
- `app/page.tsx`
- `app/rooms/page.tsx`
- `app/tasks/page.tsx`
- `components/GlobalNav.tsx`
- `components/app-bootstrap-client.ts`
- `docs/00-start-here/SYSTEM_DESIGN.md`
- `docs/10-coordination/goal.md`
- `lib/__tests__/app-bootstrap.test.ts`
- `lib/__tests__/app-shell-read-model.test.ts`
- `lib/__tests__/calendar-read-model.test.ts`
- `lib/app-bootstrap.ts`
- `lib/app-shell-read-model.ts`
- `lib/calendar-grid.ts`
- `lib/calendar-read-model.ts`
- `lib/db.ts`
- `scripts/measure-app-performance.ts`

## Safety

No external provider workflow, browser booking agent, live booking run,
OpenAI live call, payment, login, verification, OTP/CAPTCHA handling, or final
confirmation is part of this work.

There are unrelated local tracked provider-runtime edits in this worktree that
are not part of this branch and must not be staged for this goal.
