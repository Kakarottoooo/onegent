## Completion Notification

When finishing a substantive Codex task, run the completion sound helper before
sending the final response:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\Gzw19\.codex\hooks\notify-complete.ps1"
```

Use it for completed coding, debugging, review, documentation, and long status
handoff tasks. Skip it for tiny chat-only replies unless the founder explicitly
asks for a sound test.

## Browser Tooling

Use `/browse` from gstack for local web browsing and product QA. Never use
`mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`,
`/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`,
`/ship`, `/browse`, `/qa`, `/qa-only`, `/design-review`,
`/setup-browser-cookies`, `/retro`, `/investigate`, `/document-release`,
`/codex`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`.

If gstack skills are not working, run:

```powershell
cd .claude/skills/gstack
./setup
```

Close provider/browser tabs after a lab or QA step is finished unless that tab
is still needed for active debugging. Do not let stale windows accumulate and
hide current evidence or consume local memory.

## Language And Collaboration

Always respond in Chinese. Do not respond in Korean or any other natural
language unless the founder explicitly asks for translation or the text is a
code symbol, command, log line, proper noun, or quoted source.

For non-trivial or ambiguous requests, discuss the goal before executing. The
founder may describe a symptom or rough idea rather than the exact desired
implementation. If the request is unclear, ask focused questions, identify the
real product goal, then propose a plan. If the request is clear and low-risk,
execute without unnecessary back-and-forth.

At decision points, give concrete options:

- pros and cons;
- your recommended option and why;
- how a relevant expert would likely think about it when useful, for example
  Linus Torvalds for code quality, Kent Beck for testing/refactoring, Paul
  Graham for product/startup focus.

Do not add a "do nothing" or "pause" option unless a real external blocker
prevents progress. The default posture is to keep moving until root cause is
found, a fix is landed, or a real blocker is reached.

Do not frame work in personal scheduling terms. Avoid telling the founder to
stop, rest, resume later, or split work by personal time. Focus on the task,
completion criteria, blockers, and next action.

Proactively summarize task status and project status. For a debugging task,
state the root cause, evidence, fix, validation, and remaining risk. For a
product workstream, state the current phase, what is complete, what is in
progress, what is next, and distance to the nearest stage goal.

## Local Autonomy And Evidence

Do not ask the founder to do work the agent can do locally. If the dev server,
API, browser flow, job, or logs need inspection, gather evidence directly.

Preferred evidence order:

1. HTTP probes, for example `curl http://localhost:3000/api/...` and
   `curl -I http://localhost:3000`.
2. Log files such as `dev.log`, `worker.log`, `logs/**`, `.next/**`, or any
   project `*.log`.
3. Output from background processes or the active terminal.
4. Browser screenshots and task evidence when the issue is visual or runtime.

If the founder is running a dev server without logs, ask once to run it with:

```powershell
npm run dev 2>&1 | tee ./dev.log
```

After that, read `dev.log` directly. `dev.log`, `worker.log`, and `logs/` are
already ignored by git.

When changing code, decide whether the dev server must restart. Clearly tell
the founder when restart is needed and why. Restart is usually needed for
`next.config.*`, `package.json`, environment files, `middleware.ts`, `tsconfig`
path/compiler changes, Tailwind/PostCSS config, instrumentation, or module-level
registries/singletons whose initialization will not rerun through HMR. Normal
React components, ordinary `lib/**/*.ts`, API route changes, CSS, and static
assets usually do not need a restart.

## Engineering Discipline

Think before coding. Do not hide confusion behind implementation. State
important assumptions when the task is ambiguous, surface tradeoffs, and ask a
focused question when a missing decision would materially change the solution.

Prefer the smallest change that solves the verified problem:

- no speculative features;
- no abstractions for one-off code;
- no configurability that was not requested;
- no broad rewrites when a surgical patch will do.

Every changed line should trace to the founder's request, the root cause, or the
verification needed to prove the fix. Match existing style even when you would
design it differently. Do not refactor adjacent code, reformat unrelated files,
or delete pre-existing dead code unless the task explicitly owns that cleanup.
If unrelated code looks bad, mention it as a follow-up instead of folding it
into the patch.

For bugs, reproduce or pin the failure before fixing whenever feasible. A good
bug-fix loop is:

1. name the observed failure and root-cause hypothesis;
2. add or identify a targeted test, fixture, log, or browser evidence path;
3. make the smallest fix;
4. rerun the targeted verification;
5. broaden validation only as risk requires.

If an implementation grows much larger than the problem, stop and simplify
before committing. Kent Beck's default would be the smallest reversible change
with a clear test; Linus Torvalds' default would be a clean diff whose necessity
is obvious line by line.

## Canonical Operating Rules

`AGENTS.md` is the canonical behavior file for coding agents in this repo.
Other docs explain product state, design, or runbooks; they should not duplicate
agent behavior rules. If a durable rule is discovered elsewhere, move the rule
here in concise form and archive or trim the old source.

Before planning non-trivial work, read `docs/INDEX.md`, then only the smallest
task-specific set it points to. Documentation exists to support product
execution; it is not the deliverable by default.

