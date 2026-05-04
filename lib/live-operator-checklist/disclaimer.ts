// Live operator checklist - disclaimers and shared safety language.
//
// This module is intentionally tiny. It locks the wording the page must
// display so that the UI cannot drift away from "no live run is authorized
// by this page" or omit the cross-cutting hard stops. Tests pin these
// strings.

export const NO_LIVE_AUTHORIZATION_NOTICE =
  "No live run is authorized by this page. This is a read-only checklist " +
  "that prepares the evidence path. A controlled live retry still needs " +
  "explicit founder approval for that exact run.";

export const PRE_RUN_REQUIREMENTS: ReadonlyArray<string> = Object.freeze([
  "The founder has explicitly approved exactly one controlled retry for one provider/case.",
  "Worktree is C:\\Users\\Gzw19\\onegent-integrated-20260504.",
  "Branch is codex/integrated-preview-20260504 (latest pushed integrated head).",
  "npm run check-drift passes.",
  "App and worker read the same .env.local / Neon database.",
  "Worker writes logs to codex-worker.log in the active worktree (or the alternate path is recorded).",
  "USE_WORKER_FOR includes the relevant scenario if that env var is present.",
  "No broad provider suite, batch, retry loop, cron, or dashboard automation is scheduled.",
  "Operator is ready to stop on login, OTP, CAPTCHA, CVV, payment, account-sensitive prompt, or final confirmation.",
]);

export const CROSS_PROVIDER_HARD_STOPS: ReadonlyArray<string> = Object.freeze([
  "OTP, one-time code, SMS, phone verification, or email verification.",
  "CAPTCHA or bot challenge.",
  "Provider login or account-sensitive prompt.",
  "CVV, card number, payment review, or payment submit.",
  "Final booking, final purchase, final reservation, or any irreversible confirmation.",
  "Wrong provider option, wrong date, wrong time, wrong party size, or wrong price selected.",
  "Provider leaves the expected public path (search, details, guest form, checkout).",
]);

export const POST_RUN_REPORT_FIELDS: ReadonlyArray<string> = Object.freeze([
  "Retry job id (booking_jobs.id) plus task_id.",
  "DB row snapshot (status, terminalReason, terminalCode, decisionLog tail, params).",
  "Bounded worker log excerpt (Select-String -Last 200, with -Context 2,3).",
  "Provider screenshot directory and the most relevant frames.",
  "Live snapshot JSON path(s) for the same job id.",
  "Analyzer Markdown output (paste-ready) and the analyzer state it returned.",
  "One-line conclusion: safe boundary reached / patchable failure / non-patch defer / safety failure.",
]);

export const FORBIDDEN_BUTTONS: ReadonlyArray<string> = Object.freeze([
  "No 'Run live' button.",
  "No 'Retry' button.",
  "No 'Re-run' or 'Re-attempt' button.",
  "No 'Bypass OTP' / 'Bypass CAPTCHA' / 'Skip login' control.",
  "No 'Submit payment' or 'Confirm reservation' control.",
  "No automation, cron, or polling loop driven from this page.",
]);
