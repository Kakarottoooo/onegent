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
    // The contract is the cold-start checklist for any coding agent
    // and must stay reachable from both INDEX and MULTI_AGENT_PROTOCOL.
    // This invariant does not duplicate the existence-only check above;
    // it locks the structural sections and cross-links.
    const contract = read("docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md");

    // Required structural sections (numbered headings the task spec
    // calls out as the contract's seven rules).
    const requiredSections = [
      /##\s+1\.\s+Canonical Branch and Worktree/,
      /##\s+2\.\s+Who Edits HUDDLE vs Track Files/,
      /##\s+3\.\s+Stale Branch and Cherry-Pick Rules/,
      /##\s+4\.\s+Forbidden Paths/,
      /##\s+5\.\s+Safety Hard Stops/,
      /##\s+6\.\s+Required Validation Levels/,
      /##\s+7\.\s+How to Report Results/,
    ];
    for (const pattern of requiredSections) {
      expect(
        contract,
        `NEW_AGENT_STARTUP_CONTRACT must keep section matching ${pattern}`,
      ).toMatch(pattern);
    }

    // Key terms that anchor the contract's meaning. Removing any of
    // these would silently weaken the contract.
    const requiredTerms = [
      "codex/integrated-preview-20260504",
      "onegent-integrated-20260504",
      "docs/10-coordination/MULTI_AGENT_PROTOCOL.md",
      "docs/10-coordination/HUDDLE.md",
      "docs/10-coordination/codex.md",
      "docs/10-coordination/claude.md",
      "docs/10-coordination/phase2.md",
      "docs/10-coordination/track-c.md",
      "lib/booking-autopilot/**",
      "lib/core/**",
      "worker/src/**",
      "app/api/v1/**",
      "app/api/booking-jobs/**",
      "lib/db.ts",
      "Live OpenAI calls",
      "Live Computer Use sessions",
      "Final booking",
      "npx tsc --noEmit --pretty false",
      "npm run gate:phase1 -- --allow-known-drift",
      "git diff --check",
      "Branch: <agent>/<topic>",
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

    // INDEX must surface the contract in the New Agent Read Order and
    // in the Current Canonical Files table so a fresh agent can find it.
    const index = read("docs/INDEX.md");
    expect(
      index,
      "INDEX must reference the new-agent startup contract",
    ).toContain("docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md");
    expect(
      index,
      "INDEX New Agent Read Order must mention the startup contract",
    ).toMatch(/New Agent Read Order[\s\S]*NEW_AGENT_STARTUP_CONTRACT/);

    // MULTI_AGENT_PROTOCOL must cross-link to the contract as the
    // boiled-down checklist version.
    const protocol = read("docs/10-coordination/MULTI_AGENT_PROTOCOL.md");
    expect(
      protocol,
      "MULTI_AGENT_PROTOCOL must cross-link to the startup contract",
    ).toContain("docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md");
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
