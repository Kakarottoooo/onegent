import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("docs static guard - ia", () => {
  it("locks Phase 1/1.5 demo-freeze post-pass invariants", () => {
    // After the Phase 1/1.5 demo-freeze pass on integrated preview
    // (`codex/integrated-preview-20260504`), key docs must not regress
    // back to pre-freeze claims. These invariants are intentionally
    // narrow and do not duplicate the broader checks above.
    const phaseStatus = read("docs/00-start-here/PHASE_STATUS.md");
    expect(
      phaseStatus,
      "PHASE_STATUS must record the Phase 1 demo-freeze pass",
    ).toMatch(/Demo-freeze passed/);
    expect(
      phaseStatus,
      "PHASE_STATUS must list the Demo Control Room dev route",
    ).toContain("/dev/demo-control-room");
    expect(
      phaseStatus,
      "PHASE_STATUS must list the Track C demo readiness sidecar",
    ).toContain("/dev/demo-readiness");

    const projectSummary = read("docs/00-start-here/PROJECT_SUMMARY.md");
    const claudeCoord = read("docs/10-coordination/claude.md");
    expect(
      projectSummary,
      "PROJECT_SUMMARY must reflect the demo-freeze pass for Phase 1",
    ).toMatch(/demo-freeze\s+passed/i);
    expect(
      claudeCoord,
      "claude.md should now be a pointer, not a historical demo-freeze log",
    ).toContain("Claude Coordination Pointer");
    expect(
      claudeCoord,
      "claude.md must not carry old demo branch logs after cleanup",
    ).not.toContain("claude/demo-control-room");
    expect(
      claudeCoord,
      "claude.md must not carry old runtime-forensics branch logs after cleanup",
    ).not.toContain("claude/runtime-forensics-ux-polish-v2");

    const founderE2e = read("docs/40-phase1/PHASE_1_FOUNDER_E2E.md");
    expect(
      founderE2e,
      "PHASE_1_FOUNDER_E2E must not advertise the stale 95% claim in its header",
    ).not.toMatch(/Phase 1 ~95% shipped/);
    expect(
      founderE2e,
      "PHASE_1_FOUNDER_E2E header must reflect demo-freeze pass",
    ).toMatch(/demo-freeze passed/i);
  });

  it("keeps docs/INDEX.md as the single new-agent entrypoint with current canonical paths", () => {
    const index = read("docs/INDEX.md");

    expect(index, "INDEX must document the explicit new-agent read order").toMatch(
      /##\s+New Agent Read Order/,
    );
    expect(
      index,
      "INDEX must include a Phase 1/1.5 demo freeze quick path",
    ).toMatch(/Phase 1\s*\/\s*1\.5 Demo Freeze Quick Path/);

    const requiredCanonicalPaths = [
      "docs/40-phase1/DEMO_CONTROL_ROOM.md",
      "docs/40-phase1/YC_DEMO_RUNBOOK.md",
      "docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md",
      "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
      "docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md",
      "docs/40-phase1/PHASE_1_QUALITY_GATE.md",
      "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
      "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/10-coordination/HUDDLE.md",
      "docs/10-coordination/codex.md",
      "docs/10-coordination/claude.md",
      "docs/10-coordination/track-c.md",
      "docs/10-coordination/phase2.md",
    ];
    for (const relPath of requiredCanonicalPaths) {
      expect(
        index,
        `INDEX must reference ${relPath} so a new agent can find it`,
      ).toContain(relPath);
    }

    expect(index, "INDEX must remain ASCII-only").not.toMatch(/[^\x00-\x7F]/);
  });

  it("keeps PROJECT_SUMMARY phase snapshot aligned with current canonical master", () => {
    const summary = read("docs/00-start-here/PROJECT_SUMMARY.md");

    expect(
      summary,
      "PROJECT_SUMMARY must point at the current canonical worktree",
    ).toContain("C:\\Users\\Gzw19\\onegent");
    expect(
      summary,
      "PROJECT_SUMMARY must point at the current canonical branch",
    ).toContain("branch: master");
    expect(
      summary,
      "PROJECT_SUMMARY phase snapshot must record demo-freeze pass for Phase 1",
    ).toMatch(/Phase 1\s*\|\s*Demo-freeze passed/);
    expect(
      summary,
      "PROJECT_SUMMARY phase snapshot must record demo-freeze pass for Phase 1.5",
    ).toMatch(/Phase 1\.5\s*\|\s*Demo-freeze passed/);
    expect(
      summary,
      "PROJECT_SUMMARY must drop the older 'Mostly shipped' Phase 1 phrasing",
    ).not.toMatch(/Phase 1\s*\|\s*Mostly shipped/);
  });
});
