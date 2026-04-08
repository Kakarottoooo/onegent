/**
 * Phase 4 验收脚本：AI listing selection + room picking
 *
 * 用一个公开的模拟酒店列表页（hotels.com 或 Airbnb 公开结果）验证：
 * 1. clickTargetListingAI — 能在列表中找到目标酒店并点击
 * 2. selectCheapestRoomAI — 进入详情页后能选房间
 *
 * 由于真实预订网站有反爬限制，这里用 booking.com 搜索结果做冒烟测试。
 * 主要验证：函数调用不报错、act() 指令被正确执行。
 *
 * Usage:
 *   npx tsx scripts/test-find-listing.ts
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
import { clickTargetListingAI, selectCheapestRoomAI } from "../lib/booking-autopilot/ai-loop/find-listing";

async function run() {
  console.log("=== Phase 4: AI Listing + Room Selection Test ===\n");

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
  const trace = (msg: string) => console.log(" ", msg);

  // ── Test 1: clickTargetListingAI on a public hotel search page ──
  console.log("── Test 1: clickTargetListingAI ──");
  // Use a Hotels.com search results page (public, no login)
  const searchUrl = "https://www.hotels.com/search.do?destination=New+York&checkIn=2025-09-01&checkOut=2025-09-02&rooms=1&adults=1";
  console.log(`  Navigating to Hotels.com search...\n`);

  try {
    await (page as any).goto(searchUrl, { waitForLoadState: "domcontentloaded", timeoutMs: 20_000 });
    await new Promise(r => setTimeout(r, 2000));

    const result = await clickTargetListingAI(stagehand, "Marriott", trace, 3);
    console.log(`\n  Result: ${result}`);
    console.log(`  Final URL: ${page.url().slice(0, 80)}`);
    console.log(`  Status: ${result !== "not_found" ? "✓ Function executed without error" : "⚠ Hotel not found (may be normal for test data)"}`);
  } catch (err) {
    console.log(`  ✗ Error: ${(err as Error).message?.slice(0, 100)}`);
  }

  // ── Test 2: selectCheapestRoomAI on a hotel detail page ──
  console.log("\n── Test 2: selectCheapestRoomAI ──");
  // Navigate to a hotel detail page
  const hotelUrl = "https://www.hotels.com/ho113769/";
  console.log(`  Navigating to hotel detail page...\n`);

  try {
    await (page as any).goto(hotelUrl, { waitForLoadState: "domcontentloaded", timeoutMs: 20_000 });
    await new Promise(r => setTimeout(r, 2000));

    const result = await selectCheapestRoomAI(stagehand, trace);
    console.log(`\n  Result: ${result}`);
    console.log(`  Final URL: ${page.url().slice(0, 80)}`);
    console.log(`  Status: ${result !== "no_availability" ? "✓ Function executed without error" : "⚠ No availability (may be normal for test data)"}`);
  } catch (err) {
    console.log(`  ✗ Error: ${(err as Error).message?.slice(0, 100)}`);
  }

  await stagehand.close();
  console.log("\n✓ Phase 4 smoke test complete");
  console.log("  Note: full validation requires real booking site sessions");
}

run().catch(err => {
  console.error("\n✗ Test failed:", err);
  process.exit(1);
});
