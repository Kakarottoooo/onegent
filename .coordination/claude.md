# Claude — coordination state (ack history + ownership; v2 post-HUDDLE)

> **Branch**: `claude/coord-huddle-protocol` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-03 18:55 UTC
> **Last commit**: this commit (HUDDLE protocol adoption — doc-only)
>
> **Working memory has moved to `.coordination/HUDDLE.md`** (single file,
> 2k-word cap, both agents read+write). This file is now ack history +
> blockers + ownership manifest only. See `CLAUDE.md` § 协作协议 for the v2
> protocol contract. Codex's parallel file: `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

**HUDDLE coordination protocol rollout** (doc-only), per founder's directive:
> "先做 HUDDLE coordination doc-only。不要碰 OpenTable provider / worker /
> task UI。Codex 正在修 OpenTable phone field 实填问题。"

This commit:
1. ✅ New `.coordination/HUDDLE.md` — shared 2k-word working memory with
   sections: Inbox-for-codex / Inbox-for-claude / Active-locks /
   Live-activity (FIFO trim) / Hot-decisions (top 5). Includes embedded
   write protocol at bottom.
2. ✅ New `STRATEGIC_LEDGER.md` (project root) — extracted strategic locks
   from per-agent files into single append-only ledger (immutable, never
   trimmed). Replaces the per-agent `📍 Strategic decisions locked` section.
3. ✅ Updated `CLAUDE.md` § 协作协议:
   - Session-start ritual v2: HUDDLE first, STRATEGIC_LEDGER second, ack
     files third (fallback)
   - HUDDLE write rules section
   - STRATEGIC_LEDGER write rules section (append-only)
   - Schema 契约 v2: per-agent files精简 from 7 mandatory sections to 4
4. ✅ Updated this `.coordination/claude.md` to be ack-history-only
   (working memory moved to HUDDLE).

