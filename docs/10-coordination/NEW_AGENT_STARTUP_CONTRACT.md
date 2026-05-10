# New Agent Startup Contract

Last updated: 2026-05-10

This is the short startup checklist for any new external coding agent. Durable
behavior rules live in `AGENTS.md`; this file only summarizes branch startup
and handoff expectations.

## 1. Start From The Current Integration Base

Do not trust old branch names in historical docs. Before starting work:

```powershell
git fetch origin
git status --short --branch
git --no-pager log --oneline -5 origin/codex/stage0-capture-mvp
```

Use the latest pushed Stage 0 integration branch and exact commit named in the
current Codex prompt. If the prompt base is stale, stop and ask for a refreshed
base instead of building on old work.

Record the base branch and base SHA in the returned report.

## 2. Founder-Mediated External Agent Flow

The normal multi-agent workflow is external and founder-mediated:

1. Codex writes copy-paste prompts for Goal, Claude, Agent2, Agent3, or another
   named side agent.
2. The founder pastes those prompts into the external agents.
3. The external agents report branch, commit, base, worktree, files,
   validation, evidence, deferred work, and safety.
4. The founder pastes those reports back to Codex.
5. Codex triages, validates, integrates, and issues the next independent tasks.

Do not assume Codex will spawn internal subagents unless the founder explicitly
asks for internal Codex subagents.

## 3. Edit Only Your Assigned Surface

Follow the allowed and forbidden paths in the prompt. If a needed file is
outside the assigned surface, stop and ask for a handoff rather than silently
expanding scope.

Default forbidden areas for non-Codex side agents unless explicitly delegated:

- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- `lib/db.ts`
- SQL migrations or schema files
- live-run scripts or provider navigation scripts

## 4. Safety Hard Stops

No branch may perform these actions without explicit founder approval for the
exact run:

- live provider booking workflow that touches a real account or booking;
- live OpenAI / Computer Use validation;
- payment automation, CVV, final purchase, final booking, or final reservation;
- CAPTCHA bypass;
- login, OTP, phone verification, or Gmail OTP use unless that is the approved
  task;
- broad live suites or blind retries.

If a run reaches seat selection, login, OTP, CAPTCHA, payment, CVV, or final
confirmation, stop and capture evidence.

## 5. Validation

Every branch needs targeted tests for changed behavior plus:

```powershell
npx tsc --noEmit --pretty false
npm run check-drift
npm run gate:phase1 -- --allow-known-drift
git diff --check
```

Run `npm run build` if app, route, server component, or shared frontend
surfaces changed.

## 6. Return Report Shape

```text
Branch:
Commit:
Base:
Worktree:
Changed files:
What changed:
Validation:
Evidence:
Deferred:
Safety:
```

Keep reports concise. Do not paste logs unless Codex asks for a specific
failure detail.
