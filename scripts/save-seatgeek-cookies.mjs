/**
 * One-time script: open a Playwright browser, let you log in to SeatGeek,
 * then save the session cookies to .seatgeek-cookies.json.
 *
 * Usage:
 *   node scripts/save-seatgeek-cookies.mjs
 *
 * After running, the autopilot will automatically load these cookies
 * whenever it starts a SeatGeek booking session. Same pattern as
 * save-ticketmaster-cookies.mjs — we stay in the Playwright Chromium so the
 * browser fingerprint matches what the autopilot uses at runtime.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const COOKIES_FILE = path.join(process.cwd(), ".seatgeek-cookies.json");

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://seatgeek.com/", {
    waitUntil: "domcontentloaded",
  });

  console.log("\n✅ Browser opened — please sign in to your SeatGeek account.");
  console.log("   Click 'Log In' in the top right, then complete the login flow.");
  console.log("   After you are fully logged in, come back here and press Enter.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question("Press Enter when logged in... ", resolve));
  rl.close();

  // Grab cookies for all seatgeek.com domains (no parent auth domain for SG).
  const allCookies = await context.cookies();
  const sgCookies = allCookies.filter((c) => c.domain.includes("seatgeek.com"));

  if (sgCookies.length === 0) {
    console.error("❌ No SeatGeek cookies found. Are you sure you logged in?");
    await browser.close();
    process.exit(1);
  }

  fs.writeFileSync(COOKIES_FILE, JSON.stringify(sgCookies, null, 2));

  console.log(`\n✅ Saved ${sgCookies.length} cookies to ${COOKIES_FILE}`);
  console.log("   The autopilot will now automatically use your logged-in SeatGeek session.\n");

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
