# Provider Closure Operator Room

Last updated: 2026-05-05

Scope: read-only operator cockpit at `/dev/provider-closure` that
organizes restaurant, flight, and hotel closure work into a single
screen. This doc explains how to use the page during a controlled
closure attempt - before any live retry, during artifact collection
after a run, and before deciding whether to patch.

This page does not start a live provider run. A human must
separately approve one exact command before any live provider,
OpenAI, Computer Use, or browser automation is used.

## What Closure Means

Closure is the per-vertical condition under which we accept that a
provider attempt is finished without booking. Closure is not the
same as success; it is the safe boundary at which a controlled
retry must stop.

| Lane | Accepted closure outcomes |
| --- | --- |
| Restaurant / Resy + OpenTable | `ready_for_confirmation`, `safe_handoff`, `OTP/login required`, or a correct no-availability classification. |
| Flight / Expedia | `checkout_manual_review_reached` on the audited flight card. |
| Hotel / Booking.com first | `room_selection_manual_review_reached`, `guest_details_manual_review_reached`, or `payment_manual_review_reached`. |

In every lane, payment, CVV, OTP, CAPTCHA, login bypass, and final
confirmation are forbidden.

Current restaurant status: Phase 0A is closed through the 2026-05-05 Sirrah
OpenTable safe handoff recorded in
`docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md`. Resy remains a
provider/network/IP follow-up lane, not the Phase 0A gate.

## Cockpit Layout

The page is a server component composed of three lane cards plus a
disclaimer and a checklist link.

For each lane the cockpit renders:

1. Current closure posture - what success vs safe boundary means
   for this lane.
2. Last known blocker - the most recent attempt's outcome, sourced
   from the runbook and the live closure evidence protocol.
3. Latest local artifact for this lane - filename count under
   `benchmark/runs/` matching the lane's filename markers. Best
   effort, not authoritative classification.
4. Primary runbook - the controlled retry checklist.
5. Supporting references - audits, protocols, taxonomy, and dev
   pages that pair with this lane.
6. Evidence required before next live attempt - DB row, worker log
   excerpt, screenshots, live-snapshot JSON, operator notes.
7. Safe hard stops - explicit denial wording.
8. What to inspect after run - reconcile DB vs log vs screenshots,
   classify against the operator failure taxonomy, decide if the
   next case is probe-recommended, cross-link the artifact bundle.
9. No-live CLI commands - exactly the synthetic template generator,
   the per-vertical analyzer, and the preflight test scripts. Each
   block is copy-ready.
10. Operator failure taxonomy classes used by this lane.
11. Source-of-truth reminder - DB + worker log + screenshots, not
    the task UI alone.

## When To Open This Page

Open `/dev/provider-closure` in any of these states:

- You are about to drive a controlled live retry on Resy, Expedia,
  or Booking.com and need the canonical evidence checklist + CLI
  commands in one screen.
- A live run just finished and you have raw evidence (DB row,
  worker log, screenshots) but no analyzer verdict yet.
- You are reviewing whether to patch provider code after a failure
  and want to confirm DB / log / screenshots agree before reaching
  for a code change.
- You are onboarding a new agent or operator and need a single page
  that explains what closure means per vertical.

## When Not To Open This Page

Use a more focused dashboard when:

- You need raw forensic classification of an artifact bundle ->
  `/dev/runtime-forensics`.
- You need a go/no-go verdict before burning a Resy live token ->
  `/dev/restaurant-readiness`.
- You need the founder demo readiness verdict before a YC demo ->
  `/dev/demo-readiness` or `/dev/demo-control-room`.

The closure cockpit is the workflow entry point. The forensic and
readiness dashboards are the deeper-detail screens it points to.

## War Room Loop

The Provider Closure War Room is the terminal no-live CLI layer for the
cockpit workflow. It converts one post-attempt bundle into:

1. `ProviderClosureEvidence` for restaurant, flight, or hotel.
2. War-room verdict:
   `live_closed_safe_boundary`,
   `live_blocked_provider_or_network`,
   `live_blocked_selector_or_dom`,
   `live_blocked_model_or_env`, `not_live_verified`, or
   `unsafe_or_disallowed_boundary`.
3. Root-cause recommendation.
4. Next single safe action.
5. Regression-test checklist.
6. Demo-readiness verdict.

Use it after DB row JSON, worker log excerpt, screenshot paths, live snapshot
paths, and operator notes have already been collected:

```powershell
npx tsx scripts/provider-closure-war-room.ts preflight --vertical restaurant
npx tsx scripts/provider-closure-war-room.ts preflight --vertical flight
npx tsx scripts/provider-closure-war-room.ts preflight --vertical hotel
npx tsx scripts/provider-closure-war-room.ts analyze --vertical <restaurant|flight|hotel> --bundle .tmp\<bundle>.json --markdown
```

The war-room CLI is read-only. It does not approve provider work, does not
open a browser, does not call OpenAI, does not read `.env.local`, does not
write booking state, and does not click anything.

Demo-readiness is intentionally stricter than classification. A synthetic
fixture can exercise `live_closed_safe_boundary`, but it still cannot claim a
vertical. A claim requires a non-synthetic, fresh, minimum-evidence artifact
with `liveAttempt: true`.

## Hard Rules For The Cockpit

These rules are enforced by static guards
(`lib/__tests__/docs-static-operator-pages.test.ts`):

