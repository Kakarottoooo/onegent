# Activity Skill Lab Runbook

Last updated: 2026-05-10

This is the compact Stage 0B runbook for controlled Browser Harness activity
provider labs and reviewed skill patch proposals. It replaces the older split
Ticketmaster/SeatGeek lab runbook and patch proposal template document.

Read `docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md` first for the
strategy and runtime contract.

This document does not approve live provider work. It describes the evidence
shape and safe boundaries for a separately approved, scoped lab run.

## Lab Scope

The activity provider skill lane covers:

1. Ticketmaster
2. SeatGeek
3. StubHub
4. Eventbrite
5. AXS

The controlled lab answers four questions per URL:

1. Does the URL resolver classification match the rendered provider page?
2. Can the browser reach a safe boundary without crossing a hard stop?
3. Did the provider surface structural drift that should become a reviewed
   patch?
4. Is the evidence complete enough to reproduce and review the result?

## Hard Stops

The lab must halt before:

- Login or sign-in wall.
- CAPTCHA or bot challenge.
- OTP, phone verification, or email verification.
- Seat selection or ticket quantity selection.
- Payment form, card fields, CVV, CVC, or billing submission.
- Final purchase, reserve, order, or confirmation button.
- Cookie consent that blocks render and cannot be dismissed safely.
- Browser Harness error, disconnect, or ambiguous page state.

## Evidence Output

Each run writes local evidence under `.stage0b-evidence/<run_id>/`:

```text
events.jsonl
result.json
screenshots/
```

`events.jsonl` records navigation, inspection, screenshot, safe-link follow, and
hard-stop events. `result.json` stores an `L2RecoveryResult` with:

- provider
- input URL and final URL
- final page type
- classification
- safe next action
- screenshot paths
- visible facts
- hard stops
- optional reviewed `skill_patch_proposal`

The pure TypeScript schema lives in `lib/stage0b-skill-runtime/`.

## Classifications

| Classification | Safe next action |
| --- | --- |
| `exact_event_ready` | `start_task` |
| `single_candidate_ready` | `start_task` |
| `provider_listing_needs_choice` | `ask_user_choice` |
| `safe_handoff_reached` | `user_handoff_required` |
| `user_seat_selection_required` | `user_handoff_required` |
| `account_session_required` | `user_handoff_required` |
| `payment_or_final_action_required` | `user_handoff_required` |
| `provider_degraded` | `review_capture` |
| `insufficient_evidence` | `review_capture` |
| `skill_patch_needed` | `review_patch_proposal` |

## Run Procedure

Pre-flight the no-live plan:

```powershell
npx tsx scripts/stage0b-activity-skill-lab.ts --check
```

Run a scoped live lab only after explicit approval:

```powershell
npx tsx scripts/stage0b-activity-skill-lab.ts --live --provider ticketmaster --limit 1
npx tsx scripts/stage0b-activity-skill-lab.ts --live --provider seatgeek --limit 1
npx tsx scripts/stage0b-activity-skill-lab.ts --live --plan ticketmaster-forge --id tmf-01
```

Close provider/browser tabs after a case unless the tab is still needed for
active debugging.

Ingest local evidence:

```powershell
npx tsx scripts/stage0b-activity-lab-report.ts --json
npx tsx scripts/stage0-operator-report.ts --json --activity-lab-evidence-root .stage0b-evidence
```

## Patch Proposal Contract

A lab may propose a patch, but it must never edit production files. A patch
proposal is reviewed by Codex or a side agent, converted into a no-live test,
then patched and rerun only for the affected case.

Required fields:

- `kind`: `selector_drift`, `page_flow_change`, `new_page_type`,
  `stricter_safe_handoff`, or `host_pattern_extension`
- `observed_evidence`
- `patch_target`
- `proposed_change`
- `risk`: `low`, `medium`, or `high`
- `evidence_event_seqs`

Example:

```json
{
  "kind": "selector_drift",
  "observed_evidence": "Visible event cards rendered, but candidate extraction returned zero candidates.",
  "patch_target": "lib/stage0b-skill-runtime/lab-runner.ts",
  "proposed_change": "Add a provider-specific card selector behind a no-live fixture.",
  "risk": "medium",
  "evidence_event_seqs": [2, 3]
}
```

High-risk proposals that relax a hard stop are forbidden in Stage 0B without a
separate explicit approval.

## Historical Sources

The longer source docs that fed this compact runbook are archived under
`docs/90-archive/provider-debug/`:

- `STAGE0B_TM_SEATGEEK_LAB.md`
- `STAGE0B_PATCH_PROPOSAL_TEMPLATES.md`
