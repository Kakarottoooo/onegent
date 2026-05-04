import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("docs static guard", () => {
  it("keeps key Phase 1 and demo-readiness docs in place", () => {
    const requiredDocs = [
      "docs/INDEX.md",
      "docs/00-start-here/PHASE_STATUS.md",
      "docs/10-coordination/HUDDLE.md",
      "docs/10-coordination/track-c.md",
      "docs/40-phase1/DEMO_CONTROL_ROOM.md",
      "docs/40-phase1/YC_DEMO_RUNBOOK.md",
      "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    ];

    for (const relPath of requiredDocs) {
      expect(existsSync(path.join(ROOT, relPath)), relPath).toBe(true);
    }
  });

  it("keeps developer docs routes pointed at docs/60-api-integrations", () => {
    const routeFiles = [
      "app/developers/docs/api/v1/page.tsx",
      "app/developers/docs/oauth/page.tsx",
      "app/developers/docs/integrations/[slug]/page.tsx",
    ];

    for (const relPath of routeFiles) {
      const source = read(relPath);

      expect(source, relPath).toContain('"docs", "60-api-integrations"');
      expect(source, relPath).not.toMatch(
        /path\.join\(process\.cwd\(\),\s*"docs",\s*"api/,
      );
      expect(source, relPath).not.toMatch(
        /path\.join\(process\.cwd\(\),\s*"docs",\s*"oauth\.md"/,
      );
    }
  });

  it("links the YC demo runbook from the demo control room docs and page", () => {
    const doc = read("docs/40-phase1/DEMO_CONTROL_ROOM.md");
    const page = read("app/dev/demo-control-room/page.tsx");

    expect(doc).toContain("docs/40-phase1/YC_DEMO_RUNBOOK.md");
    expect(page).toContain("docs/40-phase1/YC_DEMO_RUNBOOK.md");
    expect(page).not.toMatch(/run\s+live|retry\s+live/i);
  });
});
