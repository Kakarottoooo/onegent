# Claude — coordination state

> **Branch**: `claude/festive-pare-f27273` (worktree)
> **Last updated**: 2026-05-02 19:55 UTC
> **Last commit**: pending (this session)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

Idle — just shipped `NLU_CONSUMER_CONTRACT.md` (handoff doc for the
real chat-panel hookup) + `[coord]` 774312d (coordination protocol).
Not running any background processes.

## ⏳ Blocking on codex

| Blocker | Why I need it |
|---|---|
| Master typecheck cleanup (17 TS errors) | Can't safely re-merge master into branch until clean; pre-existing errors mask new ones I'd introduce |
| `/api/v1/users/me/profile` (or equivalent) PATCH endpoint | ProfileGapCard `onSave` and NLU `apply_profile_patch` route both need a real consumer; current `/dev/profile-gap-flow` mocks it |
| Cookie-auth proxy for `/api/v1/travel-tasks/*` | Browser-side `/tasks/[taskId]` page can't render real timeline without it; benchmark dashboard drawer drill-down link is a placeholder until then |
| Phase 0 R-003 smoke run output | Dashboard at `/dev/benchmark-runs` ready to render real run; waiting on first `benchmark/runs/phase0-resy-*.json` |

## 📦 Recently shipped (Track B, last 9 commits on this branch)

| Commit | Subject | Notes for codex |
|---|---|---|
| _(pending)_ | `[handoff]` `NLU_CONSUMER_CONTRACT.md` | **Read this before wiring chat panel.** Full dispatch contract + 5 worked traces + open questions section listing what I need from you (PATCH endpoint path, validation shape, idempotency, etc.) |
| `774312d` | `[coord]` `.coordination/{claude,codex}.md` protocol + commit-msg tags | Coordination scaffolding; CLAUDE.md § "协作协议" describes the protocol you're now reading |
| `fcdc1d9` | `/dev/profile-gap-flow` end-to-end mock | Demonstrates the wiring shape codex's real chat-panel hookup will use — clone `handleSend` and replace mocks with real fetches |
| `76e35b9` | NLU profile_edit + apply_profile_patch + 21 golden tests | Contract layer — `lib/agent/nlu-v2/` types/router/extractor extended |
| `cee4d9a` | profile-gap demo polish (schema legend + wire trace + payload preview) | `/dev/profile-gap-demo` is now a contract reference page |
| `8f44eeb` | benchmark drawer drill-down fix + 56 helper tests | Drops broken `/tasks/{taskId}` link; locks codex's report contract |
| `4e06f29` | `/dev/benchmark-runs` Phase 0 dashboard | Ready to consume real `benchmark/runs/*.json` once they land |
| `bf1598f` | merge `origin/master` (took theirs on `executor.ts`) | Codex's `buildProfileGap` abstraction kept |
| `077a05c` | ProfileGapCard canonical 13-field alignment | Per `PHASE0_REPORT_CONTRACT.md` schema |

## 🤝 Open questions for codex

5 questions from `NLU_CONSUMER_CONTRACT.md` § "Open questions for codex":

1. **PATCH endpoint path** — `/api/users/me/profile` (cookie) vs
   `/api/v1/users/me/profile` (API-key)? Both? When does the
   cookie-auth proxy for `/api/v1/*` land?
2. **Validation contract** — what error shape on field-level rejection
   (DOB in future, phone too short, etc.)?
3. **Idempotency** — is PATCH idempotent? (network retry → 200 silent or 409?)
4. **Telemetry** — should `apply_profile_patch` dispatches emit a
   client telemetry event so we can spot extractor accuracy regressions?
5. **MCP path mid-flow state** — when chat surface is `tools/call`
   instead of browser, how do we ack patch + leave booking state for
   the next call?

Resolve at chat-panel hookup time. No rush; doc captures my commitments
until then.

## 🚧 Hold rules I'm respecting

- Never merge `claude/festive-pare-f27273` → `master` (codex handles eventual integration)
- Don't touch `lib/booking-autopilot/`, `lib/core/execution/`, `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`, `app/api/booking-jobs/[id]/start/route.ts`
- Don't fix the 17 master typecheck errors (codex's domain)
- Don't run `npm run dev` or worker (avoid stealing tasks during smoke run)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`
- `app/dev/**` (all dev-only routes)
- `lib/agent/nlu-v2/**` (chat / extractor / router / tests)
- `lib/ui-copy/**`
- `BENCHMARK_RESTAURANT_100.md`, `EXECUTOR_V2_PIVOT.md`, `TASK_RUNTIME_DESIGN.md`
- All `__tests__/` for the above
