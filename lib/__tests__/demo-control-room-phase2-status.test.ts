/**
 * Tests for the Phase 2 vertical status mirror.
 *
 * Invariants this module must hold:
 *  - 3 verticals (Expedia / Booking.com / Hotels.com)
 *  - Expedia status === "candidate", others === "needs_fresh_artifacts"
 *  - liveVerified is false on every vertical (V1 never auto-promotes)
 *  - statusLabel matches the canonical PHASE2_STATUS_LABEL table
 *  - liveVerifiedNote uses the user-locked phrasing
 *  - getPhase2Vertical returns by id; throws on unknown
 *  - summarizePhase2Posture rolls up correctly given the current data
 *  - every vertical has at least one piece of evidence
 *  - every evidence ref is a non-empty string with a docs/lib/test path shape
 */

import { describe, expect, it } from "vitest";

import {
  PHASE2_STATUS_LABEL,
  PHASE2_STATUS_TONE,
  PHASE_2_VERTICALS,
  getPhase2Vertical,
  listPhase2Verticals,
  summarizePhase2Posture,
  type Phase2Vertical,
  type Phase2VerticalId,
} from "@/lib/demo-control-room/phase2-status";

describe("PHASE_2_VERTICALS shape", () => {
  it("has exactly 3 verticals", () => {
    expect(PHASE_2_VERTICALS.length).toBe(3);
  });

  it("ids are unique", () => {
    const ids = new Set(PHASE_2_VERTICALS.map((v) => v.id));
    expect(ids.size).toBe(PHASE_2_VERTICALS.length);
  });

  it("expedia-flight is candidate; others need fresh artifacts", () => {
    const expedia = PHASE_2_VERTICALS.find((v) => v.id === "expedia-flight");
    const booking = PHASE_2_VERTICALS.find((v) => v.id === "booking-com-hotel");
    const hotels = PHASE_2_VERTICALS.find((v) => v.id === "hotels-com");
    expect(expedia?.status).toBe("candidate");
    expect(booking?.status).toBe("needs_fresh_artifacts");
    expect(hotels?.status).toBe("needs_fresh_artifacts");
  });

  it("V1 never promotes liveVerified (always false)", () => {
    for (const v of PHASE_2_VERTICALS) {
      expect(v.liveVerified, `${v.id} should not be live-verified`).toBe(false);
    }
  });

  it("statusLabel matches canonical PHASE2_STATUS_LABEL", () => {
    for (const v of PHASE_2_VERTICALS) {
      expect(v.statusLabel).toBe(PHASE2_STATUS_LABEL[v.status]);
    }
  });

  it("tone matches canonical PHASE2_STATUS_TONE", () => {
    for (const v of PHASE_2_VERTICALS) {
      expect(v.tone).toBe(PHASE2_STATUS_TONE[v.status]);
    }
  });

  it("Expedia liveVerifiedNote uses locked phrasing", () => {
    const expedia = getPhase2Vertical("expedia-flight");
    expect(expedia.liveVerifiedNote).toBe("candidate, not live-verified");
  });

  it("Booking and Hotels liveVerifiedNote use locked phrasing", () => {
    const booking = getPhase2Vertical("booking-com-hotel");
    const hotels = getPhase2Vertical("hotels-com");
    expect(booking.liveVerifiedNote).toBe(
      "needs fresh artifacts before live promises",
    );
    expect(hotels.liveVerifiedNote).toBe(
      "needs fresh artifacts before live promises",
    );
  });

  it("every vertical has rationale of >= 80 chars", () => {
    for (const v of PHASE_2_VERTICALS) {
      expect(v.rationale.length, `${v.id} rationale too short`).toBeGreaterThanOrEqual(80);
    }
  });

  it("every vertical has at least 1 evidence link", () => {
    for (const v of PHASE_2_VERTICALS) {
      expect(v.evidence.length).toBeGreaterThan(0);
    }
  });

  it("every evidence ref looks like a repo path or doc", () => {
    for (const v of PHASE_2_VERTICALS) {
      for (const e of v.evidence) {
        expect(e.label.length).toBeGreaterThan(0);
        expect(e.ref.length).toBeGreaterThan(0);
        expect(["doc", "test", "module", "runbook"]).toContain(e.kind);
        // path shape: starts with docs/ or lib/ or worker/ or scripts/
        expect(e.ref).toMatch(/^(docs|lib|worker|scripts|app|public|benchmark)\//);
      }
    }
  });

  it("Expedia points at the canonical audit and 2 specific tests", () => {
    const expedia = getPhase2Vertical("expedia-flight");
    const refs = expedia.evidence.map((e) => e.ref);
    expect(refs).toContain(
      "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
    );
    expect(refs).toContain(
      "lib/__tests__/expedia-flight-card-match.test.ts",
    );
    expect(refs).toContain("lib/__tests__/flight-time-filter.test.ts");
  });
});

describe("getPhase2Vertical", () => {
  it("returns each known vertical by id", () => {
    const ids: Phase2VerticalId[] = [
      "expedia-flight",
      "booking-com-hotel",
      "hotels-com",
    ];
    for (const id of ids) {
      const v = getPhase2Vertical(id);
      expect(v.id).toBe(id);
    }
  });

  it("throws on unknown id", () => {
    expect(() =>
      // @ts-expect-error testing runtime guard
      getPhase2Vertical("does-not-exist"),
    ).toThrow();
  });
});

describe("listPhase2Verticals", () => {
  it("returns the canonical list", () => {
    const list = listPhase2Verticals();
    expect(list.length).toBe(PHASE_2_VERTICALS.length);
    expect(list[0].id).toBe(PHASE_2_VERTICALS[0].id);
  });
});

describe("summarizePhase2Posture", () => {
  it("rolls up to candidate (Expedia provides the candidate)", () => {
    const summary = summarizePhase2Posture();
    expect(summary.posture).toBe("candidate");
    expect(summary.label).toBe(PHASE2_STATUS_LABEL.candidate);
    expect(summary.countByStatus.candidate).toBe(1);
    expect(summary.countByStatus.needs_fresh_artifacts).toBe(2);
    expect(summary.countByStatus.frozen).toBe(0);
  });
});

describe("PHASE2_STATUS_LABEL coverage", () => {
  it("covers every Phase2Status value", () => {
    expect(PHASE2_STATUS_LABEL.candidate).toBeTruthy();
    expect(PHASE2_STATUS_LABEL.needs_fresh_artifacts).toBeTruthy();
    expect(PHASE2_STATUS_LABEL.frozen).toBeTruthy();
  });
});
