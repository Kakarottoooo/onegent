# Artifact Corpus Inventory

Last updated: 2026-05-04

Scope: synthetic no-live fixtures used by Phase 0 restaurant artifact analysis
and Phase 2 Expedia/hotel retry analysis. This inventory is for local review,
tests, and handoff only. It does not authorize live provider runs, OpenAI live
calls, browser automation against providers, payment, CVV, OTP/CAPTCHA/login
bypass, or final confirmation.

## Sources

| Source | Domain | Path | Count |
|---|---:|---|---:|
| Restaurant artifact analyzer | restaurant | `lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/*.json` | 7 |
| Expedia retry analyzer | expedia | `lib/runtime-forensics/__fixtures__/expedia-retry-analysis/*.json` | 5 |
| Hotel retry analyzer | hotel | `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/*.json` | 8 |
| Runtime-forensics demo examples | mixed | `lib/runtime-forensics/__fixtures__/*.json` via `FIXTURE_FILENAMES` | 8 |

Total synthetic fixtures inventoried: 28.

## Domain And Class Counts

Generated with:

```powershell
npx tsx scripts/list-artifact-fixtures.ts
```

### Restaurant

Count: 10.

| Class | Count |
|---|---:|
| `opentable_form_incomplete` | 1 |
| `opentable_phone_otp_handoff` | 1 |
| `otp_or_login_required` | 1 |
| `provider_form_incomplete` | 1 |
| `provider_network_degraded` | 1 |
| `provider_no_availability` | 1 |
| `resy_modal_disabled_details_api_failed` | 1 |
| `resy_no_availability` | 1 |
| `resy_otp_login_boundary` | 1 |
| `safe_manual_review_reached` | 1 |

### Expedia

Count: 8.

| Class | Count |
|---|---:|
| `card_scan_failed_before_fallback` | 1 |
| `checkout_manual_review_reached` | 1 |
| `checkout_reached_manual_review` | 1 |
| `fallback_attempted_no_match` | 1 |
| `fallback_matched_no_checkout` | 1 |
| `legacy_shape_missing_source` | 1 |
| `network_provider_failure` | 1 |
| `unknown` | 1 |

### Hotel

Count: 10.

| Class | Count |
|---|---:|
| `guest_details_manual_review_reached` | 1 |
| `login_or_captcha_boundary` | 1 |
| `network_or_provider_5xx` | 1 |
| `network_provider_failure` | 1 |
| `payment_manual_review_reached` | 1 |
| `profile_gating` | 1 |
| `provider_form_incomplete` | 1 |
| `room_selection_drift` | 1 |
| `room_selection_manual_review_reached` | 1 |
| `safety_boundary_violation` | 1 |

## Guardrails

The corpus guard test is:

```text
lib/__tests__/artifact-fixture-corpus.test.ts
```

It asserts that each inventoried fixture has:

- a synthetic marker or fixture-style id;
- provider, scenario, and status metadata;
- no non-example email address or non-fixture E.164 phone number;
- no payment card number;
- no CVV/CVC/security-code value;
- no OTP, one-time-code, verification-code, or SMS-code value.

The fixtures may mention CVV, payment, OTP, CAPTCHA, login, phone verification,
or final confirmation as safe-boundary terms. They must not contain secret
values or represent real evidence.

## Review Use

Use this inventory before adding or changing analyzer fixtures:

1. Add the synthetic fixture under the matching analyzer directory, or add the
   legacy runtime-forensics example to `FIXTURE_FILENAMES`.
2. Include fixture-style ids such as `fixture-...`.
3. Include provider, scenario, and status.
4. Keep all person, contact, payment, and challenge data synthetic or omitted.
5. Run:

```powershell
npx vitest run lib/__tests__/*fixture*.test.ts lib/__tests__/*artifact*.test.ts
npx tsx scripts/list-artifact-fixtures.ts
```

If the helper output changes, update this document and
`docs/10-coordination/goal.md` in the same branch.
