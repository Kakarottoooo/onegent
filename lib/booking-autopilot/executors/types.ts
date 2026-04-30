/**
 * Thin executor interface (Phase 2).
 *
 * Goal: define the seam Phase 3 will use to swap / sequence executors
 * (Stagehand → DeepLink fallback → MCP v2 → eventually Skyvern / browser-use)
 * WITHOUT refactoring the existing 5500-line stagehand-executor.ts. For now
 * we only have two implementations (StagehandExecutor wrapping the existing
 * browser flow, and DeepLinkExecutor producing a handoff URL); the
 * orchestration in /start still calls runBrowserTask directly. Phase 3 will
 * introduce a router that picks an executor by capability.
 *
 * Why a separate types module: keeps the contract dependency-free so future
 * executors can implement it without pulling in Playwright / Stagehand.
 */

import type { BrowserTaskInput } from "../types";
import type { JobConstraints } from "../../booking-jobs/types";

// ─── Inputs / outputs ───────────────────────────────────────────────────────

export interface ExecutorInput {
  /**
   * Browser-flavoured task input (URL, task NL, profile, etc). Optional:
   * the DeepLinkExecutor doesn't need a browser — it builds a URL from
   * constraints alone.
   */
  browserTask?: BrowserTaskInput;
  /**
   * Structured task constraints. Phase 1 introduced these on booking_jobs
   * — DeepLinkExecutor reads them; StagehandExecutor passes them through
   * to provider helpers via browserTask.autonomySettings (already wired
   * in Phase 0/3 commit).
   */
  constraints?: JobConstraints;
}

export interface ExecutorCapability {
  can: boolean;
  /** Human-readable explanation when can = false. */
  reason?: string;
}

/** Normalised across executors so a router can compare outcomes uniformly. */
export type ExecutorStatus =
  | "completed"        // booking confirmed end-to-end
  | "paused_payment"   // form filled, waiting on user CVC
  | "handoff_ready"    // executor produced a URL the user should follow
  | "no_availability"  // confirmed empty; do not retry
  | "needs_login"      // site demands a real account
  | "captcha"          // bot detection blocked the run
  | "error";           // unexpected failure

export interface ExecutorResult {
  status: ExecutorStatus;
  /** Where the user can continue on success or handoff. */
  handoff_url?: string;
  /** Short, user-facing message — surfaced in actionItem / handoff cards. */
  message?: string;
  /** Internal reason, e.g. "automatic_booking_blocked_by_payment". */
  reason?: string;
  /** Optional debug trace for benchmark / analytics. */
  debugTrace?: string[];
}

// ─── Verification (forward-looking — Phase 4 will populate this) ────────────

export interface VerificationInput {
  result: ExecutorResult;
  constraints?: JobConstraints;
}

export interface VerificationResult {
  ok: boolean;
  /** Free-form notes — e.g. "verified: confirmation email seen". */
  notes?: string;
}

// ─── The contract ───────────────────────────────────────────────────────────

export interface BookingExecutor {
  /** Stable identifier — appears in logs / decisionLog / analytics. */
  name: string;
  /** Can this executor handle the input? Cheap check, no side effects. */
  canHandle(input: ExecutorInput): Promise<ExecutorCapability>;
  /** Actually run. Should return cleanly even on error (status="error"). */
  run(input: ExecutorInput): Promise<ExecutorResult>;
  /** Optional post-hoc verification. Phase 4 hook. */
  verify?(input: VerificationInput): Promise<VerificationResult>;
}
