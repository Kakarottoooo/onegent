/**
 * One-time script: open a Playwright browser, let you log in to Ticketmaster,
 * then save the session cookies to .ticketmaster-cookies.json.
 *
 * Usage:
 *   node scripts/save-ticketmaster-cookies.mjs
 *
 * After running, the autopilot will automatically load these cookies
 * whenever it starts a Ticketmaster booking session. Same pattern as
 * save-booking-cookies.mjs — we stay in the Playwright Chromium so the
 * browser fingerprint matches what the autopilot uses at runtime. This
 * matters for Ticketmaster more than other sites because their _abck /
 * reese84 anti-bot cookies are bound to UA + fingerprint.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const COOKIES_FILE = path.join(process.cwd(), ".ticketmaster-cookies.json");

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.ticketmaster.com/", {
    waitUntil: "domcontentloaded",
  });

  console.log("\n✅ Browser opened — please sign in to your Ticketmaster account.");
  console.log("   Click 'Sign In/Register' in the top right, then complete the login flow.");
  console.log("   After you are fully logged in, come back here and press Enter.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question("Press Enter when logged in... ", resolve));
  rl.close();

  // Grab cookies for all ticketmaster.com + livenation.com (TM's auth parent) domains.
  const allCookies = await context.cookies();
  const tmCookies = allCookies.filter((c) =>
    c.domain.includes("ticketmaster.com") ||
    c.domain.includes("livenation.com") ||
    c.domain.includes("ticketmaster.ca")
  );

  if (tmCookies.length === 0) {
    console.error("❌ No Ticketmaster cookies found. Are you sure you logged in?");
    await browser.close();
    process.exit(1);
  }

  fs.writeFileSync(COOKIES_FILE, JSON.stringify(tmCookies, null, 2));

  console.log(`\n✅ Saved ${tmCookies.length} cookies to ${COOKIES_FILE}`);
  console.log("   The autopilot will now automatically use your logged-in Ticketmaster session.\n");

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
