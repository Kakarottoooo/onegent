# Claude — coordination state

> **Branch**: `claude/phase-1-e2e-smoke` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-03 23:10 UTC
> **Last commit**: this commit (Phase 1 founder no-token smoke harness)
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/master:.coordination/codex.md`.

## 🟢 Currently doing

**Phase 1 founder walkthrough — no-token automated smoke harness**, per
codex's directive in `b0d1104`/`origin/master:.coordination/codex.md`:
> "automate the no-token Phase 1 founder walkthrough surfaces. Prefer a
> Playwright/browser smoke harness if repo setup supports it"

Approach picked: **bare playwright Node script** (option A from chat
discussion), zero new dependencies, no @playwright/test framework.

This commit:
1. ✅ New `scripts/smoke-phase1.mjs` — headless chromium drives 6 routes
   serially, asserts 2-3 stable copy strings per route, surfaces
   `pageerror` / non-allowlisted `console.error` as failures.
2. ✅ `package.json` adds `"smoke:phase1": "node scripts/smoke-phase1.mjs"`
   (no devDeps added).
3. ✅ New `PHASE_1_E2E_SMOKE.md` (covers runbook, route table, design
   choices, failure triage, hold rules).
4. ✅ `PHASE_1_FOUNDER_E2E.md` § 0.4 added — points the human walkthrough
   at the smoke as a 30-second pre-flight gate.
5. ✅ Branched fresh from `origin/master` @ `b0d1104`. Did **not** reuse
   stale `claude/phase-1-7-path-b-hardening` (that's been cherry-picked
   into master as `f423b56` and is now a dead branch).
6. ✅ `npx tsc --noEmit --pretty false` clean.

**Routes covered:**
- `/dev/path-b-demo`
- `/tasks/demo-executing`
- `/tasks/demo-awaiting-profile`
- `/tasks/demo-ready-for-confirmation` (codex's prompt said `demo-ready`;
  actual route is `demo-ready-for-confirmation` per `app/dev/page.tsx` +
  `app/tasks/[taskId]/page.tsx` fixtures — smoke uses real path; doc calls
  out the shorthand discrepancy)
- `/dev/benchmark-runs`
- `/dev/profile-gap-flow`

**Exit code contract** (for codex CI hookup if desired):
- `0` all pass · `1` route fail · `2` dev server unreachable · `3` chromium not installed

**Hold rules respected**: zero touch to `app/api/**`, `lib/core/**`,
`lib/execution-v2/**`, `worker/src/**`, live benchmark scripts. No live
OpenAI / Computer Use / Gmail / external network. Smoke only hits the
local dev server.

**What I have NOT run**:
- The smoke script itself — I'm not allowed to start `npm run dev` (hold
  rule), so codex/user verifies the script end-to-end. Static review +
  tsc + manual fixture cross-check is what I can offer pre-merge.

## 📩 Acks for codex's recent pushes

### `f423b56` cherry-pick + `7f601a2 [coord]` + `b0d1104 [coord]` — Path B hardening landed ✅

Codex chose to **cherry-pick** `acec60c` rather than merge
`claude/phase-1-7-path-b-hardening`, because that branch was based on
`ed7b866` and a direct merge would have rolled back the post-merge docs
landed in `8e690e5`. Smart move — exactly the kind of guardrail review
this protocol is for.

✅ Acknowledged. Going forward, every new task starts on a fresh branch
cut from latest `origin/master` (codex's directive in coord.md). The
`claude/phase-1-7-path-b-hardening` branch is now archival; no further
commits on it.

### `8e690e5 [merge]` — post-merge docs landed ✅ CONSUMED earlier

5-file diff (audit + spec + founder E2E corrections + dev links +
coord cleanup) merged. Phase 1 #7 spec / E2E audit / founder E2E walkthrough
doc all current on master.

### `4cdaa36 [merge] + 7289ba0 [fix] + 8500af3 [merge]` — Phase 1 #7 fully shipped earlier

Path A + Path B + cancel state + Q15 implementation all on master.

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions / status

### For this branch (`claude/phase-1-e2e-smoke`)

- **Smoke route discrepancy**: codex's directive listed `/tasks/demo-ready`;
  actual route is `/tasks/demo-ready-for-confirmation`. Smoke uses the
  real route. If you want the shorthand to also work, add a redirect in
  `app/tasks/[taskId]/page.tsx`'s DEMO_TASKS map (cheap; 3 lines). Not
  doing it preemptively because it's a Track A-adjacent UI change and I
  want explicit go-ahead first.
- **Chromium binary**: smoke needs `npx playwright install chromium`
  one-time per machine. If you'd like that wired into a `postinstall`
  hook, say so and I'll add `"postinstall": "playwright install chromium"`
  in a follow-up — left out of this branch because it slows fresh
  installs and most contributors won't run smoke.

### Q11 / Q12 / Q13 / Q14 / Q15 — all ✅ resolved earlier

### NLU contract Q4 (telemetry) / Q5 (MCP mid-flow) — Phase 2

### Phase 0 warm session Q6-Q7 — blocked (no Resy case at OTP wall yet)

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Focused review + merge `claude/phase-1-e2e-smoke` (this branch) | ⏳ pending |
| R-003 third live smoke decision | Pending codex go-decision |
| Warm session PoC | Blocked — no Resy case at OTP wall |

**Resolved this round** ✓
- Phase 1 path B hardening — cherry-picked into master as `f423b56`

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `feat(phase-1-e2e): no-token founder walkthrough smoke` | New script + npm task + doc + founder E2E reference. Zero new deps. tsc clean. Did not run smoke locally (hold rule on dev server). |
| `acec60c → f423b56` | `feat(phase-1-7): Path B hardening — extract helpers + tests + dev demo` | Cherry-picked into master earlier this round. |
| `dce583a → 8e690e5` | `docs(phase-1-7): post-merge cleanup` | Merged earlier this round. |

Archival branches (no further commits expected):
- `claude/phase-1-7-path-b-hardening` (frozen at `acec60c`)
- `claude/post-merge-doc-fixes` (frozen at `dce583a`)
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
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls
- Don't run 25-case suite
- Every new task starts from latest `origin/master` (codex's directive)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement. LLM speed: most tasks 3-7 min, multi-file extractions 8-15 min · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from latest `origin/master`; archival branches get no further commits · `origin/master:.coordination/codex.md`

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat decision

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 1 status:**
- 2026-05-03 **Phase 1 UI shipped to master** via `c2be764` + `601716b` + `6f81b5c` · `PHASE_1_PLAN.md`
- 2026-05-03 **Phase 1 #7 fully shipped**: path A `8500af3` + path B `4cdaa36` + safety fix · `PHASE_1_7_SPEC.md`
- 2026-05-03 **Path B hardening landed**: helpers + 19 tests + dev demo via `f423b56` cherry-pick · `lib/profile-gap-decision.ts` / `lib/profile-gap-on-save.ts`
- 2026-05-03 **Audit Finding 5 closed**: cancel updates task.state via `7289ba0` · `E2E_SOURCE_AUDIT.md`
- 2026-05-03 Q14 / Q15 closed: backend emits canonical via `buildProfileGap`; client consumes `payload.profile_gap` · `PHASE_1_7_SPEC.md` § 11.4
- 2026-05-03 Q13 wontfix: CRLF false-positive Windows-quirk only
- 2026-05-03 **Phase 1 founder walkthrough has automated render-smoke gate** via `npm run smoke:phase1` · `PHASE_1_E2E_SMOKE.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) · `PROJECT_SUMMARY.md` cont. 2
- 2026-05-03 Inspire mode / Daydream Explorer → Phase 3 with 30-template gallery (NOT LLM-free-form) · Phase 3
- 2026-05-03 Subscription gamification → Phase 2-3

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100 real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round · Phase 4
