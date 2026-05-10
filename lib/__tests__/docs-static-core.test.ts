import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("docs static guard - core", () => {
  it("keeps key Phase 1 and demo-readiness docs in place", () => {
    const requiredDocs = [
      "AGENTS.md",
      "CLAUDE.md",
      "docs/INDEX.md",
      "docs/00-start-here/PHASE_STATUS.md",
      "docs/10-coordination/HUDDLE.md",
      "docs/10-coordination/MULTI_AGENT_PROTOCOL.md",
      "docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md",
      "docs/10-coordination/phase2-goal-review.md",
      "docs/10-coordination/track-c.md",
      "docs/40-phase1/DEMO_CONTROL_ROOM.md",
      "docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md",
      "docs/40-phase1/YC_DEMO_OPERATOR_CARD.md",
      "docs/40-phase1/YC_DEMO_RUNBOOK.md",
      "docs/40-phase1/PHASE_1_FOUNDER_E2E.md",
      "docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md",
      "docs/40-phase1/PHASE_1_QUALITY_GATE.md",
      "docs/40-phase1/PHASE_1_E2E_SMOKE.md",
      "docs/40-dogfood/BUG_INBOX.md",
      "docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md",
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
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

  it("keeps the developer docs hub linked to static docs routes", () => {
    const hub = read("app/developers/docs/page.tsx");

    expect(hub).toContain("/developers/docs/api/v1");
    expect(hub).toContain("/developers/docs/oauth");
    expect(hub).toContain("/developers/docs/integrations/claude-mcp");
    expect(hub).toContain("/developers/docs/integrations/chatgpt-apps");
  });

  it("keeps the new-agent startup contract present and linked", () => {
    // The contract is the short startup checklist. Durable behavior rules live
    // in AGENTS.md, so this test protects the lightweight contract shape and
    // avoids locking in stale historical branch names.
    const contract = read("docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md");

    const requiredSections = [
      /##\s+1\.\s+Start From The Current Integration Base/,
      /##\s+2\.\s+Founder-Mediated External Agent Flow/,
      /##\s+3\.\s+Edit Only Your Assigned Surface/,
      /##\s+4\.\s+Safety Hard Stops/,
      /##\s+5\.\s+Validation/,
      /##\s+6\.\s+Return Report Shape/,
    ];
    for (const pattern of requiredSections) {
      expect(
        contract,
        `NEW_AGENT_STARTUP_CONTRACT must keep section matching ${pattern}`,
      ).toMatch(pattern);
    }

    const requiredTerms = [
      "AGENTS.md",
      "origin/codex/stage0-capture-mvp",
      "founder-mediated",
      "Goal, Claude, Agent2, Agent3",
      "lib/booking-autopilot/**",
      "lib/core/**",
      "worker/src/**",
      "app/api/v1/**",
      "app/api/booking-jobs/**",
      "lib/db.ts",
      "live OpenAI / Computer Use validation",
      "final purchase",
      "CAPTCHA bypass",
      "npx tsc --noEmit --pretty false",
      "npm run check-drift",
      "npm run gate:phase1 -- --allow-known-drift",
      "git diff --check",
      "Branch:",
      "Safety:",
    ];
    for (const term of requiredTerms) {
      expect(
        contract,
        `NEW_AGENT_STARTUP_CONTRACT must keep key term ${JSON.stringify(term)}`,
      ).toContain(term);
    }

    // Contract must be ASCII-only so editors and terminals do not
    // mojibake the cold-start instructions.
    expect(
      contract,
      "NEW_AGENT_STARTUP_CONTRACT must be ASCII-only",
    ).not.toMatch(/[^\x00-\x7F]/);

    // INDEX must keep AGENTS.md as the first behavior entry and keep the
    // startup contract discoverable in the canonical files table.
    const index = read("docs/INDEX.md");
    expect(index, "INDEX must point new agents at AGENTS.md").toMatch(
      /New Agent Read Order[\s\S]*AGENTS\.md/,
    );
    expect(
      index,
      "INDEX must reference the new-agent startup contract",
    ).toContain("docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md");

    // MULTI_AGENT_PROTOCOL must cross-link to the contract as the
    // boiled-down checklist version.
    const protocol = read("docs/10-coordination/MULTI_AGENT_PROTOCOL.md");
    expect(
      protocol,
      "MULTI_AGENT_PROTOCOL must cross-link to the startup contract",
    ).toContain("docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md");
  });

  it("keeps AGENTS as canonical behavior source and CLAUDE as a thin mirror", () => {
    const agents = read("AGENTS.md");
    const claude = read("CLAUDE.md");

    const requiredRules = [
      /Always respond in Chinese/,
      /Do not ask the founder to do work the agent can do locally/,
      /commit and\s+push by default/,
      /Codex should proactively decide whether a task needs Agent Teams mode/,
      /After each substantive task, proactively recommend next steps/,
      /Programmatic navigation handles known provider UI steps/,
      /Conversational NLU should preserve the three-layer split/,
    ];

    for (const rule of requiredRules) {
      expect(agents, `AGENTS.md must include rule ${rule}`).toMatch(rule);
    }

    expect(claude).toContain("Read `AGENTS.md` first and treat it as binding");
    expect(claude).toContain("Always respond in Chinese");
    expect(claude).toContain("Do not ask the founder to paste logs");
    expect(claude).toContain("Commit and push completed, validated work");
    expect(
      claude,
      "CLAUDE.md should stay a thin entrypoint instead of another huge rule file",
    ).toSatisfy((value: string) => value.length < 6000);
  });

  it("keeps dogfood and runtime mirror docs discoverable", () => {
    const index = read("docs/INDEX.md");
    const projectSummary = read("docs/00-start-here/PROJECT_SUMMARY.md");
    const systemDesign = read("docs/00-start-here/SYSTEM_DESIGN.md");
    const bugInbox = read("docs/40-dogfood/BUG_INBOX.md");
    const mirrorGuide = read("docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md");

    expect(index).toContain("docs/40-dogfood/BUG_INBOX.md");
    expect(index).toContain("docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md");
    expect(projectSummary).toContain("docs/40-dogfood/BUG_INBOX.md");
    expect(systemDesign).toContain("docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md");
    expect(bugInbox).toContain("DOG-005");
    expect(bugInbox).toContain("Lion King");
    expect(bugInbox).toContain("NLU fixture");
    expect(bugInbox).toContain("Benchmark case");
    expect(bugInbox).toContain("zh-activity-lion-king-trip-shaped");
    expect(bugInbox).toContain("activity-route-pass-08");
    expect(systemDesign).toContain("scripts/internal-benchmark.ts --mode no-live");
    expect(systemDesign).toContain("200+ structured cases");
    expect(systemDesign).toContain("does not prove live model extraction");
    expect(mirrorGuide).toContain("lib/booking-autopilot/**");
    expect(mirrorGuide).toContain("worker/src/booking-autopilot/**");
    expect(mirrorGuide).toContain("npm run check-drift");
  });
});
