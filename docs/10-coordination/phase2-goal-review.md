# Phase 2 Goal Branch Review

Last updated: 2026-05-04

Review branch: `codex/phase2-goal-review-pack`

Base reviewed: `origin/codex/integrated-preview-20260504 @ a704e6f`

Goal branch reviewed:
`codex/goal-phase2-no-live-revival @ 0214f0a23963cffa4a9c6a8d36696a8bbb4d8236`

Scope: no-live static review only. This review did not merge the goal branch,
did not run providers, and did not edit provider/runtime/core/worker/db/live
paths.

## Executive Verdict

Do not merge `codex/goal-phase2-no-live-revival` as a whole branch.

The useful goal-branch work is the hotel artifact analyzer pack and selected
docs. The branch is stale relative to latest integrated preview: its merge base
is `34cb1d1`, while latest integrated is `a704e6f`. Since then integrated added
the hotel artifact audit, Phase 1/Track C demo-freeze docs, and coordination
updates. A normal merge would produce conflicts in coordination and hotel
runbook files; a tree replacement or broad manual copy would regress already
integrated Phase 1/Track C and hotel audit work.

Recommended path: cherry-pick or manually port the hotel analyzer files as a
small no-live pack, then manually merge only the non-duplicative docs.

## Diff Basis

Goal-side three-dot diff from the current integrated base:

- 19 files changed.
- 1473 insertions, 6 deletions.
- True goal-side changes are limited to docs, runtime-forensics artifact
  analysis, fixtures, tests, and a pure local artifact script.

Current tree diff against latest integrated is larger:

- 34 files differ.
- 1437 insertions, 975 deletions.
- That larger tree diff includes stale-base effects from integrated commits
  that the goal branch does not contain. Do not use it as a cherry-pick list.

Merge simulation found real conflicts in:

- `docs/10-coordination/HUDDLE.md`
- `docs/10-coordination/phase2.md`
- `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`

## File-By-File Summary

| File | Goal change | Review |
|---|---|---|
| `docs/10-coordination/HUDDLE.md` | Adds a short no-live Phase 2 revival status note. | Manual merge only. Current integrated already has later Track C/sidecar huddle entries, so a direct cherry-pick conflicts. |
| `docs/10-coordination/goal.md` | Adds a goal handoff with changed files, validation, risks, and human approval points. | Safe doc candidate after updating base/commit claims to latest integrated and removing duplicate validation claims that belong to the old branch state. |
| `docs/10-coordination/phase2.md` | Changes current hotel posture and appends a no-live hotel analysis pack section. | Manual merge only. Preserve current integrated Expedia analyzer, artifact CLI, and hotel artifact audit sections, then append the hotel analyzer pack as a later section. |
| `docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md` | Adds optional usage for `scripts/analyze-phase2-artifact.ts flight`. | Safe only if the shared wrapper lands. Otherwise this duplicates the already-integrated Expedia-specific CLI. |
| `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` | Adds hotel artifact bundle shape, analyzer command, and hotel success/failure taxonomy. | Conflict with integrated hotel runbook. Preserve integrated exact prompt, preflight, SQL, grep patterns, screenshot paths, and hard stops. Port only analyzer usage and artifact-bundle details. |
| `docs/90-archive/phase2-product-areas/PHASE2_READINESS_MATRIX.md` | New no-live readiness table for Expedia flight, Booking.com, and Hotels.com. | Safe doc candidate, but update scope to latest integrated and cross-link the already-integrated hotel audit. |
| `docs/90-archive/phase2-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` | Adds readiness matrix pointer and notes hotel analyzer support. | Manual doc patch only. Preserve existing audit wording and avoid implying hotel is live-ready. |
| `docs/INDEX.md` | Adds `PHASE2_READINESS_MATRIX.md` to Phase 2 quick path and canonical files. | Safe if the readiness matrix lands. Otherwise skip. |
| `lib/__tests__/hotel-retry-analysis.test.ts` | Adds targeted tests for hotel artifact analyzer states and markdown helper output. | Safe cherry-pick with analyzer module and fixtures. |
| `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/*.json` | Adds seven synthetic no-live Booking.com/Hotels.com hotel artifact fixtures. | Safe cherry-pick with analyzer tests. Keep synthetic labels clear; do not treat as live evidence. |
| `lib/runtime-forensics/hotel-retry-analysis.ts` | Adds pure artifact analyzer for hotel bundles. | Best code cherry-pick candidate. It is no-live and does not read disk, network, provider, DB, or worker paths. Review the broad `payment not reached` -> `room_selection_drift` signal before relying on it for patch decisions. |
| `lib/runtime-forensics/index.ts` | Exports the hotel analyzer. | Safe with analyzer module. |
| `scripts/analyze-phase2-artifact.ts` | Adds a shared local JSON analyzer wrapper for flight and hotel. | Candidate with fixes. It is pure no-live, but lacks the robust missing-file, invalid-JSON, and empty-bundle handling already present in the integrated Expedia-specific CLI path. Port validation before replacing or promoting it. |

## Already-Integrated Duplicates

Integrated preview already contains the Expedia no-live analyzer pack:

- `lib/runtime-forensics/expedia-retry-analysis.ts`
- `lib/__tests__/expedia-retry-analysis.test.ts`
- `lib/runtime-forensics/__fixtures__/expedia-retry-analysis/*.json`

