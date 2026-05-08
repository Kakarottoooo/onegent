# Onegent Stage 0

Last updated: 2026-05-07

Stage 0 is the current operating plan for Onegent. All near-term product,
runtime, benchmark, and multi-agent work should align with this file unless
Codex and the founder explicitly update the stage plan.

## North Star

Onegent should become the travel task runtime for AI agents and groups.

The product promise for this stage is:

```text
Send Onegent a link, screenshot, text, or request.
Onegent turns travel intent into a structured task,
narrows the next action, executes through provider runtimes when appropriate,
stops at a user-controlled review or continuation boundary,
and preserves evidence for audit, recovery, and later modification.
```

Stage 0 is not about broad launch or adding many surface features. It is about
making the core chain reliable:

```text
Capture -> Travel Object -> Task -> Decision -> Execution -> Evidence -> Modify
```

## Current Starting Point

Onegent has already moved beyond "can one provider close once." Founder dogfood
has reached initial review or continuation boundaries for:

- Restaurant through OpenTable.
- Hotel through Booking.com-style provider flows.
- Flight through Expedia.
- Activity through Ticketmaster.

This is enough to validate the execution-layer direction. It is not enough for
broad launch. Stage 0 exists to turn those initial closures into repeatable,
auditable product behavior.

## Product Scope

Stage 0 work is in scope when it directly improves one of these systems:

1. **Capture MVP**
   - The homepage input is the Capture surface.
   - Users can paste a URL, screenshot description, video reference, text, or natural-language request into chat.
   - Convert input into a Travel Object with type, extracted entities,
     confidence, source, possible actions, and task readiness.
   - Keep the UI light; the important work is backend normalization into the
     task runtime, not a separate heavy Capture page.

2. **Task Runtime**
   - Preserve task identity.
   - Keep task ownership and source session stable.
   - Show consistent status, logs, screenshots, Evidence, Watch, Details, and
     next actions across restaurant, hotel, flight, activity, rooms, calendar,
     and chat.
   - Support the first Mutable Task State MVP: modify date/time/party/budget or
     provider policy, increment plan version, audit the change, and resume from
     the affected step.

3. **Execution Reliability**
   - Keep L1 provider runtimes as the default.
   - Use evidence-backed benchmark failures to patch wrong-target,
     false-success, field-fill, and state-classification bugs.
   - Keep L2 Browser Harness as a future recovery layer for selector/click/
     iframe/fill/progress/page-mutation failures.
   - Keep L3 Computer Use as a later fallback, not the current default.
   - Stage 0B narrows new provider expansion to activity/events only. Keep
     restaurant, hotel, and flight provider surfaces in maintenance mode unless
     safety evidence requires a fix. Use
     `docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md` as the shared
     plan for testing whether Browser Harness can help create a scalable
     activity provider skill system.

4. **Benchmarks And Evidence**
   - Run no-live 5/10/20/50 case batches by vertical.
   - Track routing mismatch, artifact completeness, unknown failure, false
     success, wrong target, safe boundary, owner, and patch-proposal rate.
   - For Capture specifically, run the Stage 0 capture benchmark before
     accepting private-alpha intake as product signal:

     ```bash
     npx tsx scripts/capture-benchmark.ts --vertical all --count 100 --json
     npx tsx scripts/capture-benchmark.ts --vertical all --gate
     npx tsx scripts/private-alpha-intake.ts --gate
     npx tsx scripts/stage0-operator-report.ts --json
     npx tsx scripts/measure-app-performance.ts --stage0 --json
     ```

   - `scripts/stage0-operator-report.ts` is the week-scale cockpit for Stage
     0. It should answer verdict, Capture, private-alpha intake, internal
     benchmark, layered benchmark, performance risk, agent intake, top
     blockers by owner, and the next five actions without starting providers
     or loading app-shell evidence payloads.
   - Stage 0 performance scan guards compact/bootstrap paths. Memory shell
     surfaces must use `/api/memory/compact`; full `/api/memory` is a lazy
     detail route for insights.
   - Capture benchmark fixtures are no-live deterministic parser-contract
     fixtures. They prove source metadata, Travel Object projection,
     task-readiness, owner, and artifact contracts. They do not prove live
     OpenAI extraction quality.
   - Direct activity URL coverage now flows through a structured Travel Link
     Resolver contract. Exact provider event links can become direct
     provider-entry tasks. Artist, performer, grouping, search, and listing
     pages can also start provider-page tasks, but they are explicitly
     `provider_start`, not exact event evidence: runtime must inspect the
     provider-rendered listings, choose only when there is one obvious match,
     pause for user choice when multiple events/dates/cities/seats are shown,
     and must not claim no availability merely because the original request
     omitted date or city. Impersonating hosts remain review-only.
   - The current Stage 0 capture corpus target is 500+ fixtures across
     restaurant, hotel, flight, activity, trip/package, ambiguous/save-only,
     refine/follow-up, profile/preferences, and chitchat/unsupported inputs.
   - Use small live dogfood only when evidence justifies it.

