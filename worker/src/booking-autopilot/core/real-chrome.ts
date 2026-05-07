/**
 * real-chrome.ts
 *
 * Opt-in branch that launches the autopilot against the user's real Google
 * Chrome (instead of Playwright's bundled Chromium) with a persistent user
 * data dir. Used to bypass aggressive bot detectors (DataDome on SeatGeek)
 * that fingerprint Playwright's default build.
 *
 * Activation: set USE_REAL_CHROME_FOR=<csv of substrings>. A task is routed
 * through this path when its startUrl contains any substring in the list.
 * Example: USE_REAL_CHROME_FOR=seatgeek
 *
 * Env overrides:
 *   CHROME_EXECUTABLE_PATH  — full path to chrome.exe (auto-detected if unset)
 *   CHROME_USER_DATA_DIR    — user data directory (defaults to
 *                             <cwd>/.chrome-profile-autopilot)
 *
 * Everything else (TM, hotels, flights, restaurants) keeps the existing
 * Playwright Chromium path — this module is a no-op unless the flag matches.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface RealChromeOptions {
  executablePath?: string;
  userDataDir: string;
  preserveUserDataDir: true;
  args?: string[];
}

/**
 * Returns true when the startUrl matches any substring in USE_REAL_CHROME_FOR.
 * Comparison is case-insensitive. Empty / unset flag → always false.
 */
export function shouldUseRealChrome(startUrl: string): boolean {
  const raw = process.env.USE_REAL_CHROME_FOR;
  if (!raw) return false;
  const needles = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return false;
  const hay = startUrl.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

/**
 * Auto-detect Chrome executable on Windows / macOS / Linux. Returns undefined
 * when nothing is found — caller should fall back to Playwright Chromium.
 */
function detectChromeExecutable(): string | undefined {
  const fromEnv = process.env.CHROME_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates: string[] = [];
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

/**
 * Resolve the persistent Chrome user data dir path. Kept as a separate helper
 * because callers (e.g. the executor's pre-launch cleanup) need the path
 * *before* constructing launch options. Must match the resolution done inside
 * buildRealChromeLaunchOptions.
 */
export function resolveRealChromeUserDataDir(): string {
  return (
    process.env.CHROME_USER_DATA_DIR ??
    path.join(process.cwd(), ".chrome-profile-autopilot")
  );
}

/**
 * Kill any chrome.exe processes still holding a lock on `userDataDir` from a
 * prior autopilot run. Chrome's single-instance lock on userDataDir is what
 * caused new Playwright launches to fail with ECONNREFUSED on the CDP port —
 * the new Chrome child exits immediately because the profile is busy, so the
 * requested --remote-debugging-port never binds.
 *
 * We only kill processes whose command line contains the *exact* userDataDir
 * path. Never kill the user's normal Chrome browser — that one uses a
 * different profile dir (e.g. "AppData\Local\Google\Chrome\User Data").
 *
 * Safe to call when no stale processes exist (logs "nothing to clean" and
 * returns). Swallows all errors — this is a best-effort cleanup, the
 * subsequent Chrome launch will fail loudly if it didn't work.
 */
export async function ensureUserDataDirFree(
  userDataDir: string,
  trace: (msg: string) => void,
): Promise<void> {
  try {
    const pids = await findChromePidsUsingDir(userDataDir);
    if (pids.length === 0) {
      return;
    }
    trace(`[real-chrome] Found ${pids.length} stale Chrome process(es) locking userDataDir — killing: ${pids.join(", ")}`);
    await killPids(pids);
    // Chrome needs a moment to release the profile lock file after SIGKILL.
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    trace(`[real-chrome] userDataDir cleanup failed (continuing anyway): ${(err as Error).message?.slice(0, 160)}`);
  }
}

/**
 * Return PIDs of chrome.exe processes whose command line references
 * `userDataDir`. Windows uses a PowerShell WMI query (wmic is deprecated on
 * Win11). macOS/Linux use `ps -eo`. Match is literal-string — not regex.
 */
async function findChromePidsUsingDir(userDataDir: string): Promise<number[]> {
  if (process.platform === "win32") {
    // PowerShell WMI — CommandLine includes the full arg string. We match
    // case-insensitively because Windows paths are case-insensitive.
    const dirEscaped = userDataDir.replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${dirEscaped}*' } | Select-Object -ExpandProperty ProcessId`;
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      ps,
    ], { timeout: 10000 });
    return stdout
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  // macOS / Linux: ps -eo pid,command
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,command="], { timeout: 10000 });
  const needle = `--user-data-dir=${userDataDir}`;
  const needleQuoted = `--user-data-dir="${userDataDir}"`;
  const pids: number[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes(needle) && !line.includes(needleQuoted)) continue;
    const m = line.trim().match(/^(\d+)\s/);
    if (m) {
      const pid = parseInt(m[1], 10);
      if (Number.isFinite(pid) && pid > 0) pids.push(pid);
    }
  }
  return pids;
}

/** Force-kill the given PIDs. Errors swallowed per-PID so one zombie doesn't block others. */
async function killPids(pids: number[]): Promise<void> {
  if (process.platform === "win32") {
    for (const pid of pids) {
      try {
        await execFileAsync("taskkill", ["/F", "/PID", String(pid), "/T"], { timeout: 8000 });
      } catch {
        // already gone or access denied — skip
      }
    }
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone — skip
    }
  }
}

/**
 * Build the Stagehand localBrowserLaunchOptions overrides for the real-Chrome
 * branch. Creates the user data dir if missing. Called only when
 * shouldUseRealChrome(startUrl) returns true.
 */
export function buildRealChromeLaunchOptions(
  trace: (msg: string) => void,
): RealChromeOptions {
  const userDataDir = resolveRealChromeUserDataDir();
  const viewportWidth = Number(process.env.ONEGENT_BROWSER_VIEWPORT_WIDTH) || 1365;
  const viewportHeight = Number(process.env.ONEGENT_BROWSER_VIEWPORT_HEIGHT) || 900;

  fs.mkdirSync(userDataDir, { recursive: true });

  const executablePath = detectChromeExecutable();
  if (!executablePath) {
    trace(
      "[real-chrome] WARNING: Could not find real Chrome. Falling back to bundled Chromium — DataDome may still block. Install Chrome or set CHROME_EXECUTABLE_PATH.",
    );
  } else {
    trace(`[real-chrome] Using ${executablePath}`);
  }
  trace(`[real-chrome] userDataDir = ${userDataDir}`);

  return {
    executablePath,
    userDataDir,
    preserveUserDataDir: true,
    args: [`--window-size=${viewportWidth},${viewportHeight}`],
  };
}
