/**
 * Save Expedia session cookies using Chrome remote debugging.
 *
 * Steps:
 *   1. Close Chrome completely
 *   2. Reopen Chrome with remote debugging:
 *      Windows: "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\%USERNAME%\AppData\Local\Google\Chrome\User Data"
 *      Mac:     /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   3. Log in to Expedia in that Chrome window
 *   4. Run: node scripts/save-expedia-cookies.mjs
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const COOKIE_DIR = path.join(process.cwd(), ".booking-cookies");
const COOKIE_FILE = path.join(COOKIE_DIR, "expedia.json");

async function main() {
  fs.mkdirSync(COOKIE_DIR, { recursive: true });

  console.log("\nConnecting to Chrome on localhost:9222...");
  console.log("(Make sure Chrome is open with --remote-debugging-port=9222)\n");

  let browser;
  try {
    browser = await chromium.connectOverCDP("http://localhost:9222");
  } catch {
    console.error("❌ Could not connect to Chrome.");
    console.error("\nMake sure you launched Chrome with:");
    console.error('   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome\\User Data"');
    process.exit(1);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    console.error("❌ No browser context found.");
    await browser.close();
    process.exit(1);
  }

  const context = contexts[0];

  // Make sure expedia.com is open and logged in
  let expediaPage = context.pages().find(p => p.url().includes("expedia.com"));
  if (!expediaPage) {
    console.log("No Expedia tab found — opening expedia.com...");
    expediaPage = await context.newPage();
    await expediaPage.goto("https://www.expedia.com", { waitUntil: "domcontentloaded" });
    console.log("Please log in if needed, then re-run this script.");
    await browser.disconnect();
    process.exit(0);
  }

  const cookies = await context.cookies("https://www.expedia.com");
  const expediaCookies = cookies.filter(c =>
    c.domain.includes("expedia") || c.domain.includes(".expedia")
  );

  if (!expediaCookies.length) {
    console.error("❌ No Expedia cookies found. Make sure you are logged in to Expedia.");
    await browser.disconnect();
    process.exit(1);
  }

  const data = { cookies: expediaCookies, savedAt: new Date().toISOString() };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));

  console.log(`✅ Saved ${expediaCookies.length} Expedia cookies to ${COOKIE_FILE}`);
  console.log("   The booking agent will now start in your logged-in Expedia session.\n");

  await browser.disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