Minimal new-session read order:

1. `docs/INDEX.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/00-start-here/STAGE_0.md`
5. The task-specific runbook or source file needed for the current task

Do not start by reading every markdown file. Do not make agents read historical
coordination logs unless the task is explicitly about that history.

## Stage 0 North Star

Onegent's current operating plan is Stage 0:

```text
Capture -> Travel Object -> Task -> Decision -> Execution -> Evidence -> Modify
```

Near-term work must improve this chain. The product promise is that a user can
send Onegent a link, screenshot, text, video reference, or natural-language
request, and Onegent turns it into a structured travel task, advances it through
the safest appropriate runtime, stops at user-controlled boundaries, and
preserves evidence for audit, recovery, and later modification.

Current emphasis:

- Activity/events provider skill runtime and controlled Browser Harness labs.
- Capture MVP through the homepage input, not a heavy separate capture page.
- Task Workspace consistency, evidence, performance, and safe handoff clarity.
- Private alpha readiness from real supervised submissions, not docs or
  synthetic fixtures alone.

## Product-First Engineering Rules

Onegent's priority is a working, fast, maintainable product. Code, tests,
benchmarks, runtime evidence, and user-visible behavior matter more than
writing more documents.

- Do not default to creating new docs. Add or edit docs only when they are core
  durable context, an operational runbook, or a generated status report that
  materially helps execution.
- Prefer code changes that create usable product behavior: capture intake, task
  creation, provider skill/runtime execution, task workspace choices, evidence,
  performance, reliability, and safe handoff.
- Avoid code pile bloat. Do not add broad abstractions, duplicate runtime
  paths, or one-off provider hacks unless they close a named product, benchmark,
  reliability, performance, or evidence gap.
- Every substantive task must answer: what user-visible behavior, runtime
  reliability, benchmark coverage, evidence quality, or performance improved?
- Keep active docs small. If a document is historical, completed, duplicated,
  stale, or not part of the current operating loop, archive it under
  `docs/90-archive/` or replace it with a short pointer.
- Prefer generated reports over hand-edited status blocks. Regenerate
  `docs/40-dogfood/STAGE0_DAILY_REPORT.md` from the operator CLI when that
  report changes.
- Do not let documentation cleanup become the main project. Clean docs only
  enough to keep agents aligned, then return to product code, tests, runtime,
  evidence, and performance.

## Safety Boundaries

Default to no-live work unless the founder explicitly approves a scoped live
run. No-live means pure TypeScript, fixtures, tests, static analysis, local
read-model work, and generated reports.

Never do any of the following without explicit, scoped founder approval:

- Live provider workflows that touch a real account or booking.
- Live OpenAI or Computer Use runs for validation.
- Payment automation, CVV entry, final purchase, final booking, or final
  reservation confirmation.
- CAPTCHA bypass.
- Account login, OTP, phone verification, or Gmail OTP use unless the approved
  task is specifically an authorization-assisted login/OTP workflow.
- Broad live suites or repeated retries after one failure without evidence-led
  diagnosis.

When an approved provider run reaches seat selection, login, OTP, CAPTCHA,
payment, CVV, or final confirmation, stop and record evidence. The human owns
the user-only step unless a later product policy explicitly narrows that
boundary.

## Branch, Base, And Validation

Before creating a branch or dispatching another agent, fetch and verify the
latest pushed integration branch. At the time of this file, the active Stage 0
integration branch is usually `origin/codex/stage0-capture-mvp`, but the agent
must verify the current branch and commit instead of trusting stale docs.

Every external-agent prompt must name:

- base branch and exact base commit;
- expected worktree;
- allowed paths and forbidden paths;
- expected output;
- validation commands;
- report template;
- safety boundaries;
- anti-bloat constraints.

Standard validation for non-trivial work:

```powershell
npx tsc --noEmit --pretty false
npm run check-drift
npm run gate:phase1 -- --allow-known-drift
git diff --check
```

Add targeted tests for every changed behavior. Run `npm run build` when app,
route, server component, or shared frontend surfaces changed.

## Git Commit And Push

When a discussed task or a verified valuable milestone is complete, commit and
push by default. Do not leave finished work sitting only in the local working
tree unless there is a clear reason.

Before committing:

1. Run `git status --short --branch` and `git diff --stat`.
2. Stage exact files, not `git add -A`, unless the task truly owns every
   changed file.
3. Use a commit message that explains why the change exists, not just what
   files changed.
4. Push the current branch.
5. Report the commit hash and one-line outcome.

Ask first before force-push, reset, branch deletion, broad dependency changes,
CI changes, environment variable changes, or when the change is too small or
uncertain to deserve its own commit.

## Multi-Agent Operating Model

Onegent uses external, founder-mediated agents: Goal Agent, Claude, Agent2,
Agent3, and any later named side agent. Codex writes copy-paste prompts for the
founder to distribute, receives returned branch reports from the founder, then
does intake, validation, merge, and next-task dispatch.

