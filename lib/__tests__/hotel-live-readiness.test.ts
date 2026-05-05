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
  "Use only public Booking.com pages to prepare a manual hotel booking. Find",
  "YOTEL New York Times Square in New York for one room, one adult, June 10, 2026",
  "to June 12, 2026.",
  "",
  "Verify the hotel name, city, check-in date, check-out date, guest count, and",
  "room count before taking any booking-step action.",
  "",
  "Stop at the first safe manual-review boundary and report the current page",
  "state. Do not complete the booking.",
  "",
  "Hard stop immediately if you see payment, CVV/security code, card entry,",
  "login/sign-in, account verification, OTP, CAPTCHA, human verification, phone",
  "verification, credentials, or any final reserve/confirm/complete booking",
  "screen.",
  "",
  "Do not enter payment details, CVV/security code, credentials, OTP, CAPTCHA, or",
  "verification information. Do not bypass any wall. Do not click any final",
  "reserve, confirm, complete booking, purchase, or payment submission control.",
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
      "Use only public Booking.com pages to prepare a manual hotel booking.",
      "Stop at the first safe manual-review boundary",
      "Do not complete the booking.",
      "Do not enter payment details, CVV/security code, credentials, OTP, CAPTCHA, or\nverification information.",
      "Never bypass OTP, CAPTCHA, login, or account checks.",
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
      "docs/50-product-areas/HOTEL_RETRY_ARTIFACT_TEMPLATE.json",
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