**Strictly NOT touched** (per founder's scope):
- `lib/booking-autopilot/providers/opentable-com.ts` (codex 修中)
- `worker/src/**` (codex domain)
- `app/tasks/[taskId]/**`, `components/task-timeline/**` (task UI)
- `app/api/**`, `lib/core/**`, `lib/execution-v2/**`
- Any code (this is doc-only)

**Verified pre-push**:
- `npx tsc --noEmit --pretty false` clean

## 📩 Acks for codex's recent pushes

### `3043a29 [merge]` + `75ba601 [coord]` — Founder E2E polish landed ✅ CONSUMED

Codex merged `claude/founder-e2e-polish` (`adf3d77`) cleanly. Quick path
(10 min) + Full path (60-90 min) bifurcation + stop conditions + enhanced
bug template + R003 runbook reference all on master.

### `88e7ecd [fix-docs]` + `b7e8368 [coord]` — R-003 runbook align with runner ✅

Codex caught two real errors in my v2 runbook:
1. R-003 single-case command had wrong flags (`--confirm-suite` /
   `--output` were wrong; actual is `--case R-003 --live-openai
   --allow-failures` only).
2. Browserbase assumption was wrong; current path is local Next dev +
   worker + Playwright/CU. Codex rewrote § 0.2 / § 1.3 / § 2.3 / § 6.

✅ Acknowledged. Future doc updates touching R003 runner / fixture
language: defer to codex's master state (Track A file ownership).

### `d88464e [coord] R-003 readiness preflight` ✅ CONSUMED earlier

### `f9dd0ba [merge]` + earlier — Phase 1 smoke landed ✅ CONSUMED earlier

### `f423b56` cherry-pick + earlier — Path B hardening landed ✅ CONSUMED earlier

### `4cdaa36 [merge] + 7289ba0 [fix] + 8500af3 [merge]` — Phase 1 #7 fully shipped ✅ CONSUMED earlier

## 🔴 Open BUG reports for codex

(none — OpenTable phone-field issue is codex-owned, in flight)

## 🤝 Open questions for codex

### For this branch (`claude/coord-huddle-protocol`)

- **HUDDLE 2k-word cap**: chosen by founder; trim policy is FIFO on 🔥 Live
  Activity. If 2k feels too tight after 1 week, easy to bump to 3k via
  one-line edit — no protocol change needed.
- **`.coordination/codex.md` schema sync**: my proposed v2 schema精简 (7→4
  mandatory sections) applies to both files. If codex agrees, codex.md
  on master gets the same精简 in his next push. I won't edit codex.md.
- **Main worktree cleanup deferred**: `~/onegent` is 99 commits behind +
  has dirty working tree per founder. Not addressing in this branch (out
  of scope per directive). Suggest separate `claude/main-worktree-rescue`
  branch later when founder has bandwidth.

### Standing items (carried)

- R-003 #3 live smoke decision pending founder go/no-go; preflight green
  per `d88464e`. Recurring-flake structural discussion (observability +
  replay) in deliberation; no commitment yet.
- OpenTable phone-field实填 — codex owned, in flight.
- Warm session PoC blocked until R-003 #3 outcome.
- Q4 (telemetry) / Q5 (MCP mid-flow) deferred to Phase 2.

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Focused review + merge `claude/coord-huddle-protocol` (this branch) | ⏳ pending |
| OpenTable phone-field实填 fix | ⏳ codex in flight |
| R-003 #3 live smoke decision | Pending founder go/no-go |
| Warm session PoC | Blocked until R-003 #3 outcome |

**Resolved this round** ✓
- Founder E2E doc polish — landed via `3043a29`

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `docs(coord): adopt HUDDLE protocol — shared 2k-word working memory + STRATEGIC_LEDGER` | doc-only. tsc clean. New HUDDLE.md + STRATEGIC_LEDGER.md; CLAUDE.md § 协作协议 updated; per-agent files精简 to ack history. |
| `adf3d77 → 3043a29` | `docs(founder-e2e): quick path + stop conditions + R003 reference` | Merged earlier this round. |
| `1c9299d → d0d5d32` + `88e7ecd` | `merge + fix: phase status docs + R-003 runner alignment` | Merged earlier. |
| `4f213ac → f9dd0ba` | `feat(phase-1-e2e): no-token founder walkthrough smoke` | Merged earlier. |
| `acec60c → f423b56` | `feat(phase-1-7): Path B hardening` | Cherry-picked earlier. |

Archival branches (no further commits):
- `claude/founder-e2e-polish` (frozen at `adf3d77`, merged via `3043a29`)
- `claude/phase-status-docs` (frozen at `3e37175`; superseded by `88e7ecd`)
- `claude/phase-1-e2e-smoke` (frozen at `4f213ac`, merged via `f9dd0ba`)
- `claude/phase-1-7-path-b-hardening` (frozen at `acec60c`, cherry-picked as `f423b56`)
- `claude/post-merge-doc-fixes` (frozen at `dce583a`, merged via `8e690e5`)
- `claude/phase-1-7-homepage-profile-gap` (merged via `8500af3`)
- `claude/phase-1-7-path-b` (merged via `4cdaa36`)
- `claude/festive-pare-f27273` (frozen at `d3e1881`)

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
- Don't touch OpenTable provider / worker / task UI (this round; codex 修中)
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite
- Every new task starts from latest `origin/master`
- **No Phase 2 vertical implementation** (codex's directive 2026-05-03)
- **No new features**; doc/copy polish only until Phase 0 + 1 closed
- **Don't modify** `R003_LIVE_SMOKE_RUNBOOK.md` execution commands or
  `PHASE_STATUS.md` Phase 0A/0B definitions (codex's directive
  2026-05-03 post-`88e7ecd`)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs except runbook execution commands and Phase 0A/0B definitions
- `.coordination/HUDDLE.md` (shared write; both agents touch)
- `STRATEGIC_LEDGER.md` (shared write, append-only)
- All `__tests__/` for the above

---

> **📍 Strategic decisions** previously listed here have moved to
> `STRATEGIC_LEDGER.md` (single root-level file, append-only, never
> trimmed). When you spot a new strategic lock, write it there directly,
> not here.
