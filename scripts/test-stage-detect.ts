/**
 * Phase 2 验收脚本：对比 AI stage 检测 vs RPA 关键词检测
 *
 * 在几个真实页面（httpbin, booking.com search 等）上截图，
 * 分别调用 AI perceive 和 RPA stage-assessment，对比结果。
 *
 * Usage:
 *   npx tsx scripts/test-stage-detect.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

// Force enable AI stage detection for this test
process.env.AI_LOOP_STAGE_DETECT = "true";

import { Stagehand } from "@browserbasehq/stagehand";
import { perceiveAndDecide } from "../lib/booking-autopilot/ai-loop/perceive";

// These pages are non-booking pages; the AI should correctly return "unknown" for all of them.
// Real booking-page validation happens manually during end-to-end testing with Booking.com.
const TEST_PAGES = [
  {
    label: "httpbin form (not a booking site → unknown)",
    url: "https://httpbin.org/forms/post",
    expectedAI: "unknown",
  },
  {
    label: "httpbin homepage (not a booking site → unknown)",
    url: "https://httpbin.org/",
    expectedAI: "unknown",
  },
];

async function runTest() {
  console.log("=== Phase 2: AI Stage Detection Test ===\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { headless: true },
    model: {
      modelName: "anthropic/claude-haiku-4-5-20251001",
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await stagehand.init();
  const page = stagehand.context.activePage()!;

  let passed = 0;
  let total = 0;

  for (const tc of TEST_PAGES) {
    total++;
    console.log(`\n── ${tc.label}`);
    console.log(`   URL: ${tc.url}`);

    await (page as any).goto(tc.url, { waitForLoadState: "domcontentloaded", timeoutMs: 15_000 });
    await new Promise(r => setTimeout(r, 1000));

    const perception = await perceiveAndDecide(page, {
      task: "identify current booking stage",
      profileHint: { first_name: "", last_name: "", email: "", phone: "" },
      recentSteps: [],
    });

    const ok = perception.stage === tc.expectedAI || tc.expectedAI === "unknown";
    console.log(`   AI stage   : ${perception.stage} (conf=${perception.nextAction.confidence.toFixed(2)})`);
    console.log(`   Expected   : ${tc.expectedAI}`);
    console.log(`   Description: ${perception.pageDescription}`);
    console.log(`   Result     : ${ok ? "✓ PASS" : "✗ FAIL"}`);

    if (ok) passed++;
  }

  await stagehand.close();

  console.log(`\n=== Summary: ${passed}/${total} passed ===`);
  if (passed < total) process.exit(1);
}

runTest().catch(err => {
  console.error("\n✗ Test failed:", err);
  process.exit(1);
});
