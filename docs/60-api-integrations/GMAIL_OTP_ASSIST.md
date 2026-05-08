# Gmail OTP Assist v1

Status: Stage 0B scoped implementation
Last updated: 2026-05-08

Gmail OTP Assist exists to let Onegent continue provider login only when the
user has explicitly connected Gmail for this purpose. It is separate from the
existing Google Calendar connection.

## Scope

Allowed:

- request `https://www.googleapis.com/auth/gmail.readonly` through the
  `/api/gmail/google/connect` consent flow,
- store Gmail OAuth tokens in `gmail_connections` with server-side encryption,
- search recent provider-scoped messages only,
- extract a one-time provider login code for the active task,
- pass `gmailOtp: true` into the activity skill-forge checkpoint policy.

Disallowed:

- using Calendar OAuth tokens for Gmail,
- broad mailbox search,
- reading unrelated email,
- using old OTP messages outside the task window,
- logging message bodies, snippets, or OTP codes as evidence,
- solving CAPTCHA,
- filling CVV,
- submitting payment,
- clicking final confirmation.

## Endpoints

```text
GET  /api/gmail/google/connect
GET  /api/gmail/google/callback
GET  /api/gmail/google/status
POST /api/gmail/google/disconnect
```

These routes mirror the Calendar OAuth shape but write to `gmail_connections`,
not `calendar_connections`.

## Provider OTP Flow

```text
provider login shows OTP checkpoint
-> skill forge detects otp_checkpoint
-> Gmail OTP Assist builds provider-scoped query
-> Gmail API searches recent messages from that provider
-> extractor returns a six-digit code only if provider + time window + OTP text match
-> skill forge emits use_authorized_gmail_otp
```

Initial provider support:

- Ticketmaster
- Resy
- OpenTable

The Gmail query is intentionally narrow. For example, Ticketmaster uses a query
similar to:

```text
newer_than:15m (from:ticketmaster OR from:ticketmaster.com) ("verification code" OR "one-time code" OR "security code" OR OTP OR login OR signin)
```

## Code Ownership

- OAuth/API client: `lib/google-gmail.ts`
- Encrypted token storage: `lib/gmail-db.ts`
- OTP extraction: `lib/gmail-otp.ts`
- Runtime lookup: `lib/gmail-otp-service.ts`
- Ticketmaster skill bridge:
  `lib/activity-skills/ticketmaster-gmail-otp.ts`

## Stage 0B Rule

This is an authorized assist path, not a proof of provider closure. A provider
run still needs screenshot/action-log/current-URL evidence and must stop at
CAPTCHA, seat selection, CVV, payment submit, and final confirmation.
