/**
 * Manual end-to-end test for Expedia provider (US-007).
 *
 * Usage:
 *   npx tsx scripts/test-expedia.mjs
 *   npx tsx scripts/test-expedia.mjs hotels   ← test Hotels.com instead
 *
 * Requires: ANTHROPIC_API_KEY + OPENAI_API_KEY in .env.local
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

process.env.AI_LOOP_FULL = "true";

const provider = process.argv[2] === "hotels" ? "hotels" : "expedia";

// ── Build start URL ──────────────────────────────────────────────────────────
const HOTEL_NAME = "Hilton Garden Inn Times Square";
const CITY       = "New York";
const CHECKIN    = "2026-05-26";
const CHECKOUT   = "2026-05-28";
const ADULTS     = 2;

let startUrl;
if (provider === "hotels") {
  // Hotels.com search URL
  startUrl = `https://www.hotels.com/search?destination=${encodeURIComponent(HOTEL_NAME + " " + CITY)}&startDate=${CHECKIN}&endDate=${CHECKOUT}&adults=${ADULTS}&rooms=1`;
} else {
  // Expedia search URL
  startUrl = `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(HOTEL_NAME + " " + CITY)}&startDate=${CHECKIN}&endDate=${CHECKOUT}&adults=${ADULTS}&rooms=1`;
}

console.log(`\n=== OneAgent — ${provider.toUpperCase()} Provider Test ===`);
console.log(`Hotel  : ${HOTEL_NAME}`);
console.log(`City   : ${CITY}`);
console.log(`Dates  : ${CHECKIN} → ${CHECKOUT}`);
console.log(`URL    : ${startUrl}\n`);

// ── Load profile from .booking-cookies.json path convention ─────────────────
// Uses the same test profile shape as the main app.
const TEST_PROFILE = {
  first_name:   "Ziwei",
  last_name:    "Guo",
  email:        "gzw13979725269@gmail.com",
  phone:        "2235331053",
  country:      "United States",
  zip:          process.env.TEST_BILLING_ZIP ?? "10001",
  card_name:    "Ziwei Guo",
  card_number:  process.env.TEST_CARD_NUMBER  ?? "4111111111111111",
  card_expiry:  process.env.TEST_CARD_EXPIRY  ?? "12/28",
};

const { runBrowserTask } = await import("../lib/booking-autopilot/stagehand-executor.js");

const result = await runBrowserTask({
  startUrl,
  task: `Find ${HOTEL_NAME} hotel in ${CITY} and book a room for ${ADULTS} adults, checking in ${CHECKIN} and checking out ${CHECKOUT}. Select the cheapest available room. Fill in guest information completely.`,
  profile: TEST_PROFILE,
  jobId: `test-${provider}-${Date.now()}`,
  stepIndex: 0,
});

console.log("\n=== RESULT ===");
console.log("Status  :", result.status);
console.log("Summary :", result.summary);
if (result.error) console.log("Error   :", result.error);
console.log("\nTrace:");
(result.debugTrace ?? []).forEach(line => console.log(" ", line));
