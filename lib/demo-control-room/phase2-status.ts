/**
 * Phase 2 vertical-revival status -?single structured source.
 *
 * `/dev/demo-control-room` reads this and renders the "Phase 2"
 * panel. The canonical narrative explanation lives in
 * `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`; this file
 * is the machine-readable mirror so the dashboard does not parse
 * markdown and the audit doc has a stable structure to reference
 * back into.
 *
 * Update protocol:
 *   1. Update the audit doc first.
 *   2. Mirror the change here.
 *   3. The page picks it up on next render.
 *
 * Pure module -?no fs, no DB, no LLM. Imported by the page server
 * component and by tests.
 */

/* ------ Public types ---------------------------------------------------------------------------------------------------- */

export type Phase2VerticalId =
  | "expedia-flight"
  | "booking-com-hotel"
  | "hotels-com";

export type Phase2Status =
  | "candidate"
  | "needs_fresh_artifacts"
  | "frozen";

export interface Phase2EvidenceLink {
  label: string;
  /** File path under repo root, or doc URL. */
  ref: string;
  kind: "doc" | "test" | "module" | "runbook";
}

export interface Phase2Vertical {
  id: Phase2VerticalId;
  displayName: string;
  /** Provider key (lowercase) used by other dashboards. */
  providerKey: string;
  status: Phase2Status;
  /** Short label rendered as a chip ("Candidate, not live-verified"). */
  statusLabel: string;
  /** Tone hint for UI styling. */
  tone: "warn" | "neutral" | "good" | "bad";
  /**
   * One-paragraph rationale: why this status, what no-live evidence
   * exists, and what would change the verdict.
   */
  rationale: string;
  /**
   * Whether a recent LIVE end-to-end happy path has been verified.
   * V1: always false; we never auto-promote.
   */
  liveVerified: boolean;
  /**
   * Founder-facing one-liner used inline in demo scripts. Phrasing
   * is locked by the user spec ("candidate, not live-verified" /
   * "needs fresh artifacts before live promises").
   */
  liveVerifiedNote: string;
  /** Links to the canonical evidence + tests. */
  evidence: Phase2EvidenceLink[];
}

/* ------ Display copy tables -------------------------------------------------------------------------------------- */

export const PHASE2_STATUS_LABEL: Record<Phase2Status, string> = {
  candidate: "Candidate, not live-verified",
  needs_fresh_artifacts: "Needs fresh artifacts before live promises",
  frozen: "Frozen -?Phase 2 gate not crossed",
};

export const PHASE2_STATUS_TONE: Record<Phase2Status, Phase2Vertical["tone"]> = {
  candidate: "warn",
  needs_fresh_artifacts: "neutral",
  frozen: "bad",
};

/* ------ Canonical mirror of the audit ------------------------------------------------------------------ */

