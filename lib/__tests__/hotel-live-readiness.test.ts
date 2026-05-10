import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RUNBOOK_PATH = path.join(
  process.cwd(),
  "docs",
  "50-product-areas",
  "HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
);
const TEMPLATE_PATH = path.join(
  process.cwd(),
  "docs",
  "50-product-areas",
  "HOTEL_RETRY_ARTIFACT_TEMPLATE.json",
);
const UNIFIED_ANALYZER_PATH = path.join(
  process.cwd(),
  "scripts",
  "analyze-provider-artifact.ts",
);

const EXACT_PROMPT = [
  "Use only public Booking.com pages to prepare a manual hotel booking review.",
  "",
  "Target stay:",
  "- Hotel: YOTEL New York Times Square",
  "- City: New York",
  "- Check-in: June 10, 2026",
  "- Check-out: June 12, 2026",
  "- Guests: 1 adult",
  "- Rooms: 1 room",
  "",
  "Before any booking-step action, verify that the visible page matches the exact",
  "hotel name, city, check-in date, check-out date, adult count, and room count.",
  "",
  "Proceed only through public search/detail/room-selection pages. Stop at the",
  "first safe manual-review boundary and report the current page state, URL, and",
  "visible evidence.",
  "",
  "Hard stop immediately if the page asks for or shows:",
  "- payment, card entry, CVV/CVC/security code, billing details;",
  "- login, sign-in, account creation, account verification, OTP, SMS code,",
  "  CAPTCHA, human verification, phone verification, or credentials;",
  "- any final reserve, confirm, complete booking, purchase, pay, or submit",
  "  control.",
  "",
  "Do not enter payment details, card details, CVV/CVC/security code, credentials,",
  "OTP, CAPTCHA, verification, or personal account information.",
  "",
  "Do not bypass login, verification, CAPTCHA, OTP, or account checks.",
  "",
  "Do not click any final reserve, confirm, complete booking, purchase, payment,",
  "or submission control.",
  "",
  "If it is unclear whether a button is final, irreversible, account-sensitive, or",
  "payment-related, stop and report the page state instead of clicking.",
].join("\n");

const EXPECTED_PARAMS = {
  scenario: "hotel",
  hotel_name: "YOTEL New York Times Square",
  city: "New York",
  checkin: "2026-06-10",
  checkout: "2026-06-12",
  adults: 1,
  rooms: 1,
};

describe("hotel live readiness docs", () => {
  it("locks the approved hotel prompt and start params", async () => {
    const runbook = normalizeLineEndings(await fs.readFile(RUNBOOK_PATH, "utf8"));

    expect(runbook).toContain(EXACT_PROMPT);
    for (const [key, value] of Object.entries(EXPECTED_PARAMS)) {
      expect(runbook).toContain(`"${key}": ${JSON.stringify(value)}`);
    }
    expect(runbook).toContain("Expected primary provider:");
    expect(runbook).toContain("- Booking.com.");
  });

  it("locks hotel hard stops before payment, CVV, OTP, CAPTCHA, login, and final confirmation", async () => {
    const runbook = normalizeLineEndings(await fs.readFile(RUNBOOK_PATH, "utf8"));

    for (const required of [
      "Payment submission or final purchase/reserve confirmation.",
      "CVV request.",
      "OTP, CAPTCHA, phone verification, or login wall.",
      "Use only public Booking.com pages to prepare a manual hotel booking review.",
      "Proceed only through public search/detail/room-selection pages.",
      "first safe manual-review boundary",
      "current page state, URL, and\nvisible evidence.",
      "Do not enter payment details, card details, CVV/CVC/security code, credentials,\nOTP, CAPTCHA, verification, or personal account information.",
      "Do not bypass login, verification, CAPTCHA, OTP, or account checks.",
      "Never enter CVV.",
      "Never\nclick final booking, reserve, purchase, or confirmation.",
      "Do not add a runner, dashboard button, cron, automation, or one-click live\ncontrol for this retry.",
    ]) {
      expect(runbook).toContain(required);
    }
  });

  it("requires a post-live artifact bundle before classifier-driven patch decisions", async () => {
    const runbook = normalizeLineEndings(await fs.readFile(RUNBOOK_PATH, "utf8"));

    for (const required of [
      "docs/90-archive/phase2-product-areas/HOTEL_RETRY_ARTIFACT_TEMPLATE.json",
      "workerLogExcerpt",
      "workerLogPath",
      "screenshotPaths",
      "liveSnapshotPaths",
      "provider_selector_drift",
      "room_selection_drift",
      "model_env_transient",
      "network_provider_failure",
      "provider_no_availability",
      "insufficient_evidence",
    ]) {
      expect(runbook).toContain(required);
    }
  });

  it("points hotel docs at the unified no-live artifact analyzer when it exists", async () => {
    await fs.access(UNIFIED_ANALYZER_PATH);
    const runbook = normalizeLineEndings(await fs.readFile(RUNBOOK_PATH, "utf8"));

    expect(runbook).toContain(
      "npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\\hotel-retry-artifact-bundle.json",
    );
    expect(runbook).toContain("The command only reads the local JSON bundle");
    expect(runbook).toContain("does not start a worker, open a provider, read the database, or click");
  });
});

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

describe("hotel retry artifact template", () => {
  it("is valid JSON with exact approved hotel start params", async () => {
    const template = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"));

    expect(template.job.provider).toBe("booking-com");
    expect(template.job.scenario).toBe("hotel");
    expect(template.job.params).toMatchObject(EXPECTED_PARAMS);
    expect(template.job.steps[0].body.params).toMatchObject(EXPECTED_PARAMS);
  });

  it("contains the required evidence fields and no-live safety note", async () => {
    const template = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"));

    expect(template.dbRow.id).toBeTruthy();
    expect(template.dbRow.task_id).toBeTruthy();
    expect(template.workerLogExcerpt).toContain("Synthetic fixture only");
    expect(template.workerLogPath).toContain("codex-worker.log");
    expect(template.screenshotPaths[0]).toContain("worker\\.debug-screenshots");
    expect(template.liveSnapshotPaths[0]).toContain(".debug-screenshots\\live");
    expect(template.notes.join("\n")).toContain("Replace every fixture value");
    expect(template.notes.join("\n")).toContain(
      "No payment, CVV, OTP, CAPTCHA, account prompt, or final confirmation was completed",
    );
  });
});