5. **Private Alpha Readiness**
   - Prepare for 10-20 high-intent users.
   - Measure task submission quality, capture-to-task conversion, safe handoff
     clarity, reuse, and willingness to pay.
   - Use `docs/40-dogfood/PRIVATE_ALPHA_INTAKE_PROTOCOL.md` and
     `scripts/private-alpha-intake.ts` for what to collect, what not to
     collect, scoring, and fixture conversion.
   - Do not mark private alpha green from docs, fixtures, or tooling alone.
     Green requires real submissions with Travel Object, task-readiness,
     safe-next-action, evidence, and user-value signal.

## Explicit Non-Goals

Do not spend Stage 0 energy on:

- Broad Product Hunt, Hacker News, or Reddit launch.
- Full social feed.
- Supplier network or large OTA business development.
- Self-built browser farm.
- Generic non-travel vertical expansion.
- More provider automation without benchmark or dogfood evidence.
- Broad abstractions that duplicate runtime logic or make the app slower.

These can matter later. They are not the current bottleneck.

## Stage 0 Quality Metrics

Use these as the operating scorecard:

| Area | Target |
| --- | --- |
| Routing mismatch | 0 |
| Artifact completeness | at least 95% |
| Unknown failure | below 5% |
| Severe provider mistake | 0 |
| False success | 0 |
| Wrong target selection | 0 |
| Task workspace consistency | all task entry points land on the same task view |
| Capture conversion | link/text/screenshot/video/request can become a Travel Object |
| Capture benchmark corpus | at least 500 no-live fixtures before alpha intake |
| Task-ready accuracy | at least 90% on deterministic capture fixtures |
| Source metadata completeness | at least 95% |
| Private alpha | 10-20 high-intent users before broad launch |
| App-shell payload risk | no high-risk compact/bootstrap endpoint without a next patch |

## Agent Operating Model

Codex owns:

- Integration and merge review.
- Stage 0 architecture.
- Capture schema and task runtime boundaries.
- Task Workspace and benchmark contracts.
- Keeping code changes scoped and maintainable.

Side agents should work in parallel on independent, high-value tasks:

- Benchmark corpus and owner reports.
- Provider-specific, evidence-backed runtime hardening.
- No-live NLU and Capture fixture expansion.
- Task Workspace audits that do not edit shared UI at the same time as Codex.
- Private-alpha readiness artifacts.

Anti-goals for side agents:

- Docs-only closure claims.
- Runtime mirror drift.
- Vertical-specific schema forks.
- Broad rewrites of `app/page.tsx`.
- Provider live runs without explicit run approval and evidence capture.
- Code that increases app shell bloat or duplicates existing helpers.

## 30-45 Day Plan

### Week 1: Align And Capture MVP

- Land this Stage 0 file as the north star.
- Build the first Capture MVP:
  - Homepage chat remains the capture input.
  - `/api/chat/parse` returns a Travel Object alongside the normal NLU result.
  - URL/text/screenshot-description/video-reference/request sources preserve source metadata.
  - Provider links are normalized into a structured Travel Link Resolver
    output before task creation. LLM/web metadata enrichment may improve this
    object later, but executor prompts must be generated from the structured
    contract, not from free-form model prose.
  - For activity providers, exact event URLs and provider-start URLs share the
    same task boundary but different execution contracts. Exact event URLs
    lock the runtime to one event page. Provider-start URLs lock the runtime
    to the supplied artist/performer/grouping/listing page and defer event,
    date, city, or seat choice to provider evidence and user checkpoints.
  - Task readiness is derived from NLU/router state, not from model prose.
  - Convert-to-task stays behind the existing confirm/task workspace flow.
- Keep it small and use existing NLU/task seams where possible.

### Week 2: Task Runtime Hardening

- Finish consistent Task Workspace behavior:
  - Queue = pending or not started.
  - Live = running.
  - History = terminal or ready-for-review.
  - Watch, Evidence, Details behave consistently everywhere.
- Ensure completed tasks remain attached to the originating chat/session.
- Add no-live tests for key task entry points.

### Week 3: Benchmark And Runtime Patches

- Run 5/10/20 batches by vertical.
- Patch only fixture-backed failure classes.
- Keep owner, failure class, and patch proposal reporting current.

### Week 4: Mutable Task State MVP

- Add or harden modify API and UI for active tasks.
- Preserve task identity.
- Increment plan version.
- Add audit events.
- Resume from the affected step when possible.

### Week 5-6: Private Alpha

- Recruit 10-20 high-intent users.
- Ask for real screenshots, links, text, and travel requests.
- Track:
  - Was the input understood?
  - Did it become a Travel Object?
  - Did it become a task?
  - Did it reach a safe review or continuation boundary?
  - Did the user reuse it?
  - Would the user pay?

## Decision Rule

When choosing between two tasks, pick the one that most improves this chain:

```text
Capture -> Travel Object -> Task -> Decision -> Execution -> Evidence -> Modify
```

If a task does not improve that chain, defer it.