export const PHASE_2_VERTICALS: ReadonlyArray<Phase2Vertical> = [
  {
    id: "expedia-flight",
    displayName: "Expedia Flight",
    providerKey: "expedia",
    status: "candidate",
    statusLabel: PHASE2_STATUS_LABEL.candidate,
    tone: PHASE2_STATUS_TONE.candidate,
    rationale:
      "Card-scoring regression test (`flight-time-filter.test.ts`) and " +
      "visible-card shape coverage (`expedia-flight-card-match.test.ts`) " +
      "are green on the integrated preview. The DOM-scan fallback shipped " +
      "in `codex/expedia-flight-card-fallback`. No live retry has run since " +
      "the fallback landed. A controlled live retry requires explicit " +
      "founder approval for the exact run; do not promise this works in a " +
      "demo without that approval.",
    liveVerified: false,
    liveVerifiedNote: "candidate, not live-verified",
    evidence: [
      {
        label: "Phase 2 vertical revival audit",
        ref: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
        kind: "doc",
      },
      {
        label: "Phase 2 sidecar coordination",
        ref: "docs/10-coordination/phase2.md",
        kind: "doc",
      },
      {
        label: "Expedia controlled retry runbook",
        ref: "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
        kind: "runbook",
      },
      {
        label: "Card scoring regression",
        ref: "lib/__tests__/expedia-flight-card-match.test.ts",
        kind: "test",
      },
      {
        label: "Time-filter founder bug",
        ref: "lib/__tests__/flight-time-filter.test.ts",
        kind: "test",
      },
      {
        label: "Provider runtime debug playbook",
        ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
        kind: "runbook",
      },
    ],
  },
  {
    id: "booking-com-hotel",
    displayName: "Booking.com Hotel",
    providerKey: "booking-com",
    status: "needs_fresh_artifacts",
    statusLabel: PHASE2_STATUS_LABEL.needs_fresh_artifacts,
    tone: PHASE2_STATUS_TONE.needs_fresh_artifacts,
    rationale:
      "URL builder + provider module exist and import cleanly, but there " +
      "are no fresh probe / screenshot artifacts since the last live " +
      "verification. Must run a no-token probe before any demo claim. Do " +
      "not include in a tonight demo without fresh evidence.",
    liveVerified: false,
    liveVerifiedNote: "needs fresh artifacts before live promises",
    evidence: [
      {
        label: "Phase 2 vertical revival audit",
        ref: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
        kind: "doc",
      },
      {
        label: "Provider module (Track A)",
        ref: "lib/booking-autopilot/providers/booking-com.ts",
        kind: "module",
      },
    ],
  },
  {
    id: "hotels-com",
    displayName: "Hotels.com",
    providerKey: "hotels-com",
    status: "needs_fresh_artifacts",
    statusLabel: PHASE2_STATUS_LABEL.needs_fresh_artifacts,
    tone: PHASE2_STATUS_TONE.needs_fresh_artifacts,
    rationale:
      "Provider module reuses Expedia's helpers but has no recent live " +
      "verification. Same boundary as Booking.com: probe + artifacts " +
      "before a demo claim. No promise without fresh evidence.",
    liveVerified: false,
    liveVerifiedNote: "needs fresh artifacts before live promises",
    evidence: [
      {
        label: "Phase 2 vertical revival audit",
        ref: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
        kind: "doc",
      },
      {
        label: "Provider module (Track A)",
        ref: "lib/booking-autopilot/providers/hotels-com.ts",
        kind: "module",
      },
    ],
  },
];

/* ------ Lookups -------------------------------------------------------------------------------------------------------------- */

const VERTICAL_INDEX: Record<Phase2VerticalId, Phase2Vertical> = Object.freeze(
  Object.fromEntries(PHASE_2_VERTICALS.map((v) => [v.id, v])),
) as Record<Phase2VerticalId, Phase2Vertical>;

export function getPhase2Vertical(id: Phase2VerticalId): Phase2Vertical {
  const v = VERTICAL_INDEX[id];
  if (!v) {
    throw new Error(`Unknown Phase 2 vertical id: ${id}`);
  }
  return v;
}

export function listPhase2Verticals(): ReadonlyArray<Phase2Vertical> {
  return PHASE_2_VERTICALS;
}

/**
 * Single rolled-up posture string for a quick demo banner.
 * Returns "Candidate" if at least one vertical is in candidate status,
 * otherwise "Needs fresh evidence", otherwise "Frozen".
 */
export function summarizePhase2Posture(): {
  posture: "candidate" | "needs_fresh_artifacts" | "frozen";
  label: string;
  countByStatus: Record<Phase2Status, number>;
} {
  const countByStatus: Record<Phase2Status, number> = {
    candidate: 0,
    needs_fresh_artifacts: 0,
    frozen: 0,
  };
  for (const v of PHASE_2_VERTICALS) countByStatus[v.status] += 1;
  if (countByStatus.candidate > 0) {
    return {
      posture: "candidate",
      label: PHASE2_STATUS_LABEL.candidate,
      countByStatus,
    };
  }
  if (countByStatus.needs_fresh_artifacts > 0) {
    return {
      posture: "needs_fresh_artifacts",
      label: PHASE2_STATUS_LABEL.needs_fresh_artifacts,
      countByStatus,
    };
  }
  return {
    posture: "frozen",
    label: PHASE2_STATUS_LABEL.frozen,
    countByStatus,
  };
}
