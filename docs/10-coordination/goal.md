# Goal Handoff - Stage 0 Reliability System

Last updated: 2026-05-07

Branch: `codex/goal-stage0-reliability-system`

Base: `origin/codex/stage0-capture-mvp` at
`9ad43f1b2eaf446c7528e84f4ef7c8c481aa84e1`.

## Current State

This branch is no-live Stage 0 reliability tooling. It builds the Capture ->
Travel Object -> Task Readiness -> Benchmark -> Private Alpha Readiness loop
without touching provider runtime, worker code, booking-job APIs, DB/schema,
env files, logs, screenshots, or local artifacts.

## What Is New

- `lib/capture/benchmark.ts` provides a 216-fixture no-live capture corpus and
  evaluator for raw homepage input plus deterministic parser-state fixtures.
- `scripts/capture-benchmark.ts` emits JSON/Markdown and gate results for
  routing mismatch, task-ready accuracy, source metadata, artifact
  completeness, and unknown failures.
- `lib/internal-benchmark/stage0-operator-report.ts` and
  `scripts/stage0-operator-report.ts` combine Capture, Internal Benchmark v2,
  and Layered Benchmark V2 into one Stage 0 readiness verdict and next-action
  list.
- `lib/capture/private-alpha.ts` defines the private-alpha submission contract,
  sensitive-content guard, scoring, and fixture seed conversion.
- Agent intake now supports `--forbid-provider-runtime` and the Stage 0 sample
  queue at `lib/internal-benchmark/__fixtures__/agent-intake/stage0-returned-branches.json`.
- Docs now link the Capture benchmark, Stage 0 operator report, and private
  alpha intake protocol.

## Changed Files

- `lib/capture/benchmark.ts`
- `lib/capture/private-alpha.ts`
- `lib/internal-benchmark/agent-intake.ts`
- `lib/internal-benchmark/stage0-operator-report.ts`
- `lib/internal-benchmark/__fixtures__/agent-intake/stage0-returned-branches.json`
- `lib/__tests__/capture-benchmark.test.ts`
- `lib/__tests__/private-alpha-intake.test.ts`
- `lib/__tests__/stage0-agent-intake.test.ts`
- `lib/__tests__/stage0-operator-report.test.ts`
- `scripts/capture-benchmark.ts`
- `scripts/layered-agent-intake.ts`
- `scripts/stage0-operator-report.ts`
- `docs/00-start-here/STAGE_0.md`
- `docs/40-dogfood/CAPTURE_MVP_SEAMS.md`
- `docs/40-dogfood/PRIVATE_ALPHA_INTAKE_PROTOCOL.md`
- `docs/40-dogfood/PRIVATE_ALPHA_READINESS.md`
- `docs/40-dogfood/AGENT_INTAKE_QUEUE.md`
- `docs/10-coordination/goal.md`
- `docs/INDEX.md`

## Validation Plan

- Targeted Vitest for new capture, operator, alpha, and intake tests.
- Capture benchmark JSON and gate CLI.
- Stage 0 operator report JSON CLI.
- Typecheck, check-drift, Phase 1 gate, and diff whitespace check.

## Safety

No external provider workflow, browser booking agent, live OpenAI call, worker
queue, payment, login, verification, CAPTCHA, final confirmation, secrets,
`.env*`, `.tmp`, logs, screenshots, provider cookies, DB/schema, or provider
runtime path is touched by this branch.
