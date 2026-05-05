import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildPhaseClosureEvidencePack,
  CANONICAL_PHASE_CLOSURE_BASE_SHA,
  formatPhaseClosureEvidencePackMarkdown,
  hasProviderClosureAcceptanceEvidence,
  PHASE_CLOSURE_REQUIRED_DOCS,
  type PhaseClosureDocumentKey,
  type PhaseClosureEvidenceDocuments,
} from "@/lib/phase-closure-evidence";

const ROOT = process.cwd();

describe("phase closure evidence pack", () => {
  it("classifies every requested phase from existing evidence", () => {
    const pack = buildPhaseClosureEvidencePack({
      canonicalIntegratedPreviewSha: CANONICAL_PHASE_CLOSURE_BASE_SHA,
      documents: readDocs(),
      generatedAt: "2026-05-05T02:30:00.000Z",
    });

    expect(pack.canonicalIntegratedPreviewShortSha).toBe("63837d9");
    expect(pack.providerClosureLiveVerifiedEvidencePresent).toBe(false);

    const phase0a = phase(pack, "Phase 0A");
    expect(phase0a.closureVerdict).toBe("blocked");
    expect(phase0a.status).toContain("Blocked");
    expect(phase0a.blockingEvidence).toContain(
      "Resy R-030 patch remains unvalidated",
    );
    expect(phase0a.blockingEvidence).toContain("runtime env/project mismatch");

    const phase1 = phase(pack, "Phase 1");
    expect(phase1.closureVerdict).toBe("blocked");
    expect(phase1.status).toBe("Demo-freeze passed");
    expect(phase1.blockingEvidence).toContain("final acceptance check");
    expect(phase1.closureUnblockPlan).toContain("founder");

    const phase15 = phase(pack, "Phase 1.5");
    expect(phase15.closureVerdict).toBe("blocked");
    expect(phase15.status).toBe("Demo-freeze passed");
    expect(phase15.blockingEvidence).toContain("not phase closure");
    expect(phase15.closureUnblockPlan).toContain("QA/founder");

    const phase2 = phase(pack, "Phase 2");
    expect(phase2.closureVerdict).toBe("frozen");
    expect(phase2.status).toContain("not demo-promised");
    expect(phase2.blockingEvidence).toContain("Agent2 Expedia");
    expect(phase2.blockingEvidence).toContain("Agent3 hotel");
    expect(phase2.blockingEvidence).toContain("Goal war-room");
    expect(phase2.blockingEvidence).toContain("liveVerified false");
    expect(phase2.closureUnblockPlan).toContain("Cannot be closed by more docs");
  });

  it("includes a concrete closure unblock plan for every phase", () => {
    const pack = buildPhaseClosureEvidencePack({
      canonicalIntegratedPreviewSha: CANONICAL_PHASE_CLOSURE_BASE_SHA,
      documents: readDocs(),
    });

    for (const item of pack.phases) {
      expect(item.closureUnblockPlan.length).toBeGreaterThan(80);
      expect(item.closureProofRequired.length).toBeGreaterThan(40);
    }
    expect(phase(pack, "Phase 0A").closureUnblockPlan).toContain(
      "Runtime env/project blocker",
    );
    expect(phase(pack, "Phase 1").closureProofRequired).toContain(
      "Founder manual walkthrough sign-off",
    );
  });

  it("locks the latest R-030 retry as model_env_transient / infra blocked, not provider pass/fail", () => {
    const pack = buildPhaseClosureEvidencePack({
      canonicalIntegratedPreviewSha: CANONICAL_PHASE_CLOSURE_BASE_SHA,
      documents: readDocs(),
    });

    expect(pack.latestR030Evidence.category).toBe("model_env_transient");
    expect(pack.latestR030Evidence.evidenceId).toContain(
      "r030-openai-403-model-not-found",
    );
    expect(pack.latestR030Evidence.takeaway).toContain(
      "not a Resy provider regression",
    );
    expect(pack.latestR030Evidence.takeaway).toContain(
      "Closure outcome is inconclusive",
    );
    expect(pack.latestR030Evidence.takeaway).toContain(
      "F-INFRA-MODEL-ACCESS",
    );
  });

  it("distinguishes tooling integrated from provider closure proven", () => {
    const pack = buildPhaseClosureEvidencePack({
      canonicalIntegratedPreviewSha: CANONICAL_PHASE_CLOSURE_BASE_SHA,
      documents: readDocs(),
    });

    const labels = pack.integrationAnchors.map((anchor) => anchor.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Expedia flight live closure final",
        "Hotel live closure final",
        "Provider closure acceptance",
        "Provider Closure War Room",
        "R-030 runtime env/project mismatch",
      ]),
    );
    expect(pack.integrationAnchors.find((a) => a.owner === "Agent2")?.evidence).toContain(
      "selector_drift",
    );
    expect(pack.integrationAnchors.find((a) => a.owner === "Claude")?.evidence).toContain(
      "liveVerified: false",
    );
    expect(pack.integrationAnchors.find((a) => a.owner === "Goal")?.evidence).toContain(
      "synthetic reports cannot prove closure",
    );
    expect(pack.integrationAnchors.find((a) => a.owner === "Codex")?.evidence).toContain(
      "model_not_found",
    );
  });

  it("does not allow live-verified claims without acceptance evidence", () => {
    const docs = readDocs();
    expect(hasProviderClosureAcceptanceEvidence(docs.providerClosureAcceptance)).toBe(
      false,
    );

    const pack = buildPhaseClosureEvidencePack({
      canonicalIntegratedPreviewSha: CANONICAL_PHASE_CLOSURE_BASE_SHA,
      documents: docs,
    });
    const markdown = formatPhaseClosureEvidencePackMarkdown(pack);

    expect(markdown).toContain("not live verified");
    expect(markdown).toContain(
      "docs / fixtures / green no-live tests do not close a phase",
    );
    const liveVerifiedLines = markdown
      .split(/\r?\n/)
      .filter((line) => /\blive[-\s]verified\b/i.test(line));
    expect(liveVerifiedLines.length).toBeGreaterThan(0);
    for (const line of liveVerifiedLines) {
      expect(line).toMatch(/\b(no|not|unless|until|cannot|do not)\b/i);
    }
  });

  it("all evidence checks pass against the current integrated docs", () => {
    const pack = buildPhaseClosureEvidencePack({
      canonicalIntegratedPreviewSha: CANONICAL_PHASE_CLOSURE_BASE_SHA,
      documents: readDocs(),
    });

    expect(pack.checks.map((check) => [check.key, check.passed])).toEqual(
      pack.checks.map((check) => [check.key, true]),
    );
  });
});

function phase(
  pack: ReturnType<typeof buildPhaseClosureEvidencePack>,
  label: string,
) {
  const found = pack.phases.find((item) => item.phase === label);
  if (!found) throw new Error(`Missing phase ${label}`);
  return found;
}

function readDocs(): PhaseClosureEvidenceDocuments {
  return Object.fromEntries(
    (Object.entries(PHASE_CLOSURE_REQUIRED_DOCS) as Array<
      [PhaseClosureDocumentKey, string]
    >).map(([key, relPath]) => [
      key,
      readFileSync(path.join(ROOT, relPath), "utf8"),
    ]),
  ) as PhaseClosureEvidenceDocuments;
}
