import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...listMarkdownFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      out.push(fullPath);
    }
  }
  return out;
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

    const founderE2e = read("docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md");
    expect(
      founderE2e,
      "PHASE_1_FOUNDER_E2E must not advertise the stale 95% claim in its header",
    ).not.toMatch(/Phase 1 ~95% shipped/);
    expect(
      founderE2e,
      "PHASE_1_FOUNDER_E2E header must reflect demo-freeze pass",
    ).toMatch(/demo-freeze passed/i);
  });

  it("keeps docs/INDEX.md as the single compact entrypoint with archived legacy paths", () => {
    const index = read("docs/INDEX.md");

    expect(index, "INDEX must document the explicit new-agent read order").toMatch(
      /##\s+New Agent Read Order/,
    );
    expect(
      index,
      "INDEX must not reintroduce the old demo-freeze quick path",
    ).not.toMatch(/Phase 1\s*\/\s*1\.5 Demo Freeze Quick Path/);

    const requiredCanonicalPaths = [
      "docs/00-start-here/PHASE_STATUS.md",
      "docs/00-start-here/PROJECT_SUMMARY.md",
      "docs/00-start-here/STAGE_0.md",
      "docs/40-dogfood/STAGE0_DAILY_REPORT.md",
      "docs/40-dogfood/CAPTURE_MVP_SEAMS.md",
      "docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md",
      "docs/30-provider-debug/STAGE0B_TM_SEATGEEK_LAB.md",
      "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
      "docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md",
      "docs/60-api-integrations/GMAIL_OTP_ASSIST.md",
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

    const archivePaths = [
      "docs/90-archive/phase0-restaurant/",
      "docs/90-archive/phase1-demo/",
      "docs/90-archive/phase2-product-areas/",
    ];
    for (const relPath of archivePaths) {
      expect(index, `INDEX must point historical readers at ${relPath}`).toContain(
        relPath,
      );
    }

    expect(index).not.toContain("docs/20-phase0-restaurant/");
    expect(index).not.toContain("docs/40-phase1/");
    expect(index).not.toContain("docs/50-product-areas/");

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

  it("keeps active docs below the founder-readable threshold", () => {
    const activeDocs = listMarkdownFiles(path.join(ROOT, "docs")).filter(
      (filePath) => !filePath.includes(`${path.sep}90-archive${path.sep}`),
    );

    expect(
      activeDocs.length,
      "Active docs should stay small; archive completed or historical docs instead",
    ).toBeLessThanOrEqual(55);
  });
});
