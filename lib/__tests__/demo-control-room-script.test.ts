/**
 * Tests for the safe demo script content + markdown export.
 *
 * Invariants:
 *  - canonical script has the four required sections, all non-empty
 *  - happy-path step indices are 1..N contiguous
 *  - markdown export is deterministic (same input -> same output)
 *  - markdown contains every section heading
 *  - markdown contains the locked phrasing (Phase 2, hard stops)
 *  - escapeTableCell handles pipes correctly
 *  - convenience accessors return shallow copies (mutating output
 *    does not mutate the canonical script)
 *  - ASCII-only (no emoji)
 */

import { describe, expect, it } from "vitest";

import {
  SAFE_DEMO_SCRIPT,
  formatDemoScriptMarkdown,
  listHappyPathSteps,
  listHardStops,
  listPreDemoChecklist,
  listRecoveryPhrases,
} from "@/lib/demo-control-room/script";

describe("SAFE_DEMO_SCRIPT shape", () => {
  it("has 4 sections, all non-empty", () => {
    expect(SAFE_DEMO_SCRIPT.preDemoChecklist.length).toBeGreaterThan(0);
    expect(SAFE_DEMO_SCRIPT.happyPath.length).toBeGreaterThan(0);
    expect(SAFE_DEMO_SCRIPT.hardStops.length).toBeGreaterThan(0);
    expect(SAFE_DEMO_SCRIPT.recoveryPhrases.length).toBeGreaterThan(0);
  });

  it("happy-path step indices are 1..N contiguous", () => {
    const steps = SAFE_DEMO_SCRIPT.happyPath;
    for (let i = 0; i < steps.length; i++) {
      expect(steps[i].index).toBe(i + 1);
    }
  });

  it("every checklist item has id + label + hint", () => {
    for (const item of SAFE_DEMO_SCRIPT.preDemoChecklist) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(10);
      expect(item.hint.length).toBeGreaterThan(20);
    }
  });

  it("every happy-path step has body of >= 40 chars", () => {
    for (const step of SAFE_DEMO_SCRIPT.happyPath) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThanOrEqual(40);
    }
  });

  it("every hard stop has trigger / rule / recoveryLine", () => {
    for (const hs of SAFE_DEMO_SCRIPT.hardStops) {
      expect(hs.trigger.length).toBeGreaterThan(0);
      expect(hs.rule.length).toBeGreaterThan(20);
      expect(hs.recoveryLine.length).toBeGreaterThan(10);
    }
  });

  it("hard stops cover OTP / payment / CAPTCHA / final-confirm", () => {
    const triggers = SAFE_DEMO_SCRIPT.hardStops
      .map((h) => h.trigger.toLowerCase())
      .join(" | ");
    expect(triggers).toMatch(/otp|sms/);
    expect(triggers).toMatch(/cvv|payment|final/);
    expect(triggers).toMatch(/captcha/);
  });

  it("recovery phrases cover availability / 5xx / rate limit", () => {
    const scenarios = SAFE_DEMO_SCRIPT.recoveryPhrases
      .map((r) => r.scenario.toLowerCase())
      .join(" | ");
    expect(scenarios).toMatch(/availability/);
    expect(scenarios).toMatch(/5xx|network/);
    expect(scenarios).toMatch(/rate.?limit|model/);
  });

  it("ASCII-only — no emoji in any string", () => {
    const allText = JSON.stringify(SAFE_DEMO_SCRIPT);
    // Match common emoji blocks; none should appear.
    // Pictographs U+1F000-U+1FFFF + symbols U+2600-U+27BF
    const emojiRx = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u;
    expect(allText).not.toMatch(emojiRx);
  });
});

