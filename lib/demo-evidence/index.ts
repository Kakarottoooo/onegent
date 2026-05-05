/**
 * Demo evidence helper.
 *
 * Read-only aggregation for `/dev/demo-readiness`.
 *
 * Sources:
 *   - benchmark/runs/phase1-quality-gate-*.json
 *   - benchmark/runs/founder-e2e-*.json
 *   - artifact-based runtime-forensics summaries
 *   - static docs/runbook existence checks
 *
 * Hard boundary: no DB, no provider, no worker, no live runner,
 * no payment, no OTP, no CAPTCHA, no final confirmation.
 */

export * from "./readiness";
