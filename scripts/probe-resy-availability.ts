import { chromium, type Browser, type Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ResyCase = {
  id: string;
  restaurantName: string;
  city: string;
  date: string;
  time: string;
  covers: number;
  resySlug?: string;
  fallbackPolicy?: { time_window_minutes?: number };
};

type Suite = {
  cases: ResyCase[];
};

type SlotCandidate = {
  text: string;
  minutes: number;
  diffMinutes: number;
  dateIso?: string | null;
  href?: string | null;
  tagName?: string;
  source: "api" | "dom";
  token?: string | null;
  venueSlug?: string | null;
  venueName?: string | null;
};

type CaseProbeResult = {
  caseId: string;
  restaurantName: string;
  url: string;
  targetTime: string;
  targetMinutes: number;
  allowedWindowMinutes: number;
  probeSource: "api" | "api+browser" | "browser";
  apiStatus?: number;
  apiVenueName?: string;
  apiVenueSlug?: string;
  apiError?: string;
  pageUrl: string;
  title: string;
  slots: SlotCandidate[];
  matchingSlots: SlotCandidate[];
  noAvailabilitySignals: string[];
  blockerSignals: string[];
  bodySnippet: string;
  screenshotPath?: string;
  recommendation: "use_for_live_fill_test" | "no_matching_slot" | "blocked_or_unknown";
};

type ProbeReport = {
  runId: string;
  createdAt: string;
  suitePath: string;
  visible: boolean;
  results: CaseProbeResult[];
  recommendedCase?: CaseProbeResult;
  recommendedCases: CaseProbeResult[];
};

const CASES_PATH = path.join(process.cwd(), "benchmark", "restaurant-resy-phase0.json");
const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");
const RESY_PUBLIC_API_KEY =
  process.env.RESY_PUBLIC_API_KEY ?? "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

type ResySearchHit = {
  name?: string;
  url_slug?: string;
  availability?: {
    slots?: Array<{
      date?: { start?: string; end?: string };
      config?: { token?: string; type?: string };
    }>;
  } | null;
};

type ResySearchResponse = {
  search?: {
    hits?: ResySearchHit[];
  };
};

type ApiSlotResult = {
  status: number;
  venueName?: string;
  venueSlug?: string;
  slots: SlotCandidate[];
  error?: string;
};

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseTimeToMinutes(time: string): number {
  const trimmed = time.trim();
  const match24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match24) return Number(match24[1]) * 60 + Number(match24[2]);

  const match12 = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(trimmed);
  if (!match12) throw new Error(`Unsupported time format: ${time}`);
  let hour = Number(match12[1]);
  const minute = Number(match12[2] ?? "0");
  const meridiem = match12[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function minutesDiff(a: number, b: number): number {
  return Math.abs(a - b);
}

function citySlug(city: string): string {
  const normalized = city.trim().toLowerCase();
  if (normalized === "new york" || normalized === "nyc" || normalized === "new york city") {
    return "new-york-ny";
  }
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resyStartUrl(testCase: ResyCase): string {
  if (!testCase.resySlug) {
    throw new Error(`${testCase.id} missing resySlug`);
  }
  const params = new URLSearchParams({
    date: testCase.date,
    seats: String(testCase.covers),
    time: testCase.time,
  });
  return `https://resy.com/cities/${citySlug(testCase.city)}/venues/${testCase.resySlug}?${params.toString()}`;
}

function formatMinutes12(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function normalizeSlug(slug: string | undefined): string {
  return (slug ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function geoForCity(city: string): { latitude: number; longitude: number; radius: number } {
  const normalized = city.trim().toLowerCase();
  if (normalized === "new york" || normalized === "nyc" || normalized === "new york city") {
    return { latitude: 40.712941, longitude: -74.006393, radius: 16_100 };
  }
  // Keep non-NYC probes deterministic. Unknown cities still use the city query,
  // but the geo fallback prevents Resy from using the runner's current IP city.
  return { latitude: 40.712941, longitude: -74.006393, radius: 16_100 };
}

function slotFromApi(slot: NonNullable<NonNullable<ResySearchHit["availability"]>["slots"]>[number], targetMinutes: number): SlotCandidate | null {
  const start = slot.date?.start;
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/.exec(start ?? "");
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  const seating = slot.config?.type ? ` ${slot.config.type}` : "";
  return {
    text: `${formatMinutes12(minutes)}${seating}`.trim(),
    minutes,
    diffMinutes: minutesDiff(minutes, targetMinutes),
    dateIso: match[1],
    href: null,
    tagName: "api-slot",
    source: "api",
    token: slot.config?.token ?? null,
  };
}

async function fetchApiSlots(testCase: ResyCase, targetMinutes: number): Promise<ApiSlotResult> {
  const slotFilter: Record<string, string | number> = {
    day: testCase.date,
    party_size: testCase.covers,
    time_filter: testCase.time,
  };
  const body = {
    availability: true,
    page: 1,
    per_page: 20,
    slot_filter: slotFilter,
    types: ["venue"],
    order_by: "availability",
    geo: geoForCity(testCase.city),
    query: testCase.restaurantName,
  };

  const response = await fetch("https://api.resy.com/3/venuesearch/search", {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `ResyAPI api_key="${RESY_PUBLIC_API_KEY}"`,
      "content-type": "application/json",
      origin: "https://resy.com",
      referer: "https://resy.com/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "x-origin": "https://resy.com",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    return { status: response.status, slots: [], error: text.slice(0, 500) };
  }

  let parsed: ResySearchResponse;
  try {
    parsed = JSON.parse(text) as ResySearchResponse;
  } catch (error) {
    return {
      status: response.status,
      slots: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const expectedSlug = normalizeSlug(testCase.resySlug);
  const hits = parsed.search?.hits ?? [];
  const exactHit = hits.find((hit) => normalizeSlug(hit.url_slug) === expectedSlug);
  if (!exactHit) {
    const returned = hits
      .slice(0, 5)
      .map((hit) => `${hit.name ?? "(unnamed)"}:${hit.url_slug ?? "(no-slug)"}`)
      .join(", ");
    return {
      status: response.status,
      slots: [],
      error: `Exact venue slug ${testCase.resySlug} not returned. Top hits: ${returned}`,
    };
  }

  return {
    status: response.status,
    venueName: exactHit.name,
    venueSlug: exactHit.url_slug,
    slots: (exactHit.availability?.slots ?? [])
      .map((slot) => slotFromApi(slot, targetMinutes))
      .filter((slot): slot is SlotCandidate => Boolean(slot))
      .map((slot) => ({
        ...slot,
        venueSlug: exactHit.url_slug ?? null,
        venueName: exactHit.name ?? null,
      }))
      .sort((a, b) => a.diffMinutes - b.diffMinutes || a.minutes - b.minutes),
  };
}

async function collectSlots(page: Page, targetMinutes: number): Promise<SlotCandidate[]> {
  // Use a raw string expression instead of a serialized function. The tsx/esbuild
  // dev transform can inject a `__name` helper into function bodies, and that
  // helper is not defined inside Playwright's browser execution context.
  const rawSlots = (await page.evaluate(`(() => {
    const target = ${JSON.stringify(targetMinutes)};
    const timePattern = /\\b(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s*(AM|PM)\\b/gi;
    const months = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      sept: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12"
    };

    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };

    const parseMinutes = (text) => {
      const match = /\\b(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s*(AM|PM)\\b/i.exec(text);
      if (!match) return null;
      let hour = Number(match[1]);
      const minute = Number(match[2] || "0");
      const meridiem = match[3].toUpperCase();
      if (meridiem === "PM" && hour !== 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      return hour * 60 + minute;
    };

    const parseDateIso = (text) => {
      const match = /\\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\\.?\\s*,?\\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+(\\d{1,2}),\\s*(\\d{4})\\b/i.exec(text);
      if (!match) return null;
      const month = months[match[1].toLowerCase().replace(".", "")];
      if (!month) return null;
      return [match[3], month, String(Number(match[2])).padStart(2, "0")].join("-");
    };

    const elements = Array.from(document.querySelectorAll("button, a, [role='button'], [role='link'], [tabindex='0']"));
    const slots = [];

    for (const el of elements) {
      if (!visible(el)) continue;
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (text.length > 120) continue;
      if (/\\b(All Day|Guests?|Date|Time|Log in|Notify|results?|search|newsletter|privacy|terms)\\b/i.test(text)) continue;
      if (!text || !timePattern.test(text)) {
        timePattern.lastIndex = 0;
        continue;
      }
      timePattern.lastIndex = 0;
      const minutes = parseMinutes(text);
      if (minutes == null) continue;
      slots.push({
        text,
        minutes,
        diffMinutes: Math.abs(minutes - Number(target)),
        dateIso: parseDateIso(text),
        href: el.href || null,
        tagName: el.tagName.toLowerCase(),
        source: "dom",
      });
    }

    return slots;
  })()`)) as SlotCandidate[];

  const seen = new Set<string>();
  return rawSlots
    .filter((slot) => {
      const key = `${slot.text}|${slot.minutes}|${slot.href ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.diffMinutes - b.diffMinutes || a.minutes - b.minutes);
}

async function collectSignals(page: Page): Promise<{
  title: string;
  bodySnippet: string;
  noAvailabilitySignals: string[];
  blockerSignals: string[];
}> {
  const title = await page.title().catch(() => "");
  const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  const lower = text.toLowerCase();

  const noAvailabilityChecks = [
    "notify",
    "nothing available",
    "no times",
    "sold out",
    "unavailable",
    "reservation unavailable",
    "not currently accepting",
  ];
  const blockerChecks = ["captcha", "verify you are human", "access denied", "blocked", "sign in"];

  return {
    title,
    bodySnippet: text.replace(/\s+/g, " ").trim().slice(0, 700),
    noAvailabilitySignals: noAvailabilityChecks.filter((needle) => lower.includes(needle)),
    blockerSignals: blockerChecks.filter((needle) => lower.includes(needle)),
  };
}

async function probeCase(
  browser: Browser | undefined,
  testCase: ResyCase,
  options: { screenshot: boolean },
): Promise<CaseProbeResult> {
  const url = resyStartUrl(testCase);
  const targetMinutes = parseTimeToMinutes(testCase.time);
  const allowedWindowMinutes = testCase.fallbackPolicy?.time_window_minutes ?? 60;
  const apiResult: ApiSlotResult = await fetchApiSlots(testCase, targetMinutes).catch((error): ApiSlotResult => ({
    status: 0,
    slots: [],
    error: error instanceof Error ? error.message : String(error),
  }));
  let pageUrl = url;
  let title = "";
  let bodySnippet = "";
  let noAvailabilitySignals: string[] = [];
  let blockerSignals: string[] = [];
  let screenshotPath: string | undefined;
  let domSlots: SlotCandidate[] = [];

  if (browser) {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(4500);
    await page.mouse.wheel(0, 900).catch(() => undefined);
    await page.waitForTimeout(1000);
    await page.mouse.wheel(0, -900).catch(() => undefined);
    await page.waitForTimeout(1000);

    domSlots = await collectSlots(page, targetMinutes);
    const signals = await collectSignals(page);
    pageUrl = page.url();
    title = signals.title;
    bodySnippet = signals.bodySnippet;
    noAvailabilitySignals = signals.noAvailabilitySignals;
    blockerSignals = signals.blockerSignals;

    if (options.screenshot) {
      const dir = path.join(RUNS_DIR, "resy-availability-screens");
      await mkdir(dir, { recursive: true });
      screenshotPath = path.join(dir, `${testCase.id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    }
    await context.close().catch(() => undefined);
  }

  const slots = [...apiResult.slots, ...domSlots];
  const matchingSlots = slots.filter(
    (slot) =>
      minutesDiff(slot.minutes, targetMinutes) <= allowedWindowMinutes &&
      (slot.dateIso == null || slot.dateIso === testCase.date) &&
      (slot.venueSlug == null || normalizeSlug(slot.venueSlug) === normalizeSlug(testCase.resySlug)),
  );

  const recommendation =
    matchingSlots.length > 0
      ? "use_for_live_fill_test"
      : blockerSignals.length > 0
        ? "blocked_or_unknown"
        : "no_matching_slot";

  return {
    caseId: testCase.id,
    restaurantName: testCase.restaurantName,
    url,
    targetTime: testCase.time,
    targetMinutes,
    allowedWindowMinutes,
    probeSource: browser ? "api+browser" : "api",
    apiStatus: apiResult.status,
    apiVenueName: apiResult.venueName,
    apiVenueSlug: apiResult.venueSlug,
    apiError: apiResult.error,
    pageUrl,
    title,
    slots,
    matchingSlots,
    noAvailabilitySignals,
    blockerSignals,
    bodySnippet,
    screenshotPath,
    recommendation,
  };
}

async function main(): Promise<void> {
  const suite = JSON.parse(await readFile(CASES_PATH, "utf8")) as Suite;
  const caseId = argValue("--case");
  const limit = Number(argValue("--limit") ?? "0");
  const visible = hasFlag("--visible");
  const screenshot = hasFlag("--screenshot");
  const browserProbe = hasFlag("--browser") || visible || screenshot;

  let cases = suite.cases.filter((testCase) => Boolean(testCase.resySlug));
  if (caseId) {
    cases = cases.filter((testCase) => testCase.id === caseId);
    if (cases.length === 0) throw new Error(`Unknown case: ${caseId}`);
  }
  if (limit > 0) cases = cases.slice(0, limit);

  console.log(
    `[resy-probe] probing ${cases.length} case(s), source=${browserProbe ? "api+browser" : "api"}, visible=${visible}, screenshot=${screenshot}`,
  );
  const browser = browserProbe ? await chromium.launch({ headless: !visible }) : undefined;
  const results: CaseProbeResult[] = [];

  try {
    for (const testCase of cases) {
      process.stdout.write(`[resy-probe] ${testCase.id} ${testCase.restaurantName} ${testCase.date} ${testCase.time} ... `);
      const result = await probeCase(browser, testCase, { screenshot });
      results.push(result);
      const slotText = result.matchingSlots.slice(0, 3).map((slot) => slot.text).join(" | ");
      const apiNote = result.apiError ? ` api_note="${result.apiError.slice(0, 120)}"` : "";
      console.log(
        `${result.recommendation} (${result.matchingSlots.length}/${result.slots.length} matching)` +
          `${slotText ? `: ${slotText}` : ""}${apiNote}`,
      );
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const recommendedCases = results.filter((result) => result.recommendation === "use_for_live_fill_test");
  const report: ProbeReport = {
    runId: `resy-availability-probe-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    suitePath: CASES_PATH,
    visible,
    results,
    recommendedCase: recommendedCases[0],
    recommendedCases,
  };

  await mkdir(RUNS_DIR, { recursive: true });
  const reportPath = path.join(RUNS_DIR, `${report.runId}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[resy-probe] wrote ${reportPath}`);
  if (report.recommendedCase) {
    console.log(
      `[resy-probe] recommended live fill case: ${report.recommendedCase.caseId} ` +
        `${report.recommendedCase.restaurantName} ${report.recommendedCase.targetTime} ` +
        `slot="${report.recommendedCase.matchingSlots[0]?.text ?? ""}"`,
    );
    console.log(
      `[resy-probe] next single-case command: npx tsx scripts\\run-phase0-resy-benchmark.ts ` +
        `--case ${report.recommendedCase.caseId} --live-openai --allow-failures`,
    );
  } else {
    console.log("[resy-probe] no case with matching target-window slot found");
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error("[resy-probe] fatal:", error);
  process.exit(1);
});
