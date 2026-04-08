/**
 * One-time script: open a real browser, let you log in to Booking.com,
 * then save the session cookies to .booking-cookies.json.
 *
 * Usage:
 *   node scripts/save-booking-cookies.mjs
 *
 * After running, the executor will automatically load these cookies
 * whenever it starts a Booking.com booking session.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const COOKIES_FILE = path.join(process.cwd(), ".booking-cookies.json");

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.booking.com/signin.html", {
    waitUntil: "domcontentloaded",
  });

  console.log("\n✅ Browser opened — please log in to your Booking.com account.");
  console.log("   After you are fully logged in, come back here and press Enter.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question("Press Enter when logged in... ", resolve));
  rl.close();

  const cookies = await context.cookies("https://www.booking.com");
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));

  console.log(`\n✅ Saved ${cookies.length} cookies to ${COOKIES_FILE}`);
  console.log("   The booking executor will now automatically use your logged-in session.\n");

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
