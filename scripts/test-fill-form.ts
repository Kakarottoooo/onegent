/**
 * Phase 3 验收脚本：AI form filling
 *
 * 在 httpbin.org/forms/post 上用 fillGuestFormWithAI() 填写表单，
 * 验证所有字段被正确填入后能提交。
 *
 * Usage:
 *   npx tsx scripts/test-fill-form.ts
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

import { Stagehand } from "@browserbasehq/stagehand";
import { fillGuestFormWithAI } from "../lib/booking-autopilot/ai-loop/fill-form";

const TEST_PROFILE = {
  first_name: "Jane",
  last_name: "Smith",
  email: "jane.smith@example.com",
  phone: "5551234567",
  country: "US",
};

async function run() {
  console.log("=== Phase 3: AI Form Filling Test ===\n");

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { headless: false },
    model: {
      modelName: "anthropic/claude-haiku-4-5-20251001",
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await stagehand.init();
  const page = stagehand.context.activePage()!;

  const TEST_URL = "https://httpbin.org/forms/post";
  console.log(`Navigating to: ${TEST_URL}\n`);
  await (page as any).goto(TEST_URL, { waitForLoadState: "domcontentloaded", timeoutMs: 15_000 });
  await new Promise(r => setTimeout(r, 800));

  const trace = (msg: string) => console.log(" ", msg);

  console.log("Filling guest form fields...\n");
  const result = await fillGuestFormWithAI(stagehand, TEST_PROFILE, trace);

  console.log(`\nFill result:`);
  console.log(`  Filled : ${result.filled.join(", ") || "(none)"}`);
  console.log(`  Failed : ${result.failed.join(", ") || "(none)"}`);

  // Submit the form
  console.log("\nSubmitting form...");
  await stagehand.act("click the Submit Order button");
  await new Promise(r => setTimeout(r, 2000));

  const finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);

  const submitted = finalUrl.includes("httpbin.org/post");
  console.log(`\nSubmission: ${submitted ? "✓ SUCCESS" : "✗ FAILED (expected httpbin.org/post)"}`);

  const filledOk = result.filled.length >= 2 && result.failed.length === 0;
  console.log(`Fields filled: ${filledOk ? "✓ OK" : "✗ Some fields failed"}`);

  await stagehand.close();

  if (!submitted || !filledOk) process.exit(1);
  console.log("\n✓ Phase 3 test complete");
}

run().catch(err => {
  console.error("\n✗ Test failed:", err);
  process.exit(1);
});
