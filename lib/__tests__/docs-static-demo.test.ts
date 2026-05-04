import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("docs static guard - demo", () => {
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
});
