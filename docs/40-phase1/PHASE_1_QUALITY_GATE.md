# Phase 1 Quality Gate

> **For**: founder + Claude + codex
> **Author**: Claude (Track B)
> **Last updated**: 2026-05-04
> **Branch**: `claude/phase-1-5-quality-gate-orchestrator`

This is the one-command verdict on whether today's build keeps Phase 1
shippable. No tokens. No live providers. No payment, OTP, CAPTCHA, or
final-confirm interaction. Run it before you push, before you cut a
release tag, before you hand off a branch to codex for review.

---

## TL;DR

```bash
npm run gate:phase1                          # required-only gate (~1-2 min)
npm run gate:phase1 -- --include-smoke       # adds smoke:phase1 (needs dev server)
npm run gate:phase1 -- --include-e2e         # adds preflight + autonomous founder e2e
npm run gate:phase1 -- --json                # JSON to stdout in addition to file
npm run gate:phase1 -- --label=ci-pr-42      # tag this run
npm run gate:phase1 -- --allow-known-drift   # downgrade drift fail to known_existing_failure
```

The runner writes:

- `benchmark/runs/phase1-quality-gate-<runId>.json` — machine-readable.
- `benchmark/runs/phase1-quality-gate-<runId>.md` — paste-ready report.
- Both are gitignored under `benchmark/runs/*.json` (per repo policy);
  the runner doesn't try to commit them.

The dashboard at `/dev/phase1-quality-gates` (dev-gated) lists every run
and surfaces verdict + per-check stdout/stderr tail + paste-ready
markdown.

---

## What the gate runs

### Required (verdict-blocking)

| id | Command | Severity if fail |
|---|---|---|
| `tsc` | `npx tsc --noEmit --pretty false` | **P0** |
| `vitest:flight-time-filter` | `npx vitest run lib/__tests__/flight-time-filter.test.ts` | **P0** |
| `vitest:profile-gap-decision` | `npx vitest run lib/__tests__/profile-gap-decision.test.ts` | **P0** |
| `vitest:profile-gap-on-save` | `npx vitest run lib/__tests__/profile-gap-on-save.test.ts` | **P0** |
| `vitest:chat-plan-query` | `npx vitest run lib/__tests__/chat-plan-query.test.ts` | **P0** |
| `vitest:founder-e2e` | `npx vitest run lib/__tests__/founder-e2e.test.ts` | **P0** |
| `vitest:founder-e2e-runner` | `npx vitest run lib/__tests__/founder-e2e-runner.test.ts` | **P0** |
| `vitest:quality-gate` | `npx vitest run lib/__tests__/quality-gate-*.test.ts` | **P0** |
| `check-drift` | `npm run check-drift` (lib ↔ worker) | **P1** (P2 with `--allow-known-drift`) |

