import { describe, expect, it } from "vitest";
import {
  PROVIDER_LANES,
  getProviderLane,
  laneTaxonomyClassesAreKnown,
  listProviderLanes,
  type ProviderLaneId,
} from "@/lib/provider-closure-room";
import { FAILURE_CATEGORY_KEYS } from "@/lib/operator-failure-taxonomy";

const REQUIRED_LANE_IDS: ReadonlyArray<ProviderLaneId> = [
  "restaurant",
  "flight",
  "hotel",
];

describe("provider-closure-room lanes manifest", () => {
  it("exposes exactly the three required lanes in the locked order", () => {
    expect(PROVIDER_LANES.map((l) => l.id)).toEqual(REQUIRED_LANE_IDS);
  });

  it("each lane is fully populated with the spec-required fields", () => {
    for (const lane of PROVIDER_LANES) {
      expect(lane.displayName.length, lane.id).toBeGreaterThan(0);
      expect(lane.providerKey.length, lane.id).toBeGreaterThan(0);
      expect(lane.closurePosture.length, lane.id).toBeGreaterThan(0);
      expect(lane.lastKnownBlocker.length, lane.id).toBeGreaterThan(0);
      expect(lane.primaryRunbook.label.length, lane.id).toBeGreaterThan(0);
      expect(lane.primaryRunbook.ref.length, lane.id).toBeGreaterThan(0);
      // Spec: "at least" - so >=, but practically tighter.
      expect(lane.evidenceRequired.length, lane.id).toBeGreaterThanOrEqual(4);
      expect(lane.hardStops.length, lane.id).toBeGreaterThanOrEqual(4);
      expect(lane.inspectAfterRun.length, lane.id).toBeGreaterThanOrEqual(3);
      expect(lane.cliCommands.length, lane.id).toBeGreaterThanOrEqual(2);
      expect(lane.taxonomyClasses.length, lane.id).toBeGreaterThanOrEqual(1);
      expect(lane.sourceOfTruthReminder.length, lane.id).toBeGreaterThan(0);
    }
  });

  it("every lane is ASCII-only (cockpit copy invariant)", () => {
    for (const lane of PROVIDER_LANES) {
      const blob = JSON.stringify(lane);
      expect(blob, `${lane.id} must be ASCII-only`).not.toMatch(/[^\x00-\x7F]/);
    }
  });

  it("source-of-truth reminder mentions DB + worker log + screenshots, not the task UI alone", () => {
    for (const lane of PROVIDER_LANES) {
      const t = lane.sourceOfTruthReminder.toLowerCase();
      expect(t, lane.id).toContain("db");
      expect(t, lane.id).toContain("worker log");
      expect(t, lane.id).toContain("screenshot");
      // The reminder must explicitly negate "task UI alone".
      expect(t, lane.id).toMatch(/task ui/);
      expect(t, lane.id).toMatch(/never|do not/);
    }
  });

  it("primaryRunbook ref looks like a real repo path or absolute https URL", () => {
    for (const lane of PROVIDER_LANES) {
      const ref = lane.primaryRunbook.ref;
      const looksLikeRepoPath =
        ref.startsWith("docs/") ||
        ref.startsWith("lib/") ||
        ref.startsWith("app/") ||
        ref.startsWith("scripts/");
      const looksLikeUrl = ref.startsWith("https://");
      expect(
        looksLikeRepoPath || looksLikeUrl,
        `${lane.id} primaryRunbook.ref ${ref} must be a repo path or https URL`,
      ).toBe(true);
    }
  });

  it("supportingReferences point at real repo paths or pages or https URLs", () => {
    for (const lane of PROVIDER_LANES) {
      for (const ref of lane.supportingReferences) {
        const ok =
          ref.ref.startsWith("docs/") ||
          ref.ref.startsWith("lib/") ||
          ref.ref.startsWith("app/") ||
          ref.ref.startsWith("scripts/") ||
          ref.ref.startsWith("/dev/") ||
          ref.ref.startsWith("https://");
        expect(
          ok,
          `${lane.id} supporting ref ${ref.ref} must be a repo path, dev page, or https URL`,
        ).toBe(true);
      }
    }
  });

  it("CLI commands never advertise live runs or mutating actions", () => {
    const forbidden =
      /\b(run\s+live|retry\s+live|live\s+retry|start\s+live|submit\s+payment|bypass\s+(otp|captcha|login)|confirm\s+(reservation|booking|purchase|final))\b/i;
    for (const lane of PROVIDER_LANES) {
      for (const cli of lane.cliCommands) {
        const blob = `${cli.label}\n${cli.description}\n${cli.command}`;
        expect(
          blob,
          `${lane.id} CLI ${cli.label} must not advertise live actions`,
        ).not.toMatch(forbidden);
      }
    }
  });

  it("CLI commands are exactly the no-live analyzer/template/preflight scripts", () => {
    const allowed = new Set<string>([
      "npx",
      "tsx",
      "vitest",
    ]);
    for (const lane of PROVIDER_LANES) {
      for (const cli of lane.cliCommands) {
        const firstToken = cli.command.trim().split(/\s+/)[0];
        expect(
          allowed.has(firstToken),
          `${lane.id} CLI must start with npx/tsx/vitest, got ${firstToken}`,
        ).toBe(true);
        // Never reference run-* / retry-* / start-* / live-* binaries.
        expect(
          cli.command,
          `${lane.id} CLI must not invoke run/retry/start/live binaries`,
        ).not.toMatch(
          /\b(run-live|retry-live|start-live|live-retry|launch-live|exec-live)\b/,
        );
      }
    }
  });

  it("hard stops use denial vocabulary so the static guard accepts them", () => {
    const denialRegex = /\b(no|not|never|do not|don't|stop|forbidden)\b/i;
    for (const lane of PROVIDER_LANES) {
      for (const stop of lane.hardStops) {
        expect(
          stop.detail,
          `${lane.id} hard stop ${stop.label} must use denial vocabulary`,
        ).toMatch(denialRegex);
      }
    }
  });

  it("every lane carries the no-retry-loop / no-one-click hard stop", () => {
    for (const lane of PROVIDER_LANES) {
      const found = lane.hardStops.some((s) =>
        /retry loop|one-click live|run, retry, resume, start, live, execute, or submit/i.test(
          s.detail,
        ),
      );
      expect(
        found,
        `${lane.id} must include the no-retry-loop / no-one-click hard stop`,
      ).toBe(true);
    }
  });

  it("evidenceRequired lists DB row + worker log + screenshots for every lane", () => {
    for (const lane of PROVIDER_LANES) {
      const labels = lane.evidenceRequired
        .map((e) => `${e.label}\n${e.detail}`)
        .join("\n")
        .toLowerCase();
      expect(labels, lane.id).toMatch(/db row/);
      expect(labels, lane.id).toMatch(/worker log/);
      expect(labels, lane.id).toMatch(/screenshot/);
    }
  });

  it("inspectAfterRun mentions classifying against the operator failure taxonomy", () => {
    for (const lane of PROVIDER_LANES) {
      const blob = lane.inspectAfterRun
        .map((i) => `${i.label}\n${i.detail}`)
        .join("\n")
        .toLowerCase();
      expect(blob, lane.id).toMatch(/taxonomy/);
    }
  });

  it("taxonomyClasses only reference known operator-failure-taxonomy keys", () => {
    const allowed = new Set<string>(FAILURE_CATEGORY_KEYS);
    for (const lane of PROVIDER_LANES) {
      expect(laneTaxonomyClassesAreKnown(lane), lane.id).toBe(true);
      for (const c of lane.taxonomyClasses) {
        expect(allowed.has(c), `${lane.id} ${c}`).toBe(true);
      }
    }
  });

  it("listProviderLanes returns defensive copies (does not leak frozen refs)", () => {
    const copy = listProviderLanes();
    copy[0].evidenceRequired.push({ label: "MUT", detail: "MUT" });
    expect(PROVIDER_LANES[0].evidenceRequired.map((e) => e.label)).not.toContain(
      "MUT",
    );
    copy[0].hardStops.push({ label: "MUT", detail: "MUT" });
    expect(PROVIDER_LANES[0].hardStops.map((h) => h.label)).not.toContain("MUT");
    copy[0].cliCommands.push({
      label: "MUT",
      description: "MUT",
      command: "MUT",
    });
    expect(PROVIDER_LANES[0].cliCommands.map((c) => c.label)).not.toContain(
      "MUT",
    );
  });

  it("getProviderLane returns null for unknown ids", () => {
    expect(getProviderLane("nope" as ProviderLaneId)).toBeNull();
  });

  it("restaurant lane preserves the canonical R-030 OpenAI 500 anchor", () => {
    const lane = getProviderLane("restaurant");
    expect(lane).not.toBeNull();
    const blob = lane!.lastKnownBlocker.toLowerCase();
    expect(blob).toContain("r-030");
    expect(blob).toContain("openai");
    expect(blob).toContain("model_or_env_blocked");
    expect(blob).toContain("req_ce42a48137424a938a7893b131416d28");
  });

  it("flight lane preserves the canonical Expedia MCO->BNA / WN 3084 anchor", () => {
    const lane = getProviderLane("flight");
    expect(lane).not.toBeNull();
    const blob = `${lane!.closurePosture}\n${lane!.lastKnownBlocker}`;
    expect(blob).toMatch(/MCO/);
    expect(blob).toMatch(/BNA/);
    expect(blob).toMatch(/Southwest/);
    expect(blob).toMatch(/WN 3084/);
  });

  it("hotel lane preserves the canonical Booking.com / YOTEL anchor", () => {
    const lane = getProviderLane("hotel");
    expect(lane).not.toBeNull();
    const blob = `${lane!.closurePosture}\n${lane!.lastKnownBlocker}`;
    expect(blob).toMatch(/Booking\.com/);
    expect(blob).toMatch(/YOTEL/);
  });
});
