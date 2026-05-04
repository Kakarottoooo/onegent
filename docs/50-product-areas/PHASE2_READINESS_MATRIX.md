# Phase 2 Readiness Matrix

Last updated: 2026-05-04

Scope: no-live Phase 2 revival readiness for flights and hotels on
`codex/goal-phase2-no-live-revival`, based on artifacts, fixtures, and docs
only. This file does not authorize live provider runs.

## Safety Boundary

Hard stops:

- No payment submission.
- No CVV entry.
- No OTP, CAPTCHA, login, or account-check bypass.
- No final booking or purchase confirmation.
- No live provider retry without explicit founder approval for that exact run.

## Matrix

| Vertical | Provider | Current readiness | No-live evidence | Analyzer coverage | Controlled retry gate | Demo posture |
|---|---|---|---|---|---|---|
| Flight | Expedia | Candidate for one approved controlled retry | Current audit, controlled retry runbook, existing Expedia retry fixtures | `lib/runtime-forensics/expedia-retry-analysis.ts` covers card-scan fallback, checkout/manual review, and network/provider failure classes | Founder approval for one MCO to BNA retry, current integrated branch, drift check pass, DB/log/screenshot capture plan | Demo-adjacent only as a bonus; main demo remains Phase 1 |
| Hotel | Booking.com | Artifact-ready, not live-ready | Synthetic Booking.com fixtures cover room selector drift, guest-details reached, profile gating, login/CAPTCHA boundary, network/provider failure, and safety-stop negative case | `lib/runtime-forensics/hotel-retry-analysis.ts` classifies hotel artifact bundles without live provider access | Fresh artifact bundle first; then one approved hotel retry only if profile and safety gates are clean | Do not promise live hotel demo until fresh safe handoff evidence exists |
| Hotel | Hotels.com | Secondary hotel path, not independently proven | Synthetic Hotels.com fixture covers payment/manual-review reached | Same hotel analyzer covers Expedia Group hotel checkout/manual-review signals | Use only after Booking.com has a current artifact baseline or founder explicitly changes scope | Treat as fallback compatibility, not a separate Phase 2 promise |

## Readiness Definitions

`Candidate for one approved controlled retry` means the branch has enough
no-live evidence and analyzer coverage to make a single future human-approved
provider run reviewable. It does not mean live reliability is proven.

`Artifact-ready` means the provider has a pure artifact bundle shape, fixtures,
tests, and runbook instructions. It still needs a real DB/log/screenshot bundle
before any runtime patch or demo promise.

`Not live-ready` means the next action is evidence collection and classification,
not runtime expansion.

## Known Failure Classes Covered

Flight:

- `card_scan_failed_before_fallback`
- `fallback_attempted_no_match`
- `fallback_matched_no_checkout`
- `checkout_manual_review_reached`
- `network_provider_failure`
- `insufficient_evidence`

Hotel:

- `room_selection_drift`
- `guest_details_manual_review_reached`
- `payment_manual_review_reached`
- `login_or_captcha_boundary`
- `profile_gating`
- `network_provider_failure`
- `safety_boundary_violation`
- `insufficient_evidence`

## Operator Rule

Patch only after the artifact bundle has DB row fields, worker log excerpts,
provider screenshot paths, and live snapshot paths. If the analyzer returns
`insufficient_evidence`, collect more evidence instead of patching.

Use:

```powershell
npx tsx scripts/analyze-phase2-artifact.ts flight <bundle.json>
npx tsx scripts/analyze-phase2-artifact.ts hotel <bundle.json>
```

The analyzer script reads only local JSON bundles and prints Markdown. It does
not read the database, start a worker, open a browser, or invoke a provider.
