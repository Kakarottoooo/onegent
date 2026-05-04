import { describe, expect, it } from "vitest";
import {
  CROSS_PROVIDER_HARD_STOPS,
  FORBIDDEN_BUTTONS,
  NO_LIVE_AUTHORIZATION_NOTICE,
  POST_RUN_REPORT_FIELDS,
  PRE_RUN_REQUIREMENTS,
  PROVIDER_CHECKLISTS,
  getProviderChecklist,
  listProviderChecklists,
  type ProviderKey,
} from "@/lib/live-operator-checklist";

describe("live-operator-checklist providers", () => {
  it("exposes exactly the three required providers in the locked order", () => {
    expect(PROVIDER_CHECKLISTS.map((p) => p.key)).toEqual([
      "restaurant",
      "expedia",
      "hotel",
    ]);
  });

  it("each provider entry is fully populated", () => {
    for (const provider of PROVIDER_CHECKLISTS) {
      expect(provider.title.length, provider.key).toBeGreaterThan(0);
      expect(provider.scope.length, provider.key).toBeGreaterThan(0);
      expect(provider.hardStops.length, provider.key).toBeGreaterThanOrEqual(5);
      expect(provider.neverDo.length, provider.key).toBeGreaterThanOrEqual(3);
      expect(provider.evidence.length, provider.key).toBeGreaterThanOrEqual(3);
      expect(provider.analyzers.length, provider.key).toBeGreaterThanOrEqual(1);
      expect(provider.runbooks.length, provider.key).toBeGreaterThanOrEqual(2);
    }
  });

  it("each evidence target has a concrete path, command, and what-to-look-for", () => {
    for (const provider of PROVIDER_CHECKLISTS) {
      for (const target of provider.evidence) {
        expect(target.label.length, provider.key).toBeGreaterThan(0);
        expect(target.path.length, provider.key).toBeGreaterThan(0);
        expect(target.command.length, provider.key).toBeGreaterThan(0);
        expect(
          target.whatToLookFor.length,
          `${provider.key}/${target.label}`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("each provider has at least one DB row, one worker log grep, one screenshot path", () => {
    for (const provider of PROVIDER_CHECKLISTS) {
      const labels = provider.evidence.map((t) => t.label.toLowerCase());
      expect(
        labels.some((l) => l.includes("db row")),
        `${provider.key} must include a DB row evidence target`,
      ).toBe(true);
      expect(
        labels.some((l) => l.includes("worker log")),
        `${provider.key} must include a worker log evidence target`,
      ).toBe(true);
      expect(
        labels.some((l) => l.includes("screenshot")),
        `${provider.key} must include a screenshot evidence target`,
      ).toBe(true);
    }
  });

  it("each provider's worker-log grep targets the integrated preview worktree", () => {
    for (const provider of PROVIDER_CHECKLISTS) {
      const workerLog = provider.evidence.find((t) =>
        t.label.toLowerCase().includes("worker log"),
      );
      expect(workerLog, provider.key).toBeDefined();
      expect(workerLog!.command).toContain(
        "C:\\Users\\Gzw19\\onegent-integrated-20260504\\codex-worker.log",
      );
    }
  });

  it("each provider has at least one analyzer command pointing at the unified or per-provider CLI", () => {
    for (const provider of PROVIDER_CHECKLISTS) {
      const hasAnalyzer = provider.analyzers.some(
        (a) =>
          a.command.includes("scripts/analyze-provider-artifact.ts") ||
          a.command.includes("scripts/analyze-restaurant-artifact.ts") ||
          a.command.includes("scripts/analyze-expedia-retry-artifact.ts"),
      );
      expect(hasAnalyzer, `${provider.key} must include an analyzer command`)
        .toBe(true);
    }
  });

  it("each runbook link points at an existing docs path", () => {
    for (const provider of PROVIDER_CHECKLISTS) {
      for (const runbook of provider.runbooks) {
        expect(runbook.path, `${provider.key}/${runbook.label}`).toMatch(
          /^docs\//,
        );
        expect(
          runbook.path,
          `${provider.key}/${runbook.label} must be a markdown doc`,
        ).toMatch(/\.md$/);
      }
    }
  });

  it("locks restaurant runbook references to Phase 0 restaurant pack", () => {
    const restaurant = getProviderChecklist("restaurant");
    expect(restaurant).not.toBeNull();
    const paths = restaurant!.runbooks.map((r) => r.path);
    expect(paths).toContain(
      "docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
    );
    expect(paths).toContain(
      "docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
    );
  });

  it("locks expedia runbook references to the controlled retry runbook + phase2 audit", () => {
    const expedia = getProviderChecklist("expedia");
    expect(expedia).not.toBeNull();
    const paths = expedia!.runbooks.map((r) => r.path);
    expect(paths).toContain(
      "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    );
    expect(paths).toContain(
      "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
    );
  });

  it("locks hotel runbook references to the hotel controlled retry + revival audit", () => {
    const hotel = getProviderChecklist("hotel");
    expect(hotel).not.toBeNull();
    const paths = hotel!.runbooks.map((r) => r.path);
    expect(paths).toContain(
      "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
    );
    expect(paths).toContain(
      "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
    );
  });

  it("hard stops mention the four cross-cutting safety boundaries for every provider", () => {
    const requiredKeywords = [
      /otp/i,
      /captcha/i,
      /payment|cvv/i,
      /final/i,
    ];
    for (const provider of PROVIDER_CHECKLISTS) {
      const haystack = provider.hardStops.join(" \n ");
      for (const keyword of requiredKeywords) {
        expect(
          haystack,
          `${provider.key} hard stops must mention ${keyword}`,
        ).toMatch(keyword);
      }
    }
  });

  it("listProviderChecklists returns defensive copies (does not leak frozen arrays)", () => {
    const copy = listProviderChecklists();
    // Mutating the copy must not affect the source.
    copy[0].hardStops.push("MUTATED");
    expect(PROVIDER_CHECKLISTS[0].hardStops).not.toContain("MUTATED");
    copy[0].evidence[0].whatToLookFor.push("MUTATED");
    expect(PROVIDER_CHECKLISTS[0].evidence[0].whatToLookFor).not.toContain(
      "MUTATED",
    );
  });

  it("getProviderChecklist returns null for unknown keys", () => {
    expect(getProviderChecklist("nope" as ProviderKey)).toBeNull();
  });
});

describe("live-operator-checklist disclaimer", () => {
  it("authorization notice clearly states no live run is authorized", () => {
    expect(NO_LIVE_AUTHORIZATION_NOTICE).toMatch(
      /no live run is authorized by this page/i,
    );
    expect(NO_LIVE_AUTHORIZATION_NOTICE).toMatch(/founder approval/i);
  });

  it("pre-run requirements list founder approval first and integrated preview worktree", () => {
    expect(PRE_RUN_REQUIREMENTS.length).toBeGreaterThanOrEqual(8);
    expect(PRE_RUN_REQUIREMENTS[0]).toMatch(/founder/i);
    expect(PRE_RUN_REQUIREMENTS.join(" \n ")).toContain(
      "onegent-integrated-20260504",
    );
    expect(PRE_RUN_REQUIREMENTS.join(" \n ")).toContain(
      "codex/integrated-preview-20260504",
    );
  });

  it("cross-provider hard stops cover OTP / CAPTCHA / payment / final confirmation", () => {
    const haystack = CROSS_PROVIDER_HARD_STOPS.join(" \n ");
    expect(haystack).toMatch(/otp/i);
    expect(haystack).toMatch(/captcha/i);
    expect(haystack).toMatch(/payment|cvv/i);
    expect(haystack).toMatch(/final/i);
  });

  it("post-run report fields request DB row, worker log, screenshots, analyzer output", () => {
    const haystack = POST_RUN_REPORT_FIELDS.join(" \n ");
    expect(haystack).toMatch(/db row/i);
    expect(haystack).toMatch(/worker log/i);
    expect(haystack).toMatch(/screenshot/i);
    expect(haystack).toMatch(/analyzer/i);
  });

  it("forbidden buttons list explicitly forbids run / retry / bypass / submit", () => {
    const haystack = FORBIDDEN_BUTTONS.join(" \n ").toLowerCase();
    expect(haystack).toContain("run live");
    expect(haystack).toContain("retry");
    expect(haystack).toMatch(/bypass/);
    expect(haystack).toMatch(/submit payment|confirm reservation/);
  });
});
