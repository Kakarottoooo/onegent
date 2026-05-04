# Founder E2E bug triage playbook

> **For**: founder + Claude + codex.
> **Author**: Claude (Track B).
> **Last updated**: 2026-05-04.

This doc explains how a Founder QA Suite run flows from "I clicked
Fail" → "codex / Claude have a clean issue to fix". The mechanism is
intentionally low-tech: every export is plain markdown / JSON, every
artifact lives in the repo, every triage decision is auditable.

The Founder QA Suite lives at:

- Page: `/dev/founder-e2e`
- API: `/api/dev/founder-e2e-runs` (GET list / GET ?file= / GET ?template= / POST)
- Pure logic: `lib/founder-e2e/`
- Preflight: `npm run preflight:founder-e2e`
- Saved runs: `benchmark/runs/founder-e2e-<path>-<slug>.json` (gitignored
  by the existing `benchmark/runs/*.json` rule)

## Severity ladder (mirrors PHASE_1_FOUNDER_E2E.md § 🛑)

| Severity | Emoji | Default mapping in checklist | Triage SLA |
|---|---|---|---|
| **P0** | 🔴 | All Quick path steps; ownership boundary; payment guard; demo states 2.2 + 2.4; real flow | Stop the walkthrough. Ping the relevant agent in the same message that exports the bug report. |
| **P1** | 🟠 | Demo states 2.1, 2.3; real-flow polish; benchmark dashboard; profile-gap-flow; DR | Phase 1.5 polish queue. Continue the walkthrough; batch fix-up. |
| **P2** | 🟡 | UI polish (color, alignment, copy); validator paste edge cases | Defer; group with other P2s when convenient. |
| **P3** | 🟢 | Optional verification (cookie capture, DevTools posture) | Nice-to-have; only fix if everything else is clean. |

The default severity per step is encoded in
`lib/founder-e2e/fixtures.ts`. The founder can override on a per-row
basis via the `Severity override` selector in the StepEditor.

## What an export contains

When the founder clicks **Export Markdown**, the file is laid out as:

```
# Founder QA report — <path label>

- Run id: founder-e2e-<...>
- Started: <iso>
- Updated: <iso>
- Branch SHA: <short-sha>      (if captured)

## Summary
- Pass / Fail / Blocker / Skipped / Pending counts
- P0..P3 counts
- Exit bar verdict + outstanding gaps (if any)

## Failing steps
### [BUG] <step title> (<section>)
**Severity**: <emoji> <label>
**Surface**: <urls/commands>
**Section**: <id> — <title>
**Steps to reproduce**: > <step.whatToDo>
**Expected**: > <step.expected>
**Warning signals from runbook**: > <step.warn>
**Actual**: > <founder typed>
**Notes**: > <founder typed>
**Artifacts**:
- taskId, url, screenshot path
- console error, network log, server log
- account, browser, reproducibility
**References**: <doc § section>
```

The JSON export is the same data, machine-readable, persisted to
`benchmark/runs/founder-e2e-<path>-<slug>.json` when the founder hits
**Save run**.

## Routing failures to the right agent

| Surface area | Owner |
|---|---|
| `app/`, `components/`, `lib/agent/nlu-v2/`, `lib/profile-gap-*` | Claude (Track B) |
| `app/api/v1/`, `lib/booking-jobs/`, `app/api/booking-jobs/` | codex (Track A) |
| `lib/booking-autopilot/`, `worker/src/`, `lib/core/`, `lib/execution-v2/` | codex (Track A) |
| Auth / Clerk wiring | codex (Track A) |
| Benchmark dashboard rendering | Claude (Track B) |
| Benchmark report contract / runner | codex (Track A) |
| Documentation + /dev observability surfaces | Claude (Track B) |
| `/dev/founder-e2e` itself | Claude (Track B) |

If unsure: paste the markdown export into the chat without picking. The
agent that responds will route it.

## Submission flow

1. Founder runs `/dev/founder-e2e` Quick path.
2. Marks each step pass/fail/blocker/skipped.
3. For every fail/blocker row, fills in:
   - `Actual` (1-line observation)
   - Optional artifacts (taskId, url, screenshot, account, browser)
   - Severity override if the default underestimates impact.
4. Hits **Save run** (persists JSON locally) **AND** **Export Markdown** (or
   **Copy MD**).
5. Pastes the markdown into the chat with the relevant agent.

For Full-path runs, repeat for each fail/blocker row. The aggregated
markdown export contains every failing row + the summary header.

## Stop conditions (don't keep walking)

- 🔴 Any P0 outstanding → STOP. Fix and rerun.
- ≥ 4 P1 rows → STOP. Phase 1.5 polish budget exceeded; triage before
  declaring.
- Smoke (`npm run smoke:phase1`) fails → STOP. Walk doesn't help.
- Auth (cookie 401 / Clerk loop) → STOP. Phase 1 unshippable.

The page surfaces these in the Verdict card; reasons appear in
`exit.reasonShortBy`.

## What this dashboard does NOT do

- Does not run live OpenAI / Computer Use / real bookings.
- Does not start dev server / worker.
- Does not retry failed steps automatically.
- Does not auto-classify severity (founder confirms or overrides).
- Does not sync to GitHub Issues (paste exported markdown to open one).
- Does not modify provider / runtime / runner code.

## Related dashboards

- `/dev/founder-e2e` — this dashboard.
- `/dev/benchmark-runs` — Phase 0 benchmark report viewer.
- `/dev` — landing index.

## Related docs

- `PHASE_1_FOUNDER_E2E.md` — runbook the suite encodes.
- `PHASE_1_E2E_SMOKE.md` — `npm run smoke:phase1` runbook.
- `PHASE_1_PLAN.md` — Phase 1 ship deliverables.
- `PHASE_STATUS.md` — Phase 0 / 1 status overview.
- `R003_LIVE_SMOKE_RUNBOOK.md` — Phase 0A live smoke (codex's domain).
- `CLAUDE.md` § 协作协议 — Track A / Track B file ownership.
