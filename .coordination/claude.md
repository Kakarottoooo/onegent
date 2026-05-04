# Claude — coordination state

> **Branch**: `claude/resy-observability-suite` (worktree `festive-pare-f27273`)
> **Last updated**: 2026-05-04 04:55 UTC
> **Last commit**: this commit (Resy observability suite — schema-aligned probe dashboard + cross-dashboard rail + debug-artifacts polish)
> **Forked from**: `origin/codex/openai-chat-model-env @ 024dd05` (NOT master) — codex's probe runner is the source of truth this branch consumes.
>
> Codex reads this at session start. I write to it before each push.
> See `CLAUDE.md` § "协作协议" for the protocol contract.
> Codex's parallel file lives at `origin/codex/openai-chat-model-env:.coordination/codex.md`.

## 🟢 Currently doing

**Resy observability suite** — fuller no-token tooling around codex's
probe runner (`scripts/probe-resy-availability.ts`, shipped in `024dd05`).
This branch ships UI / docs / tests aligned to the **actual codex probe
JSON schema** (the prior `claude/dev-resy-probe-dashboard` branch had
invented types like `live_ok / live_no_slots_correct / skip` that didn't
match codex's runner output `use_for_live_fill_test / no_matching_slot /
blocked_or_unknown`).

This commit (UI/docs/tests only — strictly no provider/runtime/worker/runner):

1. ✅ **Rewrote `lib/benchmark/resy-probe-report.ts`** to mirror codex's
   actual `ProbeReport` / `CaseProbeResult` / `SlotCandidate` shape
   verbatim. Verified against a real run JSON (`npm run probe:resy --
   --case R-030` against Charlie Bird → 12 matching slots). Added pure
   helpers: `parseResyProbeUrl()` (extracts date/seats/time/slug from
   probe URL), `countByRecommendation()`, `buildNextLiveCommand()`,
   `isExactVenueMatch()`, `explainRecommendation()`. All pure, no fs.

2. ✅ **Rewrote `/dev/resy-probe-runs/page.tsx`** with:
   - Recommended-case card (with copy-paste live command + matching-slot
     count + window) — shows "no live-OK case" warning state when nothing
     qualifies
   - Summary strip (Live OK / No matching slot / Blocked + total)
   - Per-case table with new columns: target date/time/covers · slots
     total/match · venue match status (exact / mismatch / api error) ·
     verdict · "Detail →" button per row
   - **NEW: per-case detail drawer** — slide-out panel showing why the
     case is/isn't safe for live, matching-slots table, all-slots
     fallback table, blocker/no-availability signals, copy-paste live
     command for THAT specific case (with safety hint when not
     `use_for_live_fill_test`), full probe URL, body snippet
   - Sidebar list with newest-first, per-run pill counts, recommended
     caseId callout
   - Empty state mentions both single-case and full-suite probe commands

3. ✅ **`/dev/benchmark-runs` ArtifactRail extension**: added a
   `<CrossDashboardRail>` below the existing artifact rows. Per-case
   cross-pointers to:
   - `/dev/resy-probe-runs` (with extra hint when outcome is
     `no_availability_correct` — "rerun this case live ONLY after probe
     says use_for_live_fill_test")
   - `/dev/debug-artifacts` (with provider-aware text using inferred
     provider from caseId prefix R-/OT-/B-/E-/H-)
   - `/tasks/<taskId>` when present
   Provider inference is purely from caseId prefix; no fields read from
   anything codex owns.

4. ✅ **`/dev/debug-artifacts` polish**:
   - Header now lists related dashboards inline (probe-runs +
     benchmark-runs)
   - Per-provider "↟ Latest run" shortcut button in sidebar (clicks the
     newest run for that provider)
   - Empty state now mentions probe-first protocol explicitly with a
     link to `/dev/resy-probe-runs` so the user understands why they
     should probe before live spend.

5. ✅ **`/dev` landing index**: refreshed Phase 0 routes block to
   include `/dev/resy-probe-runs`, `/dev/benchmark-runs` (with
   ArtifactRail mention), and `/dev/debug-artifacts` — three-dashboard
   observability tri-fecta now discoverable from the landing page with
   accurate use-case copy.

6. ✅ **Tests**: `lib/__tests__/resy-probe-report.test.ts` rewritten to
   use real codex schema fixtures (Charlie Bird live-OK case + Buvette
   no-match case + captcha blocked case). 22 vitest cases:
   parseResyProbeUrl (3) · countByRecommendation (2) ·
   buildNextLiveCommand (1) · isExactVenueMatch (3) ·
   explainRecommendation (3) · loadResyProbeRun (6) ·
   listResyProbeRunSummaries (4). All passing alongside the existing 15
   debug-artifacts tests (37/37 total in the two files).

7. ✅ **Protocol doc** (`RESY_AVAILABILITY_PROBE_PROTOCOL.md`):
   - Aligned glossary to codex's actual field names
     (`recommendation: use_for_live_fill_test | no_matching_slot |
     blocked_or_unknown` — not the invented `live_ok / live_no_slots /
     skip`)
   - Added "How to choose the next Resy live case" 6-step section
   - Documented the `--browser`, `--visible`, `--screenshot`,
     `--limit`, `--case` flags codex's runner accepts
   - Updated step 1 to use `npm run probe:resy` (the npm script codex
     added in `024dd05`)

8. ✅ **Phase status update** (`PHASE_STATUS.md` Phase 0A 未完成 block
   only — definitions strictly untouched per existing hold rule):
   - Recorded the 2026-05-04 retry outcome (`no_availability_correct`,
     not fill failure)
   - Phase 0B door language updated to require ≥1 case at
     `use_for_live_fill_test` + live ready_for_confirmation OR
     safe_handoff w/ F-PROVIDER-OTP per § 7.5

9. ✅ **R003 runbook Step 0 preamble**: updated label values from
   invented `live_ok` to actual `use_for_live_fill_test`, mentioned
   detail drawer flow + R-030 finding (12 matching slots) without
   touching execution commands.

**Review points for codex** (please check before merge):

- **Schema mirror**: `lib/benchmark/resy-probe-report.ts` types are
  copied from your `scripts/probe-resy-availability.ts` `ProbeReport` /
  `CaseProbeResult` / `SlotCandidate` types. If you change any field
  name or add a field, the dashboard breaks silently (TS will catch
  most). Suggested: ping me on the same commit as a runner schema
  change so I update the mirror in lockstep.
- **Provider inference**: `inferProviderFromCaseId()` in
  `app/dev/benchmark-runs/page.tsx` matches caseId prefix `R-`/`OT-`/
  `B-`/`E-`/`H-`. If your fixture naming differs from this convention
  for hotels/flights/activities later, tell me which prefixes to use.
- **Cross-dashboard hint when outcome is `no_availability_correct`**:
  the `<CrossDashboardRail>` for Resy cases currently surfaces "rerun
  this case live ONLY after probe says use_for_live_fill_test for the
  same caseId + date/time". If you'd rather not nudge the user toward
  rerunning at all (e.g. you want them to update the fixture instead),
  one-line edit.
- **Probe API gate**: reused `ENABLE_DEV_BENCHMARK_API=1` env var so
  prod flip flips both /api/dev/benchmark-runs/* and
  /api/dev/resy-probe-runs/* and /api/dev/debug-artifacts/* together.
  If you want a separate `ENABLE_DEV_PROBE_API` knob, say so.

**Strictly NOT touched** (per task scope):
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/execution-v2/**`
- `lib/core/**`
- `scripts/run-phase0-resy-benchmark.ts`
- `scripts/probe-resy-availability.ts` (codex source-of-truth — Track A)
- `lib/benchmark/phase0-report.ts` (codex source-of-truth — Track A)
- `benchmark/restaurant-resy-phase0.json` (codex domain)
- `PHASE_STATUS.md` Phase 0A/0B definitions (only updated 未完成 status block)
- `R003_LIVE_SMOKE_RUNBOOK.md` execution commands (only updated Step 0 preamble)
- OpenTable provider code (founder directive 2026-05-03: 不动)

## 📩 Acks for codex's recent pushes

### `024dd05 feat(resy): add no-token availability probe` ✅ CONSUMED THIS COMMIT

Codex shipped `scripts/probe-resy-availability.ts` (559 LOC) hitting
`POST /3/venuesearch/search` with exact venue-slug matching, plus the
`probe:resy` npm script. Probe schema this branch consumes verbatim:

- Top-level `ProbeReport`: `runId / createdAt / suitePath / visible /
  results[] / recommendedCase? / recommendedCases[]`
- Per-case `CaseProbeResult`: `caseId / restaurantName / url /
  targetTime / targetMinutes / allowedWindowMinutes / probeSource /
  apiStatus? / apiVenueName? / apiVenueSlug? / apiError? / pageUrl /
  title / slots[] / matchingSlots[] / noAvailabilitySignals[] /
  blockerSignals[] / bodySnippet / screenshotPath? / recommendation`
- `recommendation` enum: `use_for_live_fill_test | no_matching_slot |
  blocked_or_unknown`
- Per-slot `SlotCandidate`: `text / minutes / diffMinutes / dateIso? /
  href? / tagName? / source: api|dom / token? / venueSlug? / venueName?`

Verified by running `npm run probe:resy -- --case R-030` and parsing
the output through `loadResyProbeRun`. Schema fits.

### `1b7938e [coord] report R-003 availability classification` ✅ CONSUMED
### `ff84707 fix(resy): classify R-003 availability-slot failure` ✅ CONSUMED EARLIER

R-003 #3 retry (`phase0-resy-2026-05-04T01-03-14-028Z.json`) outcome
`no_availability_correct` (Q11(a)) — codex hardened
`NO_AVAILABILITY_PATTERN` and canonicalized R-003's `resySlug` to
`buvette-nyc`. PHASE_STATUS reflects this.

### `149193b / 1ef97fb fix(resy): add phone verify strategy ladder` ✅ CONSUMED EARLIER
### `fdf0021 / 915833d fix(opentable): reject unverified phone-gate typing` ✅ CONSUMED EARLIER
### `88e7ecd fix(docs): align R-003 runbook with current runner` ✅ CONSUMED EARLIER

## 🔴 Open BUG reports for codex

(none)

## 🤝 Open questions / status

### For this branch (`claude/resy-observability-suite`)

- **Schema lockstep**: if codex adds fields to the probe report (e.g.
  per-case `meta.fixtureRowVersion`, per-slot `priceCents`,
  per-run `runnerVersion`), tell me and I mirror in same commit.
- **Cross-dashboard pointer wording**: I default-nudge "rerun only
  after probe says use_for_live_fill_test" for `no_availability_correct`
  outcomes. Push back if you want different copy.

## ⏳ Blocking on codex

| Blocker | Status |
|---|---|
| Review + merge `claude/coord-huddle-protocol` (HUDDLE protocol) | ⏳ pending (older PR) |
| Review + merge `claude/opentable-email-preference` | ⏳ pending (older PR) |
| Review + merge `claude/dev-resy-probe-dashboard` | **Now superseded by THIS branch — recommend closing the old one + merging this instead.** |
| Review + merge `claude/dev-debug-artifacts-viewer` | **Now superseded by THIS branch — files re-included + improved.** |
| Review + merge **this branch** (`claude/resy-observability-suite`) | ⏳ pending |
| R-030 live retry decision (probe says use_for_live_fill_test, 12 matching slots) | Pending founder go/no-go on token spend |
| Warm session PoC | Blocked until R-030 outcome (if `F-PROVIDER-OTP` → 启动) |

**Resolved this round** ✓
- Probe runner schema landed (codex `024dd05`) → mirror lib + dashboard updated to match

## 📦 Recently shipped (Track B)

| Commit | Subject | Notes for codex |
|---|---|---|
| `this commit` | `feat(dev): Resy observability suite — probe schema-aligned dashboard + ArtifactRail cross-links + debug-artifacts polish` | UI/docs/tests only. tsc clean. 37/37 tests passing. Verified against real probe JSON for R-030 (Charlie Bird, 12 matching slots). |
| (prior unmerged) `87511c0` | `claude/dev-resy-probe-dashboard` | **Supersede with this branch.** Old branch had invented schema (`live_ok` etc.) that didn't match your actual runner. This branch fixes that. |
| (prior unmerged) `b64c3ba` | `claude/dev-debug-artifacts-viewer` | Files preserved on this branch + improved (latest-run shortcut, cross-links, empty-state copy). Can close the old branch. |
| `998aaea` | `claude/opentable-email-preference` | Doc-block + SMS guard + 2 policy tests. Independent of this branch. |
| `1d8ca6a` | `claude/coord-huddle-protocol` | HUDDLE protocol + STRATEGIC_LEDGER. Independent of this branch. |

Archival branches (no further commits):
- `claude/dev-resy-probe-dashboard` (frozen at `87511c0`; **superseded** — use this branch instead)
- `claude/dev-debug-artifacts-viewer` (frozen at `b64c3ba`; **superseded** — files merged into this branch)
- `claude/founder-e2e-polish` (frozen at `adf3d77`, merged via `3043a29`)
- `claude/phase-status-docs` (frozen at `3e37175`, superseded by `88e7ecd`; per codex directive do NOT merge)
- `claude/phase-1-e2e-smoke` (frozen at `4f213ac`, merged via `f9dd0ba`)
- `claude/phase-1-7-path-b-hardening` (frozen at `acec60c`, cherry-picked as `f423b56`)
- `claude/post-merge-doc-fixes` (frozen at `dce583a`, merged via `8e690e5`)

## 🚧 Hold rules I'm respecting

- Never merge to master directly
- Don't touch:
  - `lib/booking-autopilot/`, `lib/core/execution/`, `lib/execution-v2/`,
    `worker/src/**`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
    `scripts/probe-resy-availability.ts`,
    `app/api/booking-jobs/[id]/start/route.ts`,
    `benchmark/PHASE0_REPORT_CONTRACT.md`, `benchmark/fixtures/`,
    `lib/benchmark/phase0-report.ts`, `benchmark/restaurant-resy-phase0.json`
- Don't run `npm run dev` or worker (would interfere with codex E2E)
- Don't run live OpenAI calls (probe-only allowed: `npm run probe:resy`)
- Don't run 25-case suite / Computer Use / real booking submit
- Every new task starts from latest branch (here: codex/openai-chat-model-env
  per task brief; otherwise origin/master)
- **Don't modify** `R003_LIVE_SMOKE_RUNBOOK.md` execution commands or
  `PHASE_STATUS.md` Phase 0A/0B definitions — only the 未完成 status block
- **No new features**; observability + docs + tests until Phase 0A/B closed
- **No Phase 2 vertical implementation** (codex's directive 2026-05-03)
- **Don't touch OpenTable provider code** (founder directive 2026-05-03 —
  viewer/dashboard read-only is OK)

## 🗂 Track B file ownership

- `components/profile-gap/**`, `components/benchmark/**`, `components/task-timeline/**`, `components/dr-timeline/**`
- `app/dev/**`, `app/tasks/[taskId]/**`, `app/tasks/page.tsx`, `app/page.tsx` chat sections
- `lib/agent/nlu-v2/**`, `lib/ui-copy/**`, `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`
- `lib/benchmark/resy-probe-report.ts` (Track B mirror of codex runner schema)
- `lib/debug-artifacts.ts` (Track B viewer loader)
- `app/api/dev/resy-probe-runs/**`, `app/api/dev/debug-artifacts/**` (Track B)
- `scripts/smoke-phase1.mjs` (Track B test/smoke domain)
- All Phase 1 / strategy `.md` docs except runbook execution commands and Phase 0A/0B definitions
- `RESY_AVAILABILITY_PROBE_PROTOCOL.md` (Track B; codex consults but doesn't author)
- All `__tests__/` for the above

## 📍 Strategic decisions locked

> Long-term memory layer; codex consults before non-current-phase work.

**Team / role allocation:**
- 2026-05-03 Role allocation: codex 30-40% / Claude 60-70% with hold rules · doc: `CLAUDE.md` § 协作协议
- 2026-05-03 Time-prediction protocol: every task starts with "预计最快 X 分钟" + use `date` for actual measurement · chat decision
- 2026-05-03 Branch hygiene: every new task cuts a fresh branch from latest `origin/master` (or codex working branch when consuming codex's in-flight work — like this branch off `024dd05`) · `origin/master:.coordination/codex.md`
- 2026-05-03 **Claude paused on new features** until Phase 0 + Phase 1 closed; observability + docs polish only · `origin/master:.coordination/codex.md` 2026-05-03
- 2026-05-03 **R-003 runbook commands + Phase 0A/0B definitions are codex domain**; Claude must not modify (post `88e7ecd`)

**Phase 0 / engineering doctrine:**
- 2026-05-02 Computer Use as default executor · `EXECUTOR_V2_PIVOT.md`
- 2026-05-03 Phase 0 OTP transitional rule § 7.5 · `BENCHMARK_RESTAURANT_100.md`
- 2026-05-03 Q11 R-003 expectedOutcomes: option (a) explicit spec broadening · `BENCHMARK_RESTAURANT_100.md` § 4
- 2026-05-03 Coordination protocol via `.coordination/{codex,claude}.md` · `CLAUDE.md` § 协作协议
- 2026-05-03 Don't introduce 3rd-party browser-agent tools · chat decision
- **2026-05-04 Probe-first protocol** (mandatory before next live R-* retry): no token spent unless `/dev/resy-probe-runs` shows `use_for_live_fill_test` for the target case · `RESY_AVAILABILITY_PROBE_PROTOCOL.md`
- **2026-05-04 R-003 retry outcome = `no_availability_correct`** (NOT fill failure) · `phase0-resy-2026-05-04T01-03-14-028Z.json`
- **2026-05-04 R-030 = next recommended live case** (probe finding: 12 matching slots, exact venue match, party 2, 2026-05-08 20:00) · this branch's probe run

**Phase 0 OTP path:**
- 2026-05-03 OTP path D: warm session first; Gmail OTP resume fallback · `WARM_SESSION_STRATEGY.md`

**Phase 0B (codex domain definition):**
- 2026-05-03 Phase 0B = Restaurant v1: Resy observed fixture suite (currently 22 rows, target 25) + OpenTable Phase 0 coverage · `PHASE_STATUS.md` (codex `88e7ecd`)

**Phase 1 status:**
- 2026-05-03 **Phase 1 ~95% shipped** · `PHASE_1_PLAN.md`

**Phase 2 freeze:**
- 2026-05-03 Phase 2 vertical expansion FROZEN until Phase 0B + Phase 1 declared · `PHASE_STATUS.md`

**Phase 2-3 product positioning:**
- 2026-05-03 Hybrid positioning (NOT pure-infra, NOT pure-consumer) · `PROJECT_SUMMARY.md` cont. 2

**Phase 4 data flywheel:**
- 2026-05-03 Data flywheel: A (✅) + B (✅) + C (❌); trigger ≥ 100 real bookings

**Infra:**
- 2026-04-30 Browserbase Pro upgrade trigger: ≥ 500 paying users OR ≥ $1500/mo bill OR cofounder OR seed round · Phase 4

**UI migration:**
- 2026-05-03 No "原来的 UI" deletion at Phase 1 boundary; deprecation queue with explicit删除 conditions · `UI_MIGRATION_MAP.md`
