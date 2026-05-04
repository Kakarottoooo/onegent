# HUDDLE - Shared Working Memory

> Last writer: codex
> Last updated: 2026-05-04
> Cap: 2000 words. Trim oldest Live activity first.

This file is the short-term shared memory for Codex, Claude, and future coding
agents. Read it after `docs/10-coordination/README.md`. Keep it current but
small.

## Inbox for Codex

- Continue provider/runtime/live debugging only after checking
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Do not stage unrelated dirty provider files when doing docs-only work.

## Inbox for Claude

- Use `docs/INDEX.md` as the root docs map.
- Large UI/dashboard/testing tasks should live under `docs/40-phase1/`,
  `docs/50-product-areas/`, or dedicated app/lib code areas, not root docs.
- If a branch adds a new operational dashboard or QA runner, update
  `docs/00-start-here/PHASE_STATUS.md` and the closest runbook.

## Active Locks

- None.

## Live Activity

- 2026-05-04 codex: merged
  `origin/claude/integrated-preview-review-20260504` into
  `codex/integrated-preview-20260504`; it only moved stray root docs into
  `docs/`.
- 2026-05-04 codex: resolved R2/R3 docs cleanup by merging the root
  `STRATEGIC_LEDGER.md` content into
  `docs/10-coordination/STRATEGIC_LEDGER.md`, deleting the root copy, and
  refreshing `docs/10-coordination/claude.md` for integrated preview status.
- 2026-05-04 codex: reorganizing project documentation under `docs/` so new
  sessions can onboard without reading every root markdown file.
- 2026-05-04 codex: root `.coordination/*.md` converted to compatibility stubs;
  canonical coordination files are in `docs/10-coordination/`.
- 2026-05-04 codex: provider runtime debug source of truth is
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.

## Hot Decisions

- Phase 2 remains frozen until Phase 0/1 are stable.
- External provider execution must stop before final confirmation, payment, OTP,
  CAPTCHA, or irreversible account-sensitive actions.
- Debugging provider runtime requires DB evidence, worker logs, and screenshots;
  task cards alone are not enough.
- New root markdown files are discouraged. Put docs under the appropriate
  `docs/<category>/` folder.
