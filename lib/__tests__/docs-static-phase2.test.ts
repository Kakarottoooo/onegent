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
  });
});
