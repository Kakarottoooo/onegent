
## gstack

Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

If gstack skills aren't working, run: cd .claude/skills/gstack && ./setup

## Project docs

Before planning non-trivial work, read `docs/INDEX.md`, but keep doc reads
minimal and task-specific. Documentation exists to support product execution;
it is not the deliverable by default.

Minimal new-session read order:

1. `docs/INDEX.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/10-coordination/README.md`
5. `docs/10-coordination/HUDDLE.md`

Task-specific docs live under `docs/20-*` through `docs/60-*`.
Completed or historical plans live under `docs/90-archive/`.

## Product-first engineering rules

Onegent's priority is a working, fast, maintainable product. Code, tests,
benchmarks, runtime evidence, and user-visible behavior matter more than
writing more documents.

- Do not default to creating new docs. Add or edit docs only when they are
  core durable context, an operational runbook, or a generated status report
  that materially helps execution.
- Prefer code changes that create usable product behavior: capture intake,
  task creation, provider skill/runtime execution, task workspace choices,
  evidence, performance, reliability, and safe handoff.
- Multi-agent work is for parallel product execution, not documentation volume.
  Side-agent prompts should normally require code, tests, fixtures, benchmark
  gates, or runtime/evidence improvements. A docs-only side-agent task is low
  value unless explicitly requested.
- Avoid "code pile" bloat. Do not add broad abstractions, duplicate runtime
  paths, or one-off provider hacks unless they close a named product,
  benchmark, reliability, performance, or evidence gap.
- Every substantive task should answer: what user-visible behavior, runtime
  reliability, benchmark coverage, or performance improved?
- Keep active docs small. If a document is historical, completed, duplicated,
  or not part of the current operating loop, archive it under `docs/90-archive/`
  instead of making agents read it by default.
- At task completion, recommend the next highest-impact options before waiting
  for the founder to ask "what next?" Rank options by Stage 0/product impact.
