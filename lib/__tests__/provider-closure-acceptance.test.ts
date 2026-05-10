import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROVIDER_LANES } from "@/lib/provider-closure-room";
import {
  PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL,
  type ProviderClosureTerminalOutcome,
} from "@/lib/provider-closure/schema";

const ROOT = process.cwd();
const ACCEPTANCE_DOC_REL =
  "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function listMarkdownFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip archive + node_modules to keep this fast and bounded.
      if (entry === "node_modules" || entry === ".git" || entry === "90-archive")
        continue;
      listMarkdownFiles(full, acc);
    } else if (st.isFile() && entry.endsWith(".md")) {
      acc.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

const ALL_TERMINAL_OUTCOMES: ProviderClosureTerminalOutcome[] = Object.keys(
  PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL,
) as ProviderClosureTerminalOutcome[];

describe("provider-closure-acceptance lane manifest invariants", () => {
  it("every lane carries every required closure-acceptance field", () => {
    for (const lane of PROVIDER_LANES) {
      // Runbook
      expect(lane.primaryRunbook.label.length, lane.id).toBeGreaterThan(0);
      expect(lane.primaryRunbook.ref.length, lane.id).toBeGreaterThan(0);
      // Hard stops
      expect(lane.hardStops.length, lane.id).toBeGreaterThanOrEqual(4);
      // Required evidence list
      expect(lane.evidenceRequired.length, lane.id).toBeGreaterThanOrEqual(4);
      // Safe terminal states
      expect(lane.safeTerminalStates.length, lane.id).toBeGreaterThanOrEqual(1);
      // Failure terminal states (at least unsafe_blocked)
      expect(lane.failureTerminalStates.length, lane.id).toBeGreaterThanOrEqual(
        1,
      );
      // Inconclusive terminal states
      expect(
        lane.inconclusiveTerminalStates.length,
        lane.id,
      ).toBeGreaterThanOrEqual(1);
      // Next single allowed action
      expect(lane.nextSingleAllowedAction.label.length, lane.id).toBeGreaterThan(
        0,
      );
      expect(
        lane.nextSingleAllowedAction.detail.length,
        lane.id,
      ).toBeGreaterThan(0);
    }
  });

  it("the three terminal-state buckets partition the 8-state taxonomy without overlap or omission", () => {
    for (const lane of PROVIDER_LANES) {
      const safe = new Set(lane.safeTerminalStates);
      const fail = new Set(lane.failureTerminalStates);
      const inc = new Set(lane.inconclusiveTerminalStates);
      // Disjoint
      for (const s of safe) {
        expect(fail.has(s), `${lane.id} safe ${s} also in failure`).toBe(false);
        expect(inc.has(s), `${lane.id} safe ${s} also in inconclusive`).toBe(
          false,
        );
      }
      for (const s of fail) {
        expect(inc.has(s), `${lane.id} failure ${s} also in inconclusive`).toBe(
          false,
        );
      }
      // Cover
      const union = new Set<ProviderClosureTerminalOutcome>([
        ...safe,
        ...fail,
        ...inc,
      ]);
      for (const outcome of ALL_TERMINAL_OUTCOMES) {
        expect(union.has(outcome), `${lane.id} missing ${outcome}`).toBe(true);
      }
    }
  });

  it("safe_handoff and login_otp_boundary are always safe; unsafe_blocked is always failure", () => {
    for (const lane of PROVIDER_LANES) {
      expect(lane.safeTerminalStates).toContain("safe_handoff");
      expect(lane.safeTerminalStates).toContain("login_otp_boundary");
      expect(lane.failureTerminalStates).toContain("unsafe_blocked");
    }
  });

  it("nextSingleAllowedAction never references a mutating verb phrase", () => {
    // Generic words like "retry" alone are allowed as nouns
    // ("retry artifact"); we forbid mutating PHRASES that imply
    // an operator should kick off a real action from this lane.
    const forbiddenPhrases =
      /\b(run\s+live|live\s+retry|start\s+live|resume\s+live|execute\s+(the|a)\s+|launch\s+live|kick\s+off|submit\s+payment|enter\s+(otp|cvv|payment|the\s+code)|bypass\s+(otp|captcha|login)|confirm\s+(reservation|booking|purchase|final))\b/i;
    for (const lane of PROVIDER_LANES) {
      const blob = `${lane.nextSingleAllowedAction.label}\n${lane.nextSingleAllowedAction.detail}`;
      const lines = blob.split(/\n+/);
      const violations = lines.filter((line) => {
        if (!forbiddenPhrases.test(line)) return false;
        return !/\b(no|not|never|do not|don't|stop|forbidden|without explicit)\b/i.test(
          line,
        );
      });
      expect(
        violations,
        `${lane.id} nextSingleAllowedAction must not advertise mutating phrases without denial`,
      ).toEqual([]);
    }
  });

  it("nextSingleAllowedAction uses an inspection / generation / opening verb", () => {
    const allowedLeadingVerb =
      /^\s*(open|inspect|read|review|generate|paste|copy|wait|pause|hold|check|verify|capture)\b/i;
    for (const lane of PROVIDER_LANES) {
      const label = lane.nextSingleAllowedAction.label;
      expect(
        allowedLeadingVerb.test(label),
        `${lane.id} nextSingleAllowedAction.label must start with an inspection-style verb, got: ${label}`,
      ).toBe(true);
    }
  });

  it("liveVerified true is allowed only with acceptance-doc evidence", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    for (const lane of PROVIDER_LANES) {
      if (lane.liveVerified) {
        expect(
          doc,
          `${lane.id} liveVerified true requires accepted evidence`,
        ).toMatch(new RegExp(`${lane.displayName.split(" / ")[0]}[\\s\\S]+accepted closure`, "i"));
      } else {
        expect(
          doc,
          `${lane.id} liveVerified false should still have a None marker`,
        ).toMatch(new RegExp(`${lane.displayName.split(" / ")[0]}[\\s\\S]+None\\.`, "i"));
      }
    }
  });
});

