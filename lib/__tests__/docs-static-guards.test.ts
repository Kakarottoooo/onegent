import { promises as fs } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const DEVELOPER_DOC_PAGES = [
  {
    page: "app/developers/docs/api/v1/page.tsx",
    markdown: "docs/60-api-integrations/api-v1.md",
  },
  {
    page: "app/developers/docs/oauth/page.tsx",
    markdown: "docs/60-api-integrations/oauth.md",
  },
  {
    page: "app/developers/docs/integrations/[slug]/page.tsx",
    markdown: "docs/60-api-integrations/claude-mcp.md",
  },
  {
    page: "app/developers/docs/integrations/[slug]/page.tsx",
    markdown: "docs/60-api-integrations/chatgpt-apps.md",
  },
];

const KEY_PHASE1_RUNBOOKS = [
  "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
  "docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md",
  "docs/40-phase1/PHASE_1_QUALITY_GATE.md",
  "docs/40-phase1/PHASE_1_E2E_SMOKE.md",
  "docs/40-phase1/DEMO_CONTROL_ROOM.md",
  "docs/40-phase1/YC_DEMO_RUNBOOK.md",
];

describe("developer docs markdown path guards", () => {
  it.each(DEVELOPER_DOC_PAGES)(
    "$page points into docs/60-api-integrations and target markdown exists",
    async ({ page, markdown }) => {
      const pageSource = await fs.readFile(path.join(ROOT, page), "utf8");
      expect(pageSource).toContain('"docs", "60-api-integrations"');
      expect(pageSource).not.toContain('"docs", "api-v1.md"');
      expect(pageSource).not.toContain('"docs", "oauth.md"');
      await expect(fs.stat(path.join(ROOT, markdown))).resolves.toBeTruthy();
    },
  );

  it("developer docs hub links all static integration docs", async () => {
    const pageSource = await fs.readFile(
      path.join(ROOT, "app/developers/docs/page.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("/developers/docs/api/v1");
    expect(pageSource).toContain("/developers/docs/oauth");
    expect(pageSource).toContain("/developers/docs/integrations/claude-mcp");
    expect(pageSource).toContain("/developers/docs/integrations/chatgpt-apps");
  });
});

describe("Phase 1 runbook existence guards", () => {
  it.each(KEY_PHASE1_RUNBOOKS)("%s exists and is non-empty", async (docPath) => {
    const stat = await fs.stat(path.join(ROOT, docPath));
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(40);
  });
});