Integrated preview already contains the Expedia artifact CLI pack:

- `scripts/analyze-expedia-retry-artifact.ts`
- `lib/__tests__/analyze-expedia-retry-artifact-cli.test.ts`
- `docs/90-archive/phase2-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json`

Integrated preview already contains the hotel artifact audit pack:

- `docs/90-archive/phase2-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`
- `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- `lib/runtime-forensics/__fixtures__/booking-hotel-guest-form-incomplete.json`
- Fixture index/test updates for the synthetic Booking.com hotel
  `provider_form_incomplete` example.

Do not delete or overwrite the integrated hotel audit fixture when adding the
goal branch hotel analyzer fixtures. They serve different purposes: the
integrated fixture exercises the general runtime-forensics classifier, while
the goal fixtures exercise a separate post-retry hotel artifact analyzer.

## Safe Cherry-Pick Candidates

Cherry-pick as one coherent hotel analyzer pack:

- `lib/runtime-forensics/hotel-retry-analysis.ts`
- `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/*.json`
- `lib/__tests__/hotel-retry-analysis.test.ts`
- `lib/runtime-forensics/index.ts`

Manual docs candidates after the analyzer pack:

- `docs/90-archive/phase2-product-areas/PHASE2_READINESS_MATRIX.md`
- The analyzer usage and artifact-bundle sections from
  `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- The no-live hotel analysis pack section from `docs/10-coordination/phase2.md`
- `docs/10-coordination/goal.md`, after updating base and validation details.

Conditional candidate:

- `scripts/analyze-phase2-artifact.ts`

Only land the shared wrapper after adding the same validation behavior expected
from `scripts/analyze-expedia-retry-artifact.ts`: missing file, invalid JSON,
empty bundle, and unknown-but-valid bundle handling.

## Conflicts And Stale-Base Risks

The goal branch is behind latest integrated by these integrated-side commits:

- `0bdccf8 docs(phase2): add hotel artifact audit pack`
- `eb807f4 docs(demo): add freeze acceptance pack`
- `db0aef8 docs(phase1): cleanup after demo-freeze pass`
- `a704e6f docs(coord): record second sidecar integration`

Direct merge conflicts:

- `HUDDLE.md`: both sides append status. Keep integrated chronology and add a
  short final handoff only if needed.
- `phase2.md`: both sides append Phase 2 state. Keep integrated Expedia retry
  analysis, Expedia artifact CLI, and hotel audit sections; append the hotel
  analyzer pack after them.
- `HOTEL_CONTROLLED_RETRY_RUNBOOK.md`: both sides added the same path from
  different work. Keep integrated detailed Booking.com controlled retry
  runbook and manually add analyzer artifact-bundle usage.

Tree-diff stale-base warnings:

- Current integrated has Phase 1/Track C docs and dev readiness updates that
  are absent from the goal branch tree. Do not copy the goal branch tree over
  integrated.
- Current integrated has `HOTEL_VERTICAL_REVIVAL_AUDIT.md`; the goal branch
  does not. Do not delete it.
- Current integrated has docs-static guards and demo evidence updates after the
  goal branch base. Preserve them.

## Forbidden Path And Live-Action Risk

Goal-side three-dot diff does not touch these forbidden paths:

- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `app/api/booking-jobs/**`
- `app/api/v1/**`

No live provider code is introduced by the goal-side code diff:

- `lib/runtime-forensics/hotel-retry-analysis.ts` is a pure regexp/string
  classifier over supplied artifact bundles.
- `scripts/analyze-phase2-artifact.ts` reads one local JSON file and formats
  Markdown.
- No provider, browser, DB, worker, payment, OTP, CAPTCHA, login, or final
  confirmation action is started.

The only live-action risk is documentation/operator misuse: the runbooks
describe future controlled retries. Keep the hard stops and founder-approval
language when porting.

## Recommended Merge Order

1. Start a clean branch from latest
   `origin/codex/integrated-preview-20260504`.
2. Cherry-pick or manually port only the hotel analyzer pack:
   module, seven fixtures, targeted tests, and runtime-forensics export.
3. Run targeted hotel analyzer Vitest.
4. Add the readiness matrix only after the analyzer tests pass.
5. Manually merge hotel runbook analyzer usage into the current integrated
   `HOTEL_CONTROLLED_RETRY_RUNBOOK.md`; do not replace the current runbook.
6. If the shared wrapper is desired, port it with robust CLI validation from
   the Expedia-specific CLI.
7. Manually append the Phase 2 coordination/goal handoff text with current
   integrated commit hashes and verification results.
8. Run:
   - `npx vitest run lib/__tests__/hotel-retry-analysis.test.ts`
   - existing Expedia analyzer and CLI tests if the shared wrapper touches
     flight docs or script behavior
   - `npx tsc --noEmit --pretty false`
   - `npm run check-drift`
   - `git diff --check`

## Review Branch Verification

- `npx vitest run lib/__tests__/docs-static-guard.test.ts`: pass, 8/8.
- `npm run build:mcp`: pass; needed in this clean worktree before the
  requested TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this review. No payment, CVV, OTP/CAPTCHA/login
bypass, or final confirmation path was exercised.
