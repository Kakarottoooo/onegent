/**
 * Provider Closure Operator Room - public types.
 *
 * The /dev/provider-closure cockpit organizes restaurant, flight, and
 * hotel closure work into a single read-only screen. Types here are
 * structural only; the static manifest lives in `./lanes.ts` and the
 * artifact-graceful loader lives in `./loader.ts`.
 *
 * Pure types - no fs, no LLM, no DB, no live provider.
 */

import type { ProviderClosureTerminalOutcome } from "@/lib/provider-closure/schema";

export type { ProviderClosureTerminalOutcome };

export type ProviderLaneId =
  | "restaurant"
  | "flight"
  | "hotel";

/**
 * Severity tone used by the cockpit to color-code each lane and
 * each block. Locked vocabulary so the static guard can verify
 * tone strings without scanning free text.
 */
export type LaneTone = "warn" | "neutral" | "good" | "bad";

/**
 * One canonical doc/runbook/test reference for a lane. The cockpit
 * renders these as plain links - never as fetch calls.
 */
export interface LaneReference {
  label: string;
  /** File path under repo root, or absolute https doc URL. */
  ref: string;
  kind: "runbook" | "doc" | "module" | "test" | "page";
}

/**
 * A single bullet shown under "Evidence required before next live
 * attempt". Ordered. Each entry must point at a concrete artifact
 * shape - never at task UI copy.
 */
export interface EvidenceRequirement {
  /** Short label (e.g. "DB row for the booking job"). */
  label: string;
  /**
   * One-sentence "what to extract" hint for an operator. Must be
   * ASCII-only. Should mention the source-of-truth path or signal.
   */
  detail: string;
}

/**
 * One CLI command block the operator can copy. The page renders
 * these as `<pre>` copy-blocks. Never embed payment/CVV/OTP/CAPTCHA
 * values in these strings.
 */
export interface CliCommandBlock {
  /** Heading label, e.g. "Generate artifact bundle template". */
  label: string;
  /**
   * The exact command. Multi-line allowed. Must not run a live
   * provider, browser session, OpenAI call, payment, OTP, CAPTCHA,
   * login bypass, or final confirmation.
   */
  command: string;
  /** Why this command, when to use it. */
  description: string;
}

/**
 * One "what to inspect after run" bullet. Used to surface the
 * post-run review steps the operator must take before deciding to
 * patch or retry.
 */
export interface InspectAfterRun {
  label: string;
  detail: string;
}

/**
 * Per-lane safe hard stops. Wording is intentionally negation-heavy
 * ("never bypass...", "stop before...") so the docs static guard
 * recognizes denial context and does not flag them as live-action
 * advertising.
 */
export interface HardStop {
  /** Short hard-stop label. */
  label: string;
  /** ASCII-only. Must contain a denial verb (never / do not / stop). */
  detail: string;
}

/**
 * The "next single allowed action" the operator may take. The
 * cockpit renders exactly one of these per lane so an operator
 * cannot misread the current closure state as "ready for any
 * action". The action MUST be a non-mutating, inspection-only,
 * generation-only, or read-only verb.
 */
export interface NextAllowedAction {
  /** Short imperative label (under ~48 chars). ASCII-only. */
  label: string;
  /** One sentence detail. Must include a denial verb when it
   * describes a state where the operator must wait. */
  detail: string;
  /** Optional doc / page / script reference for the action. */
  ref?: string;
}

/**
 * One static lane definition. Three exist: restaurant, flight,
 * hotel. The operator cockpit composes this with the live
 * artifact loader to render the lane card.
 */
