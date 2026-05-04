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

    const claudeCoord = read("docs/10-coordination/claude.md");
    expect(
      claudeCoord,
      "claude.md must not claim Phase 1 is only ~95% shipped after demo-freeze",
    ).not.toMatch(/roughly\s+95%\s+shipped/i);
    expect(
      claudeCoord,
      "claude.md must reflect the demo-freeze pass for Phase 1",
    ).toMatch(/demo-freeze\s+passed/i);
    expect(
      claudeCoord,
      "claude.md must list the Demo Control Room shipping line",
    ).toContain("claude/demo-control-room");
    expect(
      claudeCoord,
      "claude.md must list the runtime-forensics UX v2 shipping line",
    ).toContain("claude/runtime-forensics-ux-polish-v2");

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
});
