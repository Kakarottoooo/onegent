import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("docs static guard - phase2", () => {
  it("links demo freeze acceptance and Phase 2 posture from demo readiness", () => {
    const page = read("app/dev/demo-readiness/page.tsx");
    const helper = read("lib/demo-evidence/readiness.ts");

    expect(page).toContain("docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md");
    expect(page).toMatch(/Phase 2.*not live verified/i);
    expect(helper).toContain("docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md");
    expect(helper).toContain("docs/40-phase1/YC_DEMO_OPERATOR_CARD.md");
  });

  it("keeps Phase 2 no-live review docs in place", () => {
    const requiredDocs = [
      "docs/10-coordination/phase2.md",
      "docs/10-coordination/phase2-goal-review.md",
      "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
    ];

    for (const relPath of requiredDocs) {
      expect(read(relPath), relPath).toBeTruthy();
    }
  });
});
