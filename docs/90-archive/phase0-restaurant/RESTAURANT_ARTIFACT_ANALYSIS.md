# Restaurant Artifact Analysis

Last updated: 2026-05-05

Scope: no-live artifact classification for Phase 0 restaurant evidence bundles
from Resy and OpenTable. This document prepares review of already-collected
DB/log/screenshot evidence. It does not authorize live provider runs, OpenAI
calls, payment, OTP/CAPTCHA/login bypass, or final confirmation.

## Triage Order: Classify Before You Analyze

Before running the restaurant artifact analyzer below, classify the failure
against the four-way operator taxonomy in
`docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md`. The analyzer only fires usefully
on a `provider_logic_failure`. If the run actually died at planning time with
an OpenAI 5xx, or if the provider site itself was network-degraded, the
analyzer will return `insufficient_evidence` and the correct response is to
wait and re-run the same case, not to patch a Resy/OpenTable selector.

The 2026-05-04 R-030 Resy live run is a worked example of why this matters:
the run never reached Resy and is classified as `model_env_transient`
(OpenAI Responses API 500). It is not a Resy fill/OTP regression and must
not be treated as one.

The 2026-05-05 R-030 retry is a second worked example in the same class.
It died in nine seconds with OpenAI Responses API 403
`model_not_found`. The founder later confirmed the intended OpenAI
project has `gpt-5.5` access and budget, so this points to a runtime
env/project mismatch in the Claude worktree (wrong/stale project key
or inherited env), not global model access loss. The browser opened
the exact Resy venue URL but no provider decision was made:
`decisionLog` is `null`. Classification remains
`model_env_transient` / `F-INFRA-MODEL-ACCESS`; the closure outcome is
**inconclusive**, not closure pass and not closure fail. The
`422abe0` Resy recovery patches (skip duplicate fallback, preserve
exact venue URL, reject bare time controls, separate listing-stall
from `F-AVAIL-NONE`) remain unvalidated by this run because none of
them executed. Evidence:

- Task `caa90661-ceb1-4753-aedc-be6282322a62`
- Job `f66f9e63-d2d0-43fe-940b-8fc0329ca5ef`
- Report `benchmark/runs/phase0-resy-2026-05-05T02-08-50-530Z.json`
- DB `__source` marker: `lib/core/execution-local-c2110aa34d` (M5
  gate stamped correctly)
- DB `handoff_url`: exact venue URL preserved
  (`https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=2000`)
- DB `decisionLog`: `null`
- Lifetime: 9 seconds (created 02:08:36 -> error 02:08:45)

Safety boundary observation: no payment, CVV, OTP, SMS, phone
verification, CAPTCHA, login bypass, or final confirmation was
touched. The browser opened the public Resy venue URL only and made
no automation interaction before the OpenAI 403 fired.

Next safe step (founder-only): install/verify the intended
`gpt-5.5`-enabled runtime env for the worktree and pass a no-provider
model-access preflight. Only after that, founder may explicitly
approve exactly one new R-030 attempt.

The 2026-05-05 Sirrah OpenTable dogfood is the accepted Phase 0A
positive worked example. It reached the OpenTable final review page,
filled the phone number, and stopped before the final
`Complete reservation` button. Evidence:

- Job `3bbe2ac4-c4cd-409f-8c11-6a83d2f81485`
- Session `6a5946f9-48ae-487c-a443-ccc78c6327f2`
- Request: Sirrah, New York, `2026-05-14`, `20:00`, 1 person
- DB `booking_jobs.status`: `done`
- DB `steps[0].status`: `awaiting_confirmation`
- DB `steps[0].handoff_url`: OpenTable `/booking/details?...`
- Agent logs `2782`-`2785`; final message:
  "Reservation form filled for Sirrah. Open the link to confirm."
- Local snapshot:
  `%LOCALAPPDATA%\Onegent\snapshots\live\3bbe2ac4-c4cd-409f-8c11-6a83d2f81485\1777965439235-4c4a06.json`
- Founder screenshot: Sirrah Thu May 14, 8:00 PM, 1 person, phone filled,
  final `Complete reservation` visible but not clicked

Classification: `safe_manual_review_reached` / `safe_handoff`. This closes
Phase 0A through OpenTable. It does not validate Resy, but Resy is now a
provider/network/IP follow-up lane rather than the Phase 0A gate.

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
