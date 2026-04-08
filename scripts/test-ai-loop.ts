/**
 * Integration test for Phase 1 AI loop.
 * Runs against a real browser with a simple public form page.
 *
 * Usage (from project root):
 *   npx tsx scripts/test-ai-loop.ts
 *
 * Requires: ANTHROPIC_API_KEY in .env.local
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Stagehand } from "@browserbasehq/stagehand";
import { runAIBookingLoop } from "../lib/booking-autopilot/ai-loop/loop";
import type { BookingProfile } from "../lib/booking-autopilot/types";

// ── Load .env.local (no dotenv needed) ───────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const TEST_PROFILE: BookingProfile = {
  first_name: "John",
  last_name: "Doe",
  email: "john.doe@example.com",
  phone: "+1 555 000 1234",
  country: "US",
};

async function runTest() {
  console.log("=== AI Loop Phase 1 Integration Test ===\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set — check .env.local");
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { headless: false },
    modelName: "claude-haiku-4-5-20251001",
    modelClientOptions: { apiKey: process.env.ANTHROPIC_API_KEY },
  });

  await stagehand.init();

  // Navigate using the active page
  const navPage = stagehand.context.activePage() ?? await stagehand.context.newPage();

  // httpbin.org/forms/post — simple public HTML form, no login, no bot detection
  const TEST_URL = "https://httpbin.org/forms/post";
  console.log(`Navigating to: ${TEST_URL}`);
  await (navPage as any).goto(TEST_URL, { waitForLoadState: "domcontentloaded", timeoutMs: 15_000 });

  const task = `Fill out the pizza order form on this page:
- custname: "${TEST_PROFILE.first_name} ${TEST_PROFILE.last_name}"
- custemail: "${TEST_PROFILE.email}"
- size: medium
- Select any topping
Then click the Submit Order button.`;

  console.log(`\nTask:\n${task}`);
  console.log("\nStarting AI loop...\n");

  const trace = (msg: string) => console.log(" ", msg);

  // Pass the Stagehand V3 instance — stagehand.act() is the correct API,
  // not page.act() (pages from activePage() are raw CDP pages without .act()).
  const result = await runAIBookingLoop(stagehand as any, task, TEST_PROFILE, { trace, maxSteps: 15 });

  console.log("\n=== Result ===");
  console.log("Outcome  :", result.outcome);
  console.log("Final URL:", result.finalUrl);
  console.log("Steps    :", result.steps.length);
  console.log("Summary  :", result.summary);
  console.log("\nStep breakdown:");
  for (const s of result.steps) {
    const inst = s.action.instruction ? ` "${s.action.instruction.slice(0, 50)}"` : "";
    console.log(
      `  ${s.stepIndex + 1}. [${s.stage}] ${s.action.type}${inst}` +
      ` — ${s.action.reasoning.slice(0, 60)} (${s.durationMs}ms)`
    );
  }

  await stagehand.close();
  console.log("\n✓ Test complete");
}

runTest().catch(err => {
  console.error("\n✗ Test failed:", err);
  process.exit(1);
});