If a vitest target file isn't present on the current branch, the check
is skipped with severity `skipped` and the verdict drops to
**`needs_polish`** (not `fail` — the gate notices but doesn't block).

### Optional (added with `--include-*`)

| id | Command | When triggered |
|---|---|---|
| `preflight:founder-e2e` | `npm run preflight:founder-e2e` | `--include-e2e` |
| `e2e:founder` | `npm run e2e:founder` | `--include-e2e` |
| `smoke:phase1` | `npm run smoke:phase1` | `--include-smoke` |

These need a dev server at `http://localhost:3000` (or whatever
`--base-url` points at). If the server is down when an `--include-*`
flag was passed, the check is skipped with severity `env`. That
**triggers `env_blocked` (exit 2)** — the operator asked for it but the
environment couldn't deliver.

If the server is down and the `--include-*` flag was NOT passed, the
optional checks aren't attempted at all and the verdict isn't affected.

---

## Verdict ladder

| Verdict | Exit | Meaning |
|---|---|---|
| `pass` | 0 | Every check passed. Build is shippable on these axes. |
| `needs_polish` | 0 | Required checks pass; at least one optional fail/skip OR a known_existing_failure OR a non-env required skip. CI is green; founder/codex should still glance at the report. |
| `fail` | 1 | At least one required check failed. Stop the line. |
| `env_blocked` | 2 | A required check needed an env we don't have (`--include-*` flag w/ dev server down). Restart dev server and retry. |
| `(internal error)` | 3 | Orchestrator itself blew up. Open `dev.log` + the markdown report. |

Exit codes 0 and 0 are deliberate for `pass` and `needs_polish` — you
want CI to stay green when the gate produced a usable verdict but found
non-blocking polish items. The verdict label tells you what category
you're in; the exit code is the CI gate.

---

## Severity ladder (for the markdown report)

- **P0** — shipping-critical fail. tsc, founder-e2e suites, flight-time-filter,
  profile-gap suites, chat-plan-query, quality-gate self-test. If any
  of these is red, do not push.
- **P1** — required check failed but not in the shipping-critical set.
  Currently only `check-drift`. (Drift between `lib/booking-autopilot/`
  and `worker/src/booking-autopilot/` exists today — it's a pre-existing
  codex-domain item.)
- **P2** — optional check failed, OR a `known_existing_failure` we
  intentionally tolerated. Polish item; not a ship-blocker.
- **ENV** — `--include-*` flag asked for it but env can't deliver.
- **—** (skipped) — not a fail; logged for transparency.

---

## When to run it

| Trigger | Recommended invocation |
|---|---|
| Before `git push` on a Track B branch | `npm run gate:phase1` |
| Before asking codex to review a PR | `npm run gate:phase1 -- --label=pr-<n>` |
| After cherry-picking codex's master tip | `npm run gate:phase1 -- --allow-known-drift` |
| Pre-release smoke | `npm run gate:phase1 -- --include-smoke --include-e2e` (with dev server up) |
| CI (when we get there) | `npm run gate:phase1 -- --json` |

---

## How to triage a failing run

1. Open the markdown report at `benchmark/runs/phase1-quality-gate-<runId>.md`.
2. Find the `## Failing checks` section. Each entry has:
   - severity tag (P0 / P1 / P2 / ENV)
   - check id + label
   - command (re-run locally to reproduce)
   - stdout / stderr tails
3. Route by id:
   - `tsc` → likely a Track B file you just changed; fix and re-run.
   - `vitest:founder-e2e*` → look at the test file vs your changes.
   - `vitest:flight-time-filter` → the Phase 1 founder-bug regression.
     This is the canary — if it goes red, **stop**.
   - `vitest:profile-gap-*` → likely a NLU contract drift. Check
     `lib/agent/nlu-v2/` or the Profile Gap UI components.
   - `vitest:chat-plan-query` → chat parse/commit pipeline.
   - `vitest:quality-gate` → the gate itself broke. Fix `lib/quality-gate/`.
   - `check-drift` → `lib/` and `worker/src/` diverged. If you didn't
     touch booking-autopilot files, run with `--allow-known-drift`
     while codex is fixing it on his side. If you DID touch them, sync
     manually with `cp` per `scripts/check-drift.ts` header.
   - `e2e:founder` / `preflight:founder-e2e` / `smoke:phase1` → dev
     server side. Read `dev.log`, then open the corresponding
     workbench (`/dev/founder-e2e`).
4. Paste the entire `## Failing checks` block into the chat with codex
   or me. The check id + tail is enough context to start triage.

### Routing by domain

- `tsc`, `vitest:*`, `check-drift`, `quality-gate self-test` →
  whoever last touched the failing file.
- Anything that points at `lib/booking-autopilot/`, `worker/src/`,
  `lib/core/`, `lib/execution-v2/`, `app/api/v1/**`, `scripts/run-phase0-resy-benchmark.ts`,
  `scripts/probe-resy-availability.ts` → **codex**.
- Anything that points at `app/dev/**`, `components/**`,
  `lib/founder-e2e/**`, `lib/quality-gate/**`, `lib/agent/nlu-v2/**`,
  `lib/profile-gap-*`, `scripts/run-founder-e2e.ts`,
  `scripts/run-phase1-quality-gate.ts` → **Claude**.

---

## What this gate intentionally does NOT do

- **No live OpenAI / Computer Use call.** That's `npx tsx
  scripts/run-phase0-resy-benchmark.ts --case <id> --live-openai`
  under codex's control; see `R003_LIVE_SMOKE_RUNBOOK.md`.
- **No external booking provider navigation** (Resy / OpenTable /
  Expedia / Booking.com). The probe runners + the autonomous
  founder e2e runner stay strictly local + mocked.
- **No payment, OTP, CAPTCHA, or final-confirm interaction.** These
  are non-negotiable safety boundaries (see `FOUNDER_E2E_BUG_TRIAGE.md`
  if it exists on this branch, otherwise the autonomous founder e2e
  doc).
- **No automatic dev server start.** `--start-server` is reserved and
  rejected today. Starting Next dev from inside a CI process would
  collide with codex's local worker.

If you find yourself wanting a button that violates any of the above,
the answer is no, and the gate is correctly drawing a hard line.

---

## known_existing_failure escape hatch

`--allow-known-drift` (or env `QUALITY_GATE_KNOWN_DRIFT=1`) downgrades a
`check-drift` fail from **fail** to **known_existing_failure**. The
verdict drops to `needs_polish` instead of `fail`. Purpose: prevent a
pre-existing codex-domain drift from making every Track B PR red.

When to use it:

- You're working on a UI / dashboard / docs PR that doesn't touch
  `lib/booking-autopilot/` or `worker/src/booking-autopilot/`, but
  drift exists today between those directories.
- You're cherry-picking from another Track B branch that already
  carries a known drift.

When NOT to use it:

- You actually changed `lib/booking-autopilot/` or `worker/src/`. Then
  you need to actually sync them (`scripts/check-drift.ts` header
  walks through it).
- Drift is genuinely new. Don't paper over it; the CI workflow at
  `.github/workflows/check-drift.yml` will catch it on PR.

---

## Schema

`QualityGateRun` JSON at schema version 1. Source of truth:
`lib/quality-gate/report.ts`. Highlights:

```ts
interface QualityGateRun {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;            // ISO
  checks: GateCheck[];
  verdict: "pass" | "needs_polish" | "fail" | "env_blocked";
  exitCode: 0 | 1 | 2 | 3;
  runnerMeta: {
    command: string;
    baseUrl?: string;
    nodeVersion: string;
    durationMs: number;
    label?: string;
    startedAt: string;
  };
}

interface GateCheck {
  id: string;
  label: string;
  command: string;
  requirement: "required" | "optional";
  status: "pending" | "pass" | "fail" | "skipped" | "known_existing_failure";
  severity: "p0" | "p1" | "p2" | "env" | "skipped";
  durationMs: number;
  startedAt: string;
  exitCode?: number;
  stdoutTail: string;
  stderrTail: string;
  notes?: string;
}
```

---

## Related files

- `scripts/run-phase1-quality-gate.ts` — runner entrypoint.
- `lib/quality-gate/report.ts` — pure types + verdict + markdown.
- `lib/quality-gate/loader.ts` — file IO + safe paths.
- `lib/quality-gate/runner-helpers.ts` — argv + check definitions.
- `lib/quality-gate/index.ts` — barrel.
- `app/api/dev/phase1-quality-gates/route.ts` — dev API surface.
- `app/dev/phase1-quality-gates/page.tsx` — the dashboard.
- `lib/__tests__/quality-gate-report.test.ts` — pure logic suite (130+).
- `lib/__tests__/quality-gate-runner.test.ts` — argv + check spec suite.
- `PHASE_1_FOUNDER_E2E.md` — the manual checklist this gate
  complements.
- `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` — the autonomous founder runner the
  gate optionally invokes via `--include-e2e`.
- `FOUNDER_E2E_BUG_TRIAGE.md` — severity ladder shared with this doc.
