# Restaurant Artifact Analysis

Last updated: 2026-05-04

Scope: no-live artifact classification for Phase 0 restaurant evidence bundles
from Resy and OpenTable. This document prepares review of already-collected
DB/log/screenshot evidence. It does not authorize live provider runs, OpenAI
calls, payment, OTP/CAPTCHA/login bypass, or final confirmation.

## Safety Boundary

Hard stops:

- No live provider run from this workflow.
- No OpenAI live call from this workflow.
- No payment submission or CVV entry.
- No OTP, CAPTCHA, login, phone verification, or account-check bypass.
- No final booking, reserve, purchase, or confirmation click.

## What The Analyzer Does

The analyzer reads a local JSON bundle assembled by the operator from existing
evidence:

- DB row / `booking_jobs.steps[0]` fields.
- Bounded worker log or benchmark-runner excerpt.
- Provider screenshot paths.
- Live snapshot paths.
- Operator notes.

It prints paste-ready Markdown with one restaurant artifact state, matched
signals, artifact paths, and the next no-live action.

It does not read the database, open browsers, start workers, invoke providers,
or call OpenAI.

## Covered Classes

| State | Meaning | Patch posture |
|---|---|---|
| `resy_modal_disabled_details_api_failed` | Resy selected slot but details API or reservation modal failed/disabled. | Patch only after DB/log/screenshot evidence confirms this exact layer. |
| `resy_otp_login_boundary` | Resy login, OTP, email/SMS code, or phone verification boundary. | Accept as safe boundary; do not bypass. |
| `resy_no_availability` | Resy returned no target-window slots / `F-AVAIL-NONE`. | Correct only with probe/artifact support; choose probe-positive case for fill closure. |
| `opentable_phone_otp_handoff` | OpenTable phone verification / OTP handoff reached. | Safe handoff; keep browser for human review and do not click final confirmation. |
| `opentable_form_incomplete` | OpenTable guest/contact form remains incomplete. | Patch only after screenshot confirms expected fields were visible and unfilled. |
| `provider_network_degraded` | 5xx, gateway timeout, TCP error, `net::ERR_*`, rate-limit, or provider unavailable. | Do not patch selectors from network evidence alone. |
| `safe_manual_review_reached` | Ready-for-confirmation, ready-to-review, safe handoff, or manual review boundary reached. | Count as safe Phase 0 progress while preserving the hard stop. |
| `insufficient_evidence` | No known restaurant artifact signals found. | Collect DB/log/screenshots/live snapshots before patching. |

## Bundle Shape

Create a local JSON bundle from evidence that already exists:

```json
{
  "job": {
    "id": "<job-id>",
    "taskId": "<task-id>",
    "provider": "resy",
    "scenario": "R-030",
    "status": "<booking_jobs.status>",
    "errorMessage": "<top-level or step error>",
    "terminalReason": "<step terminalReason if present>",
    "terminalCode": "<step terminalCode if present>",
    "steps": [
      {
        "type": "restaurant",
        "status": "<steps[0].status>",
        "error": "<steps[0].error>",
        "terminalReason": "<steps[0].terminalReason if present>",
        "terminalCode": "<steps[0].terminalCode if present>",
        "__source": "<steps[0].body.__source or step.__source>"
      }
    ],
    "params": "<copy steps[0].body.params>"
  },
  "dbRow": "<optional raw booking_jobs row>",
  "workerLogExcerpt": "<bounded Select-String output from codex-worker.log or benchmark runner>",
  "workerLogPath": "C:\\Users\\Gzw19\\onegent-e2e-20260503\\codex-worker.log",
  "screenshotPaths": [
    "C:\\Users\\Gzw19\\onegent-e2e-20260503\\worker\\.debug-screenshots\\<provider-run>"
  ],
  "liveSnapshotPaths": [
    "C:\\Users\\Gzw19\\onegent-e2e-20260503\\.debug-screenshots\\live\\<job-id>\\*.json"
  ],
  "notes": [
    "No live provider run was started by the analyzer."
  ]
}
```

## Usage

From the active worktree after an artifact bundle has been assembled:

```powershell
npx tsx scripts/analyze-restaurant-artifact.ts .tmp\restaurant-artifact-bundle.json
```

Unified artifact CLI equivalent:

```powershell
npx tsx scripts/analyze-provider-artifact.ts --kind restaurant .tmp\restaurant-artifact-bundle.json
```

The output is paste-ready Markdown. Paste it into
`docs/10-coordination/goal.md` or the current handoff before deciding whether a
runtime/provider patch is justified.

CLI validation behavior:

- Missing file: non-zero exit with missing path.
- Invalid JSON: non-zero exit with parse error.
- Empty JSON object: non-zero exit.
- Unknown but valid bundle: Markdown output with `insufficient_evidence`.

## Synthetic Fixtures

Synthetic no-live fixtures live under:

```text
lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/
```

They are not live evidence. They exist to pin the classifier and CLI behavior
for known Phase 0 restaurant failure classes.

## Patch Rule

Do not patch from the task card alone. Patch only after comparing:

1. DB row and step shape.
2. Worker log lines or benchmark runner excerpt.
3. Provider screenshots.
4. Live snapshot JSON when present.
5. Restaurant artifact analysis output.

If the analyzer returns `insufficient_evidence`, collect more evidence instead
of patching or retrying.