describe("provider-closure-acceptance doc structure", () => {
  it("acceptance doc exists and is reachable by the standard read path", () => {
    expect(existsSync(path.join(ROOT, ACCEPTANCE_DOC_REL))).toBe(true);
  });

  it("acceptance doc contains the canonical 'tooling vs closure' warning at the top", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    expect(doc).toMatch(/Tooling passing is not provider closure passing/);
  });

  it("acceptance doc has a per-vertical Closure passes / fails / Inconclusive triplet for each lane", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    const verticals = ["Restaurant", "Flight", "Hotel"];
    for (const v of verticals) {
      // Heading anchor for the vertical.
      expect(
        doc,
        `acceptance doc missing vertical heading for ${v}`,
      ).toMatch(new RegExp(`^##\\s+${v}\\b`, "m"));
    }
    // Triplet section headers must each appear at least three times
    // (once per vertical).
    const passCount = (doc.match(/###\s+Closure passes when/g) ?? []).length;
    const failCount = (doc.match(/###\s+Closure fails when/g) ?? []).length;
    const incCount =
      (doc.match(/###\s+Inconclusive \(do not retry blindly\)/g) ?? []).length;
    expect(passCount).toBeGreaterThanOrEqual(3);
    expect(failCount).toBeGreaterThanOrEqual(3);
    expect(incCount).toBeGreaterThanOrEqual(3);
  });

  it("acceptance doc has a 'Next single allowed action' section per vertical", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    const nextCount =
      (doc.match(/###\s+Next single allowed action/g) ?? []).length;
    expect(nextCount).toBeGreaterThanOrEqual(3);
  });

  it("acceptance doc has a 'Verified live closure' section per vertical", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    const verifiedCount =
      (doc.match(/###\s+Verified live closure/g) ?? []).length;
    expect(verifiedCount).toBeGreaterThanOrEqual(3);
    const verifiedSections = doc.split(/###\s+Verified live closure/);
    const after = verifiedSections.slice(1);
    expect(after.length).toBeGreaterThanOrEqual(3);
    expect(after[0]).toMatch(/OpenTable Sirrah safe handoff/);
    expect(after[0]).toMatch(/accepted closure/);
    expect(after[0]).not.toMatch(/None\./);
    expect(after[1]).toMatch(/None\./);
    expect(after[2]).toMatch(/None\./);
  });

  it("acceptance doc lists the 8-state taxonomy verbatim", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    for (const outcome of ALL_TERMINAL_OUTCOMES) {
      expect(
        doc,
        `acceptance doc missing terminal outcome ${outcome}`,
      ).toContain(`\`${outcome}\``);
    }
  });

  it("acceptance doc cross-links the operator-room cockpit and evidence protocol", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    expect(doc).toContain("/dev/provider-closure");
    expect(doc).toContain(
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
    );
    expect(doc).toContain(
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
    );
    expect(doc).toContain("lib/provider-closure/schema.ts");
    expect(doc).toContain("lib/provider-closure-room/lanes.ts");
  });

  it("acceptance doc is ASCII-only", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    expect(doc).not.toMatch(/[^\x00-\x7F]/);
  });

  it("acceptance doc is short enough to read during live debug (< 400 lines)", () => {
    const doc = read(ACCEPTANCE_DOC_REL);
    const lines = doc.split(/\r?\n/);
    expect(
      lines.length,
      "Acceptance doc must stay short; trim if it grows past 400 lines",
    ).toBeLessThan(400);
  });
});

describe("Phase 2 over-claim guard - docs cannot claim live verification without evidence", () => {
  // The vocabulary "live verified" and "live-verified" is locked.
  // Any occurrence in docs MUST be either prefixed by a denial
  // ("not live verified", "not live-verified", "no live...
  // verification", "pending live verification") OR appear inside
  // the explicit acceptance-doc "Verified live closure" sections
  // when those sections record real evidence (currently empty).
  const LIVE_VERIFIED_PATTERN = /\blive[-\s]verified\b/i;
  // Denial / negation / scope-marker vocabulary. Includes
  // multi-line scope markers ("Do not claim:", "prevent ... claims")
  // because a list item that follows such a marker inherits the
  // negation. Window is N-3..N+1 so a "Do not claim:" header two
  // lines above a list item still applies.
  const DENIAL_NEAR_PATTERN =
    /\b(no|not|never|without|pending|until|once|when|prevent|prevents|prevented|claim|claims|promise|promises|promised|unless|tonight unless|do not|don't)\b/i;

  it("scans docs/**/*.md for 'live verified' / 'live-verified' and requires denial context", () => {
    const docFiles = listMarkdownFiles(path.join(ROOT, "docs"));
    expect(docFiles.length).toBeGreaterThan(20);
    const violations: Array<{ file: string; line: string }> = [];
    for (const rel of docFiles) {
      // Skip the archive: historical claims may exist there and are
      // not load-bearing for current closure decisions.
      if (rel.includes("docs/90-archive/")) continue;
      const content = read(rel);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!LIVE_VERIFIED_PATTERN.test(line)) continue;
        // Inspect a 5-line window around the match for denial.
        // N-3..N+1 catches a "Do not claim:" markdown list header
        // that may sit two lines above its list items.
        const windowStart = Math.max(0, i - 3);
        const windowEnd = Math.min(lines.length - 1, i + 1);
        const windowText = lines.slice(windowStart, windowEnd + 1).join("\n");
        if (DENIAL_NEAR_PATTERN.test(windowText)) continue;
        violations.push({ file: rel, line: line.trim() });
      }
    }
    expect(
      violations,
      `docs claim live verification without denial context: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });

  it("acceptance doc is the only canonical place to record verified live closure", () => {
    // Soft check: the phrase "Verified live closure" appears only
    // in the acceptance doc (canonical heading) and possibly the
    // claude/codex coordination history (which may quote it).
    const docFiles = listMarkdownFiles(path.join(ROOT, "docs"));
    const headingFiles: string[] = [];
    for (const rel of docFiles) {
      const content = read(rel);
      if (/^###\s+Verified live closure\b/m.test(content)) {
        headingFiles.push(rel);
      }
    }
    // The heading is canonical to the acceptance doc only. Other
    // files may reference it inline without using the heading
    // anchor.
    expect(headingFiles).toEqual([ACCEPTANCE_DOC_REL]);
  });
});
