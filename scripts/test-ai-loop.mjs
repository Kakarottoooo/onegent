/**
 * Integration test for Phase 1 AI loop.
 * Runs against a real browser with a simple public form page.
 *
 * Usage:
 *   node scripts/test-ai-loop.mjs
 *
 * Requires: ANTHROPIC_API_KEY in environment (or .env.local)
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env.local") });

// Dynamic import after env is loaded
const { chromium } = await import("playwright");
const { Stagehand } = await import("@browserbasehq/stagehand");

// ── Minimal stubs to run loop without full Next.js stack ──────────────────────
const { runAIBookingLoop } = await import("../lib/booking-autopilot/ai-loop/loop.js");

const TEST_PROFILE = {
  first_name: "John",
  last_name: "Doe",
  email: "john.doe@example.com",
  phone: "+1 555 000 1234",
  country: "US",
};

async function runTest() {
  console.log("=== AI Loop Phase 1 Integration Test ===\n");

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
    },
    modelName: "claude-haiku-4-5-20251001",
    modelClientOptions: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await stagehand.init();
  const page = stagehand.context.activePage() ?? await stagehand.context.newPage();

  // Test against a simple public contact form
  const TEST_URL = "https://www.w3schools.com/html/tryit.asp?filename=tryhtml_form_submit";

  console.log(`Navigating to: ${TEST_URL}`);
  await page.goto(TEST_URL, { waitForLoadState: "domcontentloaded", timeoutMs: 15_000 });

  const trace = (msg) => console.log("  " + msg);

  const task = `Fill out the contact form with first name "${TEST_PROFILE.first_name}" and submit it`;

  console.log(`\nTask: ${task}`);
  console.log("Starting AI loop...\n");

  const result = await runAIBookingLoop(
    // Stagehand page needs to be accessed via page.page for raw Playwright methods
    page.page ?? page,
    task,
    TEST_PROFILE,
    { trace, maxSteps: 10 },
  );

  console.log("\n=== Result ===");
  console.log("Outcome:", result.outcome);
  console.log("Final URL:", result.finalUrl);
  console.log("Steps taken:", result.steps.length);
  console.log("Summary:", result.summary);
  console.log("\nStep breakdown:");
  result.steps.forEach(s => {
    console.log(`  ${s.stepIndex + 1}. [${s.stage}] ${s.action.type} — ${s.action.reasoning.slice(0, 60)} (${s.durationMs}ms)`);
  });

  await stagehand.close();
  console.log("\n✓ Test complete");
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
