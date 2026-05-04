# Demo Control Room

> Last updated: 2026-05-04
> Surface: `/dev/demo-control-room`
> Owner: Track B (Claude). Read-only V1.

The Demo Control Room is the founder-facing landing page for demo
prep. It aggregates the latest no-token verdicts (Phase 1 quality
gate, founder-e2e, smoke) plus the Phase 2 vertical posture and a
canonical safe demo script onto one screen.

This page is a **triage helper**, not the source of truth. Source of
truth remains the underlying artifact files in `benchmark/runs/` and
the docs they reference.

## What it shows

Top-down on the page:

1. **Verdict at a glance** - three cards:
   - Phase 1 quality gate: latest `phase1-quality-gate-*.json` verdict,
     pass/total counts, known-existing count, generation timestamp,
     duration, file path.
   - Founder E2E: latest `founder-e2e-*.json` runner verdict, pass /
     fail / blocker counts, path id (quick / full / auto), source
     (manual / automated), file path.
   - Smoke (`smoke:phase1`): extracted from the latest gate's
     `checks[]` when present. Absent when the gate ran without
     `--include-smoke`; the card explains how to fix.
2. **Runtime forensics quick-link** - short blurb + link to
   `/dev/runtime-forensics`. Use it after a demo if a booking flow
   stalls, to see the failure pre-classified into one of 8 categories.
3. **Phase 2 vertical posture** - three vertical cards:
   - Expedia Flight: `candidate, not live-verified`
   - Booking.com Hotel: `needs fresh artifacts before live promises`
   - Hotels.com: `needs fresh artifacts before live promises`
   Each card has rationale + per-vertical evidence (audit doc, tests,
   provider modules, runbooks).
4. **Safe demo script** - pre-demo checklist (5 min), happy path
   (numbered steps), hard stops table (OTP / payment / CAPTCHA /
   login wall / final-confirm + recovery lines), recovery phrases
   for unexpected boundaries, plus a paste-ready markdown export and a
   link to `docs/40-phase1/YC_DEMO_RUNBOOK.md`.
5. **Sources + notes** - links to the canonical docs (`PHASE_1_FOUNDER_E2E`,
   `PHASE2_VERTICAL_REVIVAL_AUDIT`, `HUDDLE`, `STRATEGIC_LEDGER`) plus
   loader notes about what artifacts were found / missing.

## What it does NOT do

Hard rules - verified per commit and by the test suite:

- **Never invokes a runner.** The dashboard does not run the gate, the
  founder-e2e runner, the worker, or any provider. The only mutating
  action on the page is `router.refresh()`, which re-renders the
  server component (re-reading filesystem artifacts).
- **No live OpenAI / Computer Use / payment entry / OTP entry / CAPTCHA solving.**
- **No DB queries.** V1 is artifact-based; consumes the same
  `benchmark/runs/*.json` files that ship today.
- **No retry / re-run / accept buttons.** Re-runs happen from a shell:
  `npm run gate:phase1 -- --allow-known-drift` /
  `npm run e2e:founder` / `npm run probe:resy`.
- **No new dev API.** The page is a server component that imports
  `lib/demo-control-room` directly.

## Architecture

```
app/dev/demo-control-room/
  page.tsx              -> server component
  refresh-button.tsx    -> client component (router.refresh())

lib/demo-control-room/
  index.ts              -> barrel
  phase2-status.ts      -> structured Phase 2 vertical mirror
                            (single source of truth for the page)
  loader.ts             -> async loader composing
                            lib/quality-gate/loader +
                            lib/founder-e2e/loader; extracts the
                            `smoke:phase1` check from the latest
                            gate JSON's `checks[]`
  script.ts             -> deterministic safe demo script content
                            + markdown export

lib/__tests__/
  demo-control-room-phase2-status.test.ts  (17 cases)
  demo-control-room-loader.test.ts         (31 cases)
  demo-control-room-script.test.ts         (20 cases)
```

## How to extend

### Add a new section to the page

1. If the new section needs structured data, add a typed module
   under `lib/demo-control-room/`. Keep it pure (no fs at module
   load).
2. Compose the new module into `loadDemoControlRoomSnapshot` in
   `lib/demo-control-room/loader.ts`.
3. Add a vitest test file under
   `lib/__tests__/demo-control-room-*.test.ts`.
4. Render the new section as a server-rendered subcomponent in
   `app/dev/demo-control-room/page.tsx`.

### Update the Phase 2 vertical status

1. Update the prose in
   `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` first.
2. Mirror the change in `lib/demo-control-room/phase2-status.ts`.
3. Run the demo-control-room tests; the structural invariants will
   catch shape regressions.

### Update the safe demo script

1. Edit `lib/demo-control-room/script.ts`. The canonical content
   lives in the `SAFE_DEMO_SCRIPT` constant.
2. The page reads it directly; the markdown export uses
   `formatDemoScriptMarkdown(SAFE_DEMO_SCRIPT)`.
3. ASCII-only - no emoji. Tests enforce this.

## Operator runbook

### Before a demo

1. From a shell:

   ```bash
   npm run gate:phase1 -- --include-smoke --allow-known-drift
   npm run e2e:founder
   ```

2. Open `/dev/demo-control-room`.
3. Verify all three verdict cards are green or yellow. **Red = stop.**
4. Skim the Phase 2 panel - confirm the Expedia phrasing matches what
   you plan to say.
5. Read `docs/40-phase1/YC_DEMO_RUNBOOK.md` and
   `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md` for the route order,
   acceptance checklist, and YC-specific fallback lines.
6. Triple-click the markdown textarea to copy the safe demo script;
   paste into Slack / a deck.

### During a demo (with control room open)

- Hard stops are listed in the page. If the live flow trips one,
  read the recovery line verbatim and take over manually.
- If a booking stalls without an obvious hard stop, switch to
  `/dev/runtime-forensics` to see the failure classification.

### After a demo

- If anything broke that wasn't covered by the script, file a
  follow-up under Track B and add a recovery phrase to
  `lib/demo-control-room/script.ts`.

## Update protocol

Per project convention:

- This file (the runbook): update on any change to the page's
  layout, sections, or operator instructions.
- `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`: linked to here from a
  pre-demo cross-reference; update when adding a fundamentally new
  pre-demo step.
- `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`: keep in
  sync with `lib/demo-control-room/phase2-status.ts`.

## Hold rules

- Do not add a "Run gate now" button.
- Do not add a "Run founder-e2e now" button.
- Do not add a "Retry failed check" button.
- Do not add a "Use saved credentials" button.
- Do not poll the dev API on a timer; rely on the manual refresh.
