import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PACK_REL = "docs/90-archive/start-here-history/PHASE_CLOSURE_EVIDENCE_PACK.md";

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("phase closure evidence pack doc", () => {
  it("exists and names the current canonical integrated preview SHA", () => {
    expect(existsSync(path.join(ROOT, PACK_REL))).toBe(true);
    const doc = read(PACK_REL);

    expect(doc).toContain("63837d9");
    expect(doc).toContain("63837d92f7bb286e4463684054e65e8381c6e1f8");
  });

  it("has one closure table row for every requested phase", () => {
    const doc = read(PACK_REL);

    const requiredRows = [
      /\| Phase 0A \| Closed via OpenTable safe handoff \| `closed` \|/,
      /\| Phase 1 \| Demo-freeze passed \| `blocked` \|/,
      /\| Phase 1\.5 \| Demo-freeze passed \| `blocked` \|/,
      /\| Phase 2 \| Frozen, not demo-promised \| `frozen` \|/,
    ];
    for (const row of requiredRows) {
      expect(doc).toMatch(row);
    }

    expect(doc).not.toMatch(
      /\| Phase (?:1|1\.5) \| Demo-freeze passed \| `closed` \|/,
    );
  });

  it("locks the concrete closure unblock plan and proof requirement per phase", () => {
    const doc = read(PACK_REL);

    expect(doc).toContain("Closure unblock plan");
    expect(doc).toContain("Phase 0B can broaden OpenTable-first restaurant fixtures");
    expect(doc).toContain("External founder-acceptance blocker");
    expect(doc).toContain("External QA/founder acceptance blocker");
    expect(doc).toContain("Cannot be closed by more docs, fixtures, or tooling");
    expect(doc).toContain("Closure Proof Required");
    expect(doc).toContain("Founder manual walkthrough sign-off");
    expect(doc).toContain("Provider Closure Acceptance sign-off");
  });

  it("preserves the required evidence anchors without overclaiming closure", () => {
    const doc = read(PACK_REL);

    expect(doc).toContain("Agent2");
    expect(doc).toContain("codex/flight-live-closure-final @ fa7afc3");
    expect(doc).toContain("selector_drift");
    expect(doc).toContain("Agent3");
    expect(doc).toContain("codex/hotel-live-closure-final @ 12b5a0e");
    expect(doc).toContain("Claude");
    expect(doc).toContain("claude/provider-closure-acceptance-final @ ed46abc");
    expect(doc).toContain("Goal");
    expect(doc).toContain("codex/goal-provider-closure-war-room @ 29ebdc6");
    expect(doc).toContain("r030-openai-403-model-not-found-2026-05-05");
    expect(doc).toContain("F-INFRA-MODEL-ACCESS");
    expect(doc).toContain("not a Resy provider regression");
  });

  it("keeps live-verified wording denied outside the acceptance evidence", () => {
    const doc = read(PACK_REL);
    const liveVerifiedLines = doc
      .split(/\r?\n/)
      .filter((line) => /\blive[-\s]verified\b/i.test(line));

    expect(liveVerifiedLines.length).toBeGreaterThan(0);
    for (const line of liveVerifiedLines) {
      expect(line).toMatch(/\b(no|not|unless|until|cannot|do not|false)\b/i);
    }
  });
});
