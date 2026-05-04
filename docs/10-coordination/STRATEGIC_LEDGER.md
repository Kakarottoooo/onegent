# Strategic Ledger

Last updated: 2026-05-04

Append-only list of long-lived decisions. Short-term progress belongs in
`docs/10-coordination/codex.md` or `docs/10-coordination/claude.md`.

## Locked Decisions

- 2026-05-04 Docs are organized under `docs/` by purpose. Root markdown should
  stay limited to repo-level entrypoints (`AGENTS.md`, `CLAUDE.md`,
  `README.md`, `CHANGELOG.md`).
- 2026-05-04 New agents start with `docs/INDEX.md`, not with full-codebase
  reading.
- 2026-05-04 Provider runtime bugs are debugged from DB evidence, worker logs,
  and debug screenshots; task-card UI logs are not enough.
- 2026-05-03 Phase 2 vertical expansion stays frozen until Phase 0/1 are closed.
- 2026-05-03 No blind live provider runs. Use no-token probes and explicit
  approval before burning model tokens.
- 2026-05-03 Safe provider stopping points are review, confirmation handoff,
  OTP handoff, payment handoff, or correct no-availability. Do not automate
  payment, OTP, CAPTCHA, or final irreversible confirmation.
- 2026-05-03 Codex owns runtime/provider/core/debug work. Claude owns large
  UI/dashboard/docs/tests/observability implementation unless explicitly
  delegated otherwise.
