import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DEV_PAGES_ROOT = path.join(ROOT, "app", "dev");

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Walk app/dev/ recursively and return every .tsx file path relative to ROOT.
 * Used so the static guard auto-discovers any new operator page; an agent
 * cannot ship a new page that side-steps the no-mutating-button rule by
 * not adding it to a hard-coded list.
 */
function listDevTsxFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listDevTsxFiles(full, acc);
    } else if (stat.isFile() && entry.endsWith(".tsx")) {
      acc.push(path.relative(ROOT, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

// Remove block comments (slash-star ... star-slash) and line comments
// (slash-slash ...) so that JSDoc examples showing real API calls are
// not flagged as live mutations. The startup contract enforces no-live
// behavior in source code, not in documentation that happens to live
// inside a comment.
function stripCodeComments(source: string): string {
  // Block comments first (non-greedy, multi-line).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments. Keep newlines so line numbers and line-context
  // semantics are preserved for the line-level scanners.
  out = out.replace(/^[ \t]*\/\/.*$/gm, "");
  out = out.replace(/([^:"'`])\/\/[^\n]*/g, "$1");
  return out;
}

/**
 * A line is a "safe context" line when it documents the boundary or
 * negates the action. Such lines are allowed to mention forbidden verbs
 * because they exist precisely to remind the reader that the action is
 * forbidden. Examples:
 *   - "No 'run live' button - only copy."
 *   - "Read-only - never bypass OTP."
 *   - "Hard stop: do not submit payment."
 *   - "RUN - single live retry safe" (status label that reads as a
 *     verdict, not an action; "safe" is the disambiguator).
 */
function isSafeContextLine(line: string): boolean {
  return /\b(no|not|never|forbidden|do not|don't|don.t|stop|hard stop|only copy|only re|read-only|read only|without explicit|safe|expected|allowed|cannot|won't|wo not)\b/i.test(
    line,
  );
}

/**
 * Returns true when the target line OR a 2-line window around it
 * contains denial wording. JSX often line-wraps a single sentence so a
 * "don't run live" sentence can split across lines; this lets us treat
 * the wrapped continuation as safe when the parent clause is denial.
 */
function isInDenialWindow(lines: string[], index: number): boolean {
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length - 1, index + 1);
  for (let i = start; i <= end; i += 1) {
    if (isSafeContextLine(lines[i])) return true;
  }
  return false;
}

describe("docs static guard - operator dev pages", () => {
  it("auto-discovers app/dev tsx pages so new pages cannot bypass the rule", () => {
    const files = listDevTsxFiles(DEV_PAGES_ROOT);
    // Sanity: at least the established dev surfaces are present.
    const required = [
      "app/dev/page.tsx",
      "app/dev/demo-readiness/page.tsx",
      "app/dev/demo-control-room/page.tsx",
      "app/dev/runtime-forensics/page.tsx",
    ];
    for (const relPath of required) {
      expect(files, `${relPath} must be discoverable`).toContain(relPath);
    }
    // The list must not be empty (otherwise this whole guard becomes
    // a no-op silently).
    expect(files.length).toBeGreaterThan(5);
  });

  it("no app/dev page advertises a run/retry/live mutating action", () => {
    const files = listDevTsxFiles(DEV_PAGES_ROOT);
    const forbiddenVerbs: ReadonlyArray<RegExp> = [
      /\brun\s+live\b/i,
      /\bretry\s+live\b/i,
      /\blive\s+retry\b/i,
      /\bstart\s+live\b/i,
      /\bbypass\s+(otp|captcha|login)\b/i,
      /\bsubmit\s+payment\b/i,
      /\bconfirm\s+(reservation|booking|purchase|final)\b/i,
    ];

    for (const relPath of files) {
      const source = stripCodeComments(read(relPath));
      const lines = source.split(/\r?\n/);
      for (const pattern of forbiddenVerbs) {
        const violations: string[] = [];
        lines.forEach((line, index) => {
          if (!pattern.test(line)) return;
          if (isInDenialWindow(lines, index)) return;
          violations.push(line);
        });
        expect(
          violations,
          `${relPath} has line(s) advertising ${pattern} without safe context: ${JSON.stringify(violations)}`,
        ).toEqual([]);
      }
    }
  });

  it("no app/dev page wires a mutating onClick handler with a live-action verb", () => {
    const files = listDevTsxFiles(DEV_PAGES_ROOT);
    const forbiddenHandlers: ReadonlyArray<RegExp> = [
      // Handler names that imply provider/payment/auth mutation.
      /\b(runLive|retryLive|startLive|liveRetry|submitPayment|bypassOtp|bypassCaptcha|bypassLogin|skipOtp|skipCaptcha|confirmReservation|confirmFinal)\b/,
      // onClick that references those names.
      /onClick\s*=\s*\{[^}]*\b(runLive|retryLive|startLive|submitPayment|bypassOtp|bypassCaptcha|bypassLogin|skipOtp|skipCaptcha|confirmReservation|confirmFinal)\b/,
    ];

    for (const relPath of files) {
      const source = stripCodeComments(read(relPath));
      for (const pattern of forbiddenHandlers) {
        expect(
          source,
          `${relPath} must not declare or reference handler matching ${pattern}`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("no app/dev page issues a fetch / form action against booking-jobs or v1 mutation APIs", () => {
    const files = listDevTsxFiles(DEV_PAGES_ROOT);
    // Single-line patterns: real mutating fetches put the URL and the
    // method on a small enough span that this catches the obvious
    // shape. Multi-line API examples inside JSDoc comments are ignored
    // because we strip block/line comments before scanning.
    const forbiddenApiPatterns: ReadonlyArray<RegExp> = [
      // Any fetch with /api/booking-jobs/ or /api/v1/ in the URL plus
      // a mutating method, anywhere within ~240 chars on the same logical
      // statement (we keep newlines in stripped source so this stays
      // statement-local rather than file-global).
      /fetch\([^)]{0,240}\/api\/booking-jobs[^)]{0,240}method\s*[:=]\s*["'`](?:POST|PUT|PATCH|DELETE)/i,
      /fetch\([^)]{0,240}\/api\/v1\/[^)]{0,240}method\s*[:=]\s*["'`](?:POST|PUT|PATCH|DELETE)/i,
      // Form actions targeting those APIs (any method, since forms
      // default to GET/POST and a form pointed at booking-jobs is a leak).
      /<form[^>]*action\s*=\s*["'`][^"'`]*\/api\/(?:booking-jobs|v1)\//i,
    ];

    for (const relPath of files) {
      const source = stripCodeComments(read(relPath));
      for (const pattern of forbiddenApiPatterns) {
        expect(
          source,
          `${relPath} must not match ${pattern}`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("keeps the operator failure taxonomy doc and lib in place", () => {
    // The taxonomy is the canonical source of truth for separating
    // model/env transient failures from provider failures. Both the
    // doc and the pure module must exist; tests in
    // operator-failure-taxonomy.test.ts pin the module's content.
    expect(
      existsSync(
        path.join(ROOT, "docs/30-provider-debug/FAILURE_TAXONOMY.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(path.join(ROOT, "lib/operator-failure-taxonomy/index.ts")),
    ).toBe(true);
    expect(
      existsSync(
        path.join(ROOT, "lib/operator-failure-taxonomy/categories.ts"),
      ),
    ).toBe(true);

    const taxonomy = read("docs/30-provider-debug/FAILURE_TAXONOMY.md");

    // Required structural sections.
    const requiredSections = [
      /Model\s*\/\s*env transient/i,
      /Provider network degraded/i,
      /Provider logic failure/i,
      /Safe boundary reached/i,
      /Worked example/i,
    ];
    for (const pattern of requiredSections) {
      expect(
        taxonomy,
        `FAILURE_TAXONOMY.md must keep section matching ${pattern}`,
      ).toMatch(pattern);
    }

    // Worked example must preserve the canonical R-030 evidence ids
    // so this run is not silently rewritten in history.
    expect(taxonomy).toContain("9ca2a595-09cd-4f03-bb19-2b59c474089b");
    expect(taxonomy).toContain("77f70121-4460-4bcd-974d-999360221cde");
    expect(taxonomy).toContain("req_ce42a48137424a938a7893b131416d28");
    expect(taxonomy).toContain(
      "benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json",
    );

    // Restaurant runbook must cross-link to the taxonomy.
    const restaurant = read(
      "docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
    );
    expect(
      restaurant,
      "RESTAURANT_ARTIFACT_ANALYSIS must cross-link to FAILURE_TAXONOMY",
    ).toContain("docs/30-provider-debug/FAILURE_TAXONOMY.md");

    // Provider runtime debug playbook must surface the taxonomy in its
    // fast triage order.
    const playbook = read(
      "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
    );
    expect(
      playbook,
      "PROVIDER_RUNTIME_DEBUG_PLAYBOOK must reference FAILURE_TAXONOMY in its triage steps",
    ).toContain("docs/30-provider-debug/FAILURE_TAXONOMY.md");
  });
});
