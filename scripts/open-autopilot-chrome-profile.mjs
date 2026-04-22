/**
 * Opens your real Google Chrome pointed at the autopilot's persistent user
 * data directory (.chrome-profile-autopilot). Use this to manually sign in
 * to sites like SeatGeek — the autopilot's real-Chrome branch will then
 * inherit the session automatically.
 *
 * Usage:
 *   node scripts/open-autopilot-chrome-profile.mjs [startUrl]
 *
 * Defaults startUrl to https://seatgeek.com/account/login. Close this Chrome
 * window before running the autopilot (Chrome does not allow two processes
 * sharing the same user data dir at the same time).
 *
 * Overrides:
 *   CHROME_EXECUTABLE_PATH  — explicit path to chrome.exe
 *   CHROME_USER_DATA_DIR    — persistent profile directory
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

function detectChromeExecutable() {
  const fromEnv = process.env.CHROME_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [];
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const pfx86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"];
    candidates.push(path.join(pf, "Google", "Chrome", "Application", "chrome.exe"));
    candidates.push(path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"));
    if (local) candidates.push(path.join(local, "Google", "Chrome", "Application", "chrome.exe"));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    candidates.push("/usr/bin/google-chrome");
    candidates.push("/usr/bin/google-chrome-stable");
    candidates.push("/snap/bin/chromium");
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

const exe = detectChromeExecutable();
if (!exe) {
  console.error(
    "❌ Could not find Chrome. Install Google Chrome or set CHROME_EXECUTABLE_PATH.",
  );
  process.exit(1);
}

const userDataDir =
  process.env.CHROME_USER_DATA_DIR ??
  path.join(process.cwd(), ".chrome-profile-autopilot");
fs.mkdirSync(userDataDir, { recursive: true });

const startUrl = process.argv[2] ?? "https://seatgeek.com/";

console.log(`\n✅ Opening Chrome — user data dir: ${userDataDir}`);
console.log(`   Target: ${startUrl}`);
console.log("   Sign in here, then close this Chrome window before running the autopilot.\n");

const args = [
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  startUrl,
];
const child = spawn(exe, args, { stdio: "inherit", detached: false });
child.on("exit", (code) => process.exit(code ?? 0));
