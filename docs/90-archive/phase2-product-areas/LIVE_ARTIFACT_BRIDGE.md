# Live Artifact Bridge

Last updated: 2026-05-04

Scope: no-live bridge from already-collected post-live evidence into the
normalized JSON bundle shape consumed by the restaurant, Expedia, and hotel
artifact analyzers. This bridge does not authorize live provider runs, OpenAI
live calls, browser automation, payment/CVV handling, OTP/CAPTCHA/login bypass,
or final confirmation.

## What This Adds

The bridge is a local template generator:

```powershell
npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant
npx tsx scripts/create-artifact-bundle-template.ts --kind expedia
npx tsx scripts/create-artifact-bundle-template.ts --kind hotel
```

It prints a synthetic JSON bundle template to stdout. The operator can save the
output locally and replace placeholders with copied evidence after a
founder-approved live run has already completed.

The script does not:

- read the database;
- read `.env.local`;
- open a browser;
- start a worker;
- navigate a provider;
- call OpenAI;
- write a file;
- click payment, CVV, OTP/CAPTCHA/login, or final confirmation controls.

## Normalized Bundle Shape

Each generated template includes placeholders for:

- job id;
- task id;
- provider;
- scenario;
- status;
- params;
- step error;
- decisionLog;
- workerLogExcerpt;
- workerLogPath;
- screenshotPaths;
- liveSnapshotPaths;
- notes.

All templates also include:

```json
{
  "synthetic": true,
  "templateId": "synthetic-<kind>-artifact-bundle-template",
  "templateKind": "<kind>"
}
```

These markers make the template safe to distinguish from real evidence until
every placeholder has been replaced by an operator.

## Workflow

1. Obtain explicit founder approval before any live provider retry. This bridge
   does not grant that approval.
2. After the live run is complete, collect the DB row, bounded worker log
   excerpt, screenshot paths, live snapshot paths, and operator notes.
3. Generate the matching template:

   ```powershell
   npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant > .tmp\restaurant-artifact-bundle.json
   ```

4. Replace placeholders with already-collected evidence. Redact any personal
   data or secret values before saving the bundle.
5. Run the matching no-live analyzer:

   ```powershell
   npx tsx scripts/analyze-provider-artifact.ts --kind restaurant .tmp\restaurant-artifact-bundle.json
   npx tsx scripts/analyze-provider-artifact.ts --kind expedia .tmp\expedia-retry-artifact-bundle.json
   npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\hotel-retry-artifact-bundle.json
   ```

6. Paste the analyzer output into the current handoff before deciding whether a
   patch is justified.

## Safety And Redaction

Before running an analyzer on a filled bundle, verify:

- no real email address, phone number, address, or profile data is present;
- no payment card number is present;
- no CVV/CVC/security-code value is present;
- no OTP, one-time-code, SMS-code, phone-verification, or CAPTCHA value is
  present;
- no login bypass, account-sensitive bypass, payment submission, or final
  confirmation action is recorded as an automated action.

Safe-boundary terms may appear as descriptions, but secret values must not be
included.

## Analyzer Behavior

Fresh templates are intentionally signal-free. The current analyzers accept the
template JSON and classify it as `insufficient_evidence`.

Once placeholders are replaced, the analyzer state should come from the copied
DB/log/screenshot evidence, not from the task UI summary. If a filled bundle
still returns `insufficient_evidence`, collect more evidence before patching or
retrying.

## Review Guard

The template guard test is:

```text
lib/__tests__/artifact-bundle-template.test.ts
```

It verifies that every generated template:

- contains the required bridge fields;
- contains no real PII or secret values;
- is accepted by the current analyzer for that domain;
- classifies as `insufficient_evidence` until real evidence replaces the
  placeholders.