- The page never advertises run, retry, live, start, resume,
  execute, or submit verbs as button labels or onClick handlers.
- The page does not issue a mutating fetch (POST/PUT/PATCH/DELETE)
  against any API.
- The page does not contain a `<form>` element.
- The page does not import `lib/live-operator-checklist/**`. If
  that sidecar is merged into the integrated preview, the cockpit
  links to `/dev/live-operator-checklist` via a runtime
  filesystem probe; otherwise the cockpit shows a placeholder note
  and the per-lane runbooks remain canonical.
- The page surfaces the explicit phrase "No live run is authorized
  by this page".
- The only mutating action is a `Refresh now` button that calls
  `router.refresh()` to re-render the server component.

## Workflow: Pre-Live

1. Open `/dev/provider-closure`.
2. Pick the lane that matches the founder-approved retry.
3. Read "Last known blocker" and confirm the next attempt is not a
   blind re-run of the same case (especially restaurant lane: do
   not re-run R-030; pick a probe-recommended case via
   `/dev/restaurant-readiness`).
4. Open the primary runbook link and follow its preflight checklist
   end to end.
5. Confirm the operator has the DB query, worker log grep, and
   screenshot path ready before any live command runs.
6. Confirm the safe hard stops apply.

## Workflow: Post-Run

1. Open `/dev/provider-closure` and pick the lane.
2. Read "Evidence required before next live attempt" and collect
   each item in order. The artifact bundle template is the
   normalized JSON shape.
3. Run the synthetic template generator from the lane's CLI block:

   ```powershell
   npx tsx scripts/create-artifact-bundle-template.ts --kind <restaurant|expedia|hotel>
   ```

4. Save to `.tmp/<kind>-artifact-bundle.json` and replace
   placeholders with copied evidence. Redact PII and secret values
   before continuing.
5. Run the analyzer from the lane's CLI block:

   ```powershell
   npx tsx scripts/analyze-provider-artifact.ts --kind <restaurant|expedia|hotel> .tmp\<kind>-artifact-bundle.json
   ```

6. Read "What to inspect after run" and reconcile DB vs worker log
   vs screenshots. If they disagree, the failure class is
   `insufficient_evidence`; collect more, do not patch.
7. Classify against the four-way operator taxonomy at
   `docs/30-provider-debug/FAILURE_TAXONOMY.md`. OpenAI Responses
   API 5xx is `model_env_transient`, not a provider regression.
8. Cross-link the analyzer output into the handoff before a patch
   decision.

## Cross-Links

| Surface | Purpose |
| --- | --- |
| `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` | Cross-vertical evidence order, DB fields, hard stops, classifications. The cockpit's lane manifest mirrors this protocol. |
| `docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` | Canonical per-vertical pass / fail / inconclusive closure criteria. Read this when deciding whether a closure attempt is closure-pass; the cockpit mirrors the partition. |
| `docs/30-provider-debug/FAILURE_TAXONOMY.md` | Four-way operator failure taxonomy used by every lane's "What to inspect after run" step. |
| `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` | Provider runtime debug source of truth. Cross-linked from each lane's supporting references. |
| `docs/90-archive/phase2-product-areas/LIVE_ARTIFACT_BRIDGE.md` | Synthetic template generator + bundle redaction protocol. The cockpit's CLI blocks reference these scripts. |
| `docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md` | Restaurant lane primary runbook. |
| `docs/90-archive/phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md` | Restaurant lane operator decision flow for `/dev/resy-run-analysis`. |
| `docs/90-archive/phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md` | Probe-first protocol for restaurant lane case selection. |
| `docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md` | Restaurant artifact analysis with R-030 evidence anchors. |
| `docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md` | Flight lane primary runbook. |
| `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` | Hotel lane primary runbook. |
| `docs/90-archive/phase2-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` | Phase 2 status anchor for flight + hotel lanes. |
| `docs/90-archive/phase2-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md` | Hotel vertical no-live audit. |
| `/dev/runtime-forensics` | Read-only artifact-based forensic classification across 8 categories. |
| `/dev/restaurant-readiness` | Restaurant lane go/no-go before live token spend. |
| `/dev/resy-probe-runs` | Restaurant lane probe runs surface. |
| `/dev/resy-run-analysis` | Restaurant lane post-run ladder analysis. |

## Update Protocol

When a lane's posture, blocker, or evidence requirement changes:

1. Update the canonical doc first
   (`LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`, the per-vertical runbook,
   or `PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`).
2. Mirror the change into `lib/provider-closure-room/lanes.ts`.
3. Run `npx vitest run lib/__tests__/provider-closure-room-lanes.test.ts lib/__tests__/provider-closure-room-loader.test.ts lib/__tests__/docs-static-operator-pages.test.ts` to verify the static guards still pass.
4. The cockpit picks up the change on next render.

## Out Of Scope

- DB live lookup. The cockpit reads only filesystem artifacts under
  `benchmark/runs/`. DB lookup is future Track A work.
- Worker control. The cockpit never starts a worker, never queues a
  job, never reads `worker/.debug-screenshots/` directly (the
  per-lane runbooks own that path).
- Mutation endpoints. The cockpit has no `/api/dev/provider-closure`
  POST. Refresh is `router.refresh()` only.
- Screenshot upload / paste UI. The artifact bundle template script
  is the canonical bridge, not a client-side paste form.
