# Claude Entry Rules

This repository uses `AGENTS.md` as the canonical behavior file for all coding
agents, including Claude. Read `AGENTS.md` first and treat it as binding.

This file exists only because Claude-style agents often look for `CLAUDE.md` at
repo root. Do not duplicate long rules here. If a durable rule is missing, add
it to `AGENTS.md`, not here.

## Must-Follow Summary

- Always respond in Chinese unless the founder explicitly asks otherwise.
- Discuss ambiguous goals before executing; execute clear low-risk tasks without
  unnecessary back-and-forth.
- At decision points, provide options, pros/cons, a recommendation, and an
  expert-style reference when useful.
- Do not suggest pausing or doing nothing as a default option. Keep moving until
  root cause, fix, validation, or a real blocker is reached.
- Do not ask the founder to paste logs or manually run checks that the agent can
  run. Use local HTTP probes, `dev.log`, `worker.log`, terminal output, browser
  evidence, and repo scripts directly.
- Keep Stage 0 focused on:

```text
Capture -> Travel Object -> Task -> Decision -> Execution -> Evidence -> Modify
```

- Prefer product code, tests, benchmarks, runtime evidence, performance, and
  task UX over docs. Docs are support material, not the product.
- Keep changes surgical: state assumptions, avoid speculative abstractions,
  touch only what the task needs, and verify the behavior that changed.
- Avoid code pile bloat: no broad abstractions, duplicate runtime paths, or
  one-off provider hacks unless they close a named product, reliability,
  benchmark, performance, or evidence gap.
- Use external Agent Teams when work splits cleanly across providers, files,
  benchmarks, safety reviews, or architecture questions. Otherwise stay solo.
- For external agents, Codex writes prompts for the founder to paste; agents
  return branch, commit, base, worktree, changed files, validation, evidence,
  deferred work, and safety notes.
- Verify latest base before starting branch work. Do not trust stale branch
  names in historical docs.
- Validate meaningful changes with targeted tests plus TypeScript, drift check,
  phase gate, and `git diff --check` as applicable.
- Commit and push completed, validated work by default unless the change is
  destructive, dependency/CI/env-affecting, or too small/uncertain to stand
  alone.
- Stop provider automation at seat selection, login, OTP, CAPTCHA, payment,
  CVV, or final confirmation unless the founder explicitly approved a narrower
  authorization-assisted flow.

## Project Entrypoints

Read only what the task needs:

1. `AGENTS.md`
2. `docs/INDEX.md`
3. `docs/00-start-here/PROJECT_SUMMARY.md`
4. `docs/00-start-here/PHASE_STATUS.md`
5. `docs/00-start-here/STAGE_0.md`
6. The relevant source files or task-specific runbook

Historical coordination logs live under `docs/90-archive/` and should not be
read by default.
