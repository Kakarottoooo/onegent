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

  it("keeps /dev/live-operator-checklist read-only with no action buttons", () => {
    // The live operator checklist page is a hard safety surface. It must:
    //   1. exist;
    //   2. carry the "no live run is authorized by this page" notice via
    //      lib/live-operator-checklist;
    //   3. not contain any control that could start/retry/bypass anything;
    //   4. not import a client component or use onClick / form handlers;
    //   5. be linked from the /dev landing as a Phase 0 route.
    const page = read("app/dev/live-operator-checklist/page.tsx");
    const lib = read("lib/live-operator-checklist/disclaimer.ts");
    const providers = read("lib/live-operator-checklist/providers.ts");
    const devLanding = read("app/dev/page.tsx");

    // 1 + 2: notice plumbing.
    expect(
      lib,
      "disclaimer module must expose the no-live authorization notice",
    ).toMatch(/No live run is authorized by this page/i);
    expect(
      page,
      "page must render the no-live authorization notice",
    ).toContain("NO_LIVE_AUTHORIZATION_NOTICE");

    // 3: no action buttons / form handlers / client mutation hooks.
    const forbiddenAttributes = [
      /<button\b/i,
      /<form\b/i,
      /<input\b/i,
      /<select\b/i,
      /onClick\s*=/,
      /onSubmit\s*=/,
      /onChange\s*=/,
      /useState\b/,
      /useTransition\b/,
      /router\.refresh\(/,
      /router\.push\(/,
      /fetch\(/,
      /axios\./,
      /\bswr\b/i,
    ];
    for (const pattern of forbiddenAttributes) {
      expect(
        page,
        `live-operator-checklist page must not match ${pattern}`,
      ).not.toMatch(pattern);
    }
    // No client boundary either; this stays a server component.
    expect(
      page,
      "live-operator-checklist page must remain a server component (no 'use client')",
    ).not.toMatch(/^\s*"use client"|^\s*'use client'/m);
    // Forbidden action verbs in the rendered copy. These would imply a
    // run/retry/live action is available from this page.
    const forbiddenCopy = [
      /\brun live\b/i,
      /\bretry now\b/i,
      /\bre-run\b/i,
      /\bbypass otp\b/i,
      /\bbypass captcha\b/i,
      /\bsubmit payment\b/i,
      /\bconfirm reservation\b/i,
    ];
    for (const pattern of forbiddenCopy) {
      const hits = page
        .split(/\r?\n/)
        .filter((line) => pattern.test(line))
        .filter(
          (line) =>
            // Allow these patterns to appear inside a "No ..." denial line
            // sourced from FORBIDDEN_BUTTONS, since that is the disclaimer.
            !/\b(no|never|forbidden|not authorize|stop)\b/i.test(line),
        );
      expect(
        hits,
        `live-operator-checklist page must not promise ${pattern}`,
      ).toEqual([]);
    }

    // 4: providers source must reference each runbook the page advertises.
    const requiredRunbookPaths = [
      "docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
      "docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
      "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
    ];
    for (const path of requiredRunbookPaths) {
      expect(
        providers,
        `live-operator-checklist providers must reference ${path}`,
      ).toContain(path);
    }

    // 5: /dev landing must list the new route.
    expect(
      devLanding,
      "/dev landing must list /dev/live-operator-checklist as a Phase 0 route",
    ).toContain("/dev/live-operator-checklist");
  });
});