export interface ProviderLane {
  id: ProviderLaneId;
  displayName: string;
  /** Lowercase provider key for cross-dashboard pointers. */
  providerKey: string;
  /**
   * Locked false until provider closure has been live-verified
   * for this vertical AND the manifest is updated by a separate
   * branch with founder approval. The static guard fails if any
   * lane silently flips to true without an accompanying
   * acceptance-doc evidence section.
   */
  liveVerified: false;
  /**
   * One-paragraph "what closure looks like for this lane" rationale.
   * Defines what an accepted safe outcome is.
   */
  closurePosture: string;
  /**
   * Last known blocker text. Sourced from the closure protocol +
   * runbook. The cockpit shows this even when no fresh artifact
   * exists, since it is the operator's anchor for "what to fix
   * next".
   */
  lastKnownBlocker: string;
  /** Latest runbook / playbook the operator should follow. */
  primaryRunbook: LaneReference;
  /** Additional canonical references (taxonomy, evidence protocol, audits). */
  supportingReferences: LaneReference[];
  /** Ordered list of evidence the operator must collect before any next live attempt. */
  evidenceRequired: EvidenceRequirement[];
  /** Per-lane hard stops. */
  hardStops: HardStop[];
  /**
   * Closure-acceptance partition. The 8-state taxonomy in
   * `lib/provider-closure/schema.ts` MUST be partitioned across
   * these three buckets without overlap and without omission.
   * The static guard verifies this invariant.
   */
  safeTerminalStates: ProviderClosureTerminalOutcome[];
  failureTerminalStates: ProviderClosureTerminalOutcome[];
  inconclusiveTerminalStates: ProviderClosureTerminalOutcome[];
  /**
   * The single next action the operator may take from this lane
   * right now. Must be a non-mutating verb (inspect / read / open
   * / generate / paste). Static guard rejects retry / run / live
   * / start / resume / execute / submit verbs.
   */
  nextSingleAllowedAction: NextAllowedAction;
  /** "What to inspect after run" bullets. */
  inspectAfterRun: InspectAfterRun[];
  /** CLI command blocks for the operator to copy. */
  cliCommands: CliCommandBlock[];
  /**
   * Failure-classification keys (from
   * `lib/operator-failure-taxonomy`) that this lane commonly hits.
   * The cockpit cross-renders the matching taxonomy categories.
   */
  taxonomyClasses: string[];
  /**
   * Source-of-truth reminder rendered at the bottom of the lane.
   * Locked phrasing: must mention DB + worker log + screenshots,
   * never the task UI alone.
   */
  sourceOfTruthReminder: string;
}

/**
 * Live artifact summary attached per lane by the loader. Always
 * graceful - the page renders even when the directory is missing
 * or empty.
 */
export interface LaneArtifactSummary {
  /** Total benchmark-run artifacts under `benchmark/runs/`. */
  totalBenchmarkArtifacts: number;
  /**
   * Artifacts that "look like" they belong to this lane based on
   * filename markers (e.g. `phase0-resy`, `expedia`, `hotel`,
   * `booking-com`, `hotels-com`). This is a best-effort filter,
   * not authoritative classification.
   */
  laneBenchmarkArtifacts: number;
  /** Most recent matching artifact filename, if any. */
  latestArtifactFile: string | null;
  /** Friendly hint when no artifacts match. */
  emptyHint: string;
}

/**
 * Composite per-lane snapshot shown by the cockpit. The lane data
 * is static; the artifact summary is loader-attached.
 */
export interface ProviderLaneSnapshot {
  lane: ProviderLane;
  tone: LaneTone;
  artifacts: LaneArtifactSummary;
}

/**
 * Optional pointer to the read-only checklist surface, if it has
 * been merged into the integrated preview. The loader returns
 * `available: false` and the page renders a placeholder when the
 * page is not present - no hard import is allowed.
 */
export interface OperatorChecklistLink {
  available: boolean;
  href: string;
  /** Friendly note rendered on the page regardless of availability. */
  note: string;
}

/**
 * Top-level snapshot rendered by `/dev/provider-closure`.
 */
export interface ProviderClosureRoomSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  lanes: ProviderLaneSnapshot[];
  checklist: OperatorChecklistLink;
  /** Loader-attached graceful empty-state notes. */
  notes: string[];
}
