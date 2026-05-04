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
      "docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md",
      "docs/40-phase1/YC_DEMO_RUNBOOK.md",
      "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
      "docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md",
      "docs/40-phase1/PHASE_1_QUALITY_GATE.md",
      "docs/40-phase1/PHASE_1_E2E_SMOKE.md",
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    ];

    for (const relPath of requiredDocs) {
      expect(existsSync(path.join(ROOT, relPath)), relPath).toBe(true);
    }
  });

  it("keeps active demo docs free of mojibake and unsafe live-action copy", () => {
    const activeDemoDocs = [
      "docs/40-phase1/DEMO_CONTROL_ROOM.md",
      "docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md",
      "docs/40-phase1/YC_DEMO_RUNBOOK.md",
    ];
    const unsafePatterns = [
      /\b(run live|retry live|live retry)\b/i,
      /\b(otp|payment|captcha|login)\s+bypass\b/i,
      /\bbypass\s+(otp|payment|captcha|login)\b/i,
      /\bclick\s+(the\s+)?final\s+(confirm|confirmation|booking|purchase)\b/i,
    ];

    for (const relPath of activeDemoDocs) {
      const source = read(relPath);
      expect(source, relPath).not.toMatch(/[鈥�馃]/);
      for (const pattern of unsafePatterns) {
        expect(source, `${relPath} should not match ${pattern}`).not.toMatch(pattern);
      }
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
    const devPage = read("app/dev/page.tsx");

    expect(doc).toContain("docs/40-phase1/YC_DEMO_RUNBOOK.md");
    expect(doc).toContain("docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md");
    expect(page).toContain("docs/40-phase1/YC_DEMO_RUNBOOK.md");
    expect(devPage).toContain("/dev/demo-readiness");
    expect(page).not.toMatch(/run\s+live|retry\s+live/i);
  });

  it("links demo freeze acceptance and Phase 2 posture from demo readiness", () => {
    const page = read("app/dev/demo-readiness/page.tsx");
    const helper = read("lib/demo-evidence/readiness.ts");

    expect(page).toContain("docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md");
    expect(page).toMatch(/Phase 2.*not live verified/i);
    expect(helper).toContain("docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md");
  });

  it("keeps the developer docs hub linked to static docs routes", () => {
    const hub = read("app/developers/docs/page.tsx");

    expect(hub).toContain("/developers/docs/api/v1");
    expect(hub).toContain("/developers/docs/oauth");
    expect(hub).toContain("/developers/docs/integrations/claude-mcp");
    expect(hub).toContain("/developers/docs/integrations/chatgpt-apps");
  });
});