describe("formatDemoScriptMarkdown", () => {
  it("contains every section heading", () => {
    const md = formatDemoScriptMarkdown();
    expect(md).toContain("# Safe Demo Script");
    expect(md).toContain("## Pre-demo");
    expect(md).toContain("## Happy path");
    expect(md).toContain("## Hard stops");
    expect(md).toContain("## Recovery phrases");
  });

  it("contains every happy-path step title", () => {
    const md = formatDemoScriptMarkdown();
    for (const step of SAFE_DEMO_SCRIPT.happyPath) {
      expect(md).toContain(step.title);
    }
  });

  it("contains every checklist label", () => {
    const md = formatDemoScriptMarkdown();
    for (const item of SAFE_DEMO_SCRIPT.preDemoChecklist) {
      expect(md).toContain(item.label);
    }
  });

  it("hard stops table is well-formed (header + separator + N rows)", () => {
    const md = formatDemoScriptMarkdown();
    const tableLines = md.split("\n").filter((l) => l.startsWith("|"));
    // Header (Trigger | Rule | Recovery), separator, plus one per stop.
    expect(tableLines.length).toBe(2 + SAFE_DEMO_SCRIPT.hardStops.length);
  });

  it("contains the locked Phase 2 phrasing in the pre-demo checklist", () => {
    const md = formatDemoScriptMarkdown();
    expect(md).toContain("candidate, not live-verified");
    expect(md).toContain("needs fresh artifacts before live promises");
  });

  it("includes the source-of-truth caveat at the bottom", () => {
    const md = formatDemoScriptMarkdown();
    expect(md).toContain("DEMO_CONTROL_ROOM.md");
    expect(md).toMatch(/never invokes a provider/);
  });

  it("is deterministic (idempotent)", () => {
    const a = formatDemoScriptMarkdown();
    const b = formatDemoScriptMarkdown();
    expect(a).toBe(b);
  });

  it("accepts a custom script override", () => {
    const md = formatDemoScriptMarkdown({
      schemaVersion: 1,
      preDemoChecklist: [
        { id: "x", label: "X-LABEL", hint: "X-HINT-LONG-ENOUGH" },
      ],
      happyPath: [
        {
          index: 1,
          title: "X-TITLE",
          body: "X-BODY-MORE-THAN-FORTY-CHARACTERS-FOR-TEST",
        },
      ],
      hardStops: [
        {
          trigger: "X-TRIGGER",
          rule: "X-RULE-LONG-ENOUGH-FOR-TEST",
          recoveryLine: "X-RECOVERY-LINE",
        },
      ],
      recoveryPhrases: [{ scenario: "X-SCEN", line: "X-LINE" }],
    });
    expect(md).toContain("X-LABEL");
    expect(md).toContain("X-TITLE");
    expect(md).toContain("X-TRIGGER");
    expect(md).toContain("X-SCEN");
  });

  it("escapes pipes in cell values", () => {
    const md = formatDemoScriptMarkdown({
      schemaVersion: 1,
      preDemoChecklist: [],
      happyPath: [],
      hardStops: [
        {
          trigger: "pipe|in|trigger",
          rule: "rule",
          recoveryLine: "line",
        },
      ],
      recoveryPhrases: [],
    });
    expect(md).toContain("pipe\\|in\\|trigger");
  });
});

describe("convenience accessors return shallow copies", () => {
  it("listPreDemoChecklist mutation does not affect canonical", () => {
    const list = listPreDemoChecklist();
    const original = SAFE_DEMO_SCRIPT.preDemoChecklist.length;
    list.push({ id: "x", label: "x", hint: "x" });
    expect(SAFE_DEMO_SCRIPT.preDemoChecklist.length).toBe(original);
  });

  it("listHappyPathSteps mutation does not affect canonical", () => {
    const list = listHappyPathSteps();
    const original = SAFE_DEMO_SCRIPT.happyPath.length;
    list.pop();
    expect(SAFE_DEMO_SCRIPT.happyPath.length).toBe(original);
  });

  it("listHardStops + listRecoveryPhrases also return copies", () => {
    expect(listHardStops().length).toBe(SAFE_DEMO_SCRIPT.hardStops.length);
    expect(listRecoveryPhrases().length).toBe(
      SAFE_DEMO_SCRIPT.recoveryPhrases.length,
    );
  });
});