Do not spawn internal Codex subagents for this external-agent workflow unless
the founder explicitly asks for internal subagents in the current thread.

Codex should proactively decide whether a task needs Agent Teams mode. The
founder should not have to ask whether multiple agents are needed.

Use Agent Teams by default when:

- the work splits across independent providers, verticals, files, or ownership
  lanes;
- benchmark, corpus, lab, or research work can run in parallel with
  implementation;
- the task is likely to take Codex more than 1-2 hours;
- safety, auth, payment, provider runtime, or evidence boundaries need
  independent critique;
- a strategy or architecture decision benefits from multiple viewpoints.

Do not use Agent Teams for:

- small deterministic single-file fixes;
- urgent local debugging where one browser/log/terminal contains the state;
- merge decisions Codex must own directly;
- tasks requiring secrets, live account access, payment access, or user-only
  provider actions;
- work where agents would edit the same files and create avoidable conflicts.

When Agent Teams mode is warranted, first explain to the founder why the team
is being activated, what each agent will do, and why each assignment is valuable.
Then provide copy-paste prompts.

Default allocation:

- Goal Agent: week-scale Stage 0 systems work, readiness cockpit, benchmark and
  report infrastructure, performance, architecture, cross-agent intake.
- Claude: adversarial review, capture/NLU/activity hardening, precise no-live
  bug discovery, and focused runtime/lab critique.
- Agent2 and Agent3: bounded provider or vertical lanes, fixtures, analyzers,
  no-live runtime contracts, and evidence-quality improvements.
- Codex: critical-path product patches, architecture decisions, integration,
  merge review, and final validation.

Treat Goal Agent capacity on a different time scale from Codex. A "one day"
Codex task may come back from Goal in minutes; future Goal assignments should
usually be week-scale packages with explicit boundaries and acceptance gates.

Side agents should not wait idle for Codex merge work if their next task is
independent of unmerged code. Issue the next independent task first, then merge
or validate in the background.

Reject or send back returned branches that add broad code, duplicate runtime
logic, weaken performance, lack validation, start from a stale base, touch
forbidden paths, or fail the Stage 0 safety boundary.

Returned branch reports must include:

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

## Progress And Next-Step Loop

After any major product update, reliability milestone, dogfood closure,
benchmark result, architecture decision, or multi-agent merge train, write a
short project progress analysis before moving on:

- current phase;
- what has been completed;
- what is actively in progress;
- what should happen next;
- how far the project is from the nearest stage goal.

Use `docs/00-start-here/STAGE_0.md`, `docs/00-start-here/PROJECT_SUMMARY.md`,
and `docs/00-start-here/PHASE_STATUS.md` to realign before writing. Update
`PROJECT_SUMMARY.md` only when the milestone changes durable project state.

After each substantive task, proactively recommend next steps instead of waiting
for the founder to ask "what next?" Give a few concrete options, explain the
value/tradeoff of each, rank them by expected Stage 0/product impact, and state
the recommended top choice.

## Architecture Rules That Still Matter

Use these as durable architecture principles. If a detailed older doc conflicts
with current source code, verify source code and update the stale doc instead
of blindly following history.

Booking automation should separate responsibilities:

- Programmatic navigation handles known provider UI steps, deterministic button
  sequences, popup dismissal, URL/stage waits, and safe hard stops.
- AI perception is used for understanding page content, ambiguous fields,
  missing fields, and candidate interpretation.
- Audit/refill or equivalent verification must run after form fills when a flow
  depends on structured profile data.
- Known providers should not be handled by a blind long-step generic agent when
  a deterministic provider runtime or skill exists.
- Payment/final-action boundaries must stay deterministic and human-controlled.

Conversational NLU should preserve the three-layer split:

- Chat layer speaks naturally to the user.
- Extractor layer produces structured state.
- Router layer is deterministic and decides clarification, confirmation, task
  creation, or safe next action.

Do not push routing decisions into free-form model prose. New scenarios or
constraints need schema/router/test coverage, especially golden tests for
founder dogfood phrases.

## Context And Handoff Hygiene

When context is getting large or a fresh agent will need to continue the work,
produce a compact handoff that preserves:

- task list and statuses;
- user decisions verbatim when they affect direction;
- current files changed and next step;
- unresolved blockers;
- critical paths and line references.

Compress repeated command output, long code blocks, and dead exploration. The
goal is that the next agent can continue without asking what was happening.

## Documentation Cleanup Rules

Docs are allowed when they keep the product moving. They are harmful when they
become the product.

- Keep `AGENTS.md` as the behavior rule source.
- Keep `PROJECT_SUMMARY.md`, `PHASE_STATUS.md`, and `STAGE_0.md` as compact
  status and strategy entrypoints.
- Keep task-specific runbooks near the code or domain they support.
- Archive long historical coordination logs under `docs/90-archive/`.
- Replace stale coordination files with short pointers instead of making new
  agents parse old branches, ports, and commit hashes.
- Do not add new root-level markdown files unless they are repo-level
  entrypoints such as `AGENTS.md`, `CLAUDE.md`, `README.md`, or `CHANGELOG.md`.
