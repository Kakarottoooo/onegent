/**
 * stagehand-executor.ts
 *
 * Universal AI-driven browser executor.
 * Uses Stagehand + Claude vision to navigate any booking website and fill forms.
 * Replaces the hardcoded opentable.ts / booking-com.ts / kayak-flights.ts scripts.
 *
 * Production: runs on Browserbase (cloud browser, bot evasion, no Vercel timeout).
 * Development: runs on local Playwright (no API key required).
 */

import { Stagehand } from "@browserbasehq/stagehand";
import type { Locator, Page } from "playwright";
import type { BrowserTaskInput, BrowserTaskResult } from "./types";
import { writeAgentLog } from "../db";
import { browserSessionStore } from "../browser-session-store";
import {
  assessBookingStage as coreAssessBookingStage,
  dismissBlockingModals as coreDismissBlockingModals,
  resolveCurrentUrl as coreResolveCurrentUrl,
  type StageAssessmentDependencies,
} from "./core/stage-assessment";
import {
  buildStageRecoveryInstruction as coreBuildStageRecoveryInstruction,
  clickAdvanceButton as coreClickAdvanceButton,
  clickAllowedAdvanceButton as coreClickAllowedAdvanceButton,
  type RecoveryDependencies,
} from "./core/recovery";
import {
  buildEffectiveProfile,
  extractTargetHotelName,
  extractTargetHotelNameFromUrl,
} from "./core/profile";
import { buildInstruction } from "./core/instructions";
import { extractErrorDetails } from "./core/error-utils";
import {
  shouldUseRealChrome,
  buildRealChromeLaunchOptions,
  resolveRealChromeUserDataDir,
  ensureUserDataDirFree,
} from "./core/real-chrome";
import { getProvider } from "./providers/index";
export {
  buildFlightTask,
  buildHotelTask,
  buildRestaurantTask,
} from "./core/task-builders";
import {
  type BookingStage,
  type BookingStageAssessment,
  type RequestedStayDates,
  DATE_SELECTION_ADVANCE_BUTTONS,
  extractRequestedStayDates,
  INTERMEDIATE_GATE_ADVANCE_BUTTONS,
  ROOM_SELECTION_ADVANCE_BUTTONS,
} from "./core/stages";
import {
  containsAny,
  hasRequestedStaySelected,
} from "./core/stage-signals";
import {
  type BookingComHelpers,
  clickBookingComListingTarget as providerClickBookingComListingTarget,
  evaluateBookingComVerification as providerEvaluateBookingComVerification,
  getBookingComStageSignals as providerGetBookingComStageSignals,
  revealBookingComRoomSelection as providerRevealBookingComRoomSelection,
  setBookingComRoomQuantity as providerSetBookingComRoomQuantity,
} from "./providers/booking-com";
import { determineFinalOutcome, NO_AVAILABILITY_SIGNALS } from "./core/final-outcome";
import { fillGuestFormWithAI, fillFlightGuestFormWithAI, auditAndRefillEmptyFields } from "./ai-loop/fill-form";
import { clickTargetListingAI, selectRoomAI } from "./ai-loop/find-listing";
import { liveLogPush, liveLogClose, liveLogReset } from "../live-log-store";
import {
  clickLocatorDom,
  evaluateLocatorElement,
  fillLocator,
  findVisibleField,
  getInteractionScopes,
  getLocatorText,
  getScopeUrl,
  isLocatorEnabled,
  isVisible,
  normalizeDigits,
  normalizeLooseText,
  normalizeText,
} from "./shared/field-utils";
import {
  safeMouseClick,
  safePressEscape,
  waitForEvaluateCondition,
  waitForPageSignals,
  waitForVisibleActionText,
} from "./shared/playwright-safe";
import {
  getVisibleFieldCategoryKeys,
  hasValueInScopes,
  readCombinedText,
} from "./shared/page-read";
import {
  clickAgreementCheckboxes,
  fillFieldsInScopes,
} from "./shared/form-actions";
import { bookExpediaFlightProgrammatic } from "./providers/expedia";
import { bookTicketmasterProgrammatic } from "./providers/ticketmaster-rpa";
import { bookSeatGeekProgrammatic } from "./providers/seatgeek-rpa";

type FieldSpec = { patterns: string[]; value: string };
type AgentExecutionResult = {
  message?: string;
  output?: string;
  completed?: boolean;
};

function getRawPage(stagehandPage: unknown): Page {
  return (((stagehandPage as { page?: Page }).page ?? stagehandPage) as Page);
}

/**
 * Stagehand's Page wrapper exposes CDP-level APIs that differ from Playwright's Page:
 *   sh(raw).keyPress("Ctrl+a")      — press key combo (no .keyboard controller)
 *   sh(raw).type(text, {delay})     — type to focused element (no selector)
 *   sh(raw).click(x, y)            — coordinate click via CDP (no .mouse controller)
 *   sh(raw).locatorClick(sel)       — selector click via raw.locator(sel).click()
 *
 * Use this helper anywhere Playwright-style .keyboard/.mouse/.press() would fail.
 */
function sh(page: Page) {
  const p = page as unknown as {
    keyPress(key: string, options?: { delay?: number }): Promise<void>;
    type(text: string, options?: { delay?: number }): Promise<void>;
    click(x: number, y: number, options?: { button?: string; clickCount?: number }): Promise<string>;
  };
  return {
    keyPress: (key: string) => p.keyPress(key),
    type: (text: string, opts?: { delay?: number }) => p.type(text, opts),
    /** Coordinate-based click via CDP (y must be ≥ 0, i.e., element must be in viewport). */
    click: (x: number, y: number) => p.click(x, y),
    /** Selector-based click via Playwright locator (for elements that need selector-click). */
    locatorClick: (sel: string, opts?: { clickCount?: number }) =>
      page.locator(sel).click(opts),
  };
}

/**
 * Generate a direct Booking.com hotel detail URL from a hotel name.
 * Booking.com hotel URLs follow: booking.com/hotel/{countryCode}/{slug}.html
 * This lets us bypass the searchresults.html endpoint which blocks headless browsers.
 */
function buildBookingComDirectHotelUrl(hotelName: string, searchUrl: string): string | null {
  if (!hotelName) return null;

  // Generate Booking.com slug: lowercase, replace non-alphanumeric runs with hyphens
  const slug = hotelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) return null;

  // Infer country code from city/country mentions in the search URL or hotel name
  const combined = (searchUrl + " " + hotelName).toLowerCase();
  let countryCode = "us"; // default
  if (/new york|los angeles|chicago|houston|miami|las vegas|san francisco|boston|washington dc|seattle|denver|dallas|atlanta|philadelphia|phoenix|nashville|portland|austin/.test(combined)) countryCode = "us";
  else if (/london|manchester|edinburgh|glasgow|liverpool|birmingham|bristol|leeds/.test(combined)) countryCode = "gb";
  else if (/paris|lyon|marseille|nice|bordeaux|toulouse|strasbourg/.test(combined)) countryCode = "fr";
  else if (/berlin|munich|hamburg|frankfurt|cologne|stuttgart|dusseldorf/.test(combined)) countryCode = "de";
  else if (/rome|milan|venice|florence|naples|turin|bologna/.test(combined)) countryCode = "it";
  else if (/madrid|barcelona|seville|valencia|malaga|ibiza/.test(combined)) countryCode = "es";
  else if (/tokyo|osaka|kyoto|nagoya|sapporo|yokohama/.test(combined)) countryCode = "jp";
  else if (/sydney|melbourne|brisbane|perth|gold coast|adelaide/.test(combined)) countryCode = "au";
  else if (/toronto|vancouver|montreal|calgary|ottawa|edmonton/.test(combined)) countryCode = "ca";
  else if (/amsterdam|rotterdam|the hague|utrecht/.test(combined)) countryCode = "nl";
  else if (/dubai|abu dhabi|sharjah/.test(combined)) countryCode = "ae";
  else if (/singapore/.test(combined)) countryCode = "sg";
  else if (/bangkok|phuket|chiang mai/.test(combined)) countryCode = "th";
  else if (/hong kong/.test(combined)) countryCode = "hk";
  else if (/seoul|busan/.test(combined)) countryCode = "kr";

  // Extract date/occupancy params from the original search URL.
  // Hotel detail pages use ISO date format (checkin=YYYY-MM-DD), not the split
  // checkin_year/month/monthday format used by searchresults.html.
  const qIndex = searchUrl.indexOf("?");
  const urlParams = new URLSearchParams(qIndex >= 0 ? searchUrl.slice(qIndex + 1) : "");
  const params = new URLSearchParams();

  const ciy = urlParams.get("checkin_year");
  const cim = urlParams.get("checkin_month");
  const cid = urlParams.get("checkin_monthday");
  if (ciy && cim && cid) {
    params.set("checkin", `${ciy}-${String(cim).padStart(2, "0")}-${String(cid).padStart(2, "0")}`);
  }

  const coy = urlParams.get("checkout_year");
  const com = urlParams.get("checkout_month");
  const cod = urlParams.get("checkout_monthday");
  if (coy && com && cod) {
    params.set("checkout", `${coy}-${String(com).padStart(2, "0")}-${String(cod).padStart(2, "0")}`);
  }

  const adults = urlParams.get("group_adults");
  if (adults) params.set("group_adults", adults);
  const rooms = urlParams.get("no_rooms");
  if (rooms) params.set("no_rooms", rooms);

  return `https://www.booking.com/hotel/${countryCode}/${slug}.html?${params.toString()}`;
}

function createStageAssessmentDeps(): StageAssessmentDependencies {
  return {
    getVisibleFieldCategoryKeys,
    readCombinedText,
    getBookingComStageSignals: providerGetBookingComStageSignals,
    getScopeUrl,
    getRawPage,
    getInteractionScopes,
    evaluateLocatorElement,
    getLocatorText,
    normalizeText,
  };
}

function createRecoveryDeps(): RecoveryDependencies {
  return {
    getInteractionScopes,
    isVisible,
    isLocatorEnabled,
    evaluateLocatorElement,
    getLocatorText,
    clickLocatorDom,
    normalizeText,
  };
}

async function evaluateLocatorElementWithArg<T>(
  locator: Locator,
  pageFunction: (element: Element, arg: string) => T,
  arg: string
): Promise<T> {
  return evaluateLocatorElement(
    locator,
    pageFunction as (element: Element, maybeArg?: string) => T,
    arg
  );
}

function createBookingComHelpers(): BookingComHelpers {
  return {
    normalizeText,
    normalizeLooseText,
    normalizeDigits,
    findVisibleField,
    fillLocator,
    evaluateLocatorElement: evaluateLocatorElementWithArg,
    waitForEvaluateCondition,
    safePressEscape,
    safeMouseClick,
    waitForPageSignals,
  };
}

function scoreActivePageCandidate(url: string, startUrl: string): number {
  const normalized = url.toLowerCase();
  const normalizedStartUrl = startUrl.toLowerCase();

  if (!normalized || normalized === "about:blank") return -100;

  let score = 0;
  if (normalized === normalizedStartUrl) score -= 2;

  if (normalized.includes("secure.booking.com/book") || normalized.includes("booking.com/book")) {
    score += 10;
  } else if (normalized.includes("booking.com/hotel/")) {
    score += 8;
  } else if (normalized.includes("booking.com/searchresults")) {
    score -= 5;
  } else {
    score += 1;
  }

  return score;
}

async function clickAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[],
  dryRun = false
): Promise<string | null> {
  return coreClickAdvanceButton(rawPage, buttonNames, createRecoveryDeps(), dryRun);
}

async function clickAllowedAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[],
  options?: {
    dryRun?: boolean;
    excludeText?: RegExp[];
    skipEnabledCheck?: boolean;
  }
): Promise<string | null> {
  return coreClickAllowedAdvanceButton(rawPage, buttonNames, createRecoveryDeps(), options);
}

async function dismissBlockingModals(rawPage: Page): Promise<string> {
  return coreDismissBlockingModals(rawPage, createStageAssessmentDeps());
}

async function assessBookingStage(params: {
  rawPage: Page;
  stagehand: Stagehand;
  startUrl: string;
  requestedDates: RequestedStayDates;
  agentMessage?: string;
}): Promise<BookingStageAssessment> {
  return coreAssessBookingStage({
    ...params,
    deps: createStageAssessmentDeps(),
  });
}

async function resolveCurrentUrl(
  rawPage: Page,
  stagehand: Stagehand,
  startUrl: string
): Promise<string> {
  return coreResolveCurrentUrl(rawPage, stagehand, startUrl, createStageAssessmentDeps());
}

/**
 * Per-job Stagehand registry — used to close a previous paused_payment browser
 * when the same job is re-run (Reset & Retry). Without this, the old browser
 * window stays open alongside the new one.
 */
const activeStagehands = new Map<string, { close: () => Promise<void> }>();

/**
 * Run a booking task on any website using AI vision.
 *
 * The agent navigates the site, fills all known fields (name / email / phone /
 * dates / party size), and stops before entering payment information.
 * Returns a screenshot and the handoff URL so the user can complete payment.
 */
/**
 * Normalise well-known broken startUrl patterns before the executor touches them.
 * Hotels.com:
 *   /search?destination=... → /Hotel-Search?destination=... (fixes 404)
 *   City-level URL (has regionId or destination contains comma) + hotelName
 *   → add hotelName query param so Hotels.com pre-filters results to that hotel.
 *   Keep city-level destination + regionId intact for proper date/guest context.
 *
 * Correct Hotels.com search URL structure (user-verified):
 *   hotels.com/Hotel-Search?destination=New+York%2C...&regionId=2621&...&hotelName=Hilton+Garden+Inn+...
 *   → Shows only the target hotel in results sidebar filter
 */
function normaliseStartUrl(url: string, hotelName?: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("hotels.com")) {
      // Fix broken /search path → /Hotel-Search
      if (parsed.pathname.toLowerCase() === "/search") {
        parsed.pathname = "/Hotel-Search";
      }
      // `ro` frequently restores a refundable-only filter state on Hotels.com,
      // which breaks the property-name sidebar flow and leads to "No exact matches".
      parsed.searchParams.delete("ro");
      // Explicitly override saved "Fully refundable only" account preference.
      // Hotels.com reads `refundableOnly=false` from the URL and uses it to suppress
      // the saved-preference filter, preventing "No exact matches" on non-refundable hotels.
      parsed.searchParams.set("refundableOnly", "false");
      // Always add hotelName when we have one — Hotels.com uses this to pre-filter
      // the "Search by property name" sidebar, regardless of whether destination is
      // city-level ("New York, NY") or already a hotel name ("414 Hotel New York...").
      if (hotelName && !parsed.searchParams.has("hotelName")) {
        parsed.searchParams.set("hotelName", hotelName);
      }
      return parsed.toString();
    }
  } catch { /* leave unchanged if unparseable */ }
  return url;
}

export async function runBrowserTask(
  input: BrowserTaskInput
): Promise<BrowserTaskResult> {
  // Normalise startUrl (e.g. hotels.com/search → hotels.com/Hotel-Search,
  // and add hotelName param for city-level Hotels.com searches so results are pre-filtered)
  const hotelNameForUrl = extractTargetHotelName(input.task);
  input = { ...input, startUrl: normaliseStartUrl(input.startUrl, hotelNameForUrl ?? undefined) };

  // For OpenTable no_availability: captured time slots the user can choose from instead.
  let capturedAvailableSlots: string[] = [];

  // AI_LOOP_FULL=true activates all AI sub-flags simultaneously.
  // RPA code is never removed — each flag independently falls back to RPA on failure.
  if (process.env.AI_LOOP_FULL === "true") {
    process.env.AI_LOOP_STAGE_DETECT = "true";
    process.env.AI_LOOP_FORM_FILL    = "true";
    process.env.AI_LOOP_LISTING      = "true";
  }

  // Close any previously paused browser for this job (e.g. Reset & Retry after paused_payment).
  // Without this, the old browser stays open alongside the new one.
  if (input.jobId) {
    const prev = activeStagehands.get(input.jobId);
    if (prev) {
      activeStagehands.delete(input.jobId);
      await prev.close().catch(() => {});
    }
  }

  // Reset live log so previous runs don't bleed into this run's log panel.
  if (input.jobId) liveLogReset(input.jobId);

  const debugTrace: string[] = [];
  const trace = (message: string) => {
    debugTrace.push(message);
    if (input.jobId) liveLogPush(input.jobId, message);
    // Print to terminal in dev so you can follow execution without opening the DB.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[stagehand] ${message}`);
    }
  };
  trace(`normaliseStartUrl: hotelNameForUrl="${hotelNameForUrl ?? "(none)"}" → startUrl=${input.startUrl.slice(0, 160)}`);
  const bookingComHelpers = createBookingComHelpers();

  const useCloud =
    !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);

  // Vercel serverless has no Chromium —?local mode will crash with a confusing
  // error. Fail fast with an actionable message instead.
  // To re-enable cloud browser: set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID
  // in Vercel environment variables (Settings 鈫?Environment Variables).
  // Future option: set WORKER_URL to a Railway/Render worker that runs Playwright.
  const onVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  if (onVercel && !useCloud) {
    return {
      status: "error" as const,
      error: "Browser automation requires a cloud browser on Vercel. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in your Vercel environment variables, or deploy the worker service to Railway.",
      sessionUrl: undefined,
      handoffUrl: input.startUrl,
      summary: "Browser automation unavailable on Vercel without Browserbase credentials.",
    };
  }

  // Resolve model name —?Stagehand v3 uses "provider/model" format
  const modelName = input.agentModel?.model ?? "openai/gpt-4o-mini";

  // Resolve API key from user-supplied config or env fallback
  const modelApiKey = input.agentModel?.apiKey
    ?? (modelName.startsWith("google/") || modelName.includes("gemini")
        ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY)
        : modelName.startsWith("anthropic/") || modelName.includes("claude")
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY);

  // Stagehand reads credentials from env vars (providerEnvVarMap), NOT from the
  // model config object. Inject the resolved key into the correct env var so
  // both constructor-level (act/observe) and agent-level calls can find it.
  if (modelApiKey) {
    if (modelName.startsWith("google/") || modelName.includes("gemini")) {
      process.env.GEMINI_API_KEY = modelApiKey;
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = modelApiKey;
    } else if (modelName.startsWith("anthropic/") || modelName.includes("claude")) {
      process.env.ANTHROPIC_API_KEY = modelApiKey;
    } else {
      process.env.OPENAI_API_KEY = modelApiKey;
    }
  }

  // Pre-launch cleanup: if a prior run left a Chrome process holding our
  // persistent userDataDir, Playwright can't spawn a new Chrome against the
  // same profile — the child exits and the requested CDP port never binds
  // (manifests as ECONNREFUSED 127.0.0.1:<port>). Kill stale siblings first.
  if (!useCloud && shouldUseRealChrome(input.startUrl)) {
    await ensureUserDataDirFree(resolveRealChromeUserDataDir(), trace);
  }

  const stagehand = new Stagehand({
    env: useCloud ? "BROWSERBASE" : "LOCAL",
    ...(useCloud && {
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      // Residential proxies bypass OTA bot-detection (booking.com, Expedia).
      // Requires Browserbase plan that includes proxies —?disable if on free plan.
      ...(process.env.BROWSERBASE_USE_PROXIES === "true" && {
        browserbaseSessionCreateParams: { proxies: true },
      }),
    }),
    model: modelName,  // just the string —?Stagehand reads key from env vars above
    verbose: 0,
    disablePino: true,
    // Dev: set PLAYWRIGHT_HEADLESS=false to watch the browser window.
    // slowMo is not in Stagehand v3 localBrowserLaunchOptions —?use PLAYWRIGHT_SLOW_MO
    // via the Playwright env var PWDEBUG or by patching context after init() instead.
    ...(!useCloud && {
      localBrowserLaunchOptions: {
        headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
        // Opt-in: route specific providers (e.g. SeatGeek) to the user's real
        // Chrome with a persistent profile to bypass DataDome-style bot
        // fingerprinting. Other providers keep the default Playwright path.
        ...(shouldUseRealChrome(input.startUrl) && buildRealChromeLaunchOptions(trace)),
      },
    }),
  });
  if (!useCloud && shouldUseRealChrome(input.startUrl)) {
    trace(`[real-chrome] Activated for startUrl matching USE_REAL_CHROME_FOR="${process.env.USE_REAL_CHROME_FOR}"`);
  }

  trace(`Executor starting —?model: ${modelName}, browser: ${useCloud ? "Browserbase" : "local"}, proxies: ${process.env.BROWSERBASE_USE_PROXIES === "true"}`);

  // In local mode, keep the browser open when we reach a manual handoff point
  // so the user can inspect the page and continue in the same browser.
  // Auto-close after BROWSER_KEEP_OPEN_MS (default 60 minutes; override via
  // BOOKING_BROWSER_KEEP_OPEN_MINUTES env var if you need longer for testing).
  const BROWSER_KEEP_OPEN_MS =
    (Number(process.env.BOOKING_BROWSER_KEEP_OPEN_MINUTES) || 60) * 60 * 1000;
  let keepBrowserOpen = false;

  // Safety net: if the flow reached guest-form filling (restaurant or
  // hotel/flight guest details) but then threw or finalized as "error",
  // we still want to keep the browser open so the user can visually confirm
  // what was filled and submit the form themselves.
  let reachedGuestForm = false;

  const holdBrowserOpenForManualReview = (reason: string) => {
    if (keepBrowserOpen || useCloud || !input.jobId) return;
    keepBrowserOpen = true;
    trace(reason);
    browserSessionStore.setGetter(input.jobId, () => {
      const ctx = stagehand.context;
      if (!ctx) return null;
      const ap = ctx.activePage();
      return ap ? getRawPage(ap) : null;
    }, BROWSER_KEEP_OPEN_MS);
    setTimeout(() => {
      browserSessionStore.delete(input.jobId!);
      activeStagehands.delete(input.jobId!);
      stagehand.close().catch(() => {});
    }, BROWSER_KEEP_OPEN_MS);
  };

  try {
    await stagehand.init();
    // Register stagehand so a future Reset & Retry can close this browser instance.
    if (input.jobId) activeStagehands.set(input.jobId, { close: () => stagehand.close() });
    // v3 API: get active page from context (resolvePage is private)
    const page = stagehand.context.activePage() ?? await stagehand.context.newPage();
    // Register the page in the live-view store immediately so SSE stream can
    // take screenshots during the entire booking process (not just after payment).
    // Only in local mode — Browserbase sessions have their own live view URL.
    if (!useCloud && input.jobId) {
      // Use a dynamic getter so the live-view stream always screenshots the currently
      // active page — even after tab switches or stagehand.act() navigations.
      browserSessionStore.setGetter(input.jobId, () => {
        const ctx = stagehand.context;
        if (!ctx) return null;
        const ap = ctx.activePage();
        return ap ? getRawPage(ap) : null;
      }, BROWSER_KEEP_OPEN_MS);
      trace('Local mode: registered dynamic page getter in live-view store for real-time streaming.');
    }


    // 鈹€鈹€ Inject saved session cookies (e.g. Booking.com login) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // Cookies are saved once via: node scripts/save-booking-cookies.mjs
    // They persist your logged-in session so the agent starts already authenticated.
    // Provider setup (cookies, initScripts, etc.) — delegate to provider registry
    const startProvider = getProvider(input.startUrl);
    await startProvider?.setup?.(getRawPage(page), stagehand.context, trace);

    // Navigate to the starting URL
    await page.goto(input.startUrl, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });

    // For Booking.com search results (React SPA), wait for networkidle so JS can finish
    // fetching and rendering hotel listing cards before we check for them.
    if (input.startUrl.includes("booking.com/searchresults")) {
      trace("Booking.com searchresults: waiting for networkidle (React SPA hydration)…");
      await getRawPage(page)
        .waitForLoadState("networkidle", { timeout: 20_000 })
        .catch(() => trace("Booking.com searchresults: networkidle timeout — continuing anyway."));
    }

    // Post-goto URL checks — Playwright considers chrome error pages a "successful" navigation.
    {
      const landedUrl = getRawPage(page).url();

      // Hard browser error (network failure, DNS, crash)
      if (landedUrl.startsWith("chrome-error://") || landedUrl === "about:blank") {
        trace(`Page load failed after navigation — url="${landedUrl}". This is a network or browser error.`);
        throw new Error(`Page failed to load: ${landedUrl}. Check network connectivity or proxy settings.`);
      }

      // Booking.com city/region redirect — hotel not found in search, try fallback URL
      const isCityRedirect = /booking\.com\/(city|region|country|district)\//i.test(landedUrl);
      if (isCityRedirect && input.startUrl.includes("booking.com")) {
        const fallback = input.fallbackUrl ?? input.task.match(/fallback URL[^:]*:\s*(https?:\/\/\S+)/i)?.[1]?.replace(/\s.*$/, "");
        if (fallback && fallback !== input.startUrl) {
          trace(`Booking.com redirected to city page (${landedUrl}) — hotel not found via primary search URL. Trying fallback: ${fallback}`);
          await page.goto(fallback, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
          const fallbackLanded = getRawPage(page).url();
          if (/booking\.com\/(city|region|country|district)\//i.test(fallbackLanded)) {
            trace(`Fallback also redirected to city page (${fallbackLanded}) — hotel unavailable on Booking.com.`);
            return {
              status: "no_availability",
              screenshotBase64: "",
              handoffUrl: input.startUrl,
              summary: "This property wasn't found in Booking.com search results for the requested dates.",
              debugTrace,
            };
          }
          trace(`Fallback navigation succeeded — landed on: ${fallbackLanded}`);
        } else {
          trace(`Booking.com redirected to city page (${landedUrl}) and no fallback URL available — hotel unavailable.`);
          return {
            status: "no_availability",
            screenshotBase64: "",
            handoffUrl: input.startUrl,
            summary: "This property wasn't found in Booking.com search results for the requested dates.",
            debugTrace,
          };
        }
      }
    }

    // Dev: inject a red cursor dot so you can watch the agent interact visually.
    // Inject on the BrowserContext (not the page) so it persists across all tabs/navigations.
    if (process.env.NODE_ENV !== "production" && !useCloud) {
      // stagehand.context is a V3Context wrapper; the underlying Playwright BrowserContext
      // may be exposed as .browserContext or .context —?try both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const browserCtx = (stagehand.context as any).browserContext ?? (stagehand.context as any).context ?? null;
      const addInitTarget = browserCtx ?? getRawPage(page);
      await addInitTarget.addInitScript(() => {
        function installCursor() {
          if (document.getElementById("__pw_cursor__")) return;
          const dot = document.createElement("div");
          dot.id = "__pw_cursor__";
          Object.assign(dot.style, {
            position: "fixed", top: "0", left: "0", width: "12px", height: "12px",
            borderRadius: "50%", background: "red", opacity: "0.75",
            pointerEvents: "none", zIndex: "999999", transition: "transform 0.05s",
            transform: "translate(-50%,-50%)",
          });
          (document.body || document.documentElement).appendChild(dot);
          document.addEventListener("mousemove", (e) => {
            dot.style.left = e.clientX + "px";
            dot.style.top  = e.clientY + "px";
          });
        }
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", installCursor);
        } else {
          installCursor();
        }
      });
    }

    // ─── Early check: site unreachable (network error before agent runs) ─────
    {
      let earlyText = "";
      try {
        earlyText = (await page.evaluate(() =>
          (document.body?.innerText ?? "").toLowerCase().slice(0, 1000)
        ) as string);
      } catch { /* ignore */ }
      const unreachable =
        earlyText.includes("this site can't be reached") ||
        earlyText.includes("err_tunnel_connection_failed") ||
        earlyText.includes("err_connection_refused") ||
        earlyText.includes("err_name_not_resolved") ||
        earlyText.includes("dns_probe_finished_nxdomain");
      // Bot-detection / error pages on hotel brand sites and OTAs
      const providerBotPatterns = startProvider?.getBotPatterns?.() ?? [
        "something went wrong",
        "access denied",
        "checking your browser",
        "show us your human side",
        "bot or not",
        "we can't tell if you're a human",
        "please type the numbers you hear",
      ];
      const botBlocked =
        earlyText.includes("reference no.") ||
        earlyText.includes("please enable cookies") ||
        providerBotPatterns.some((p) => earlyText.includes(p));
      if (unreachable || botBlocked) {
        const reason = botBlocked ? "Bot detection / error page" : "Network unreachable";
        trace(`${reason} detected on landing page —?stopping early.`);
        const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
        const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;
        await stagehand.close();
        return {
          status: "captcha",
          screenshotBase64,
          handoffUrl: input.fallbackUrl ?? input.startUrl,
          sessionUrl,
          summary: botBlocked
            ? "This hotel's website blocked the automated browser. Please book directly via the link."
            : "The hotel's website could not be reached by the automated browser (network error). Open the link to book directly in your own browser.",
          error: `${reason} on landing page.`,
          debugTrace,
        };
      }
    }

    // 鈹€鈹€ Early check: booking.com search failed —?redirect to fallback 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    {
      const landedUrl = page.url();
      const bookingComBotRedirect =
        input.startUrl.includes("booking.com/searchresults") &&
        !landedUrl.includes("errorc_searchstring_not_found") && (
          landedUrl.includes("booking.com/index.html") ||
          /booking\.com\/?(\?|#|$)/.test(landedUrl)  // root/homepage redirect = bot detection
        );
      const bookingComFailed =
        landedUrl.includes("errorc_searchstring_not_found") ||
        bookingComBotRedirect;

      if (bookingComFailed) {
        if (bookingComBotRedirect) {
          // Bot redirect —?let the user open the original search URL in their own browser
          // (works fine for real browsers, no CAPTCHA)
          trace(`booking.com bot-redirect detected (${landedUrl}). Returning handoff to original search URL.`);
          const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
          const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;
          await stagehand.close();
          return {
            status: "captcha",
            screenshotBase64,
            handoffUrl: input.startUrl,
            sessionUrl,
            summary: "Booking.com detected an automated browser. Click the link to open the search in your own browser and complete booking there.",
            error: "booking.com bot-redirect to index.html.",
            debugTrace,
          };
        }

        // Resolve fallback: prefer explicit input.fallbackUrl, then parse from task string
        const fallback =
          input.fallbackUrl ??
          input.task.match(/fallback URL[^:]*:\s*(https?:\/\/\S+)/i)?.[1]?.replace(/\s.*$/, "");

        if (fallback) {
          // booking.com search failed (errorc_searchstring_not_found) —?retry with fallback URL.
          // fallbackUrl is also a booking.com search URL, so no bot-check needed here.
          trace(`booking.com search failed (${landedUrl}). Navigating to fallback: ${fallback}`);
          await page.goto(fallback, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
          if (fallback.includes("booking.com/searchresults")) {
            await getRawPage(page)
              .waitForLoadState("networkidle", { timeout: 20_000 })
              .catch(() => trace("Booking.com fallback searchresults: networkidle timeout."));
          }
        } else {
          trace(`booking.com search failed but no fallback URL found. Letting agent handle it.`);
        }
      }
    }

    // Build the agent instruction
    const instruction = buildInstruction(input);

    // Agent uses the same model string —?key is already in process.env
    const agent = stagehand.agent({
      // agentMode: "hybrid" —?not yet available in this Stagehand v3 build; will
      // default to hybrid automatically in an upcoming release per the SDK warning.
      model: modelName,
      systemPrompt: `You are a booking assistant completing a hotel reservation on behalf of a user. Be decisive —?never ask questions, always try the most reasonable action.

GOAL: Complete all steps up to (but NOT including) CVV entry or final payment confirmation.
Required steps in order: dates 鈫?room selection 鈫?skip upsell pages 鈫?guest info form 鈫?card number + expiry 鈫?STOP.

STOP IMMEDIATELY before: CVV field, "Pay Now", "Confirm Payment", "Complete Purchase", "Complete Booking", "Confirm Booking", "Submit Payment".
DO NOT stop at: "Reserve", "Continue", "Proceed to payment", "Book Now" (intermediate) —?click these to advance.

KEY RULES:
- Cookie/consent banner 鈫?click "Decline all" / "Reject all" first, then proceed.
- Domain redirect 鈫?stay on the redirected site, it is correct.
- "Add Extras" / "Upgrade" upsell page 鈫?click "No thanks, skip it" immediately.
- Room selection page 鈫?select cheapest room and click Continue/Reserve. Do NOT fill guest info here.
- "Select a Rate" page (shows multiple rate options with prices) 鈫?always pick the lowest-priced rate UNLESS the task explicitly mentions breakfast, free cancellation, or a specific rate preference. Click "Select" on that rate to continue.
- Booking.com room list with QUANTITY DROPDOWNS (each room shows a "0" dropdown): find the cheapest available room, change its dropdown from "0" to "1". After setting it to 1, a blue "鐜板湪灏遍璁? (Book Now) button will appear in the RIGHT-SIDE SUMMARY PANEL —?click that button immediately. Do NOT interact with the search bar at the top of the page. Do NOT navigate away.
- Calendar month wrong 鈫?click —?—?arrow to navigate; verify header before clicking a date.
- IHG/single-date calendar (shows per-night price on each cell, has Stay duration +/鈭?control) 鈫?click check-in date ONLY, then use + button to set nights, then CONTINUE.
- If hotel detail page shows wrong dates 鈫?update the date picker first, then View Prices.
- "Book Now" at a consent/review summary (no name/email/card fields visible yet) 鈫?check terms checkbox, then click it to open the actual form.
- Terms/privacy checkboxes 鈫?always check before clicking booking buttons.
- Fill guest fields one at a time; only fill on the actual checkout form page.
- Browser/CORS/reCAPTCHA console errors 鈫?ignore, keep going.
- If clicking a button opens a NEW TAB or new browser window 鈫?immediately switch focus to that new tab and continue the booking flow there. Do not stay on the original tab.
- On a Booking.com hotel detail page: your FIRST action must be to SCROLL DOWN to find the room list ("绌烘埧鎯呭喌" / "Available rooms"). Do NOT interact with anything at the top of the page. Do NOT click or type into the search bar (the bar showing destination / dates / guests at the very top) —?that is for new hotel searches only. Do NOT type the guest's name, email, or any personal info anywhere on this page —?that comes on the NEXT page after you click "鐜板湪灏遍璁?.
- The room list on a Booking.com hotel page is BELOW the fold —?you must scroll down to see it. Only after you can see the room rows should you interact with room selection.
- The Booking.com room selection page has TWO distinct areas: (1) the room list with quantity dropdowns in the CENTER, and (2) the summary panel on the RIGHT with the blue "鐜板湪灏遍璁? button. The correct sequence is: change dropdown to "1" 鈫?immediately click the blue "鐜板湪灏遍璁? in the right panel 鈫?done. Nothing else happens on this page.
- Booking.com checkout forms may appear in CHINESE. Treat these Chinese labels as their English equivalents: 濮?Last name, 鍚?First name, 鐢靛瓙閭鍦板潃=Email, 鎵嬫満鍙风爜=Phone, 鍥藉/鍦板尯=Country, 鍗″彿=Card number, 鍒版湡鏃?Expiry date, 鎸佸崱浜哄鍚?Cardholder name, 瀹屾垚棰勮=Complete booking (STOP before this), 绔嬪嵆浠樻=Pay now (STOP before this).
- After switching to a new tab, wait for it to fully load before taking any action.
- Expedia room selection: rooms show a "Reserve" button (NOT a quantity dropdown). Click "Reserve" on the cheapest available room. A modal/dialog will appear — click "Reserve" inside the modal too to proceed to checkout.
- Expedia checkout is a SINGLE PAGE with both guest info and payment fields inline (not in an iframe). Fill First name, Last name, Email fields, then Phone number (digits ONLY, no letters or state codes). Then fill card fields: "Name on card", card number (placeholder "0000 0000 0000 0000"), expiration date (placeholder "MM/YY"), billing ZIP code. STOP before Security code (CVV).
- Expedia "Protect your stay" section: always select "No protection" / "I am willing to risk my stay" BEFORE filling card fields. This selection is required.
- Expedia FLIGHT booking: On the flight search results page, find the target flight and click "Select". On seat selection pages, click "Skip seat selection" or "No thanks". On the checkout/traveler info page, fill First name, Last name, Date of birth, and passport details. STOP before entering CVV or clicking the final "Complete booking" / "Purchase" button.

The user will enter CVV and confirm payment themselves.`,
    });

    // For Booking.com hotel detail pages, skip the initial agent run entirely.
    // Our programmatic recovery code handles room selection and form filling directly.
    // Running the agent here wastes 300+ seconds and causes search-bar interference.
    const landedUrlAfterSetup = page.url();
    const openPageUrls = stagehand.context.pages().map((p) => getScopeUrl(getRawPage(p)));
    const bookingComPageOpen = !!(
      getProvider(input.startUrl)?.id === 'booking-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'booking-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'booking-com')
    );
    // Expedia/Hotels.com: same as Booking.com — skip the initial AI agent run entirely.
    // The 40-step agent run on Expedia goes off-rails: it clicks wrong hotels (e.g. The Fifth
    // Avenue Hotel instead of the target), tries to edit the search bar, and follows IHG/Marriott
    // logos to brand sites. The programmatic recovery flow (clickTargetListingAI → selectRoomAI
    // → fillExpediaGuestForm → fillExpediaGroupPaymentForm) handles Expedia correctly stage-by-stage.
    // Expedia flight URLs are handled by programmatic RPA (bookExpediaFlightProgrammatic),
    // not the AI agent. Skip the agent entirely for flight booking.
    const isExpediaFlightUrl = (url: string) =>
      /expedia\.com\/Flights/i.test(url) || /expedia\.com\/flights/i.test(url);
    const expediaPageOpen = !!(
      (!isExpediaFlightUrl(input.startUrl) && getProvider(input.startUrl)?.id === 'expedia') ||
      (!isExpediaFlightUrl(landedUrlAfterSetup) && getProvider(landedUrlAfterSetup)?.id === 'expedia') ||
      openPageUrls.find((u) => u && !isExpediaFlightUrl(u) && getProvider(u)?.id === 'expedia')
    );
    // Hotels.com: same as Expedia — skip the initial AI agent run. The AI agent navigates to
    // wrong hotels (e.g. Artezen Hotel instead of 414 Hotel) because it clicks the first result
    // or follows brand site links. The programmatic recovery flow (Stage B sidebar filter →
    // fast path → selectRoomAI → fillExpediaGroupPaymentForm) handles Hotels.com correctly.
    const hotelsComPageOpen = !!(
      getProvider(input.startUrl)?.id === 'hotels-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'hotels-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'hotels-com')
    );
    // OpenTable: skip the AI agent run entirely — time-slot selection and guest
    // form fill are handled programmatically in the listing/guestDetailsStep stages.
    const openTablePageOpen = !!(
      getProvider(input.startUrl)?.id === 'opentable-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'opentable-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'opentable-com')
    );
    const resyPageOpen = !!(
      getProvider(input.startUrl)?.id === 'resy-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'resy-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'resy-com')
    );
    const yelpPageOpen = !!(
      getProvider(input.startUrl)?.id === 'yelp-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'yelp-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'yelp-com')
    );
    // SeatGeek: skip the AI agent entirely — event listing detection and checkout form fill
    // run programmatically through the three-layer pipeline (native setter fill + AI fill + audit).
    const seatgeekPageOpen = !!(
      getProvider(input.startUrl)?.id === 'seatgeek-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'seatgeek-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'seatgeek-com')
    );
    // Ticketmaster: same skip-agent pattern as SeatGeek. Event page / checkout
    // detection + form fill run programmatically through the three-layer pipeline.
    const ticketmasterPageOpen = !!(
      getProvider(input.startUrl)?.id === 'ticketmaster-com' ||
      getProvider(landedUrlAfterSetup)?.id === 'ticketmaster-com' ||
      openPageUrls.find((u) => u && getProvider(u)?.id === 'ticketmaster-com')
    );
    const expediaFlightPageOpen = isExpediaFlightUrl(input.startUrl);
    const skipInitialAgent = bookingComPageOpen || expediaPageOpen || hotelsComPageOpen || openTablePageOpen || resyPageOpen || yelpPageOpen || seatgeekPageOpen || ticketmasterPageOpen || expediaFlightPageOpen;
    const initialMaxSteps = skipInitialAgent ? 0 : 40;

    const skipProviderLabel = bookingComPageOpen ? 'Booking.com' : expediaPageOpen ? 'Expedia' : hotelsComPageOpen ? 'Hotels.com' : openTablePageOpen ? 'OpenTable' : resyPageOpen ? 'Resy' : yelpPageOpen ? 'Yelp' : seatgeekPageOpen ? 'SeatGeek' : ticketmasterPageOpen ? 'Ticketmaster' : expediaFlightPageOpen ? 'Expedia Flight' : '';
    trace(`Agent starting main run (maxSteps=${initialMaxSteps}, model=${modelName})${skipInitialAgent ? ` [${skipProviderLabel} detected: agent.execute disabled, using programmatic flow only]` : ""}`);
    const t0 = Date.now();
    const result = initialMaxSteps === 0
      ? { message: `Skipped initial agent run — ${skipProviderLabel} programmatic flow active.` }
      : await agent.execute({ instruction, maxSteps: 40 }) as AgentExecutionResult;

    // 鈹€鈹€ Switch to the most relevant open tab 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // Some hotel sites open a new tab when "Book Now" is clicked (e.g. Radio Hotel).
    // After the agent run, find the most recently opened non-blank page that is NOT
    // the original start URL, and use it for all subsequent DOM operations.
    let activePage = page;
    try {
      const allPages = stagehand.context.pages();
      const rankedPages = allPages
        .map((candidatePage, index) => {
          const url = getScopeUrl(getRawPage(candidatePage));
          return {
            candidatePage,
            url,
            index,
            score: scoreActivePageCandidate(url, input.startUrl),
          };
        })
        .filter((candidate) => candidate.score > -100)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          return right.index - left.index;
        });

      if (rankedPages.length > 0 && rankedPages[0].candidatePage !== page) {
        activePage = rankedPages[0].candidatePage;
        trace(`Switched active page to best candidate: ${rankedPages[0].url.slice(0, 80)} (score=${rankedPages[0].score})`);
        // Live-view getter already returns stagehand.context.activePage() dynamically — no update needed.
      }
    } catch {
      // ignore —?keep using the original page
    }
    const raw = getRawPage(activePage);
    const mainMsg = (result.message ?? "").slice(0, 200);
    trace(`Agent finished main run in ${((Date.now() - t0) / 1000).toFixed(1)}s —?message: "${mainMsg.slice(0, 120)}"`);

    // Detect fatal API errors (out of credits, invalid key, quota exceeded).
    // Continuing the recovery loop is pointless —?every agent call will fail too.
    const fatalApiError =
      /credit balance is too low|insufficient_quota|invalid.{0,20}api.{0,20}key|rate limit exceeded|payment required|quota exceeded|exceeded your current quota|credits? exhausted|billing error|billing issue|browser minutes limit/i.test(mainMsg);
    if (fatalApiError) {
      return {
        status: "error" as const,
        error: `AI model API error: ${mainMsg.slice(0, 300)}`,
        handoffUrl: input.startUrl,
        sessionUrl: useCloud ? stagehand.browserbaseSessionURL : undefined,
        summary: "Booking stopped: the AI model API returned a billing or quota error. Check your API key credits.",
        debugTrace,
      };
    }

    // Check ALL open pages —?booking sites often open a new tab for the
    // checkout flow, so activePage() may still point to the original hotel
    // homepage while the real booking progress is in another tab.
    let agentMessage = (result.message ?? "").toLowerCase();
    let currentUrl = await resolveCurrentUrl(raw, stagehand, input.startUrl);
    const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;

    // ── Expedia flight programmatic RPA ──────────────────────────────────────────
    // Bypasses the AI agent entirely. Programmatically: find flight → select fare →
    // dismiss bundle popup → skip to checkout → fill passenger info → stop before CVV.
    if (isExpediaFlightUrl(input.startUrl)) {
      const screenshotBuf = await raw.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
      const screenshotBase64 = screenshotBuf?.toString("base64") ?? "";

      try {
        const flightProfile = {
          first_name: input.profile.first_name,
          last_name: input.profile.last_name,
          email: input.profile.email,
          phone: input.profile.phone,
          date_of_birth: input.profile.date_of_birth,
          passport_number: input.profile.passport_number,
          passport_expiry: input.profile.passport_expiry,
          passport_country: input.profile.passport_country,
          known_traveler_number: input.profile.known_traveler_number,
        };

        const targetAirline = input.targetAirline;
        const targetPrice = input.targetPrice;
        const targetDepartureTime = input.targetDepartureTime;
        const targetFlightNumber = input.targetFlightNumber;

        trace(`[flight-rpa] Starting programmatic flight booking: airline="${targetAirline}" price=$${targetPrice} time="${targetDepartureTime}" flightNo="${targetFlightNumber}"`);

        const getAllPages = (): Page[] =>
          stagehand.context.pages().map((p: unknown) => getRawPage(p));

        const rpaResult = await bookExpediaFlightProgrammatic(
          raw, flightProfile, targetAirline, targetPrice, targetDepartureTime, targetFlightNumber, trace, getAllPages, stagehand
        );

        const finalScreenshot = await raw.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
        const finalScreenshotBase64 = finalScreenshot?.toString("base64") ?? screenshotBase64;

        if (rpaResult.reached_checkout) {
          // Use activePage (may be a new tab Expedia opened for review/checkout)
          const checkoutPage = rpaResult.activePage ?? raw;

          // ── AI form fill: passenger info + travel documents ──────────────
          trace("[flight-rpa] Checkout reached — running AI form fill");
          const effectiveFlightProfile = buildEffectiveProfile(input.profile, input.task);
          let fillStoppedForQuota = false;
          let fillSummary = "Flight passenger info pre-filled by AI — open to review and complete payment.";
          try {
            const fillResult = await fillFlightGuestFormWithAI(stagehand, effectiveFlightProfile, trace);
            trace(`[flight-rpa] AI fill: filled=${fillResult.filled.join(",")} failed=${fillResult.failed.join(",")}`);
            fillStoppedForQuota = fillResult.stoppedReason === "quota";
            if (fillStoppedForQuota) {
              fillSummary = "Flight checkout reached, but AI form fill stopped because the model API quota was exceeded. Review traveler details and complete payment.";
            } else if (fillResult.filled.length === 0) {
              fillSummary = "Flight checkout reached — review traveler details and complete payment.";
            }
          } catch (fillErr) {
            trace(`[flight-rpa] AI fill error: ${(fillErr as Error).message?.slice(0, 80)}`);
            fillSummary = "Flight checkout reached — review traveler details and complete payment.";
          }
          // ── AI audit: re-fill any fields AI missed ────────────────────
          if (!fillStoppedForQuota) {
            try {
              const auditResult = await auditAndRefillEmptyFields(stagehand, checkoutPage, effectiveFlightProfile, trace);
              trace(`[flight-rpa] Audit refill: ${auditResult.refilled.join(",") || "none"}`);
            } catch (auditErr) {
              trace(`[flight-rpa] Audit error: ${(auditErr as Error).message?.slice(0, 80)}`);
            }
          } else {
            trace("[flight-rpa] Skipping AI audit refill because the model API quota was exceeded");
          }

          const postFillScreenshot = await checkoutPage.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
          const checkoutUrl = (() => { try { return (checkoutPage as unknown as { url: () => string }).url(); } catch { return rpaResult.currentUrl || input.startUrl; } })();
          // Keep the Expedia flight browser open so the user can review traveler
          // details and enter payment info. Without this call, the successful
          // paused_payment return short-circuits past the central hold at the
          // end of runBrowserTask and the browser gets torn down with Stagehand
          // — making the flight tab "flash closed" right after checkout.
          if (!useCloud && input.jobId) {
            holdBrowserOpenForManualReview(
              `Local mode: flight checkout reached — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes to review traveler details and complete payment.`
            );
          }
          return {
            status: "paused_payment" as const,
            screenshotBase64: postFillScreenshot?.toString("base64") ?? finalScreenshotBase64,
            handoffUrl: checkoutUrl || rpaResult.currentUrl || input.startUrl,
            sessionUrl,
            summary: fillSummary,
            debugTrace,
          };
        }

        if (!useCloud && input.jobId) {
          holdBrowserOpenForManualReview(
            `Local mode: flight checkout was not reached — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes for manual review/continue.`
          );
        }

        return {
          status: "error" as const,
          screenshotBase64: finalScreenshotBase64,
          handoffUrl: input.startUrl,
          sessionUrl,
          summary: rpaResult.error ?? "Couldn't navigate to flight checkout. Open the link to book manually.",
          error: rpaResult.error ?? "Flight booking RPA did not reach checkout.",
          debugTrace,
        };
      } catch (rpaErr) {
        trace(`[flight-rpa] Unexpected error: ${(rpaErr as Error).message?.slice(0, 120)}`);
        if (!useCloud && input.jobId) {
          holdBrowserOpenForManualReview(
            `Local mode: flight booking hit an unexpected error — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes for inspection.`
          );
        }
        return {
          status: "error" as const,
          screenshotBase64,
          handoffUrl: input.startUrl,
          sessionUrl,
          summary: "Flight booking encountered an error. Open the link to book manually.",
          error: (rpaErr as Error).message?.slice(0, 200) ?? "Flight RPA error",
          debugTrace,
        };
      }
    }
    // ── End Expedia flight RPA ─────────────────────────────────────────────────

    // ── Ticketmaster programmatic RPA (phase 1: navigate to seat selection) ───
    // Bypasses the AI agent. Flow: attraction calendar click → Find Tickets →
    // event page → STOP for user to pick seats → poll Reserve Tickets → checkout.
    // Once checkout.ticketmaster is reached, the normal guestDetails / payment
    // layers (via provider.fillGuestForm / fillPaymentForm) take over.
    if (ticketmasterPageOpen) {
      const screenshotBuf = await raw.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
      const screenshotBase64 = screenshotBuf?.toString("base64") ?? "";
      try {
        const getAllPages = (): Page[] =>
          stagehand.context.pages().map((pg: unknown) => getRawPage(pg));
        const rpaResult = await bookTicketmasterProgrammatic(
          raw, input.task, trace, stagehand, getAllPages
        );

        const finalScreenshot = await raw.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
        const finalScreenshotBase64 = finalScreenshot?.toString("base64") ?? screenshotBase64;

        if (rpaResult.reached_checkout) {
          // Checkout reached — fall through to the normal form-fill pipeline below.
          // Update currentUrl so the guestDetails/payment stage detection is correct.
          // activePage stays on the Stagehand wrapper; recovery loop handles tab
          // switching if Ticketmaster opens checkout in a new tab.
          currentUrl = rpaResult.currentUrl || currentUrl;
          agentMessage = "Ticketmaster RPA: reached checkout, handing off to form-fill pipeline";
          trace(`[tm-rpa] Handoff: currentUrl=${currentUrl.slice(0, 140)}`);
          // Fall through — do NOT return. Normal recovery loop will detect
          // guestDetailsStep via provider.getStageSignals and fill the form.
        } else {
          if (!useCloud && input.jobId) {
            holdBrowserOpenForManualReview(
              `Local mode: Ticketmaster RPA did not reach checkout — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes for manual review/continue.`
            );
          }
          return {
            status: rpaResult.needs_login ? "error" as const : "error" as const,
            screenshotBase64: finalScreenshotBase64,
            handoffUrl: rpaResult.currentUrl || input.startUrl,
            sessionUrl,
            summary: rpaResult.needs_login
              ? "Ticketmaster wants you to sign in. Run `node scripts/save-ticketmaster-cookies.mjs` to refresh your saved session, then try again."
              : (rpaResult.error ?? "Couldn't reach Ticketmaster checkout. Open the link to finish manually."),
            error: rpaResult.error ?? "Ticketmaster RPA did not reach checkout.",
            debugTrace,
          };
        }
      } catch (rpaErr) {
        trace(`[tm-rpa] Unexpected error: ${(rpaErr as Error).message?.slice(0, 120)}`);
        if (!useCloud && input.jobId) {
          holdBrowserOpenForManualReview(
            `Local mode: Ticketmaster RPA crashed — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes for inspection.`
          );
        }
        return {
          status: "error" as const,
          screenshotBase64,
          handoffUrl: input.startUrl,
          sessionUrl,
          summary: "Ticketmaster booking encountered an error. Open the link to book manually.",
          error: (rpaErr as Error).message?.slice(0, 200) ?? "Ticketmaster RPA error",
          debugTrace,
        };
      }
    }
    // ── End Ticketmaster RPA ────────────────────────────────────────────────────

    // ── SeatGeek programmatic RPA (navigate to checkout + open card modal) ─────
    // Bypasses the AI agent. Flow: homepage search → autocomplete top result →
    // listing page date match (Show more expansion) → event detail → cheapest
    // ticket → /checkout URL → click "Add new card" to open billing+card modal.
    // Once the modal is open, the normal guestDetails / payment layers (via
    // provider.fillGuestForm / fillPaymentForm) take over.
    // This path requires real Chrome (USE_REAL_CHROME_FOR=seatgeek) to bypass
    // DataDome bot fingerprinting — Playwright Chromium gets 403'd otherwise.
    if (seatgeekPageOpen) {
      const screenshotBuf = await raw.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
      const screenshotBase64 = screenshotBuf?.toString("base64") ?? "";
      try {
        const getAllPages = (): Page[] =>
          stagehand.context.pages().map((pg: unknown) => getRawPage(pg));
        const rpaResult = await bookSeatGeekProgrammatic(
          raw, input.task, trace, stagehand, getAllPages
        );

        const finalScreenshot = await raw.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
        const finalScreenshotBase64 = finalScreenshot?.toString("base64") ?? screenshotBase64;

        if (rpaResult.reached_checkout) {
          // Checkout modal open — call SG provider's fillGuestForm + fillPaymentForm
          // directly on the new /checkout tab, then return paused_payment.
          // Do NOT fall through: the generic hotel/listing flow below does not
          // apply to SeatGeek (wrong page assessment, wrong AI prompts).
          const checkoutPage = (rpaResult.activePage as Page | undefined) ?? raw;
          currentUrl = rpaResult.currentUrl || currentUrl;
          trace(`[sg-rpa] Handoff: currentUrl=${currentUrl.slice(0, 140)}`);

          const sgProvider = getProvider("https://seatgeek.com/checkout");
          const effectiveProfile = buildEffectiveProfile(input.profile, input.task);
          // Note: SeatGeek's card number + CVV fields live inside a cross-origin
          // Spreedly iframe (PCI tokenization) — we can't auto-fill either. The
          // user must enter both manually. Billing address + exp date we do fill.
          let fillSummary = "SeatGeek checkout reached — review billing details and enter card number + CVC to complete payment.";
          // Separate try/catch: guest-form error must NOT skip payment-form fill,
          // and vice versa. Each is independent and worth attempting.
          if (sgProvider?.fillGuestForm) {
            try {
              await sgProvider.fillGuestForm(checkoutPage, effectiveProfile, { stagehand, rawPage: checkoutPage, autonomy: input.autonomySettings }, trace);
            } catch (fillErr) {
              trace(`[sg-rpa] fillGuestForm error: ${(fillErr as Error).message?.slice(0, 120)}`);
              fillSummary = "SeatGeek checkout reached, but billing auto-fill hit an error. Review details and enter card number + CVC to complete payment.";
            }
          }
          if (sgProvider?.fillPaymentForm) {
            try {
              await sgProvider.fillPaymentForm(checkoutPage, effectiveProfile, { stagehand, rawPage: checkoutPage }, trace);
            } catch (fillErr) {
              trace(`[sg-rpa] fillPaymentForm error: ${(fillErr as Error).message?.slice(0, 120)}`);
            }
          }

          const postFillScreenshot = await checkoutPage.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
          const checkoutUrl = (() => { try { return checkoutPage.url(); } catch { return rpaResult.currentUrl || input.startUrl; } })();
          if (!useCloud && input.jobId) {
            holdBrowserOpenForManualReview(
              `Local mode: SeatGeek checkout reached — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes to enter card number + CVC and complete payment.`
            );
          }
          return {
            status: "paused_payment" as const,
            screenshotBase64: postFillScreenshot?.toString("base64") ?? finalScreenshotBase64,
            handoffUrl: checkoutUrl,
            sessionUrl,
            summary: fillSummary,
            debugTrace,
          };
        } else {
          if (!useCloud && input.jobId) {
            holdBrowserOpenForManualReview(
              `Local mode: SeatGeek RPA did not reach checkout — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes for manual review/continue.`
            );
          }
          return {
            status: "error" as const,
            screenshotBase64: finalScreenshotBase64,
            handoffUrl: rpaResult.currentUrl || input.startUrl,
            sessionUrl,
            summary: rpaResult.needs_login
              ? "SeatGeek wants you to sign in. Open the link to sign in manually, then try again."
              : (rpaResult.error ?? "Couldn't reach SeatGeek checkout. Open the link to finish manually."),
            error: rpaResult.error ?? "SeatGeek RPA did not reach checkout.",
            debugTrace,
          };
        }
      } catch (rpaErr) {
        trace(`[sg-rpa] Unexpected error: ${(rpaErr as Error).message?.slice(0, 120)}`);
        if (!useCloud && input.jobId) {
          holdBrowserOpenForManualReview(
            `Local mode: SeatGeek RPA crashed — keeping browser open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes for inspection.`
          );
        }
        return {
          status: "error" as const,
          screenshotBase64,
          handoffUrl: input.startUrl,
          sessionUrl,
          summary: "SeatGeek booking encountered an error. Open the link to book manually.",
          error: (rpaErr as Error).message?.slice(0, 200) ?? "SeatGeek RPA error",
          debugTrace,
        };
      }
    }
    // ── End SeatGeek RPA ────────────────────────────────────────────────────────

    const p = buildEffectiveProfile(input.profile, input.task);
    const hasProfile = !!(p.full_name || p.first_name || p.last_name || p.email || p.phone);
    trace(`Profile check: hasProfile=${hasProfile}, fields=${[p.full_name?"full_name":null, p.first_name?"first_name":null, p.email?"email":null, p.phone?"phone":null].filter(Boolean).join(",") || "none"}`);
    const requestedDatesFromTask = extractRequestedStayDates(input.task);
    // Fallback: extract dates from startUrl query params (Expedia uses startDate/endDate,
    // Hotels.com uses similar params). Reliable because the frontend always builds the URL.
    const startUrlParams = (() => { try { return new URL(input.startUrl).searchParams; } catch { return new URLSearchParams(); } })();
    const requestedDates = {
      checkin:  requestedDatesFromTask.checkin  || startUrlParams.get("startDate") || startUrlParams.get("chkin")  || undefined,
      checkout: requestedDatesFromTask.checkout || startUrlParams.get("endDate")   || startUrlParams.get("chkout") || undefined,
    };
    const targetHotelFromTask = extractTargetHotelName(input.task);
    const targetHotelFromStartUrl = extractTargetHotelNameFromUrl(input.startUrl);
    const targetHotelFromCurrentUrl = extractTargetHotelNameFromUrl(currentUrl);
    const targetHotelName =
      targetHotelFromTask ||
      targetHotelFromStartUrl ||
      targetHotelFromCurrentUrl;
    const targetHotelSource =
      targetHotelFromTask ? "task" :
      targetHotelFromStartUrl ? "startUrl" :
      targetHotelFromCurrentUrl ? "currentUrl" :
      "unknown";
    trace(
      `Target hotel: ${targetHotelName ?? "unknown"} ` +
      `(source=${targetHotelSource}, startUrl=${input.startUrl.slice(0, 140)})`
    );

    // Extract room type preference from the task text.
    // buildHotelTask() embeds it as "Prefer a <pref> room type if available."
    // We also accept inline formats like "Room type: King Suite" for manual tasks.
    // Fallback: extract from hotel name suffix "Hotel Name - Room Type" (step label format).
    const roomPreference: string | undefined = (() => {
      const t = input.task;
      const m =
        t.match(/[Pp]refer(?:ence)?[:\s]+(?:a\s+)?([^.]+?)\s+room\s+type/i) ||
        t.match(/[Rr]oom\s+(?:type|preference)[:\s]+([^\n.]+)/i) ||
        t.match(/[Ss]elect\s+(?:a\s+)?([^.]+?)\s+room/i);
      let raw = m?.[1]?.trim();
      // Fallback: "Hotel Name - Deluxe Family Room" suffix in the hotel name label
      if (!raw) {
        raw = targetHotelName?.match(/\s+-\s+(.+)$/)?.[1]?.trim();
      }
      // Reject non-preference captures: empty, too short, or containing generic words.
      // Pattern 3 (/Select\s+...room/) can capture "the cheapest available" or just "the" —
      // these must all be rejected so we don't pass a stop-word as a room preference.
      if (!raw) return undefined;
      if (raw.length < 4) return undefined;  // "the", "a", "an", etc.
      if (/^the\b|cheapest|standard|available|lowest/i.test(raw)) return undefined;
      // Restaurant tasks don't have room types — skip for all restaurant platforms
      if (startProvider?.id === "opentable-com" || startProvider?.id === "resy-com" || startProvider?.id === "yelp-com") return undefined;
      // Reject location-like suffixes that look like restaurant branch names
      // e.g. "Nashville - Lower Broadway" from "Hattie B's Hot Chicken - Nashville - Lower Broadway"
      if (/^[A-Z][a-z]+ -\s+[A-Z]/.test(raw)) return undefined;
      return raw;
    })();
    if (roomPreference) {
      trace(`Room preference extracted from task: "${roomPreference}"`);
    } else {
      trace("No specific room preference found in task — will select cheapest available.");
    }
    // ── Pre-AI fast path: cheap text-signal check for not-bookable pages ──
    // Skip the AI stage detector entirely when the page is unambiguously a
    // not-bookable surface (OT 'Not available on OpenTable', 'Permanently
    // Closed', OT/Resy 404). Without this fast path we still classify these
    // correctly, but we burn 30-60s on Anthropic vision calls + queueing
    // first. Catches the same signals as the listing-stage classifier at
    // line ~4753 — runs first so we never hit the slow path for these pages.
    try {
      const earlyText = await raw.evaluate(() => (document.body?.innerText ?? "").toLowerCase());
      if (NO_AVAILABILITY_SIGNALS.some((sig) => earlyText.includes(sig))) {
        const matchedSignal = NO_AVAILABILITY_SIGNALS.find((sig) => earlyText.includes(sig));
        trace(`Pre-AI fast path: page text matched NO_AVAILABILITY_SIGNALS ("${matchedSignal}") — early no_availability without AI assessment.`);
        const ssBuf = await raw.screenshot({ type: "png" }).catch(() => null);
        const ss = ssBuf ? `data:image/png;base64,${ssBuf.toString("base64")}` : undefined;
        const venueLabel = targetHotelName ?? "This venue";
        return {
          status: "no_availability" as const,
          screenshotBase64: ss,
          handoffUrl: raw.url(),
          sessionUrl,
          summary: `${venueLabel} is not available for booking on this platform. The detail page exists but the booking widget is not present.`,
          debugTrace,
        };
      }
    } catch (err) {
      trace(`Pre-AI fast path skipped (${(err as Error).message?.slice(0, 60)})`);
    }

    let assessment = await assessBookingStage({
      rawPage: raw,
      stagehand,
      startUrl: input.startUrl,
      requestedDates,
      agentMessage,
    });
    let pageText = assessment.pageText;
    currentUrl = assessment.currentUrl;

    const attemptStageRecovery = async (stage: BookingStage): Promise<boolean> => {
      // Always clear blocking modals before any recovery attempt.
      const cleared = await dismissBlockingModals(raw).catch(() => "");
      if (cleared) trace(`Stage recovery dismissed modal(s) before ${stage}: ${cleared}`);
      const bookingComContext = !!(
        getProvider(currentUrl)?.id === 'booking-com' ||
        getProvider(raw.url())?.id === 'booking-com' ||
        bookingComPageOpen
      );

      switch (stage) {
        case "listing": {
          if (process.env.AI_LOOP_LISTING === "true") {
            // OpenTable: run time-slot handler regardless of targetHotelName —
            // the search URL already has the restaurant pre-filtered via ?term=.
            // This block is a copy of the handler below (before targetHotelName guard).
            if (startProvider?.id === "opentable-com") {
              // Fall through to the OpenTable handler below (after the guard).
            } else if (!targetHotelName) {
              trace("[ai-listing] target hotel name could not be parsed from the task.");
              return false;
            }
            // Helper: does a URL look like a hotel detail page on any known OTA?
            const isHotelDetailUrl = (url: string): boolean => {
              return (
                /booking\.com\/hotel\//.test(url) ||
                /secure\.booking\.com\/book/.test(url) ||
                /expedia\.com\/.*[./]h\d+[./]/.test(url) ||   // e.g. .h12345.Hotel-Information
                /hotels\.com\/ho\d+/.test(url) ||              // e.g. /ho12345/
                /hotels\.com\/h\d+/.test(url) ||               // alternate /h12345/ format
                /\/hotel-information/.test(url) ||
                /\/hotel-details/.test(url)
              );
            };

            // Dismiss any blocking modals before clicking the hotel listing.
            // Expedia shows a "We include taxes and fees — Got it" info dialog
            // that intercepts clicks on the listing cards behind it.
            // Strategy 1: modal container selector (works when role="dialog" or aria-modal is set)
            // Strategy 2: direct "Got it" button search on page (works even without a container)
            const preDismissed = await raw.evaluate(() => {
              const isVisible = (el: Element) => {
                const r = (el as HTMLElement).getBoundingClientRect();
                return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
              };
              const closePatterns = /^(got it|ok|okay|close|dismiss|done|continue|accept|×|✕|no thanks)$/i;
              let clicked = 0;

              // Strategy 1: buttons inside known dialog/modal/overlay containers
              const modals = Array.from(document.querySelectorAll<HTMLElement>(
                '[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="Modal"], ' +
                '[class*="overlay"], [class*="Overlay"], [class*="dialog"], [class*="Dialog"], ' +
                '[class*="sheet"], [class*="Sheet"], [class*="popup"], [class*="Popup"]'
              )).filter(el => isVisible(el));
              for (const modal of modals) {
                const btns = Array.from(modal.querySelectorAll<HTMLElement>('button, [role="button"]'));
                for (const btn of btns) {
                  if (!isVisible(btn)) continue;
                  if (closePatterns.test((btn.textContent ?? "").trim())) {
                    btn.click();
                    clicked++;
                    break;
                  }
                }
              }

              // Strategy 2: fallback — look for any visible "Got it" / dismiss button
              // anywhere on the page. This handles Expedia-style modals that use
              // transform-based centering with no explicit z-index on ancestors.
              // Safety check: only click if there are multiple visible buttons or the
              // page has an obvious overlay (darkened background) element.
              if (clicked === 0) {
                const hasOverlay = !!document.querySelector(
                  '[class*="overlay" i], [class*="backdrop" i], [class*="scrim" i], [style*="rgba(0"]'
                );
                const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
                  .filter(b => isVisible(b) && closePatterns.test((b.textContent ?? "").trim()));
                if (hasOverlay && allBtns.length > 0) {
                  allBtns[0].click();
                  clicked++;
                } else if (allBtns.length > 0) {
                  // Even without an explicit overlay: if there's exactly one "Got it"-style
                  // button visible and the page title / URL suggests a search results page
                  // (not a form), click it as it's almost certainly the info modal dismiss.
                  const isSearchPage = window.location.href.includes("hotel-search") ||
                    window.location.href.includes("searchresults") ||
                    document.title.toLowerCase().includes("hotels") ||
                    !!document.querySelector('[data-testid*="search"], [id*="search"]');
                  if (isSearchPage && allBtns.length === 1) {
                    allBtns[0].click();
                    clicked++;
                  }
                }
              }

              return clicked;
            }).catch(() => 0);
            if (preDismissed > 0) {
              trace(`[ai-listing] dismissed ${preDismissed} pre-click modal(s)`);
              await new Promise(r => setTimeout(r, 800));
            } else {
              trace(`[ai-listing] no blocking modal detected before listing click`);
            }

            // Expedia search refinement strategy:
            // Expedia always redirects a hotel-name destination URL to a city-level search.
            // Re-navigating is futile. Instead we use a two-stage approach:
            //
            // Stage A: Type hotel name into the TOP search bar, select from autocomplete,
            //          then click Search — this navigates directly to the hotel detail page
            //          (or a filtered hotel-specific results page).
            //
            // Stage B (fallback): If the top search bar approach fails, use the left-sidebar
            //          "Search by property name" filter and type character-by-character to
            //          trigger React's event handlers (raw.type beats raw.fill here).
            if (startProvider?.id === "expedia" || startProvider?.id === "hotels-com") {
              try {
                // ── Hotels.com: proactively dismiss the "We include taxes and fees" modal ──
                // This promotional modal appears 1-3 seconds after the Hotels.com search results
                // page loads. It blocks all clicks on the page until dismissed. We poll for it
                // right at the START of the Hotels.com refinement flow (before sidebar typing)
                // so it doesn't block Stage B. Without this early dismiss the sidebar filter
                // interaction gets intercepted by the modal overlay.
                if (startProvider?.id === "hotels-com") {
                  const dismissHotelsModal = async (): Promise<boolean> => {
                    return raw.evaluate(() => {
                      const isVisible = (el: Element) => {
                        const r = (el as HTMLElement).getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                      };
                      const patterns = /^(got it|ok|okay|close|dismiss|done|continue|accept|×|✕|no thanks)$/i;
                      // Strategy 1: buttons inside known dialog/modal containers
                      const modals = Array.from(document.querySelectorAll<HTMLElement>(
                        '[role="dialog"], [aria-modal="true"], [class*="modal" i], ' +
                        '[class*="overlay" i], [class*="dialog" i], [class*="popup" i], ' +
                        '[class*="sheet" i]'
                      )).filter(isVisible);
                      for (const modal of modals) {
                        for (const btn of modal.querySelectorAll<HTMLElement>('button, [role="button"]')) {
                          if (isVisible(btn) && patterns.test((btn.textContent ?? "").trim())) {
                            btn.click();
                            return true;
                          }
                        }
                      }
                      // Strategy 2: any visible "Got it" button anywhere on the page
                      for (const btn of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
                        if (isVisible(btn) && /^got it$/i.test((btn.textContent ?? "").trim())) {
                          btn.click();
                          return true;
                        }
                      }
                      return false;
                    }).catch(() => false);
                  };

                  // Poll up to 4 seconds (500ms intervals) for the modal to appear, then dismiss
                  let modalDismissed = false;
                  for (let attempt = 0; attempt < 8; attempt++) {
                    await new Promise(r => setTimeout(r, 500));
                    const dismissed = await dismissHotelsModal();
                    if (dismissed) {
                      modalDismissed = true;
                      trace(`[ai-listing] Hotels.com "taxes & fees" modal dismissed (attempt ${attempt + 1})`);
                      // Wait for the modal close animation to complete
                      await new Promise(r => setTimeout(r, 600));
                      break;
                    }
                  }
                  if (!modalDismissed) {
                    trace(`[ai-listing] Hotels.com: no promotional modal found — proceeding`);
                  }
                }

                const expediaCurrentUrl = new URL(raw.url());
                const dest = expediaCurrentUrl.searchParams.get("destination") ?? "";
                const isCityLevel = dest.includes(",") || expediaCurrentUrl.searchParams.has("regionId") ||
                  // Hotels.com city-level search: destination is a city name like "New York"
                  // or no hotel ID appears in the URL yet
                  (startProvider?.id === "hotels-com" && !/hotels\.com\/(ho|h)\d+/.test(raw.url().toLowerCase()));

                // Hotels.com: skip Stage A (destination bar) entirely.
                // The "Where to?" bar navigates to a city-level search and cannot reliably
                // select a specific hotel property. Use Stage B (sidebar "Search by property name") directly.
                const skipStageA = startProvider?.id === "hotels-com";

                if (isCityLevel && targetHotelName) {
                  // searchBarUsed tracks whether Stage A succeeded; false means Stage B will run.
                  let searchBarUsed = false;

                  if (skipStageA) {
                    trace(`[ai-listing] Hotels.com: skipping Stage A — will use sidebar "Search by property name" (Stage B)`);
                  } else {
                  trace(`[ai-listing] city-level search detected — trying Stage A (destination bar) first`);

                  // ── Stage A: use the destination search box at the top ──────────────────
                  // Selectors for the main destination/location search input.
                  // Hotels.com uses "Where to?" placeholder; Expedia uses "Going to".
                  const destSelectors = [
                    '[data-testid="destination-field"]',
                    'input[data-testid="destination-field"]',
                    'button[data-testid="destination-field"]',
                    '[data-stid*="destination"] input[type="text"]',
                    'input[placeholder*="Where to" i]',
                    'input[placeholder*="Going to" i]',
                    'input[id*="destination" i][type="text"]',
                    'input[aria-label*="Going to" i]',
                    'input[aria-label*="Staying" i]',
                    'input[aria-label*="destination" i]',
                  ];

                  for (const sel of destSelectors) {
                    const visible = await raw.evaluate((s: string) => {
                      const el = document.querySelector(s);
                      if (!el) return false;
                      const r = (el as HTMLElement).getBoundingClientRect();
                      return r.width > 0 && r.height > 0;
                    }, sel).catch(() => false);
                    if (!visible) continue;

                    try {
                      // Click to focus, select-all, then type hotel name character-by-character.
                      // Use Stagehand's sh() helper: keyPress/type use CDP input events.
                      await sh(raw).locatorClick(sel, { clickCount: 3 });
                      await new Promise(r => setTimeout(r, 300));
                      await sh(raw).keyPress("Control+a");
                      await sh(raw).keyPress("Backspace");
                      await new Promise(r => setTimeout(r, 200));
                      await sh(raw).type(targetHotelName, { delay: 60 });
                      trace(`[ai-listing] typed hotel name in top search bar: "${targetHotelName.slice(0, 60)}"`);
                      searchBarUsed = true;
                      break;
                    } catch (typeErr) {
                      trace(`[ai-listing] search bar type failed (${sel}): ${(typeErr as Error).message?.slice(0, 60)}`);
                    }
                  }

                  if (searchBarUsed) {
                    // Wait for autocomplete suggestions to appear
                    await new Promise(r => setTimeout(r, 2000));

                    // Select the best matching suggestion from the dropdown.
                    // IMPORTANT: Use CDP coordinate click (not DOM .click()) to trigger Hotels.com
                    // navigation. Filter out "Search for '...'" items (text-only search).
                    const hotelWords = targetHotelName.toLowerCase().split(/\s+/)
                      .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                    const pickedCoords = await raw.evaluate((words: string[]) => {
                      const isVisible = (el: HTMLElement) => {
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                      };
                      // Filter out "Search for '...'" generic search suggestions.
                      // Use a non-anchored pattern — autocomplete items often prepend a hidden
                      // icon span whose accessible text is "search", turning the full textContent
                      // into "searchsearchSearch for ..." which defeats a ^-anchored regex.
                      const isNotSearchFor = (el: HTMLElement) =>
                        !/search\s+for\b/i.test((el.textContent ?? "").replace(/\s+/g, " ").trim());
                      const scoreEl = (el: HTMLElement) =>
                        words.filter(w => (el.textContent ?? "").toLowerCase().includes(w)).length;
                      const toResult = (el: HTMLElement) => {
                        el.scrollIntoView({ behavior: 'instant', block: "center" });
                        const r = el.getBoundingClientRect();
                        return {
                          x: Math.round(r.left + r.width / 2),
                          y: Math.round(r.top + r.height / 2),
                          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
                        };
                      };

                      // Structured selectors — ordered from most to least specific
                      const suggSelectors = [
                        '[role="option"]',
                        '[data-testid*="suggest"]',
                        '[data-stid*="typeahead-item"]',
                        '[data-stid*="TypeAhead-item"]',
                        '[data-stid*="typeahead"] li',
                        '[data-stid*="TypeAhead"] li',
                        '[class*="TypeAheadResults"] li',
                        '[class*="typeaheadResults"] li',
                        '[class*="typeahead" i] li',
                        '[class*="AutoSuggest" i] li',
                        '[class*="suggestion" i]',
                        '[class*="autocomplete" i] li',
                        'ul[role="listbox"] li',
                        '[role="listbox"] li',
                        '[role="listbox"] [role="option"]',
                      ];
                      const threshold = Math.max(1, Math.ceil(words.length * 0.4));
                      for (const ss of suggSelectors) {
                        const items = Array.from(document.querySelectorAll<HTMLElement>(ss))
                          .filter(el => isVisible(el) && isNotSearchFor(el));
                        if (items.length === 0) continue;
                        const scored = items
                          .map(el => ({ el, score: scoreEl(el), text: (el.textContent ?? "").slice(0, 60) }))
                          .sort((a, b) => b.score - a.score);
                        const best = scored[0];
                        if (best && best.score >= threshold) return toResult(best.el);
                      }

                      // ── Broad fallback: individual dropdown items near the search bar ──
                      // Hotels.com may use class names we haven't seen yet. We scan for elements
                      // that are (a) visually in the autocomplete area, (b) item-sized (not containers).
                      // KEY CONSTRAINTS:
                      //   height: 20-100px  → exclude the full search-bar container (200px+)
                      //   top: 80-300px     → below the search input (y~55-75), above main content
                      //   width: 80-700px   → wide enough to be a suggestion row
                      // Do NOT include [data-stid] — it matches the whole search container.
                      const topItems = Array.from(document.querySelectorAll<HTMLElement>(
                        'li, [role="option"], button, div[tabindex]'
                      )).filter(el => {
                          if (!isVisible(el) || !isNotSearchFor(el)) return false;
                          const r = el.getBoundingClientRect();
                          return r.top >= 80 && r.top <= 300 &&
                                 r.width >= 80 && r.width <= 700 &&
                                 r.height >= 20 && r.height <= 100;
                        });
                      // Build diagnostics
                      const diagText = topItems.slice(0, 5)
                        .map(el => {
                          const r = el.getBoundingClientRect();
                          return `[${el.tagName}h${Math.round(r.height)}] ${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}`;
                        })
                        .join(" || ");
                      if (topItems.length > 0) {
                        const scored = topItems
                          .map(el => ({ el, score: scoreEl(el) }))
                          .sort((a, b) => b.score - a.score);
                        // Accept any item with score >= 1 (at least one word matches)
                        const best = scored[0];
                        if (best && best.score >= 1) return toResult(best.el);
                        // Still nothing — just take the first visible item (hotel property)
                        return toResult(topItems[0]);
                      }
                      // No items found at all — return diagnostic info
                      return { x: -1, y: -1, text: `DIAG:no-items-found diag=${diagText || "empty"}` };
                    }, hotelWords).catch(() => null);

                    if (pickedCoords?.x === -1) {
                      trace(`[ai-listing] autocomplete broad-fallback: ${pickedCoords.text}`);
                    }
                    if (pickedCoords && pickedCoords.x > 0) {
                      trace(`[ai-listing] CDP-clicking autocomplete suggestion: "${pickedCoords.text.slice(0, 60)}" at (${pickedCoords.x},${pickedCoords.y})`);
                      await sh(raw).click(pickedCoords.x, pickedCoords.y);
                      const picked = pickedCoords.text;
                      await new Promise(r => setTimeout(r, 1000));

                      // Click the Search / Submit button
                      const searched = await raw.evaluate(() => {
                        const isVisible = (el: Element) => {
                          const r = (el as HTMLElement).getBoundingClientRect();
                          return r.width > 0 && r.height > 0;
                        };
                        const btn = Array.from(document.querySelectorAll<HTMLElement>(
                          'button[data-testid="submit-button"], button[type="submit"], button[data-testid*="search"]'
                        )).find(b => isVisible(b));
                        if (btn) { btn.click(); return true; }
                        // Fallback: any visible "Search" button
                        const fallbackBtn = Array.from(document.querySelectorAll<HTMLElement>("button"))
                          .find(b => isVisible(b) && /^search$/i.test((b.textContent ?? "").trim()));
                        if (fallbackBtn) { fallbackBtn.click(); return true; }
                        return false;
                      }).catch(() => false);

                      if (searched) {
                        await new Promise(r => setTimeout(r, 4000));
                        trace(`[ai-listing] search submitted — URL: ${raw.url().slice(0, 100)}`);
                      } else {
                        // Autocomplete selection may have already navigated directly to hotel
                        await new Promise(r => setTimeout(r, 2000));
                        trace(`[ai-listing] no Search button found — autocomplete may have navigated directly`);
                      }
                    } else {
                      trace(`[ai-listing] no matching autocomplete suggestion found (x=${pickedCoords?.x ?? "null"}) — falling back to property name filter`);
                      searchBarUsed = false; // trigger fallback below
                    }
                  }
                  } // end of !skipStageA Stage A block

                  const getHotelsListingSnapshot = async (): Promise<string> => {
                    const snapshot = await raw.evaluate(() => {
                      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
                      const isVisible = (el: Element | null): el is HTMLElement => {
                        if (!(el instanceof HTMLElement)) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                      };
                      const activeFilters = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], label, .uitk-pill'))
                        .filter((el) => isVisible(el) && /fully refundable|free cancellation|refundable only|clear all/i.test(normalize(el.textContent ?? "")))
                        .map((el) => normalize(el.textContent ?? "").slice(0, 60))
                        .slice(0, 6);
                      const input = (() => {
                        const candidateInputs = Array.from(document.querySelectorAll<HTMLElement>('input, textarea'))
                          .filter((el): el is HTMLInputElement | HTMLTextAreaElement => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
                          .map((el) => {
                            const r = el.getBoundingClientRect();
                            const value = normalize((el as HTMLInputElement).value ?? "");
                            const meta = normalize([
                              el.getAttribute("placeholder") ?? "",
                              el.getAttribute("aria-label") ?? "",
                              el.getAttribute("data-testid") ?? "",
                              el.getAttribute("data-stid") ?? "",
                              el.className ?? "",
                              el.closest("label, section, aside, div")?.textContent ?? "",
                            ].join(" "));
                            const looksPropertyish =
                              /property name|marriott|hotel name|search by property name|e\.g\./i.test(meta) ||
                              /property/.test((el.getAttribute("data-testid") ?? "") + " " + (el.getAttribute("data-stid") ?? ""));
                            const isCurrency = /^\$\s*\d/.test(value) || /\bprice\b|\bnightly\b|\btotal\b/i.test(meta);
                            const isSidebarSized = r.left <= 420 && r.width >= 90 && r.width <= 360 && r.height >= 28 && r.height <= 64;
                            const visible = r.width > 0 && r.height > 0;
                            const score =
                              (looksPropertyish ? 120 : 0) +
                              (visible ? 30 : 0) +
                              (isSidebarSized ? 25 : 0) +
                              (value && !isCurrency ? 10 : 0) -
                              (isCurrency ? 200 : 0) -
                              (value.includes(",") ? 40 : 0);
                            return { el, score, visible, isCurrency, isSidebarSized };
                          })
                          .filter(({ score, isCurrency }) => score > 0 && !isCurrency)
                          .sort((a, b) => b.score - a.score);
                        return candidateInputs[0]?.el ?? null;
                      })();
                      const inputRect = input?.getBoundingClientRect();
                      const inputSummary = input
                        ? `value="${normalize(input.value ?? "").slice(0, 40)}" rect=(${Math.round(inputRect?.left ?? 0)},${Math.round(inputRect?.top ?? 0)}) ${Math.round(inputRect?.width ?? 0)}x${Math.round(inputRect?.height ?? 0)}`
                        : "missing";
                      const visibleCards = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
                        .filter((a) => {
                          if (!isVisible(a)) return false;
                          const href = a.href ?? "";
                          return /hotels\.com\/(ho|h)\d+/i.test(href) || /Hotel-Search/i.test(href);
                        })
                        .map((a) => `${normalize(a.textContent ?? "").slice(0, 60)} -> ${(a.href ?? "").slice(0, 90)}`)
                        .slice(0, 4);
                      return {
                        href: location.href.slice(0, 140),
                        noExact: /no exact matches/i.test(document.body.textContent ?? ""),
                        activeFilters,
                        inputSummary,
                        visibleCards,
                      };
                    }).catch(() => null as null | {
                      href: string;
                      noExact: boolean;
                      activeFilters: string[];
                      inputSummary: string;
                      visibleCards: string[];
                    });

                    if (!snapshot) return "snapshot-unavailable";
                    return [
                      `href=${snapshot.href}`,
                      `noExact=${snapshot.noExact}`,
                      `filters=${snapshot.activeFilters.length > 0 ? snapshot.activeFilters.join(" | ") : "none"}`,
                      `propertyInput=${snapshot.inputSummary}`,
                      `cards=${snapshot.visibleCards.length > 0 ? snapshot.visibleCards.join(" | ") : "none"}`,
                    ].join(" ; ");
                  };

                  // ── Pre-Stage B: remove active filters that hide the target hotel ────────
                  // Hotels.com may have "Fully refundable properties" or similar filters active
                  // (often from the &ro parameter in the start URL). These prevent the property
                  // name filter from finding the hotel. Clear them before searching by name.
                  if (!searchBarUsed && startProvider?.id === "hotels-com") {
                    trace(`[ai-listing] Hotels.com snapshot before filter clear -> ${await getHotelsListingSnapshot()}`);
                    const filterClear = await raw.evaluate(() => {
                      const filterTerms = /fully refundable|free cancellation|refundable only/i;
                      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
                      const isVisible = (el: Element | null): el is HTMLElement => {
                        if (!(el instanceof HTMLElement)) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                      };
                      const isInViewport = (el: Element | null): el is HTMLElement => {
                        if (!(el instanceof HTMLElement)) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight;
                      };
                      const clicked: string[] = [];
                      const fallbackTargets: Array<{ x: number; y: number; label: string }> = [];

                      const clickIfVisible = (el: Element | null, label: string) => {
                        if (!isVisible(el)) return false;
                        el.click();
                        clicked.push(label);
                        return true;
                      };

                      const chipSelectors = [
                        '[data-testid*="filterChip"]',
                        '[data-testid*="applied-filter"]',
                        '.uitk-pill',
                        '[class*="filter-pill"]',
                        '[class*="FilterChip"]',
                        '[data-stid*="filter-chip"]',
                        'button',
                        '[role="button"]',
                        // Hotels.com renders "Fully refundable property" as a label
                        // (uitk-checkbox-label) at ~y=2700, no close button inside.
                        // We scroll it into view and CDP-click to toggle the checkbox.
                        'label',
                      ];

                      for (const selector of chipSelectors) {
                        const chips = Array.from(document.querySelectorAll<HTMLElement>(selector));
                        for (const chip of chips) {
                          const text = normalize(chip.textContent ?? "");
                          if (!filterTerms.test(text)) continue;
                          // Exclude elements that are giant containers (their textContent includes the
                          // filter text but they span the whole sidebar — clicking them does nothing useful).
                          const r0 = chip.getBoundingClientRect();
                          if (r0.width > 600 || r0.height > 120) continue;
                          // Try DOM click (may not trigger Hotels.com React handler, but attempt anyway)
                          const closeBtn = chip.querySelector<HTMLElement>(
                            'button, [role="button"], [aria-label*="remove" i], [aria-label*="close" i]'
                          );
                          if (clickIfVisible(closeBtn, `chip-close:${text.slice(0, 40)}`)) {
                            // DOM click attempted — also capture CDP coordinates for fallback
                            (closeBtn as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
                            const rc = (closeBtn as HTMLElement).getBoundingClientRect();
                            if (rc.width > 0 && rc.height > 0) fallbackTargets.push({ x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2), label: `chip-close-cdp:${text.slice(0, 40)}` });
                            continue;
                          }
                          // No close button — scroll chip into view and capture CDP coordinates
                          chip.scrollIntoView({ behavior: 'instant', block: 'center' });
                          const r = chip.getBoundingClientRect();
                          if (r.width > 0 && r.height > 0) {
                            fallbackTargets.push({
                              x: Math.round(r.right - Math.max(14, Math.min(24, r.width * 0.12))),
                              y: Math.round(r.top + r.height / 2),
                              label: `chip-cdp:${text.slice(0, 40)}`,
                            });
                          }
                          clickIfVisible(chip, `chip:${text.slice(0, 40)}`);
                        }
                      }

                      const checkboxes = Array.from(document.querySelectorAll<HTMLElement>(
                        '[role="checkbox"], input[type="checkbox"]'
                      ));
                      for (const cb of checkboxes) {
                        const label = cb.closest('label') ?? cb.parentElement;
                        const labelText = normalize(label?.textContent ?? "");
                        if (!filterTerms.test(labelText)) continue;
                        const isChecked = cb.getAttribute('aria-checked') === 'true' ||
                          (cb as HTMLInputElement).checked;
                        if (isChecked) {
                          // Try DOM click first (may not trigger React handler, but attempt anyway)
                          clickIfVisible(label ?? cb, `checkbox:${labelText.slice(0, 40)}`);
                          // Always scroll into view and capture coordinates for CDP coordinate click.
                          // Hotels.com checkboxes are often far below the fold (y > 2000) and DOM
                          // .click() doesn't reliably trigger their React state handlers.
                          const target = label ?? cb;
                          (target as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
                          const r = (target as HTMLElement).getBoundingClientRect();
                          if (r.width > 0 && r.height > 0) {
                            fallbackTargets.push({
                              x: Math.round(r.left + r.width / 2),
                              y: Math.round(r.top + r.height / 2),
                              label: `checkbox-cdp:${labelText.slice(0, 40)}`,
                            });
                          }
                        }
                      }

                      // "Try removing filters" can be any element type — search broadly.
                      const clearFilterEls = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], span, p, div'))
                        .filter(el => {
                          const r = el.getBoundingClientRect();
                          if (r.width === 0 || r.height === 0 || r.height > 80) return false;
                          return /try removing filters|remove filters|clear filters|clear all/i.test(normalize(el.textContent ?? ""));
                        });
                      for (const link of clearFilterEls) {
                        const text = normalize(link.textContent ?? "");
                        if (isInViewport(link)) {
                          const r = link.getBoundingClientRect();
                          fallbackTargets.unshift({
                            x: Math.round(r.left + r.width / 2),
                            y: Math.round(r.top + r.height / 2),
                            label: `clear-link:${text.slice(0, 40)}`,
                          });
                        }
                        clickIfVisible(link, `clear-link:${text.slice(0, 40)}`);
                      }

                      const genericFilterTargets = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], label, div, span'))
                        .filter((el) => {
                          if (!isInViewport(el)) return false;
                          const text = normalize(el.textContent ?? "");
                          if (!filterTerms.test(text)) return false;
                          const r = el.getBoundingClientRect();
                          const inLikelyFilterZone = r.left < 420 || r.top < 260;
                          if (!inLikelyFilterZone) return false;
                          return r.width >= 60 && r.width <= 360 && r.height >= 20 && r.height <= 64;
                        })
                        .slice(0, 8);
                      for (const el of genericFilterTargets) {
                        const text = normalize(el.textContent ?? "");
                        const r = el.getBoundingClientRect();
                        fallbackTargets.push({
                          x: Math.round(r.right - Math.max(12, Math.min(22, r.width * 0.12))),
                          y: Math.round(r.top + r.height / 2),
                          label: `generic-filter:${text.slice(0, 40)}`,
                        });
                      }

                      const remaining = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], label, .uitk-pill'))
                        .filter((el) => isVisible(el) && filterTerms.test(normalize(el.textContent ?? "")))
                        .map((el) => normalize(el.textContent ?? "").slice(0, 60))
                        .slice(0, 5);

                      const dedupedFallbackTargets = fallbackTargets.filter((target, index, all) =>
                        all.findIndex((item) =>
                          item.label === target.label &&
                          Math.abs(item.x - target.x) <= 2 &&
                          Math.abs(item.y - target.y) <= 2
                        ) === index
                      ).slice(0, 6);

                      return { clicked, remaining, fallbackTargets: dedupedFallbackTargets };
                    }).catch(() => ({
                      clicked: [] as string[],
                      remaining: [] as string[],
                      fallbackTargets: [] as Array<{ x: number; y: number; label: string }>,
                    }));

                    // ── Diagnostic: find SMALL elements with filter text (not giant containers) ──
                    const filterDiag = await raw.evaluate(() => {
                      const filterTerms = /fully refundable|free cancellation|refundable only/i;
                      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
                      // querySelectorAll('*') returns outer containers first — skip them.
                      // Only look at small/leaf elements that are likely clickable UI controls.
                      return Array.from(document.querySelectorAll<HTMLElement>(
                        'button, label, [role="button"], [role="checkbox"], input, span, a, li, div, p'
                      )).filter(el => {
                          const r = el.getBoundingClientRect();
                          if (r.width === 0 || r.height === 0) return false;
                          if (r.width > 600 || r.height > 150) return false; // skip containers
                          return filterTerms.test(norm(el.textContent ?? ""));
                        })
                        .slice(0, 10)
                        .map(el => {
                          const r = el.getBoundingClientRect();
                          const ariaChecked = el.getAttribute('aria-checked');
                          const checked = (el as HTMLInputElement).checked;
                          return `${el.tagName}[${el.getAttribute('data-testid') ?? el.getAttribute('data-stid') ?? el.className.split(' ').slice(0,2).join(' ')}] ` +
                            `${Math.round(r.width)}x${Math.round(r.height)}@(${Math.round(r.left)},${Math.round(r.top)}) ` +
                            `ariaChecked=${ariaChecked} checked=${checked} ` +
                            `"${norm(el.textContent ?? "").slice(0, 50)}"`;
                        });
                    }).catch(() => [] as string[]);
                    trace(`[filter-diag] ALL elements with refundable text: ${filterDiag.length === 0 ? "NONE FOUND" : filterDiag.join(" || ")}`);

                    if (filterClear.clicked.length > 0) {
                      trace(`[ai-listing] Hotels.com: cleared active filters -> ${filterClear.clicked.join(" || ")}`);
                    } else {
                      trace(`[ai-listing] Hotels.com: no active refundable filter chip/checkbox was clickable before Stage B`);
                      if (filterClear.fallbackTargets.length > 0) {
                        trace(`[ai-listing] Hotels.com: filter fallback targets -> ${filterClear.fallbackTargets.map((t) => `${t.label}@(${t.x},${t.y})`).join(" || ")}`);
                      }
                      for (const fallbackTarget of filterClear.fallbackTargets.slice(0, 3)) {
                        await sh(raw).click(fallbackTarget.x, fallbackTarget.y);
                        trace(`[ai-listing] Hotels.com: CDP-clicked filter fallback "${fallbackTarget.label}" at (${fallbackTarget.x},${fallbackTarget.y})`);
                        await new Promise(r => setTimeout(r, 500));
                      }
                    }

                    trace(`[ai-listing] Hotels.com: pre-Stage-B filter clear attempted — waiting for results`);
                    await new Promise(r => setTimeout(r, 2500));

                    // Check if filter is still active after UI clear attempts
                    const remainingFilters = await raw.evaluate(() => {
                      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
                      const isV = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                      return Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], label, .uitk-pill'))
                        .filter(el => isV(el) && /fully refundable|free cancellation|refundable only/i.test(norm(el.textContent ?? "")))
                        .map(el => norm(el.textContent ?? "").slice(0, 60))
                        .slice(0, 5);
                    }).catch(() => [] as string[]);

                    if (remainingFilters.length > 0) {
                      trace(`[ai-listing] Hotels.com: refundable filter still visible after UI clear: ${remainingFilters.join(" | ")}`);

                      // ── Strategy 1: clear filter-related localStorage keys and reload ──────
                      // Hotels.com stores filter preferences in localStorage. If we can clear
                      // the relevant keys, the next page load will use URL params instead.
                      try {
                        const clearedKeys = await raw.evaluate(() => {
                          const filterKeywords = ['filter', 'refund', 'cancell', 'amenity', 'amenities', 'search', 'HCOM'];
                          const cleared: string[] = [];
                          for (let i = localStorage.length - 1; i >= 0; i--) {
                            const key = localStorage.key(i) ?? '';
                            if (filterKeywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()))) {
                              localStorage.removeItem(key);
                              cleared.push(key);
                            }
                          }
                          // Also try sessionStorage
                          for (let i = sessionStorage.length - 1; i >= 0; i--) {
                            const key = sessionStorage.key(i) ?? '';
                            if (filterKeywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()))) {
                              sessionStorage.removeItem(key);
                              cleared.push(`session:${key}`);
                            }
                          }
                          return cleared;
                        }).catch(() => [] as string[]);
                        if (clearedKeys.length > 0) {
                          trace(`[ai-listing] Hotels.com: cleared filter localStorage keys: ${clearedKeys.join(', ')}`);
                        } else {
                          trace(`[ai-listing] Hotels.com: no filter-related localStorage keys found`);
                        }
                      } catch (lsErr) {
                        trace(`[ai-listing] Hotels.com: localStorage clear error: ${(lsErr as Error).message?.slice(0, 60)}`);
                      }

                      // ── Strategy 2: reload current URL with refundableOnly=false ──────────
                      try {
                        const currentUrl = new URL(raw.url());
                        currentUrl.searchParams.set("refundableOnly", "false");
                        currentUrl.searchParams.delete("ro");
                        const cleanUrl = currentUrl.toString();
                        trace(`[ai-listing] Hotels.com: reloading with refundableOnly=false → ${cleanUrl.slice(0, 120)}`);
                        await raw.goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
                        await new Promise(r => setTimeout(r, 3000));
                        trace(`[ai-listing] Hotels.com: after refundableOnly reload — URL: ${raw.url().slice(0, 100)}`);
                        trace(`[ai-listing] Hotels.com snapshot after reload -> ${await getHotelsListingSnapshot()}`);
                      } catch (reloadErr) {
                        trace(`[ai-listing] Hotels.com: reload with refundableOnly=false failed: ${(reloadErr as Error).message?.slice(0, 80)}`);
                      }
                    }
                    trace(`[ai-listing] Hotels.com snapshot after filter clear -> ${await getHotelsListingSnapshot()}`);
                  }

                  // ── Stage B: "Search by property name" sidebar filter (fallback) ────────
                  if (!searchBarUsed) {
                    trace(`[ai-listing] Stage B fallback — typing in "Search by property name" filter`);
                    // Use evaluate() to find the input, scroll it into view, and click/focus it via DOM.
                    // We NEVER use coordinates for this click: y-coordinates like 2710 are off-screen,
                    // and CDP-coordinate clicks can land on survey overlays instead of the sidebar input.
                    // DOM el.scrollIntoView() + el.focus() + el.click() is reliable regardless of scroll pos.
                    const inputInfo = await raw.evaluate(({ hotelN }: { hotelN: string }) => {
                      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
                      const hotelWords = norm(hotelN).toLowerCase().split(/\s+/).filter((w) => w.length > 2 || /^\d+$/.test(w));
                      const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea'))
                        .map((el) => {
                          const r = el.getBoundingClientRect();
                          return `[${el.getAttribute('placeholder')?.slice(0,20) ?? ''} | ${el.getAttribute('aria-label')?.slice(0,20) ?? ''} | ${el.getAttribute('data-testid') ?? el.getAttribute('data-stid') ?? ''}] ` +
                            `${Math.round(r.width)}x${Math.round(r.height)}@(${Math.round(r.left)},${Math.round(r.top)}) val="${(el.value ?? '').slice(0,20)}"`;
                        })
                        .slice(0, 12);

                      const scoreInput = (el: HTMLInputElement | HTMLTextAreaElement, scopeText = "") => {
                        const r = el.getBoundingClientRect();
                        const value = norm((el as HTMLInputElement).value ?? "");
                        const meta = norm([
                          el.getAttribute("placeholder") ?? "",
                          el.getAttribute("aria-label") ?? "",
                          el.getAttribute("data-testid") ?? "",
                          el.getAttribute("data-stid") ?? "",
                          el.className ?? "",
                          scopeText,
                          el.closest("label, section, aside, div")?.textContent ?? "",
                        ].join(" "));
                        const visible = r.width > 0 && r.height > 0;
                        const isCurrency = /^\$\s*\d/.test(value) || /^\$\s*\d/.test(meta) || /\bnightly\b|\btotal\b|\bprice\b/.test(meta);
                        const propertyish = /search by property name|property name|marriott|hotel name|e\.g\./.test(meta);
                        const score =
                          (propertyish ? 160 : 0) +
                          (hotelWords.some((w) => value.toLowerCase().includes(w)) ? 45 : 0) +
                          (visible ? 30 : 0) +
                          (r.left <= 420 ? 20 : -30) +
                          (r.width >= 90 && r.width <= 360 ? 20 : 0) +
                          (r.height >= 24 && r.height <= 64 ? 15 : 0) -
                          (value.includes(",") ? 80 : 0) -
                          (/^\d+$/.test(value) ? 90 : 0) -
                          (isCurrency ? 220 : 0);
                        return { el, r, value, meta, visible, propertyish, isCurrency, score };
                      };

                      const activateCandidate = (
                        candidate: ReturnType<typeof scoreInput>,
                        label: string,
                        clickTarget?: HTMLElement | null
                      ): { sel: string; cx: number; cy: number; diag?: string } | null => {
                        if (!candidate || candidate.score <= 0 || candidate.isCurrency) return null;
                        const target = (() => {
                          if (clickTarget) return clickTarget;
                          const direct = candidate.el instanceof HTMLElement ? candidate.el : null;
                          if (direct && candidate.visible) return direct;
                          const nearby = candidate.el.closest<HTMLElement>(
                            '[role="combobox"], [data-stid*="typeahead"], [data-testid*="typeahead"], [class*="typeahead"], [class*="Typeahead"], label, section, aside, div'
                          );
                          return nearby ?? direct;
                        })();
                        if (!(target instanceof HTMLElement)) return null;
                        target.scrollIntoView({ behavior: 'instant', block: 'center' });
                        candidate.el.focus();
                        target.click();
                        const after = target.getBoundingClientRect();
                        if (after.width === 0 || after.height === 0) return null;
                        return {
                          sel: label,
                          cx: Math.round(after.left + after.width / 2),
                          cy: Math.round(after.top + after.height / 2),
                          diag: `${label} score=${candidate.score} visible=${candidate.visible} value="${candidate.value.slice(0, 20)}" meta="${candidate.meta.slice(0, 80)}"`,
                        };
                      };

                      const headingCandidates = Array.from(document.querySelectorAll<HTMLElement>(
                        'h1,h2,h3,h4,h5,h6,label,legend,[class*="title"],[class*="heading"],[class*="label"],[class*="Title"],[class*="Heading"]'
                      )).filter((title) => /search by property name|property name filter/i.test(norm(title.textContent ?? "")));

                      const rankedCandidates: Array<{
                        candidate: ReturnType<typeof scoreInput>;
                        label: string;
                        clickTarget?: HTMLElement | null;
                      }> = [];

                      for (const title of headingCandidates) {
                        let container: Element | null = title.parentElement;
                        let depth = 0;
                        while (container && container !== document.body && depth < 4) {
                          const scopeText = norm(container.textContent ?? "");
                          const inputs = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
                          for (const input of inputs) {
                            const candidate = scoreInput(input, scopeText);
                            rankedCandidates.push({
                              candidate: { ...candidate, score: candidate.score + 40 - depth * 8 },
                              label: `stratA:depth${depth}`,
                              clickTarget: container instanceof HTMLElement ? container : null,
                            });
                          }
                          const widgets = Array.from(container.querySelectorAll<HTMLElement>(
                            '[role="combobox"], [class*="typeahead"], [class*="Typeahead"], [data-stid*="typeahead"], [data-testid*="typeahead"]'
                          ));
                          for (const widget of widgets) {
                            const hiddenInput = widget.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
                            if (!hiddenInput) continue;
                            const candidate = scoreInput(hiddenInput, scopeText + " " + norm(widget.textContent ?? ""));
                            rankedCandidates.push({
                              candidate: { ...candidate, score: candidate.score + 55 - depth * 8 },
                              label: `stratA-widget:depth${depth}`,
                              clickTarget: widget,
                            });
                          }
                          container = container.parentElement;
                          depth++;
                        }
                      }

                      const selectors = [
                        'input[placeholder*="property name" i]',
                        'input[aria-label*="property name" i]',
                        'input[placeholder*="e.g. Marriott" i]',
                        'input[placeholder*="Marriott" i]',
                        'input[data-testid*="property"]',
                        '[data-stid*="property-name"] input',
                        '[data-stid*="hotel-name"] input',
                        '[data-stid*="filter-name"] input',
                        '[data-stid*="filterName"] input',
                        '[role="combobox"] input',
                      ];
                      for (const s of selectors) {
                        const found = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(s));
                        for (const el of found) {
                          rankedCandidates.push({ candidate: scoreInput(el), label: `stratB:${s}` });
                        }
                      }

                      const allTextInputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
                      for (const el of allTextInputs) {
                        const candidate = scoreInput(el);
                        if (candidate.r.left > 420) continue;
                        rankedCandidates.push({ candidate, label: 'stratC' });
                      }

                      const rankedSummary = rankedCandidates
                        .filter(({ candidate }) => candidate.score > -100)
                        .sort((a, b) => b.candidate.score - a.candidate.score)
                        .slice(0, 8)
                        .map(({ candidate, label }) =>
                          `${label} score=${candidate.score} ${Math.round(candidate.r.width)}x${Math.round(candidate.r.height)}@(${Math.round(candidate.r.left)},${Math.round(candidate.r.top)}) value="${candidate.value.slice(0, 16)}" meta="${candidate.meta.slice(0, 40)}"`
                        );

                      const best = rankedCandidates
                        .filter(({ candidate }) => candidate.score > 0 && !candidate.isCurrency)
                        .sort((a, b) => b.candidate.score - a.candidate.score)[0];

                      if (best) {
                        const activated = activateCandidate(best.candidate, best.label, best.clickTarget);
                        if (activated) {
                          return { ...activated, diag: `${activated.diag ?? ""} ranked=[${rankedSummary.join(" | ")}]` };
                        }
                      }

                      return {
                        sel: 'NOT_FOUND',
                        cx: -1,
                        cy: -1,
                        diag: `no-usable-property-widget ranked=[${rankedSummary.join(' | ')}] allInputs=[${allInputs.join(' | ')}]`,
                      };
                    }, { hotelN: targetHotelName ?? "" }).catch(() => null);

                    if (!inputInfo || inputInfo.cx === -1) {
                      trace(`[stageB-diag] input search failed: ${inputInfo?.diag ?? "evaluate-threw"}`);
                      trace(`[ai-listing] Stage B: property name input not found in DOM`);
                    } else {
                    const { sel, cx, cy, diag } = inputInfo;
                    if (diag) trace(`[stageB-diag] input found via ${diag.slice(0, 120)}`);
                    try {
                        // Brief pause for scroll/focus to settle after DOM el.focus() + el.click()
                        await new Promise(r => setTimeout(r, 400));
                        // CDP coordinate click to ensure the CORRECT element gets focus in the browser.
                        // DOM el.focus() inside evaluate() sets focus, but CDP type() uses whatever has
                        // browser-level focus. The coordinate click lands on the exact input element.
                        trace(`[ai-listing] CDP clicking property name input at (${cx},${cy}) sel="${sel}"`);
                        await sh(raw).click(cx, cy);
                        await new Promise(r => setTimeout(r, 300));
                        // Select-all + type via Stagehand CDP APIs (no .keyboard/.mouse controller).
                        await sh(raw).keyPress("Control+a");
                        await new Promise(r => setTimeout(r, 150));
                        // Type up to 25 chars (trimmed) to trigger the typeahead dropdown.
                        const typeaheadText = targetHotelName.slice(0, Math.min(25, targetHotelName.length)).trimEnd();
                        await sh(raw).type(typeaheadText, { delay: 80 });
                        trace(`[ai-listing] property name filter typed "${typeaheadText}" via "${sel}" (DOM focus/click)`);
                        trace(`[ai-listing] Hotels.com snapshot after property typing -> ${await getHotelsListingSnapshot()}`);

                        const verifyHotelsCurrentDetailMatchesTarget = async (): Promise<boolean> => {
                          if (!isHotelDetailUrl(raw.url())) return false;
                          return raw.evaluate(({ hotelN }: { hotelN: string }) => {
                            const normalize = (value: string) =>
                              value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                            const nameWords = normalize(hotelN)
                              .split(" ")
                              .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                            const stopWords = new Set([
                              "hotel", "hotels", "inn", "suite", "suites", "resort", "spa",
                              "the", "by", "and", "at", "of",
                              "new", "york", "times", "square", "manhattan", "midtown", "downtown",
                              "broadway", "city", "united", "states", "america",
                            ]);
                            const numericWords = nameWords.filter((w: string) => /^\d+$/.test(w));
                            const distinctiveWords = nameWords.filter((w: string) => !/^\d+$/.test(w) && !stopWords.has(w) && w.length >= 4);
                            const targetCoreWords = Array.from(new Set([
                              ...numericWords,
                              ...distinctiveWords,
                            ]));
                            const requiredWords = numericWords.length > 0
                              ? numericWords
                              : distinctiveWords.slice(0, Math.min(2, distinctiveWords.length));
                            const allowedUiWords = new Set([
                              "reserve", "reserved", "book", "booking", "room", "rooms", "select", "overview",
                              "accessibility", "policies", "about", "good", "great", "excellent", "review", "reviews",
                            ]);
                            const combined = normalize(`${document.title ?? ""} ${document.querySelector("h1")?.textContent ?? ""}`);
                            const combinedWords = combined.split(" ").filter((w: string) => w.length > 0);
                            const combinedCoreWords = combinedWords.filter((w: string) =>
                              /^\d+$/.test(w) || (!stopWords.has(w) && !allowedUiWords.has(w) && w.length >= 4)
                            );
                            const extraCoreWords = combinedCoreWords.filter((w: string) => !targetCoreWords.includes(w));
                            const requiredOk = requiredWords.every((w: string) => combined.includes(w));
                            const matchedDistinctive = distinctiveWords.filter((w: string) => combined.includes(w)).length;
                            const matchedAll = nameWords.filter((w: string) => combined.includes(w)).length;
                            if (numericWords.length > 0) {
                              return requiredOk && extraCoreWords.length === 0;
                            }
                            return requiredOk &&
                              extraCoreWords.length === 0 &&
                              matchedAll >= Math.max(1, Math.ceil(nameWords.length * 0.25)) &&
                              (distinctiveWords.length === 0 || matchedDistinctive >= 1);
                          }, { hotelN: targetHotelName ?? "" }).catch(() => false);
                        };

                        const verifyHotelsSidebarResult = async (): Promise<{
                          status: "detail" | "listing" | "no_exact" | "unknown";
                          text?: string;
                          href?: string;
                          x?: number;
                          y?: number;
                        }> => {
                          if (isHotelDetailUrl(raw.url())) {
                            return { status: "detail", href: raw.url() };
                          }

                          return raw.evaluate(({ hotelN }: { hotelN: string }) => {
                            const normalize = (value: string) =>
                              value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                            const isVisible = (el: Element | null): el is HTMLElement => {
                              if (!(el instanceof HTMLElement)) return false;
                              const r = el.getBoundingClientRect();
                              return r.width > 0 && r.height > 0;
                            };
                            const nameWords = normalize(hotelN)
                              .split(" ")
                              .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                            const stopWords = new Set([
                              "hotel", "hotels", "inn", "suite", "suites", "resort", "spa",
                              "the", "by", "and", "at", "of",
                              "new", "york", "times", "square", "manhattan", "midtown", "downtown",
                              "broadway", "city", "united", "states", "america",
                            ]);
                            const targetCoreWords = Array.from(new Set(
                              nameWords.filter((w: string) => /^\d+$/.test(w) || (!stopWords.has(w) && w.length >= 4))
                            ));
                            const requiredWords = targetCoreWords.length > 0
                              ? targetCoreWords.slice(0, Math.min(2, targetCoreWords.length))
                              : nameWords.slice(0, Math.min(2, nameWords.length));
                            const getCardTitle = (container: HTMLElement, anchor?: HTMLAnchorElement | null) => {
                              const titleCandidate = container.querySelector<HTMLElement>(
                                'h1,h2,h3,h4,[role="heading"], [data-stid*="title"], [class*="title"], [class*="Title"], a[aria-label^="Opens "]'
                              );
                              const fromAria = normalize(titleCandidate?.getAttribute("aria-label") ?? anchor?.getAttribute("aria-label") ?? "")
                                .replace(/^opens\s+/, "")
                                .replace(/\s+in new tab$/, "");
                              const fromHeading = normalize(titleCandidate?.textContent ?? "");
                              const fromAnchorText = normalize(anchor?.textContent ?? "").split(" reserve now")[0]?.trim() ?? "";
                              const fromContainerText = normalize(container.textContent ?? "").split(" reserve now")[0]?.trim() ?? "";
                              return fromAria || fromHeading || fromAnchorText || fromContainerText;
                            };
                            const getClickableTarget = (container: HTMLElement) => {
                              const clickTarget =
                                container.querySelector<HTMLElement>(
                                  'a[href*="/ho"], a[href*="/h"], button, [role="button"], [data-stid*="open-hotel-information"], [data-stid*="select-room"]'
                                ) ?? container;
                              const rect = clickTarget.getBoundingClientRect();
                              if (rect.width <= 0 || rect.height <= 0) return null;
                              return {
                                x: Math.round(rect.left + Math.min(rect.width * 0.45, Math.max(80, rect.width / 2))),
                                y: Math.round(rect.top + Math.min(rect.height * 0.5, Math.max(20, rect.height / 2))),
                              };
                            };
                            const scoreCard = (title: string, top: number, href: string, clickPos: { x: number; y: number } | null) => {
                              const titleWords = title.split(" ").filter((w: string) => w.length > 0);
                              const titleCoreWords = titleWords.filter((w: string) => /^\d+$/.test(w) || (!stopWords.has(w) && w.length >= 4));
                              const extraCoreWords = titleCoreWords.filter((w: string) => !targetCoreWords.includes(w));
                              const matchedRequired = requiredWords.every((w: string) => titleCoreWords.includes(w) || titleWords.includes(w));
                              const matchedCore = targetCoreWords.filter((w: string) => titleCoreWords.includes(w)).length;
                              const matchedAll = nameWords.filter((w: string) => titleWords.includes(w)).length;
                              const score =
                                matchedAll * 12 +
                                matchedCore * 35 +
                                (matchedRequired ? 80 : 0) -
                                extraCoreWords.length * 90 +
                                (href ? 12 : 0) +
                                (clickPos ? 8 : 0);
                              return { score, matchedRequired, matchedCore, matchedAll, extraCoreWords };
                            };

                            const seen = new Map<string, {
                              text: string;
                              href: string;
                              score: number;
                              matchedRequired: boolean;
                              matchedCore: number;
                              matchedAll: number;
                              extraCoreWords: string[];
                              top: number;
                              x?: number;
                              y?: number;
                            }>();
                            const cardSelectors = [
                              'article',
                              '[data-stid*="property"]',
                              '[data-stid*="listing"]',
                              '[class*="card"]',
                              '[class*="Card"]',
                              'section',
                              'li',
                            ].join(",");
                            Array.from(document.querySelectorAll<HTMLElement>(cardSelectors))
                              .filter((container) => isVisible(container))
                              .forEach((container) => {
                                const rect = container.getBoundingClientRect();
                                if (rect.width < 260 || rect.height < 60) return;
                                if (rect.right < 260 || rect.top > window.innerHeight + 120 || rect.bottom < -20) return;
                                const hrefAnchor =
                                  container.querySelector<HTMLAnchorElement>('a[href*="/ho"], a[href*="/h"]') ??
                                  (container.tagName === "A" ? container as HTMLAnchorElement : null);
                                const href = hrefAnchor?.href ?? "";
                                const title = getCardTitle(container, hrefAnchor);
                                if (!title) return;
                                const top = rect.top + window.scrollY;
                                const clickPos = getClickableTarget(container);
                                const { score, matchedRequired, matchedCore, matchedAll, extraCoreWords } =
                                  scoreCard(title, top, href, clickPos);
                                const candidate = {
                                  text: title,
                                  href,
                                  score,
                                  matchedRequired,
                                  matchedCore,
                                  matchedAll,
                                  extraCoreWords,
                                  top,
                                  x: clickPos?.x,
                                  y: clickPos?.y,
                                };
                                const key = href || `${title}:${Math.round(top)}`;
                                const prev = seen.get(key);
                                if (!prev || candidate.score > prev.score || (candidate.score === prev.score && candidate.top < prev.top)) {
                                  seen.set(key, candidate);
                                }
                              });
                            const anchors = Array.from(seen.values())
                              .sort((a, b) => {
                                if (b.score !== a.score) return b.score - a.score;
                                return a.top - b.top;
                              });

                            const best = anchors[0];
                            if (
                              best &&
                              best.matchedRequired &&
                              best.extraCoreWords.length === 0 &&
                              (
                                best.matchedCore >= Math.max(1, Math.min(2, targetCoreWords.length || 1)) ||
                                best.matchedAll >= Math.max(1, Math.min(2, nameWords.length))
                              )
                            ) {
                              return {
                                status: "listing" as const,
                                text: best.text.slice(0, 120),
                                href: best.href || undefined,
                                x: best.x,
                                y: best.y,
                              };
                            }

                            const textContent = normalize(document.body.textContent ?? "");
                            if (textContent.includes("no exact matches")) {
                              return { status: "no_exact" as const };
                            }

                            return { status: "unknown" as const };
                          }, { hotelN: targetHotelName ?? "" }).catch(() => ({ status: "unknown" as const }));
                        };

                        const waitForHotelsSidebarResultSettlement = async (): Promise<{
                          status: "detail" | "listing" | "no_exact" | "unknown";
                          text?: string;
                          href?: string;
                        }> => {
                          let sawNoExact = false;
                          let last: { status: "detail" | "listing" | "no_exact" | "unknown"; text?: string; href?: string } = { status: "unknown" };
                          for (let attempt = 0; attempt < 9; attempt++) {
                            const current = await verifyHotelsSidebarResult();
                            last = current;
                            if (current.status === "detail" || current.status === "listing") {
                              return current;
                            }
                            if (current.status === "no_exact") {
                              sawNoExact = true;
                            }
                            await new Promise(r => setTimeout(r, sawNoExact ? 700 : 450));
                          }
                          return last;
                        };

                        const adoptHotelsDetailTabIfOpened = async (strategyLabel: string): Promise<boolean> => {
                          try {
                            const allPages = stagehand.context.pages();
                            const hotelPageEntry = allPages
                              .map((candidatePage) => {
                                const pr = getRawPage(candidatePage);
                                return { pr, url: pr.url() };
                              })
                              .find(({ pr, url }) => pr !== raw && isHotelDetailUrl(url));
                            if (!hotelPageEntry) return false;
                            trace(`[ai-listing] ${strategyLabel}: detected hotel detail tab -> ${hotelPageEntry.url.slice(0, 80)}`);
                            const matches = await hotelPageEntry.pr.evaluate(({ hotelN }: { hotelN: string }) => {
                              const normalize = (value: string) =>
                                value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                              const nameWords = normalize(hotelN)
                                .split(" ")
                                .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                              const stopWords = new Set([
                                "hotel", "hotels", "inn", "suite", "suites", "resort", "spa",
                                "the", "by", "and", "at", "of",
                                "new", "york", "times", "square", "manhattan", "midtown", "downtown",
                                "broadway", "city", "united", "states", "america",
                              ]);
                              const numericWords = nameWords.filter((w: string) => /^\d+$/.test(w));
                              const distinctiveWords = nameWords.filter((w: string) => !/^\d+$/.test(w) && !stopWords.has(w) && w.length >= 4);
                              const targetCoreWords = Array.from(new Set([
                                ...numericWords,
                                ...distinctiveWords,
                              ]));
                              const requiredWords = numericWords.length > 0
                                ? numericWords
                                : distinctiveWords.slice(0, Math.min(2, distinctiveWords.length));
                              const allowedUiWords = new Set([
                                "reserve", "reserved", "book", "booking", "room", "rooms", "select", "overview",
                                "accessibility", "policies", "about", "good", "great", "excellent", "review", "reviews",
                              ]);
                              const combined = normalize(`${document.title ?? ""} ${document.querySelector("h1")?.textContent ?? ""}`);
                              const combinedWords = combined.split(" ").filter((w: string) => w.length > 0);
                              const combinedCoreWords = combinedWords.filter((w: string) =>
                                /^\d+$/.test(w) || (!stopWords.has(w) && !allowedUiWords.has(w) && w.length >= 4)
                              );
                              const extraCoreWords = combinedCoreWords.filter((w: string) => !targetCoreWords.includes(w));
                              const requiredOk = requiredWords.every((w: string) => combined.includes(w));
                              const matchedDistinctive = distinctiveWords.filter((w: string) => combined.includes(w)).length;
                              const matchedAll = nameWords.filter((w: string) => combined.includes(w)).length;
                              if (numericWords.length > 0) {
                                return requiredOk && extraCoreWords.length === 0;
                              }
                              return requiredOk &&
                                extraCoreWords.length === 0 &&
                                matchedAll >= Math.max(1, Math.ceil(nameWords.length * 0.25)) &&
                                (distinctiveWords.length === 0 || matchedDistinctive >= 1);
                            }, { hotelN: targetHotelName ?? "" }).catch(() => false);
                            if (!matches) {
                              trace(`[ai-listing] ${strategyLabel}: detected hotel detail tab did not match target (${hotelPageEntry.url.slice(0, 80)})`);
                              await hotelPageEntry.pr.close().catch(() => {});
                              return false;
                            }
                            try {
                              await raw.goto(hotelPageEntry.url, { waitUntil: "domcontentloaded", timeout: 25000 });
                              await raw.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
                            } catch (navErr) {
                              trace(`[ai-listing] ${strategyLabel}: failed to adopt hotel detail tab via goto: ${(navErr as Error).message?.slice(0, 70)}`);
                              return false;
                            }
                            await hotelPageEntry.pr.close().catch(() => {});
                            trace(`[ai-listing] ${strategyLabel}: adopted hotel detail tab into main page -> ${raw.url().slice(0, 80)}`);
                            return true;
                          } catch (adoptErr) {
                            trace(`[ai-listing] ${strategyLabel}: hotel detail tab adoption failed: ${(adoptErr as Error).message?.slice(0, 70)}`);
                            return false;
                          }
                        };

                        const advanceHotelsSidebarListingResult = async (
                          stageBResult: { status: "detail" | "listing" | "no_exact" | "unknown"; text?: string; href?: string; x?: number; y?: number },
                          strategyLabel: string
                        ): Promise<"detail" | "listing" | "failed"> => {
                          if (stageBResult.status === "detail") {
                            const matches = await verifyHotelsCurrentDetailMatchesTarget();
                            if (matches) {
                              trace(`[ai-listing] ${strategyLabel}: hotel card → verified target hotel detail: ${raw.url().slice(0, 80)}`);
                              return "detail";
                            }
                            trace(`[ai-listing] ${strategyLabel}: reached hotel detail but title does not match target — rejecting ${raw.url().slice(0, 80)}`);
                            await raw.evaluate(() => window.history.back()).catch(() => {});
                            await new Promise(r => setTimeout(r, 1200));
                            return "failed";
                          }
                          if (stageBResult.status !== "listing") {
                            return "failed";
                          }

                          trace(`[ai-listing] ${strategyLabel}: sidebar filter applied — target result visible (${(stageBResult.text ?? "").slice(0, 70)})`);
                          if (stageBResult.href && /hotels\.com\/(ho|h)\d+/i.test(stageBResult.href)) {
                            try {
                              trace(`[ai-listing] ${strategyLabel}: opening visible target result href → ${stageBResult.href.slice(0, 100)}`);
                              await raw.goto(stageBResult.href, { waitUntil: "domcontentloaded", timeout: 20000 });
                              await new Promise(r => setTimeout(r, 2200));
                              if (isHotelDetailUrl(raw.url())) {
                                const matches = await verifyHotelsCurrentDetailMatchesTarget();
                                if (matches) {
                                  trace(`[ai-listing] ${strategyLabel}: target result href reached verified hotel detail: ${raw.url().slice(0, 80)}`);
                                  return "detail";
                                }
                                trace(`[ai-listing] ${strategyLabel}: target result href opened wrong hotel detail — going back (${raw.url().slice(0, 80)})`);
                                await raw.evaluate(() => window.history.back()).catch(() => {});
                                await new Promise(r => setTimeout(r, 1200));
                                return "failed";
                              }
                              trace(`[ai-listing] ${strategyLabel}: target result href did not reach hotel detail (${raw.url().slice(0, 80)})`);
                            } catch (hrefErr) {
                              trace(`[ai-listing] ${strategyLabel}: opening target result href failed: ${(hrefErr as Error).message?.slice(0, 70)}`);
                            }
                          }

                          if (typeof stageBResult.x === "number" && typeof stageBResult.y === "number") {
                            try {
                              trace(`[ai-listing] ${strategyLabel}: clicking visible target result card at (${stageBResult.x},${stageBResult.y})`);
                              await sh(raw).click(stageBResult.x, stageBResult.y);
                              await new Promise(r => setTimeout(r, 2200));
                              if (await adoptHotelsDetailTabIfOpened(strategyLabel)) {
                                return "detail";
                              }
                              if (isHotelDetailUrl(raw.url())) {
                                const matches = await verifyHotelsCurrentDetailMatchesTarget();
                                if (matches) {
                                  trace(`[ai-listing] ${strategyLabel}: visible target card click reached verified hotel detail: ${raw.url().slice(0, 80)}`);
                                  return "detail";
                                }
                                trace(`[ai-listing] ${strategyLabel}: visible target card click opened wrong hotel detail — going back (${raw.url().slice(0, 80)})`);
                                await raw.evaluate(() => window.history.back()).catch(() => {});
                                await new Promise(r => setTimeout(r, 1200));
                                return "failed";
                              }
                            } catch (clickErr) {
                              trace(`[ai-listing] ${strategyLabel}: clicking visible target result card failed: ${(clickErr as Error).message?.slice(0, 70)}`);
                            }
                          }

                          return "listing";
                        };

                        const getHotelsDropdownDiagnostics = async (): Promise<string[]> => {
                          return raw.evaluate(({ hotelN }: { hotelN: string }) => {
                            const findPropertyNameInput = (): HTMLInputElement | null => {
                              const score = (el: HTMLInputElement) => {
                                const r = el.getBoundingClientRect();
                                const value = (el.value ?? "").trim();
                                const meta = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('data-testid') ?? ''} ${el.getAttribute('data-stid') ?? ''} ${el.closest('label, section, aside, div')?.textContent ?? ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
                                const isCurrency = /^\$\s*\d/.test(value) || /\bnightly\b|\btotal\b|\bprice\b/.test(meta);
                                return (meta.match(/property name|marriott|search by property name|hotel name|e\.g\./) ? 120 : 0)
                                  + (r.width >= 90 && r.width <= 360 ? 20 : 0)
                                  + (r.left <= 420 ? 20 : -40)
                                  + (r.height >= 24 && r.height <= 64 ? 10 : 0)
                                  - (value.includes(',') ? 50 : 0)
                                  - (/^\d+$/.test(value) ? 80 : 0)
                                  - (isCurrency ? 200 : 0);
                              };
                              return Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea'))
                                .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
                                .map((el) => ({ el, score: score(el) }))
                                .filter(({ score }) => score > 0)
                                .sort((a, b) => b.score - a.score)[0]?.el ?? null;
                            };
                            const input = findPropertyNameInput();
                            if (!input) return [];

                            const normalize = (value: string) =>
                              value.replace(/\s+/g, " ").trim().slice(0, 80);
                            const hotelWords = hotelN.toLowerCase().split(/\s+/)
                              .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                            const inputRect = input.getBoundingClientRect();
                            const selectorCandidates = Array.from(document.querySelectorAll<HTMLElement>(
                              '[role="option"], [role="listbox"] li, [data-stid*="typeahead-item"], ' +
                              '[data-stid*="typeahead"] li, [data-stid*="typeahead"] a, ' +
                              'ul[role="listbox"] > li, ul[role="listbox"] > *, [role="listbox"] > *'
                            )).filter((el) => {
                              const r = el.getBoundingClientRect();
                              if (r.width === 0 || r.height === 0) return false;
                              if (r.bottom < 0 || r.top > window.innerHeight) return false;
                              const verticallyNear =
                                (r.top >= inputRect.top - 260 && r.top <= inputRect.bottom + 360) ||
                                (r.bottom >= inputRect.top - 260 && r.bottom <= inputRect.bottom + 360);
                              const horizontallyNear = r.right >= inputRect.left - 40 && r.left <= inputRect.right + 520;
                              return verticallyNear && horizontallyNear;
                            });
                            if (selectorCandidates.length > 0) {
                              return selectorCandidates.slice(0, 5).map((el) => {
                                const r = el.getBoundingClientRect();
                                return `${normalize(el.textContent ?? "")} @ (${Math.round(r.left)},${Math.round(r.top)}) ${Math.round(r.width)}x${Math.round(r.height)}`;
                              });
                            }

                            const sampled = new Map<HTMLElement, true>();
                            const pointStacks: string[] = [];
                            const sampleXs = [
                              inputRect.left + Math.min(32, inputRect.width / 4),
                              inputRect.left + Math.min(96, Math.max(48, inputRect.width / 2)),
                            ];
                            const sampleYs = [32, 64, 96, 128, 160].map((offset) => inputRect.bottom + offset);
                            for (const x of sampleXs) {
                              for (const y of sampleYs) {
                                const stackTexts: string[] = [];
                                for (const el of document.elementsFromPoint(x, y)) {
                                  if (!(el instanceof HTMLElement)) continue;
                                  if (el === input || el.contains(input) || input.contains(el)) continue;
                                  const text = normalize(el.textContent ?? "");
                                  if (!text) continue;
                                  if (stackTexts.length < 3) stackTexts.push(text.slice(0, 50));
                                  if (/^search\s+for\b/i.test(text)) continue;
                                  const matches = hotelWords.filter((w: string) => text.toLowerCase().includes(w)).length;
                                  if (matches < Math.ceil(hotelWords.length * 0.4)) continue;
                                  sampled.set(el, true);
                                }
                                if (stackTexts.length > 0 && pointStacks.length < 6) {
                                  pointStacks.push(`point(${Math.round(x)},${Math.round(y)}): ${stackTexts.join(" > ")}`);
                                }
                              }
                            }

                            const sampledEntries = Array.from(sampled.keys()).slice(0, 5).map((el) => {
                              const r = el.getBoundingClientRect();
                              return `${normalize(el.textContent ?? "")} @ (${Math.round(r.left)},${Math.round(r.top)}) ${Math.round(r.width)}x${Math.round(r.height)}`;
                            });
                            if (sampledEntries.length > 0) return sampledEntries;
                            if (pointStacks.length > 0) return pointStacks;
                            return [
                              `inputRect=(${Math.round(inputRect.left)},${Math.round(inputRect.top)}) ${Math.round(inputRect.width)}x${Math.round(inputRect.height)}`,
                              `inputValue=${normalize(input.value ?? "").slice(0, 50)}`,
                            ];
                          }, { hotelN: targetHotelName ?? "" }).catch(() => [] as string[]);
                        };

                        const waitForHotelsDropdownCandidates = async (): Promise<boolean> => {
                          const startedAt = Date.now();
                          while (Date.now() - startedAt < 4000) {
                            const found = await raw.evaluate(({ hotelN, selArg }: { hotelN: string; selArg: string }) => {
                              const findPropertyNameInput = (): HTMLInputElement | null => {
                                if (selArg && selArg !== 'sidebar-text-input-fallback') { const el=document.querySelector<HTMLInputElement>(selArg); if(el){const r=el.getBoundingClientRect();if(r.width>=60)return el;} }
                                const sels=['input[placeholder*="property name" i]','input[placeholder*="Marriott" i]','input[aria-label*="property name" i]','input[data-testid*="property"]','[data-stid*="property-name"] input[type="text"]','aside input[type="text"]','section input[type="text"]'];
                                for(const s of sels){const el=document.querySelector<HTMLInputElement>(s);if(el){const r=el.getBoundingClientRect();if(r.width>=60)return el;}}
                                return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]')).find(el=>{const r=el.getBoundingClientRect();return r.width>=60&&r.width<=400&&r.left<=420&&!(el.value??'').includes(',');})??null;
                              };
                              const input = findPropertyNameInput();
                              if (!input) return false;

                              const normalize = (value: string) =>
                                value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                              const hotelWords = normalize(hotelN)
                                .split(" ")
                                .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                              const inputRect = input.getBoundingClientRect();

                              const nearby = Array.from(document.querySelectorAll<HTMLElement>("body *")).some((el) => {
                                const r = el.getBoundingClientRect();
                                if (r.width === 0 || r.height === 0) return false;
                                if (r.bottom < inputRect.top - 260 || r.top > inputRect.bottom + 360) return false;
                                if (r.right < inputRect.left - 40 || r.left > inputRect.right + 520) return false;
                                const text = normalize(el.textContent ?? "");
                                if (!text || /^search\s+for\b/.test(text) || /^clear$/.test(text)) return false;
                                const matches = hotelWords.filter((w: string) => text.includes(w)).length;
                                return matches >= Math.ceil(hotelWords.length * 0.4);
                              });

                              input.focus();
                              const end = input.value.length;
                              input.setSelectionRange?.(end, end);
                              return nearby;
                            }, { hotelN: targetHotelName ?? "", selArg: sel }).catch(() => false);

                            if (found) return true;
                            await new Promise((r) => setTimeout(r, 250));
                          }
                          return false;
                        };

                        // ── Strategy 1: click hotel property CARD in dropdown ────────────────
                        // Hotels.com "Search by property name" typeahead shows:
                        //   Item 0: hotel property card (li/a/div) → navigate to hotel detail page
                        //   Item 1: "Search for '...'" button       → text filter only
                        // The hotel card is NOT always a <button> — Hotels.com UITK uses <li> or <a>.
                        // We exclude elements that contain an <input> child (the input wrapper).
                        const dropdownReady = await waitForHotelsDropdownCandidates();
                        if (!dropdownReady) {
                          const preDiag = await getHotelsDropdownDiagnostics();
                          if (preDiag.length > 0) {
                            trace(`[ai-listing] pre-Strategy diagnostics: nearby dropdown candidates -> ${preDiag.join(" || ")}`);
                          } else {
                            trace(`[ai-listing] pre-Strategy diagnostics: no nearby dropdown candidates detected after wait`);
                          }
                        }

                        let suggClicked = false;
                        await new Promise(r => setTimeout(r, 600)); // allow last layout/animation tick to settle
                        try {
                          // Strategy 1: find the hotel card in the dropdown via DOM, return its
                          // coordinates or href — do NOT use evaluate().click() (synthetic DOM click
                          // doesn't trigger Hotels.com UITK React navigation handlers).
                          const s1Result = await raw.evaluate(({ hotelN }: { hotelN: string }) => {
                            const normalize = (value: string) =>
                              value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                            const isInputWrapper = (el: HTMLElement) => {
                              if (el.tagName === "INPUT") return true;
                              if (el.querySelector("input")) return true;
                              const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
                              if (label === "clear" || label === "clear search") return true;
                              if (/^clear$/i.test((el.textContent ?? "").trim())) return true;
                              return false;
                            };
                            const isSearchForRow = (el: HTMLElement) =>
                              /^search\s+for\b/i.test((el.textContent ?? "").trim());
                            const findPropertyNameInput2 = (): HTMLInputElement | null => {
                              const score = (el: HTMLInputElement) => {
                                const r = el.getBoundingClientRect();
                                const value = (el.value ?? "").trim();
                                const meta = normalize([
                                  el.getAttribute("placeholder") ?? "",
                                  el.getAttribute("aria-label") ?? "",
                                  el.getAttribute("data-testid") ?? "",
                                  el.getAttribute("data-stid") ?? "",
                                  el.className ?? "",
                                  el.closest("label, section, aside, div")?.textContent ?? "",
                                ].join(" "));
                                const isCurrency = /^\$\s*\d/.test(value) || /\bnightly\b|\btotal\b|\bprice\b/.test(meta);
                                return (/(search by property name|property name|marriott|hotel name|e\.g\.)/.test(meta) ? 120 : 0)
                                  + (r.left <= 420 ? 20 : -40)
                                  + (r.width >= 90 && r.width <= 380 ? 20 : 0)
                                  + (r.height >= 24 && r.height <= 76 ? 10 : 0)
                                  - (value.includes(",") ? 50 : 0)
                                  - (/^\d+$/.test(value) ? 80 : 0)
                                  - (isCurrency ? 220 : 0);
                              };
                              return Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea'))
                                .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
                                .map((el) => ({ el, score: score(el) }))
                                .filter(({ score }) => score > 0)
                                .sort((a, b) => b.score - a.score)[0]?.el ?? null;
                            };
                            const input = findPropertyNameInput2();
                            const inputRect = input?.getBoundingClientRect();
                            const visibleOpts = Array.from(document.querySelectorAll<HTMLElement>(
                              '[role="option"], [role="listbox"] li, [data-stid*="typeahead-item"], ' +
                              '[data-stid*="typeahead"] li, [data-stid*="typeahead"] a, ' +
                              'ul[role="listbox"] > li, [data-stid*="typeahead"] button'
                            )).filter(el => {
                              const r = el.getBoundingClientRect();
                              if (r.width === 0 || r.height === 0) return false;
                              if (r.bottom < 0 || r.top > window.innerHeight) return false;
                              if (isInputWrapper(el) || isSearchForRow(el)) return false;
                              if (!inputRect) return true;
                              if (r.top <= inputRect.bottom + 6) return false;
                              const verticallyNear =
                                (r.top >= inputRect.top - 260 && r.top <= inputRect.bottom + 360) ||
                                (r.bottom >= inputRect.top - 260 && r.bottom <= inputRect.bottom + 360);
                              const horizontallyNear = r.right >= inputRect.left - 40 && r.left <= inputRect.right + 520;
                              return verticallyNear && horizontallyNear;
                            });

                            const nameWords = hotelN.toLowerCase().split(/\s+/)
                              .filter((w: string) => w.length > 2 || /^\d+$/.test(w));

                            const sampleElementsFromPoint = () => {
                              if (!inputRect) return [] as HTMLElement[];
                              const picked = new Map<HTMLElement, true>();
                              const sampleXs = [
                                inputRect.left + Math.min(32, inputRect.width / 4),
                                inputRect.left + Math.min(96, Math.max(48, inputRect.width / 2)),
                              ];
                              const sampleYs = [32, 64, 96, 128, 160].map((offset) => inputRect.bottom + offset);
                              for (const x of sampleXs) {
                                for (const y of sampleYs) {
                                  for (const el of document.elementsFromPoint(x, y)) {
                                    if (!(el instanceof HTMLElement)) continue;
                                    if (isInputWrapper(el) || isSearchForRow(el)) continue;
                                    if (el === input || el.contains(input as Node) || (input && input.contains(el))) continue;
                                    const r = el.getBoundingClientRect();
                                    if (inputRect && r.top <= inputRect.bottom + 6) continue;
                                    const text = (el.textContent ?? "").toLowerCase();
                                    const matches = nameWords.filter((w: string) => text.includes(w)).length;
                                    if (matches < Math.ceil(nameWords.length * 0.4)) continue;
                                    picked.set(el, true);
                                  }
                                }
                              }
                              return Array.from(picked.keys());
                            };

                            const candidatePool = visibleOpts.length > 0 ? visibleOpts : sampleElementsFromPoint();
                            if (candidatePool.length === 0) return { action: "none" as const };

                            // Priority 1: find the hotel card element by name match,
                            // then look for an <a href> to a hotel page (use goto instead of click).
                            const hotelCard = candidatePool
                              .map((el) => {
                                const text = normalize(el.textContent ?? "");
                                const r = el.getBoundingClientRect();
                                const matches = nameWords.filter((w: string) => text.includes(w)).length;
                                const searchPenalty = /search\s+for\b/.test(text) ? 100 : 0;
                                const score =
                                  matches * 20 +
                                  (inputRect && r.top > inputRect.bottom + 6 ? 20 : 0) +
                                  (r.width >= 220 ? 10 : 0) +
                                  (text.includes("united states") ? 6 : 0) -
                                  searchPenalty;
                                return { el, score };
                              })
                              .filter(({ score }) => score >= Math.ceil(nameWords.length * 0.5) * 20)
                              .sort((a, b) => b.score - a.score)[0]?.el;
                            if (hotelCard) {
                              const promotedCard = (() => {
                                let node: HTMLElement | null = hotelCard;
                                while (node && node !== document.body) {
                                  const r = node.getBoundingClientRect();
                                  if (
                                    r.width >= 240 &&
                                    r.height >= 40 &&
                                    (!inputRect || r.top > inputRect.bottom + 6) &&
                                    !isInputWrapper(node) &&
                                    !isSearchForRow(node)
                                  ) {
                                    return node;
                                  }
                                  node = node.parentElement;
                                }
                                return hotelCard;
                              })();
                              // Check if the card itself or any child/ancestor is an <a> with hotel URL
                              const selfA = promotedCard.tagName === "A" ? promotedCard as HTMLAnchorElement : null;
                              const childA = promotedCard.querySelector<HTMLAnchorElement>("a[href]");
                              let parentA: HTMLAnchorElement | null = null;
                              let p = promotedCard.parentElement;
                              while (p && p !== document.body) {
                                if (p.tagName === "A" && (p as HTMLAnchorElement).href) {
                                  parentA = p as HTMLAnchorElement; break;
                                }
                                p = p.parentElement;
                              }
                              const hrefEl = selfA ?? childA ?? parentA;
                              if (hrefEl?.href && /hotels\.com\/(ho|h)\d+/i.test(hrefEl.href)) {
                                return { action: "href" as const, href: hrefEl.href };
                              }
                              // No href — scroll into view (instant) then return viewport coordinates.
                              // The dropdown may render above the sidebar input, giving y < 0.
                              // scrollIntoView({block:'nearest'}) fixes that without closing the dropdown.
                              (promotedCard as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'nearest' });
                              const r = promotedCard.getBoundingClientRect();
                              return {
                                action: "coords" as const,
                                x: Math.round(r.left + r.width / 2),
                                y: Math.round(r.top + r.height / 2),
                                text: (promotedCard.textContent ?? "").trim().slice(0, 60),
                              };
                            }

                            // Priority 2: any anchor with direct hotel-page href
                            const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(
                              '[role="listbox"] a[href], [role="option"] a[href], [data-stid*="typeahead"] a[href]'
                            ));
                            for (const a of anchors) {
                              if (/hotels\.com\/(ho|h)\d+/i.test(a.href)) {
                                return { action: "href" as const, href: a.href };
                              }
                            }

                            // Priority 3: return coordinates of first option (real mouse click)
                            const first = candidatePool[0];
                            (first as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'nearest' });
                            const r = first.getBoundingClientRect();
                            return {
                              action: "coords" as const,
                              x: Math.round(r.left + r.width / 2),
                              y: Math.round(r.top + r.height / 2),
                              text: (first.textContent ?? "").trim().slice(0, 60),
                            };
                          }, { hotelN: targetHotelName ?? "" }).catch(() => ({ action: "none" as const }));

                          type S1Result =
                            | { action: "none" }
                            | { action: "href"; href: string }
                            | { action: "coords"; x: number; y: number; text: string };
                          const res = s1Result as S1Result;

                          if (res.action === "href") {
                            trace(`[ai-listing] Strategy 1: found hotel href in dropdown → goto()`);
                            await raw.goto(res.href, { waitUntil: "domcontentloaded", timeout: 20000 });
                            await new Promise(r => setTimeout(r, 2000));
                            if (isHotelDetailUrl(raw.url())) {
                              suggClicked = true;
                              trace(`[ai-listing] Strategy 1: goto() hotel detail: ${raw.url().slice(0, 80)}`);
                            }
                          } else if (res.action === "coords") {
                            trace(`[ai-listing] Strategy 1: coordinate-clicking dropdown item "${res.text}" at (${res.x},${res.y})`);
                            // sh(raw).click(x, y) uses Stagehand's CDP coordinate click
                            // (triggers real browser mouse events, unlike DOM .click())
                            await sh(raw).click(res.x, res.y);
                            await new Promise(r => setTimeout(r, 1200));
                            const stageBResult = await waitForHotelsSidebarResultSettlement();
                            const advanced = await advanceHotelsSidebarListingResult(stageBResult, "Strategy 1");
                            if (advanced === "detail" || advanced === "listing") {
                              suggClicked = true;
                            } else {
                              if (stageBResult.status === "no_exact") {
                                trace(`[ai-listing] Strategy 1: "no exact match" after coordinate click — retrying dropdown`);
                              } else {
                                trace(`[ai-listing] Strategy 1: click did not expose target result — retrying dropdown`);
                              }
                              // Re-focus input and retype so Strategy 2 can try
                              await raw.evaluate((selArg: string) => {
                                const el = document.querySelector<HTMLInputElement>(selArg);
                                if (el) { el.scrollIntoView({ behavior: 'instant', block: 'center' }); el.focus(); el.click(); }
                              }, sel).catch(() => {});
                              await new Promise(r => setTimeout(r, 300));
                              await sh(raw).keyPress("Control+a");
                              await sh(raw).type(typeaheadText, { delay: 80 });
                              await new Promise(r => setTimeout(r, 1800));
                            }
                          } else {
                            trace(`[ai-listing] Strategy 1: no dropdown suggestions found`);
                            const diag = await getHotelsDropdownDiagnostics();
                            if (diag.length > 0) {
                              trace(`[ai-listing] Strategy 1 diagnostics: nearby dropdown candidates -> ${diag.join(" || ")}`);
                            }
                          }
                        } catch (kbErr) {
                          trace(`[ai-listing] Strategy 1 failed: ${(kbErr as Error).message?.slice(0, 60)}`);
                        }

                        // ── Strategy 2: Playwright locator with coordinate click ──────────────
                        // Hotels.com UITK hotel property card may be <li>, <a>, or <div> — NOT always
                        // a <button>. Try li/a selectors first, then button as fallback.
                        // Among all found items, prefer the one whose text matches the hotel name.
                        // Use coordinate (mouse.move → mouse.click) instead of synthetic click
                        // for better React event handler compatibility.
                        if (!suggClicked) {
                          try {
                            const suggLocatorSpecs = [
                              '[role="listbox"] [role="option"]',
                              '[role="option"]',
                              '[data-stid*="typeahead-item"]',
                              '[data-stid*="typeahead"] li',     // Hotels.com UITK list items
                              '[data-stid*="typeahead"] a',      // anchor-based hotel card
                              'ul[role="listbox"] > li',
                              'ul[role="listbox"] > *',
                              '[role="listbox"] > *',
                              // button last — might include the Clear button (×)
                              '[role="listbox"] button',
                            ];
                            const nameWords = (targetHotelName ?? "").toLowerCase().split(/\s+/)
                              .filter((w: string) => w.length > 2 || /^\d+$/.test(w));

                            for (const spec of suggLocatorSpecs) {
                              const count = await raw.locator(spec).count().catch(() => 0);
                              if (count === 0) continue;

                              // Among found items, find best text match for hotel name.
                              // Fall back to index 0 if no match.
                              let targetIdx = -1;
                              for (let i = 0; i < Math.min(count, 6); i++) {
                                const text = (await raw.locator(spec).nth(i).textContent().catch(() => "")) ?? "";
                                // Skip clear button
                                if (/^clear$/i.test(text.trim())) continue;
                                if (/^search\s+for\b/i.test(text.trim())) continue;
                                const ltext = text.toLowerCase();
                                const matches = nameWords.filter((w: string) => ltext.includes(w)).length;
                                if (matches >= Math.ceil(nameWords.length * 0.5)) {
                                  targetIdx = i;
                                  break;
                                }
                              }
                              if (targetIdx < 0) continue;

                              // Coordinate click: move mouse to center of element then click
                              const loc = raw.locator(spec).nth(targetIdx);
                              const bbox = await loc.boundingBox().catch(() => null);
                              const itemText = (await loc.textContent().catch(() => "")) ?? "";
                              if (bbox) {
                                const cx = Math.round(bbox.x + bbox.width / 2);
                                const cy = Math.round(bbox.y + bbox.height / 2);
                                await sh(raw).click(cx, cy);
                                trace(`[ai-listing] Strategy 2: coordinate-clicked item ${targetIdx}/${count} via "${spec}" — "${itemText.trim().slice(0, 50)}"`);
                              } else {
                                await loc.click().catch(() => {});
                                trace(`[ai-listing] Strategy 2: synthetic-clicked item ${targetIdx}/${count} via "${spec}" — "${itemText.trim().slice(0, 50)}"`);
                              }
                              // Check if we navigated to hotel detail page
                              await new Promise(r => setTimeout(r, 1200));
                              const stageBResult = await waitForHotelsSidebarResultSettlement();
                              const advanced = await advanceHotelsSidebarListingResult(stageBResult, "Strategy 2");
                              if (advanced === "detail" || advanced === "listing") {
                                suggClicked = true;
                              } else if (stageBResult.status === "no_exact") {
                                trace(`[ai-listing] Strategy 2: click led to "No exact matches" — continuing fallback`);
                              } else {
                                trace(`[ai-listing] Strategy 2: click did not expose target result`);
                              }
                              break;
                            }
                            if (!suggClicked) {
                              trace(`[ai-listing] Strategy 2: no dropdown items found via any locator`);
                              const diag = await getHotelsDropdownDiagnostics();
                              if (diag.length > 0) {
                                trace(`[ai-listing] Strategy 2 diagnostics: nearby dropdown candidates -> ${diag.join(" || ")}`);
                              }
                            }
                          } catch (s2Err) {
                            trace(`[ai-listing] Strategy 2 failed: ${(s2Err as Error).message?.slice(0, 60)}`);
                          }
                        }

                        // ── Strategy 3: position-based fallback — prefer hotel name card ─────
                        if (!suggClicked) {
                          await new Promise(r => setTimeout(r, 500));
                          suggClicked = await raw.evaluate(({ hotelN }: { hotelN: string }) => {
                            const normalize = (value: string) =>
                              value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                            const input = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea'))
                              .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
                              .map((el) => {
                                const r = el.getBoundingClientRect();
                                const value = (el.value ?? "").trim();
                                const meta = normalize([
                                  el.getAttribute("placeholder") ?? "",
                                  el.getAttribute("aria-label") ?? "",
                                  el.getAttribute("data-testid") ?? "",
                                  el.getAttribute("data-stid") ?? "",
                                  el.className ?? "",
                                  el.closest("label, section, aside, div")?.textContent ?? "",
                                ].join(" "));
                                const isCurrency = /^\$\s*\d/.test(value) || /\bnightly\b|\btotal\b|\bprice\b/.test(meta);
                                const score =
                                  (/(search by property name|property name|marriott|hotel name|e\.g\.)/.test(meta) ? 120 : 0) +
                                  (r.left <= 420 ? 20 : -40) +
                                  (r.width >= 90 && r.width <= 380 ? 20 : 0) +
                                  (r.height >= 24 && r.height <= 76 ? 10 : 0) -
                                  (value.includes(",") ? 50 : 0) -
                                  (isCurrency ? 220 : 0);
                                return { el, score };
                              })
                              .filter(({ score }) => score > 0)
                              .sort((a, b) => b.score - a.score)[0]?.el ?? null;
                            if (!input) return false;
                            const inputRect = input.getBoundingClientRect();
                            const allBelow = Array.from(
                              document.querySelectorAll<HTMLElement>(
                                'li, [role="option"], [role="listbox"] *, button, [data-stid]'
                              )
                            ).filter(el => {
                              const r = el.getBoundingClientRect();
                              if (r.width === 0 || r.height === 0) return false;
                              if (r.top <= inputRect.bottom + 6) return false;
                              if (r.top > inputRect.bottom + 450) return false;
                              if (r.left > inputRect.right + 520 || r.right < inputRect.left - 40) return false;
                              return true;
                            });
                            if (allBelow.length === 0) return false;

                            // Prefer element whose text matches the hotel name (property card)
                            const nameWords = normalize(hotelN).split(/\s+/)
                              .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                            const hotelCard = allBelow
                              .map((el) => {
                                const text = normalize(el.textContent ?? "");
                                const r = el.getBoundingClientRect();
                                if (/^search\s+for\b/i.test((el.textContent ?? "").trim())) return { el, score: -999 };
                                const matches = nameWords.filter((w: string) => text.includes(w)).length;
                                const score =
                                  matches * 20 +
                                  (r.width >= 220 ? 10 : 0) +
                                  (r.height >= 40 ? 8 : 0) +
                                  (text.includes("united states") ? 6 : 0);
                                return { el, score };
                              })
                              .filter(({ score }) => score >= Math.ceil(nameWords.length * 0.5) * 20)
                              .sort((a, b) => b.score - a.score)[0]?.el;
                            const target = hotelCard ?? null;
                            if (!target) return false;
                            const promotedTarget = (() => {
                              let node: HTMLElement | null = target;
                              while (node && node !== document.body) {
                                const r = node.getBoundingClientRect();
                                if (r.width >= 240 && r.height >= 40 && r.top > inputRect.bottom + 6) {
                                  return node;
                                }
                                node = node.parentElement;
                              }
                              return target;
                            })();
                            (promotedTarget as HTMLElement).scrollIntoView({ block: "nearest" });
                            (promotedTarget as HTMLElement).click();
                            return true;
                          }, { hotelN: targetHotelName ?? "" }).catch(() => false);
                          if (suggClicked) {
                            trace(`[ai-listing] Strategy 3: clicked dropdown item via position-based DOM`);
                            await new Promise(r => setTimeout(r, 1200));
                            const stageBResult = await waitForHotelsSidebarResultSettlement();
                            const advanced = await advanceHotelsSidebarListingResult(stageBResult, "Strategy 3");
                            if (advanced === "failed" && stageBResult.status === "no_exact") {
                              suggClicked = false;
                              trace(`[ai-listing] Strategy 3: click led to "No exact matches" — treating as failure`);
                            } else if (advanced === "failed") {
                              suggClicked = false;
                              trace(`[ai-listing] Strategy 3: click did not expose target result`);
                            }
                          }
                        }

                        if (suggClicked) {
                          trace(`[ai-listing] sidebar suggestion activated for "${targetHotelName.slice(0, 50)}"`);
                          await new Promise(r => setTimeout(r, 1200));
                          if (isHotelDetailUrl(raw.url())) {
                            trace(`[ai-listing] sidebar suggestion navigated directly to hotel detail: ${raw.url().slice(0, 80)}`);
                          } else {
                            const stageBResult = await waitForHotelsSidebarResultSettlement();
                            const advanced = await advanceHotelsSidebarListingResult(stageBResult, "Strategy 3 follow-up");
                            if (advanced === "detail") {
                              trace(`[ai-listing] sidebar suggestion navigated directly to hotel detail: ${raw.url().slice(0, 80)}`);
                            }
                          }
                        } else {
                          if (startProvider?.id === "hotels-com") {
                            trace(`[ai-listing] skipped Enter on Hotels.com property filter (would trigger text-only filtering)`);
                          } else {
                            // All strategies failed — press Enter as absolute last resort
                            await sh(raw).keyPress("Enter");
                            trace(`[ai-listing] pressed Enter on property name filter (all suggestion strategies failed)`);
                            await new Promise(r => setTimeout(r, 3500));
                          }
                        }
                      } catch (stgBErr) {
                        trace(`[ai-listing] Stage B inner error: ${(stgBErr as Error).message?.slice(0, 80)}`);
                      }
                    } // end else (inputInfo found)
                  }
                }
              } catch (refineErr) {
                trace(`[ai-listing] Expedia search refinement failed: ${(refineErr as Error).message?.slice(0, 80)}`);
              }
            }

            // If the Expedia search refinement above already navigated to a hotel detail page
            // (e.g. autocomplete selection went directly to the hotel), skip clickTargetListingAI.
            if (isHotelDetailUrl(raw.url())) {
              trace(`[ai-listing] already on hotel detail page after refinement (${raw.url().slice(0, 80)}) — skipping clickTargetListingAI`);
              return true;
            }

            // Hotels.com fast path: find the first hotels.com/ho<id>/ or hotels.com/h<id>/ link
            // on the page and navigate to it directly via page.goto().
            // This is the most reliable approach for Hotels.com because:
            //   • Hotel detail URLs have a fixed /ho<digits>/ pattern
            //   • Brand sites (hilton.com, marriott.com) never match this pattern
            //   • Avoids stagehand.act() which can accidentally click "Visit hotel website" buttons
            // Runs after Stage B sidebar filter has narrowed results to ≤2 hotels.
            if (startProvider?.id === "hotels-com") {
              // Scroll to top first so the first hotel card (highest-ranked after filter) is
              // in the viewport and its DOM element is definitely rendered.
              await raw.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
              await new Promise(r => setTimeout(r, 600));

              // Guard: if the page shows "No exact matches", skip hotels that are in the
              // "Properties that don't match all your filters" section — those are wrong hotels
              // that the sidebar filter didn't match. Without this guard, Artezen Hotel and
              // other unrelated hotels from that section get selected instead of the target.
              const noMatchPage = await raw.evaluate(() =>
                /no exact match/i.test(document.body.textContent ?? "")
              ).catch(() => false);

              if (noMatchPage) {
                trace(`[ai-listing] Hotels.com: "No exact matches" — trying "Try removing filters" to clear active filters`);
                // Hotels.com shows a "Try removing filters" link when no property name matches.
                // DOM .click() does NOT trigger Hotels.com's React navigation handler — use
                // CDP coordinate click instead, which fires real pointer/mouse events.
                const removeFiltersCoords = await raw.evaluate(() => {
                  // "Try removing filters" can be any element — span, p, a, button, etc.
                  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
                  const removeLink = Array.from(document.querySelectorAll<HTMLElement>(
                    'a, button, [role="button"], span, p, div, li'
                  )).find(el => {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0 || r.height > 80) return false;
                    return /try removing filters|remove filters|clear filters|clear all/i.test(norm(el.textContent ?? ""));
                  });
                  if (!removeLink) return null;
                  removeLink.scrollIntoView({ behavior: 'instant', block: 'center' });
                  const r = removeLink.getBoundingClientRect();
                  return {
                    x: Math.round(r.left + r.width / 2),
                    y: Math.round(r.top + r.height / 2),
                    text: norm(removeLink.textContent ?? "").slice(0, 60),
                  };
                }).catch(() => null);

                if (removeFiltersCoords) {
                  trace(`[ai-listing] Hotels.com: CDP-clicking "Try removing filters" "${removeFiltersCoords.text}" at (${removeFiltersCoords.x},${removeFiltersCoords.y})`);
                  await sh(raw).click(removeFiltersCoords.x, removeFiltersCoords.y);
                  await new Promise(r => setTimeout(r, 3000));
                  trace(`[ai-listing] Hotels.com: waited 3s after "Try removing filters" CDP click`);
                } else {
                  trace(`[ai-listing] Hotels.com: "Try removing filters" link not found in DOM`);
                }
              }

              // Re-check noMatchPage after filter removal attempt
              const noMatchPageFinal = noMatchPage && await raw.evaluate(() =>
                /no exact match/i.test(document.body.textContent ?? "")
              ).catch(() => false);
              if (noMatchPageFinal) {
                trace(`[ai-listing] Hotels.com: still "No exact matches" after filter removal — skipping fast path`);
              }

              const hotelDetailHref = noMatchPageFinal ? null : await raw.evaluate(
                ({ nameWords }: { nameWords: string[] }) => {
                  const stopWords = new Set([
                    "hotel", "hotels", "inn", "suite", "suites", "resort", "spa",
                    "the", "by", "and", "at", "of",
                    "new", "york", "times", "square", "manhattan", "midtown", "downtown",
                    "broadway", "city", "united", "states", "america",
                  ]);
                  const numericWords = nameWords.filter((w: string) => /^\d+$/.test(w));
                  const distinctiveWords = nameWords.filter((w: string) => !/^\d+$/.test(w) && !stopWords.has(w) && w.length >= 4);
                  const targetCoreWords = Array.from(new Set([
                    ...numericWords,
                    ...distinctiveWords,
                  ]));
                  const requiredWords = numericWords.length > 0
                    ? numericWords
                    : distinctiveWords.slice(0, Math.min(2, distinctiveWords.length));
                  const normalize = (value: string) =>
                    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                  // Find all hotels.com hotel detail links on the page (deduplicated by href).
                  // EXCLUDE links that are inside a "doesn't match your filters" section —
                  // those are fallback hotels shown when the sidebar filter found no exact match.
                  const doesntMatchHeading = Array.from(document.querySelectorAll<HTMLElement>("h2, h3, [role='heading'], p, div"))
                    .find(el => /don.t match|doesn.t match|not match/i.test(el.textContent ?? ""));
                  const doesntMatchTop = doesntMatchHeading
                    ? doesntMatchHeading.getBoundingClientRect().top + window.scrollY
                    : Infinity;

                  const detailLinksRaw = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
                    .filter(a => {
                      const href = (a.href ?? "").toLowerCase();
                      if (!href.includes("hotels.com")) return false;
                      if (!(/\/ho\d+\/|\/h\d+\//.test(href))) return false;
                      if (href.includes("checkout")) return false;
                      // Skip links below the "doesn't match" heading
                      const linkTop = a.getBoundingClientRect().top + window.scrollY;
                      if (linkTop > doesntMatchTop) return false;
                      return true;
                    });
                  if (detailLinksRaw.length === 0) return null;

                  // Deduplicate: keep one <a> per unique href (the one closest to page top)
                  const byHref = new Map<string, { a: HTMLAnchorElement; top: number }>();
                  for (const a of detailLinksRaw) {
                    const key = a.href;
                    const top = a.getBoundingClientRect().top + window.scrollY;
                    if (!byHref.has(key) || top < (byHref.get(key)!.top)) {
                      byHref.set(key, { a, top });
                    }
                  }

                  const scored = Array.from(byHref.values()).map(({ a, top }) => {
                    const container = a.closest<HTMLElement>('article, li, [data-stid*="property"], [data-stid*="listing"], [class*="card"], [class*="Card"]') ?? a;
                    const titleCandidate = container.querySelector<HTMLElement>(
                      'h1,h2,h3,h4,[role="heading"], [data-stid*="title"], [class*="title"], [class*="Title"], a[aria-label^="Opens "]'
                    );
                    const title = normalize(
                      (titleCandidate?.getAttribute("aria-label") ?? a.getAttribute("aria-label") ?? "")
                        .replace(/^opens\s+/i, "")
                        .replace(/\s+in new tab$/i, "") ||
                      titleCandidate?.textContent ||
                      a.textContent ||
                      ""
                    ).split(" reserve now")[0]?.trim() ?? "";
                    const titleWords = title.split(" ").filter((w: string) => w.length > 0);
                    const titleCoreWords = titleWords.filter((w: string) => /^\d+$/.test(w) || (!stopWords.has(w) && w.length >= 4));
                    const extraCoreWords = titleCoreWords.filter((w: string) => !targetCoreWords.includes(w));
                    const matchedRequired = requiredWords.every((w: string) => titleWords.includes(w) || titleCoreWords.includes(w));
                    const matchedDistinctive = distinctiveWords.filter((w: string) => titleWords.includes(w) || titleCoreWords.includes(w)).length;
                    const matchedAll = nameWords.filter(w => titleWords.includes(w)).length;
                    const score =
                      matchedAll * 10 +
                      matchedDistinctive * 25 +
                      (matchedRequired ? 60 : 0) -
                      extraCoreWords.length * 90;
                    return { href: a.href, score, top, matchedRequired, matchedDistinctive, matchedAll, extraCoreWords };
                  });

                  // Primary sort: keyword score (desc). Tie-break: page position (asc = higher up).
                  // After sidebar filter, the correct hotel card is at the TOP of results.
                  scored.sort((x, y) => {
                    if (y.score !== x.score) return y.score - x.score;
                    return x.top - y.top; // prefer elements higher on the page
                  });

                  const best = scored[0];
                  if (
                    best &&
                    best.matchedRequired &&
                    best.extraCoreWords.length === 0 &&
                    best.matchedAll >= Math.max(1, Math.ceil(nameWords.length * 0.35)) &&
                    (distinctiveWords.length === 0 || best.matchedDistinctive >= 1)
                  ) {
                    return best.href;
                  }
                  return null;
                },
                { nameWords: (targetHotelName ?? "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3 || /^\d+$/.test(w)) }
              ).catch(() => null);

              if (hotelDetailHref) {
                trace(`[ai-listing] Hotels.com direct goto hotel detail: ${hotelDetailHref.slice(0, 80)}`);
                // Append check-in/out dates so room availability loads correctly
                let hotelUrl = hotelDetailHref;
                const chkin  = requestedDates?.checkin;
                const chkout = requestedDates?.checkout;
                if (chkin && chkout) {
                  try {
                    const u = new URL(hotelDetailHref);
                    if (!u.searchParams.has("chkin")) u.searchParams.set("chkin", chkin);
                    if (!u.searchParams.has("chkout")) u.searchParams.set("chkout", chkout);
                    hotelUrl = u.toString();
                  } catch { /* leave unchanged */ }
                }
                try {
                  await raw.goto(hotelUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
                  await new Promise(r => setTimeout(r, 1200));
                  const landedUrl = raw.url();
                  if (isHotelDetailUrl(landedUrl)) {
                    const matches = await raw.evaluate(({ hotelN }: { hotelN: string }) => {
                      const normalize = (value: string) =>
                        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                      const nameWords = normalize(hotelN)
                        .split(" ")
                        .filter((w: string) => w.length > 2 || /^\d+$/.test(w));
                      const stopWords = new Set([
                        "hotel", "hotels", "inn", "suite", "suites", "resort", "spa",
                        "the", "by", "and", "at", "of",
                        "new", "york", "times", "square", "manhattan", "midtown", "downtown",
                        "broadway", "city", "united", "states", "america",
                      ]);
                      const numericWords = nameWords.filter((w: string) => /^\d+$/.test(w));
                      const distinctiveWords = nameWords.filter((w: string) => !/^\d+$/.test(w) && !stopWords.has(w) && w.length >= 4);
                      const targetCoreWords = Array.from(new Set([
                        ...numericWords,
                        ...distinctiveWords,
                      ]));
                      const requiredWords = numericWords.length > 0
                        ? numericWords
                        : distinctiveWords.slice(0, Math.min(2, distinctiveWords.length));
                      const allowedUiWords = new Set([
                        "reserve", "reserved", "book", "booking", "room", "rooms", "select", "overview",
                        "accessibility", "policies", "about", "good", "great", "excellent", "review", "reviews",
                      ]);
                      const combined = normalize(`${document.title ?? ""} ${document.querySelector("h1")?.textContent ?? ""}`);
                      const combinedWords = combined.split(" ").filter((w: string) => w.length > 0);
                      const combinedCoreWords = combinedWords.filter((w: string) =>
                        /^\d+$/.test(w) || (!stopWords.has(w) && !allowedUiWords.has(w) && w.length >= 4)
                      );
                      const extraCoreWords = combinedCoreWords.filter((w: string) => !targetCoreWords.includes(w));
                      const requiredOk = requiredWords.every((w: string) => combined.includes(w));
                      const matchedDistinctive = distinctiveWords.filter((w: string) => combined.includes(w)).length;
                      const matchedAll = nameWords.filter((w: string) => combined.includes(w)).length;
                      if (numericWords.length > 0) {
                        return requiredOk && extraCoreWords.length === 0;
                      }
                      return requiredOk &&
                        extraCoreWords.length === 0 &&
                        matchedAll >= Math.max(1, Math.ceil(nameWords.length * 0.25)) &&
                        (distinctiveWords.length === 0 || matchedDistinctive >= 1);
                    }, { hotelN: targetHotelName ?? "" }).catch(() => false);
                    if (matches) {
                      trace(`[ai-listing] Hotels.com goto succeeded — verified target detail on ${landedUrl.slice(0, 80)}`);
                      return true;
                    }
                    trace(`[ai-listing] Hotels.com goto reached wrong hotel detail — going back (${landedUrl.slice(0, 80)})`);
                    await raw.evaluate(() => window.history.back()).catch(() => {});
                    await new Promise(r => setTimeout(r, 1200));
                  } else {
                    trace(`[ai-listing] Hotels.com goto landed on unexpected URL (${landedUrl.slice(0, 60)}) — falling through to clickTargetListingAI`);
                  }
                } catch (gotoErr) {
                  trace(`[ai-listing] Hotels.com goto failed: ${(gotoErr as Error).message?.slice(0, 60)} — falling through to clickTargetListingAI`);
                }
              } else {
                trace(`[ai-listing] Hotels.com: no /ho<id>/ link found on page — falling through to clickTargetListingAI`);
              }
            }

            // ── OpenTable: programmatic time-slot selection ──────────────────────
            // OpenTable search results show available time-slot buttons directly on
            // the search page. We click the closest slot to the requested time via
            // pure DOM — no stagehand.act() needed (avoids OpenAI quota errors).
            if (startProvider?.id === "opentable-com") {
              // ── Early exit: restaurant not found on OpenTable ──────────────
              // OpenTable shows "We didn't find a match" when the restaurant doesn't exist.
              // Return no_availability so the user gets a clear message instead of a
              // confusing "stage=unknown" error.
              const noResultsFound = await raw.evaluate(() => {
                const text = (document.body?.innerText ?? "").toLowerCase();
                return (
                  text.includes("we didn't find a match") ||
                  text.includes("no results found") ||
                  text.includes("couldn't find") ||
                  text.includes("no restaurants found") ||
                  (text.includes("didn't find") && text.includes("match"))
                );
              }).catch(() => false);

              if (noResultsFound) {
                const restaurantLabel = targetHotelName ?? "This restaurant";
                trace(`[opentable] no results found for "${restaurantLabel}" — returning no_availability`);
                return false; // signals no_availability; the outer loop captures available slots
              }

              // Extract requested time from task string (HH:MM 24h or "H:MM PM" 12h)
              const timeMatch = input.task.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
              let requestedMinutes = 19 * 60; // default 7 PM
              if (timeMatch) {
                let h = parseInt(timeMatch[1], 10);
                const m = parseInt(timeMatch[2], 10);
                const meridiem = (timeMatch[3] ?? "").toUpperCase();
                if (meridiem === "PM" && h < 12) h += 12;
                if (meridiem === "AM" && h === 12) h = 0;
                requestedMinutes = h * 60 + m;
              }

              // Parse "7:00 PM" / "7:30 pm" / "19:00" to minutes since midnight
              const parseTimeText = (text: string): number | null => {
                const m12 = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                if (m12) {
                  let h = parseInt(m12[1], 10);
                  const min = parseInt(m12[2], 10);
                  if (m12[3].toUpperCase() === "PM" && h < 12) h += 12;
                  if (m12[3].toUpperCase() === "AM" && h === 12) h = 0;
                  return h * 60 + min;
                }
                const m24 = text.match(/(\d{1,2}):(\d{2})$/);
                if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
                return null;
              };

              // ── OT detail-page widget: programmatic time-slot select ────────────
              // /r/<slug> detail pages render the booking widget in two states:
              //   (a) initial: only <select data-test="time-picker"> shown
              //   (b) post-select: <ul data-test="time-slots"> with <a> anchors
              // We must drive the <select> first, wait for AJAX to render slots,
              // then click the closest anchor. Listing-card selector below
              // never works for /r/<slug> because anchors lack role="button".
              const isDetailUrl = /opentable\.com\/r\//i.test(raw.url());
              if (isDetailUrl) {
                // Step 0: navigate to detail URL with dateTime+covers query
                // params if missing. OT widget honors these on SSR — without
                // them, the widget defaults to today and the wrong party size.
                // Last benchmark (96834ada) showed widget date stuck at "Apr 30"
                // even though case date was "May 14" because we never set it.
                const taskDateMatch = input.task.match(/\bon\s+(20\d{2}-\d{2}-\d{2})\b/);
                const taskCoversMatch = input.task.match(/\bfor\s+(\d+)\s+people\b/i);
                if (taskDateMatch) {
                  const hh = String(Math.floor(requestedMinutes / 60)).padStart(2, "0");
                  const mm = String(requestedMinutes % 60).padStart(2, "0");
                  const covers = taskCoversMatch ? taskCoversMatch[1] : "2";
                  const u = new URL(raw.url());
                  const desiredDateTime = `${taskDateMatch[1]}T${hh}:${mm}`;
                  if (u.searchParams.get("dateTime") !== desiredDateTime || u.searchParams.get("covers") !== covers) {
                    u.searchParams.set("dateTime", desiredDateTime);
                    u.searchParams.set("covers", covers);
                    trace(`[opentable] detail-page navigate w/ params: dateTime=${desiredDateTime}&covers=${covers}`);
                    await raw.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
                    await new Promise((r) => setTimeout(r, 2000));
                  }
                }

                // Step 1: as a backup, drive the <select> via Playwright
                // selectOption. Some OT variants need this to finalize state
                // even when query params set the initial render.
                const optionInfo = await raw.evaluate(
                  ({ reqMins }: { reqMins: number }) => {
                    const parseT = (text: string): number | null => {
                      const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                      if (!m) return null;
                      let h = parseInt(m[1], 10);
                      if (m[3].toUpperCase() === "PM" && h < 12) h += 12;
                      if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
                      return h * 60 + parseInt(m[2], 10);
                    };
                    const select = document.querySelector<HTMLSelectElement>('[data-test="time-picker"]');
                    if (!select) return null;
                    const sorted = Array.from(select.options)
                      .map((o) => ({ value: o.value, label: o.text, t: parseT(o.text) }))
                      .filter((x): x is { value: string; label: string; t: number } => x.t !== null)
                      .sort((a, b) => Math.abs(a.t - reqMins) - Math.abs(b.t - reqMins));
                    return sorted[0] ?? null;
                  },
                  { reqMins: requestedMinutes },
                ).catch(() => null);

                let setOk = false;
                if (optionInfo) {
                  setOk = await raw
                    .locator('[data-test="time-picker"]')
                    .selectOption(optionInfo.value)
                    .then(() => true)
                    .catch(() => false);
                }
                trace(`[opentable] detail-page time-picker drive: ${JSON.stringify({ ok: setOk, picked: optionInfo?.label, diff: optionInfo ? Math.abs(optionInfo.t - requestedMinutes) : null })}`);

                // Step 2: wait for AJAX-rendered <ul data-test="time-slots">
                // (extend to 8s — OT can take 5+ seconds when peak load)
                await raw.waitForSelector('[data-test="time-slots"] a, [data-test="time-slots"] button', { timeout: 8000 }).catch(() => null);

                // Step 3: find the closest matching time-slot anchor.
                // OT renders <a href="/booking/...">7:30 PM</a> on detail pages
                // — these have no role="button" so the listing-card selector
                // misses them. Match by anchor href containing /booking/ as a
                // strong filter (avoids picking up footer/menu links). Also
                // include <button> as fallback for variant layouts. If the
                // canonical [data-test="time-slots"] container exists, prefer
                // it; otherwise fall back to a global scan with the booking
                // href filter.
                const detailSlot = await raw.evaluate(
                  ({ reqMins, maxDiffMins }: { reqMins: number; maxDiffMins: number }) => {
                    const parseT = (text: string): number | null => {
                      const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                      if (!m) return null;
                      let h = parseInt(m[1], 10);
                      if (m[3].toUpperCase() === "PM" && h < 12) h += 12;
                      if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
                      return h * 60 + parseInt(m[2], 10);
                    };
                    const isVisible = (el: Element) => {
                      const r = (el as HTMLElement).getBoundingClientRect();
                      return r.width > 0 && r.height > 0;
                    };

                    // Collect candidates from two sources, then dedupe
                    const collected: HTMLElement[] = [];
                    const container = document.querySelector<HTMLElement>('[data-test="time-slots"]');
                    if (container) {
                      collected.push(...Array.from(container.querySelectorAll<HTMLElement>("a, button")));
                    }
                    // Global fallback: any anchor whose text is strictly a
                    // PM/AM time slot (e.g. "7:30 PM"). OT detail-page time-
                    // slot anchors render as <a> with NO href (onclick-driven
                    // SPA nav), so we can't filter by href. The strict regex
                    // avoids false positives from menu/footer links that
                    // happen to contain time text.
                    Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))
                      .filter((el) => {
                        const t = (el.textContent ?? "").trim();
                        return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t) && t.length < 12;
                      })
                      .forEach((el) => collected.push(el));
                    // Plus any <button> with PM/AM-only short text
                    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
                      .filter((el) => {
                        const t = (el.textContent ?? "").trim();
                        return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t) && t.length < 12;
                      })
                      .forEach((el) => collected.push(el));

                    const seen = new Set<HTMLElement>();
                    const candidates = collected
                      .filter((el) => {
                        if (seen.has(el)) return false;
                        seen.add(el);
                        return isVisible(el);
                      })
                      .map((el) => {
                        const t = parseT((el.textContent ?? "").trim());
                        return t === null ? null : { el, t };
                      })
                      .filter((x): x is { el: HTMLElement; t: number } => x !== null && Math.abs(x.t - reqMins) <= maxDiffMins);

                    if (candidates.length === 0) {
                      // Diagnostic: show what we DID find with PM/AM text
                      const debug = Array.from(document.querySelectorAll<HTMLElement>("a, button"))
                        .filter((el) => {
                          const t = (el.textContent ?? "").trim();
                          return /\d{1,2}:\d{2}\s*(AM|PM)/i.test(t) && t.length < 30 && isVisible(el);
                        })
                        .slice(0, 8)
                        .map((el) => ({
                          tag: el.tagName,
                          text: (el.textContent ?? "").trim().slice(0, 25),
                          href: el.tagName === "A" ? (el as HTMLAnchorElement).getAttribute("href")?.slice(0, 60) || "" : "",
                        }));
                      return { _empty: true as const, debug };
                    }
                    candidates.sort((a, b) => Math.abs(a.t - reqMins) - Math.abs(b.t - reqMins));
                    const best = candidates[0].el;
                    best.scrollIntoView({ block: "center" });
                    const r = best.getBoundingClientRect();
                    return {
                      _empty: false as const,
                      x: Math.round(r.left + r.width / 2),
                      y: Math.round(r.top + r.height / 2),
                      text: (best.textContent ?? "").trim().slice(0, 30),
                    };
                  },
                  { reqMins: requestedMinutes, maxDiffMins: 90 },
                ).catch(() => null);

                if (detailSlot && detailSlot._empty) {
                  trace(`[opentable] detail-page no candidates — debug seen: ${JSON.stringify(detailSlot.debug)}`);
                }

                if (detailSlot && !detailSlot._empty && detailSlot.x > 0) {
                  trace(`[opentable] detail-page time slot match: "${detailSlot.text}" — clicking via CDP`);
                  const clicked = await sh(raw)
                    .click(detailSlot.x, detailSlot.y)
                    .then(() => true)
                    .catch(() => false);
                  if (clicked) {
                    await new Promise((r) => setTimeout(r, 2500));
                    trace("[opentable] detail-page slot clicked — yielding to stage reassessment");
                    return true;
                  }
                  trace("[opentable] detail-page slot click failed — falling through to listing logic");
                } else if (!detailSlot || detailSlot._empty) {
                  trace("[opentable] detail-page widget has no time slots in ±90 min — falling through");
                }
              }
              // ── END detail-page early path ────────────────────────────────────

              // Find the best time slot button WITHIN the target restaurant's card.
              // IMPORTANT: OpenTable search results show multiple restaurants. We must
              // restrict the search to the card that contains the target restaurant name
              // to avoid clicking slots from other restaurant cards (e.g. Firebirds).
              const slotCoords = await raw.evaluate(
                ({ reqMins, maxDiffMins, restaurantName }: { reqMins: number; maxDiffMins: number; restaurantName: string }) => {
                  const isVisible = (el: Element) => {
                    const r = (el as HTMLElement).getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                  };
                  const parseT = (text: string): number | null => {
                    const m12 = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                    if (m12) {
                      let h = parseInt(m12[1], 10);
                      const min = parseInt(m12[2], 10);
                      if (m12[3].toUpperCase() === "PM" && h < 12) h += 12;
                      if (m12[3].toUpperCase() === "AM" && h === 12) h = 0;
                      return h * 60 + min;
                    }
                    return null;
                  };
                  // Exact time text pattern: "7:00 PM", "7:15 PM", etc. (with optional asterisk)
                  const isTimeText = (text: string) => /^\d{1,2}:\d{2}\s*(AM|PM)\*?$/i.test(text.trim());

                  // Find the restaurant card containing our target name.
                  // OpenTable cards are typically <li>, <article>, or a div with the restaurant name.
                  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                  const targetNorm = normalize(restaurantName);
                  const targetWords = targetNorm.split('').length > 4 ? [targetNorm.slice(0, 6)] : [targetNorm];

                  // Find a container element whose text contains the restaurant name
                  // but is reasonably sized (a card, not the whole page).
                  const allContainers = Array.from(document.querySelectorAll<HTMLElement>(
                    'li, article, [class*="result" i], [class*="card" i], [class*="restaurant" i], [data-test*="result" i]'
                  )).filter(el => {
                    if (!isVisible(el)) return false;
                    const r = el.getBoundingClientRect();
                    if (r.width < 100 || r.height < 50) return false; // too small to be a card
                    const text = normalize(el.textContent ?? '');
                    return targetWords.every(w => text.includes(w));
                  });

                  // Sort by smallest area to find the most specific card (not entire page body)
                  const targetCard = allContainers.sort((a, b) => {
                    const ra = a.getBoundingClientRect();
                    const rb = b.getBoundingClientRect();
                    return (ra.width * ra.height) - (rb.width * rb.height);
                  })[0];

                  // Scan for time slots: prefer within target card, fall back to all page slots
                  const searchRoot: Element = targetCard ?? document.body;
                  const diagScope = targetCard ? 'card' : 'page (no matching card found)';

                  // Broad scan within scope
                  const allEls = Array.from(searchRoot.querySelectorAll<HTMLElement>(
                    'a[href], button, [role="button"], [role="link"], [tabindex]'
                  ));
                  const leafTimeEls = Array.from(searchRoot.querySelectorAll<HTMLElement>('*'))
                    .filter(el => isTimeText((el.textContent ?? '').trim()) && el.children.length === 0 && isVisible(el));

                  const combined = [...new Set([...allEls, ...leafTimeEls])];

                  // Diagnostics
                  const diag = `scope=${diagScope} | ` + combined
                    .filter(el => isVisible(el) && parseT((el.textContent ?? '').trim()) !== null)
                    .slice(0, 5)
                    .map(el => `${el.tagName}[${el.getAttribute('role') ?? ''}] "${(el.textContent ?? '').trim().slice(0, 15)}"`)
                    .join(' | ');

                  const candidates = combined.filter((el) => {
                    if (!isVisible(el)) return false;
                    // Strip asterisk (*) from slot text before parsing (OpenTable marks some slots with *)
                    const t = parseT((el.textContent ?? "").trim().replace(/\*$/, ""));
                    return t !== null && Math.abs(t - reqMins) <= maxDiffMins;
                  });

                  if (candidates.length === 0) return { x: -1, y: -1, text: '', diag };

                  // Pick the closest slot
                  const best = candidates.sort((a, b) => {
                    const ta = parseT((a.textContent ?? "").trim().replace(/\*$/, "")) ?? Infinity;
                    const tb = parseT((b.textContent ?? "").trim().replace(/\*$/, "")) ?? Infinity;
                    return Math.abs(ta - reqMins) - Math.abs(tb - reqMins);
                  })[0];

                  best.scrollIntoView({ block: "center" });
                  const r = best.getBoundingClientRect();
                  return {
                    x: Math.round(r.left + r.width / 2),
                    y: Math.round(r.top + r.height / 2),
                    text: (best.textContent ?? "").trim().slice(0, 20),
                    diag,
                  };
                },
                { reqMins: requestedMinutes, maxDiffMins: 90, restaurantName: targetHotelName ?? "" }
              ).catch(() => null);

              if (slotCoords?.diag) {
                trace(`[opentable] time slot diag: ${slotCoords.diag || "(none found)"}`);
              }

              // Use CDP coordinate click (real mouse event that React can detect)
              const slotClicked = slotCoords && slotCoords.x > 0
                ? await sh(raw).click(slotCoords.x, slotCoords.y)
                    .then(() => slotCoords.text)
                    .catch(() => null)
                : null;

              if (slotClicked) {
                trace(`[opentable] clicked time slot "${slotClicked}" (requested: ${Math.floor(requestedMinutes / 60)}:${String(requestedMinutes % 60).padStart(2, "0")})`);
                await new Promise(r => setTimeout(r, 2500));

                // Check 1: URL navigated away from search results
                const nowUrl = raw.url();
                if (nowUrl.toLowerCase().includes("opentable.com") && !nowUrl.toLowerCase().includes("/s?")) {
                  // ── Seating options page: auto-select Standard ────────────────
                  // OpenTable may show /booking/seating-options before the guest form.
                  // Automatically click "Standard" (or first "Select" button) to proceed.
                  if (nowUrl.toLowerCase().includes("/booking/seating-options")) {
                    trace(`[opentable] seating options page detected — auto-selecting Standard`);
                    const seatingSelected = await raw.evaluate(() => {
                      const isVisible = (el: Element) => {
                        const r = (el as HTMLElement).getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                      };
                      // Prefer "Standard" seating; fall back to first visible Select button
                      const allSelectBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
                        .filter(b => isVisible(b) && /^select$/i.test((b.textContent ?? "").trim()));
                      const stdSection = document.querySelector<HTMLElement>("[class*='standard' i], [data-testid*='standard' i]");
                      const stdBtn = stdSection
                        ? Array.from(stdSection.querySelectorAll<HTMLButtonElement>("button"))
                            .find(b => /^select$/i.test((b.textContent ?? "").trim()))
                        : null;
                      const btn = stdBtn ?? allSelectBtns[0] ?? null;
                      if (btn) { btn.click(); return (btn.closest("section, [class*='section']")?.querySelector("h3, p, span")?.textContent ?? "Standard").trim().slice(0, 30); }
                      return null;
                    }).catch(() => null);
                    if (seatingSelected) {
                      trace(`[opentable] selected seating: "${seatingSelected}" — waiting for booking form`);
                      await new Promise(r => setTimeout(r, 2000));
                      return true;
                    }
                  }

                  // ── Verify correct restaurant ─────────────────────────────────
                  // Avoid booking the wrong restaurant (e.g. from "you may also like" cards).
                  // OpenTable booking pages show restaurant name in specific elements near the
                  // booking header — NOT in generic page headings like "You're almost done!".
                  if (targetHotelName) {
                    const pageRestaurant = await raw.evaluate(() => {
                      // OpenTable booking pages show the restaurant name near the top,
                      // separate from the page's action heading (h1: "You're almost done!").
                      // Strategy: find a heading that is NOT a generic UI phrase.
                      const genericUI = /you're almost done|complete your reservation|available seating|select seating|reservation details|almost done|booking|diner details/i;
                      // Check all headings and prominent text nodes for a restaurant-like name
                      const candidates = Array.from(document.querySelectorAll<HTMLElement>(
                        'h1, h2, h3, [class*="restaurant" i], [class*="venue" i], [data-testid*="restaurant" i]'
                      ));
                      for (const el of candidates) {
                        const text = (el.textContent ?? "").trim();
                        if (text.length >= 3 && text.length <= 80 && !genericUI.test(text)) {
                          return text;
                        }
                      }
                      // Fallback: read page title (tab title often has restaurant name)
                      return document.title.replace(/\s*[-|].*$/, "").trim().slice(0, 80);
                    }).catch(() => "");
                    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
                    const targetWords = normalize(targetHotelName).split(" ").filter(w => w.length > 3);
                    const pageWords = normalize(pageRestaurant);
                    const matched = targetWords.filter(w => pageWords.includes(w)).length;
                    const matchRatio = targetWords.length > 0 ? matched / targetWords.length : 1;
                    if (pageRestaurant && matchRatio < 0.4) {
                      trace(`[opentable] wrong restaurant on booking page: "${pageRestaurant}" (target: "${targetHotelName}") — going back`);
                      await raw.evaluate(() => window.history.back()).catch(() => {});
                      await new Promise(r => setTimeout(r, 1000));
                      return false; // retry the listing stage
                    }
                    if (pageRestaurant) {
                      trace(`[opentable] correct restaurant confirmed: "${pageRestaurant}" (matchRatio=${matchRatio.toFixed(2)})`);
                    }
                  }
                  trace(`[opentable] navigated to reservation page: ${nowUrl.slice(0, 80)}`);
                  return true;
                }

                // Check 2: OpenTable opened a reservation form as an inline modal
                // (URL stays at /s? but a name/email/phone form appears on the page)
                const hasReservationForm = await raw.evaluate(() => {
                  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
                  const visible = inputs.filter(el => el.offsetParent !== null && !el.disabled);
                  return visible.some(el => {
                    const ph = (el.placeholder || "").toLowerCase();
                    const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
                    return ph.includes("first") || ph.includes("last") || el.type === "email" ||
                           ph.includes("phone") || lbl.includes("phone") ||
                           lbl.includes("first name") || lbl.includes("last name");
                  });
                }).catch(() => false);

                if (hasReservationForm) {
                  trace("[opentable] reservation form modal detected after slot click — proceeding to guest details");
                  return true;
                }

                // Check 3: Even if we can't detect the state change, return true to prevent
                // clickTargetListingAI from navigating back to the search page and causing a loop.
                // The stage assessment on the next pass will detect the actual state.
                trace("[opentable] slot clicked but no URL/form change detected — yielding to stage reassessment");
                return true;
              } else {
                trace("[opentable] no time slots found in ±90 min — trying restaurant card click");
                // Fall back: click the restaurant card to navigate to detail page
                const cardClicked = await raw.evaluate((restaurantName: string) => {
                  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
                  const target = normalize(restaurantName);
                  const links = Array.from(document.querySelectorAll<HTMLElement>("a[href]"));
                  const match = links.find((el) => {
                    const t = normalize(el.textContent ?? "");
                    return t.includes(target.slice(0, 8)) || target.includes(t.slice(0, 8));
                  });
                  if (match) { match.click(); return true; }
                  return false;
                }, targetHotelName ?? "").catch(() => false);

                if (cardClicked) {
                  trace("[opentable] clicked restaurant card — waiting for detail page");
                  await new Promise(r => setTimeout(r, 2000));
                  // Retry time slot click on the detail page — use CDP coords, not DOM .click()
                  const detailSlotCoords = await raw.evaluate(
                    ({ reqMins, maxDiffMins }: { reqMins: number; maxDiffMins: number }) => {
                      const parseT = (text: string): number | null => {
                        const m12 = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                        if (m12) {
                          let h = parseInt(m12[1], 10);
                          const min = parseInt(m12[2], 10);
                          if (m12[3].toUpperCase() === "PM" && h < 12) h += 12;
                          if (m12[3].toUpperCase() === "AM" && h === 12) h = 0;
                          return h * 60 + min;
                        }
                        return null;
                      };
                      const isVisible = (el: Element) => {
                        const r = (el as HTMLElement).getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                      };
                      const slots = Array.from(
                        document.querySelectorAll<HTMLElement>('button, a[role="button"]')
                      ).filter((el) => {
                        if (!isVisible(el)) return false;
                        const t = parseT((el.textContent ?? "").trim());
                        return t !== null && Math.abs(t - reqMins) <= maxDiffMins;
                      });
                      if (!slots.length) return null;
                      const best = slots.sort((a, b) => {
                        const ta = parseT((a.textContent ?? "").trim()) ?? Infinity;
                        const tb = parseT((b.textContent ?? "").trim()) ?? Infinity;
                        return Math.abs(ta - reqMins) - Math.abs(tb - reqMins);
                      })[0];
                      best.scrollIntoView({ block: "center" });
                      const r = best.getBoundingClientRect();
                      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (best.textContent ?? "").trim().slice(0, 20) };
                    },
                    { reqMins: requestedMinutes, maxDiffMins: 90 }
                  ).catch(() => null);

                  const detailSlot = detailSlotCoords
                    ? await sh(raw).click(detailSlotCoords.x, detailSlotCoords.y)
                        .then(() => detailSlotCoords.text)
                        .catch(() => null)
                    : null;
                  if (detailSlot) {
                    trace(`[opentable] clicked time slot on detail page: "${detailSlot}"`);
                    await new Promise(r => setTimeout(r, 1500));
                    return true;
                  }
                }

                // Capture ALL visible time slots so the UI can offer alternatives
                capturedAvailableSlots = await raw.evaluate(() => {
                  const parseT = (text: string): number | null => {
                    const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                    if (!m) return null;
                    let h = parseInt(m[1], 10);
                    if (m[3].toUpperCase() === "PM" && h < 12) h += 12;
                    if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
                    return h * 60 + parseInt(m[2], 10);
                  };
                  const isVisible = (el: Element) => {
                    const r = (el as HTMLElement).getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                  };
                  const seen = new Set<string>();
                  return Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"]'))
                    .filter(el => isVisible(el) && parseT((el.textContent ?? "").trim()) !== null)
                    .map(el => (el.textContent ?? "").trim().replace(/\s+/g, " "))
                    .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; })
                    .slice(0, 12);
                }).catch(() => []);
                trace(`[opentable] no time slots found in ±90 min — captured ${capturedAvailableSlots.length} available slot(s): ${capturedAvailableSlots.slice(0, 5).join(", ")}`);
                return false; // signals no_availability to outer loop
              }
            }

            // ── Resy: programmatic time-slot selection (mirrors OpenTable) ────────
            if (startProvider?.id === "resy-com") {
              // No-results check
              const resyNoResults = await raw.evaluate(() => {
                const text = (document.body?.innerText ?? "").toLowerCase();
                return text.includes("no results") || text.includes("no restaurants") ||
                       text.includes("nothing here") || (text.includes("didn't find") && text.includes("match"));
              }).catch(() => false);
              if (resyNoResults) {
                const label = targetHotelName ?? "This restaurant";
                trace(`[resy] "${label}" not found on Resy — returning no_availability`);
                return false; // outer loop will return no_availability via capturedAvailableSlots path
              }

              // Time slot selection — identical logic to OpenTable
              const timeMatch2 = input.task.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
              let reqMins2 = 19 * 60;
              if (timeMatch2) {
                let h = parseInt(timeMatch2[1], 10);
                const m = parseInt(timeMatch2[2], 10);
                const mer = (timeMatch2[3] ?? "").toUpperCase();
                if (mer === "PM" && h < 12) h += 12;
                if (mer === "AM" && h === 12) h = 0;
                reqMins2 = h * 60 + m;
              }

              const resySlotCoords = await raw.evaluate(({ reqMins, maxDiff }: { reqMins: number; maxDiff: number }) => {
                const isVisible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                const parseT = (text: string) => { const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) return null; let h = parseInt(m[1], 10); const min = parseInt(m[2], 10); if (m[3].toUpperCase() === "PM" && h < 12) h += 12; if (m[3].toUpperCase() === "AM" && h === 12) h = 0; return h * 60 + min; };
                const isTimeText = (t: string) => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t.trim());
                const allEls = [...Array.from(document.querySelectorAll<HTMLElement>('a[href], button, [role="button"], [role="link"]')),
                                ...Array.from(document.querySelectorAll<HTMLElement>('*')).filter(el => isTimeText((el.textContent ?? '').trim()) && el.children.length === 0 && isVisible(el))];
                const candidates = [...new Set(allEls)].filter(el => { if (!isVisible(el)) return false; const t = parseT((el.textContent ?? '').trim()); return t !== null && Math.abs(t - reqMins) <= maxDiff; });
                if (!candidates.length) return { x: -1, y: -1, text: '', diag: 'none' };
                const best = candidates.sort((a, b) => Math.abs((parseT((a.textContent ?? '').trim()) ?? Infinity) - reqMins) - Math.abs((parseT((b.textContent ?? '').trim()) ?? Infinity) - reqMins))[0];
                best.scrollIntoView({ block: "center" });
                const r = best.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (best.textContent ?? '').trim().slice(0, 20), diag: best.tagName };
              }, { reqMins: reqMins2, maxDiff: 90 }).catch(() => null);

              if (resySlotCoords?.diag) trace(`[resy] time slot diag: ${resySlotCoords.diag} "${resySlotCoords.text}"`);

              const resySlotClicked = resySlotCoords && resySlotCoords.x > 0
                ? await sh(raw).click(resySlotCoords.x, resySlotCoords.y).then(() => resySlotCoords.text).catch(() => null)
                : null;

              if (resySlotClicked) {
                trace(`[resy] clicked time slot "${resySlotClicked}" (requested: ${Math.floor(reqMins2 / 60)}:${String(reqMins2 % 60).padStart(2, "0")})`);
                await new Promise(r => setTimeout(r, 2500));
                const resyNowUrl = raw.url();
                if (!resyNowUrl.toLowerCase().includes("resy.com/cities") || resyNowUrl.toLowerCase().includes("/book")) {
                  trace(`[resy] navigated to booking page: ${resyNowUrl.slice(0, 80)}`);
                  return true;
                }
                const resyHasForm = await raw.evaluate(() => {
                  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(el => el.offsetParent !== null && !el.disabled);
                  return inputs.some(el => { const ph = (el.placeholder || "").toLowerCase(); return ph.includes("first") || ph.includes("last") || el.type === "email" || ph.includes("phone"); });
                }).catch(() => false);
                if (resyHasForm) { trace("[resy] reservation form detected"); return true; }
                trace("[resy] slot clicked — yielding to stage reassessment");
                return true;
              } else {
                capturedAvailableSlots = await raw.evaluate(() => {
                  const parseT = (t: string) => { const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); if (!m) return null; let h = parseInt(m[1], 10); if (m[3].toUpperCase() === "PM" && h < 12) h += 12; if (m[3].toUpperCase() === "AM" && h === 12) h = 0; return h * 60 + parseInt(m[2], 10); };
                  const isV = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                  const seen = new Set<string>();
                  return Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"]')).filter(el => isV(el) && parseT((el.textContent ?? "").trim()) !== null).map(el => (el.textContent ?? "").trim()).filter(t => { if (seen.has(t)) return false; seen.add(t); return true; }).slice(0, 12);
                }).catch(() => []);
                trace(`[resy] no time slots found — captured ${capturedAvailableSlots.length} slot(s)`);
                return false;
              }
            }

            // ── Yelp: find restaurant and click reservation link ───────────────
            if (startProvider?.id === "yelp-com") {
              // Find and click the "Make a Reservation" button on the Yelp biz page
              const yelpResCoords = await raw.evaluate(() => {
                const isVisible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                const pattern = /make a reservation|reserve a table|book a table|reserve now|find a table/i;
                const btn = Array.from(document.querySelectorAll<HTMLElement>("a, button")).find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
                if (!btn) return null;
                btn.scrollIntoView({ block: "center" });
                const r = btn.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (btn.textContent ?? "").trim().slice(0, 40) };
              }).catch(() => null);

              if (yelpResCoords) {
                trace(`[yelp] clicking reservation link: "${yelpResCoords.text}"`);
                await sh(raw).click(yelpResCoords.x, yelpResCoords.y).catch(() => {});
                await new Promise(r => setTimeout(r, 2500));
                const yelpNowUrl = raw.url();
                trace(`[yelp] after reservation click: ${yelpNowUrl.slice(0, 80)}`);
                // The click may redirect to OpenTable/Resy — those providers handle from here
                return true;
              }

              // If no reservation button found on Yelp, search for the restaurant first
              trace("[yelp] no reservation button found — still on search/listing");
            }

            // Pass startDomain so clickTargetListingAI can detect & revert wrong-domain clicks
            // (e.g. clicking an IHG logo badge on Expedia that navigates to ihg.com).
            const startDomainHint = startProvider?.id === "expedia" ? "expedia.com"
              : startProvider?.id === "hotels-com" ? "hotels.com"
              : startProvider?.id === "opentable-com" ? "opentable.com"
              : startProvider?.id === "resy-com" ? "resy.com"
              : startProvider?.id === "yelp-com" ? "yelp.com"
              : input.startUrl.match(/^https?:\/\/([^/]+)/)?.[1] ?? undefined;
            const result = await clickTargetListingAI(stagehand, targetHotelName ?? "", trace, 5, startDomainHint, requestedDates);
            if (result === "no_availability") return false;
            if (result === "clicked") {
              // Wait briefly — Booking.com opens hotel pages in a new tab; Expedia navigates
              // the current tab directly. Check both patterns.
              let hotelUrl: string | null = null;
              for (let tabWait = 0; tabWait < 3 && !hotelUrl; tabWait++) {
                await new Promise(r => setTimeout(r, 800));
                // Check if the current page navigated to a hotel detail URL (Expedia pattern)
                const directUrl = raw.url();
                if (isHotelDetailUrl(directUrl)) {
                  trace(`[ai-listing] raw page navigated to hotel directly: ${directUrl.slice(0, 80)}`);
                  return true;
                }
                // Check for a new tab (Booking.com pattern)
                try {
                  const allPages = stagehand.context.pages();
                  const hotelPageEntry = allPages
                    .map(p => ({ p, url: getScopeUrl(getRawPage(p)) }))
                    .find(({ url }) => isHotelDetailUrl(url));
                  if (hotelPageEntry) hotelUrl = hotelPageEntry.url;
                } catch { /* ignore */ }
              }
              if (hotelUrl) {
                if (raw.url() !== hotelUrl) {
                  // Close the extra tab then navigate raw to the hotel URL
                  try {
                    const allPages = stagehand.context.pages();
                    for (const p of allPages) {
                      const pr = getRawPage(p);
                      if (pr !== raw && isHotelDetailUrl(pr.url())) {
                        await pr.close().catch(() => {});
                        break;
                      }
                    }
                  } catch { /* ignore */ }
                  trace(`[ai-listing] new hotel tab detected — navigating main page to: ${hotelUrl.slice(0, 80)}`);
                  try {
                    await raw.goto(hotelUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
                    await raw.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
                  } catch (navErr) {
                    trace(`[ai-listing] navigation failed: ${(navErr as Error).message?.slice(0, 60)}`);
                  }
                } else {
                  trace(`[ai-listing] already on hotel page: ${hotelUrl.slice(0, 80)}`);
                }
              } else {
                trace(`[ai-listing] no hotel tab or direct navigation detected after 2.4s — current URL: ${raw.url().slice(0, 80)}`);
              }
              return true;
            }
            return false;
          }
          if (bookingComContext) {
            if (!targetHotelName) {
              trace("[RPA] Booking.com listing: target hotel name could not be parsed from the task.");
              return false;
            }
            trace(`[RPA] Booking.com listing: clicking target "${targetHotelName}" via RPA.`);
            const clicked = await providerClickBookingComListingTarget(raw, targetHotelName, {
              normalizeText,
              normalizeLooseText,
              normalizeDigits,
              findVisibleField,
              fillLocator,
              evaluateLocatorElement: evaluateLocatorElementWithArg,
              waitForEvaluateCondition,
              safePressEscape,
              safeMouseClick,
              waitForPageSignals,
            }, trace);
            if (!clicked) {
              trace(`Booking.com listing: no clickable result matched "${targetHotelName}".`);

              // Fallback: navigate directly to the hotel detail page using a slug-derived URL.
              // The searchresults.html endpoint is often blocked by Booking.com's headless detection,
              // but individual hotel pages (booking.com/hotel/{cc}/{slug}.html) are not.
              const directUrl = buildBookingComDirectHotelUrl(targetHotelName, input.startUrl);
              if (directUrl) {
                trace(`Booking.com listing: trying direct hotel URL: ${directUrl}`);
                try {
                  await raw.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
                  await raw.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
                  const landedUrl = raw.url();
                  if (/booking\.com\/hotel\/[a-z]{2}\//.test(landedUrl)) {
                    trace(`Booking.com listing: direct hotel URL worked — on hotel page: ${landedUrl}`);
                    return true; // room_selection stage will handle this on the next iteration
                  }
                  trace(`Booking.com listing: direct hotel URL redirected to non-hotel page: ${landedUrl}`);
                } catch (err) {
                  trace(`Booking.com listing: direct hotel URL navigation failed: ${err}`);
                }
              }

              // Capture a debug screenshot so we can see what the page actually looked like
              // when the listing match failed (helps diagnose bot detection / empty results).
              try {
                const debugShot = await raw.screenshot({ type: "jpeg", quality: 40, timeout: 3000 });
                trace(`[debug-screenshot] data:image/jpeg;base64,${debugShot.toString("base64")}`);
              } catch { /* screenshot is best-effort */ }
              return false;
            }
            return true;
          }
          return false;
        }
        case "date_selection": {
          const clicked = await clickAllowedAdvanceButton(raw, DATE_SELECTION_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" to advance the date-selection gate.`);
            return true;
          }
          // Never run AI agent for date_selection on Booking.com —?it types in the search bar.
          if (bookingComContext) {
            trace("Booking.com date_selection: skipping AI agent to prevent search-bar interference.");
            return false;
          }
          trace("No deterministic date-selection advance button was found, so a stage-specific agent recovery pass is running.");
          await agent.execute({ instruction: coreBuildStageRecoveryInstruction(stage), maxSteps: 8 });
          return true;
        }
        case "room_selection": {
          // AI path: all non-Booking.com sites always use selectRoomAI.
          // Booking.com gets AI path when AI_LOOP_LISTING=true, otherwise uses RPA fallback.
          // selectRoomAI handles Expedia's two-click Reserve flow (Reserve → modal → Reserve).
          if (process.env.AI_LOOP_LISTING === "true" || !bookingComContext) {
            const result = await selectRoomAI(stagehand, trace, roomPreference);
            if (result === "no_availability") return false;

            // ── Hotels.com "Your payment options" modal ──────────────────────────────
            // After clicking Reserve, Hotels.com shows a modal with two options:
            //   • "Pay now" (Pay total now online)
            //   • "Pay at property" (Pay when you stay)
            // Neither is pre-selected. We must click "Pay now" to proceed to checkout.
            // This modal does NOT appear on Expedia or Booking.com.
            await new Promise(r => setTimeout(r, 1200)); // wait for modal to render
            const payNowClicked = await raw.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
              // First, check if this modal is present by looking for "pay at property" or "pay now" buttons
              const bodyText = (document.body.textContent ?? "").toLowerCase();
              const hasPaymentOptionsModal = bodyText.includes("pay at the property") || bodyText.includes("pay at property") || bodyText.includes("pay when you stay");
              if (!hasPaymentOptionsModal) return false;
              // Click "Pay now" button — avoid "Pay at property"
              const payNowBtn = buttons.find(btn => {
                const text = (btn.textContent ?? "").trim().toLowerCase();
                const r = btn.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return false;
                return text === "pay now" || text === "pay the total now";
              });
              if (payNowBtn) { payNowBtn.click(); return true; }
              return false;
            }).catch(() => false);
            if (payNowClicked) {
              trace(`[ai-room] Hotels.com payment options modal: clicked "Pay now"`);
              await new Promise(r => setTimeout(r, 1000));
            }
            // ── End payment options modal ────────────────────────────────────────────

            // Booking.com opens the checkout page in a new tab after "I'll reserve".
            // Wait briefly, then check if a checkout tab was opened.
            // If so, navigate raw to that URL (raw is const — can't reassign).
            await new Promise(r => setTimeout(r, 1500));
            try {
              const allPages = stagehand.context.pages();
              const checkoutEntry = allPages
                .map(p => ({ p, url: getScopeUrl(getRawPage(p)) }))
                .find(({ url }) => /secure\.booking\.com\/book/.test(url));
              if (checkoutEntry) {
                const checkoutUrl = checkoutEntry.url;
                // Close the extra tab Booking.com opened, then navigate raw to checkout URL
                try {
                  const checkoutRaw = getRawPage(checkoutEntry.p);
                  if (checkoutRaw && checkoutRaw !== raw) {
                    await checkoutRaw.close().catch(() => {});
                    trace(`[ai-room] closed extra checkout tab`);
                  }
                } catch { /* ignore */ }
                if (raw.url() !== checkoutUrl) {
                  trace(`[ai-room] checkout tab detected — navigating main page to: ${checkoutUrl.slice(0, 80)}`);
                  await raw.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
                  await raw.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
                } else {
                  trace(`[ai-room] already on checkout page: ${checkoutUrl.slice(0, 80)}`);
                }
              } else {
                // No new tab — Booking.com may have navigated the current page directly.
                // Check if we're already on the checkout URL; if so, nothing to do.
                const nowUrl = raw.url();
                if (/secure\.booking\.com\/book/.test(nowUrl)) {
                  trace(`[ai-room] already on checkout page (direct nav): ${nowUrl.slice(0, 80)}`);
                } else {
                  trace(`[ai-room] no checkout tab detected — current URL: ${nowUrl.slice(0, 80)}`);
                }
              }
            } catch (err) {
              trace(`[ai-room] post-click tab check failed: ${(err as Error).message?.slice(0, 60)}`);
            }
            return true;
          }
          // ── Booking.com RPA fallback: used when AI_LOOP_LISTING is disabled ──
          // Uses Playwright native selectOption() + JS click.
          if (bookingComContext) {
            try {
              trace("[RPA] Booking.com room_selection: using RPA selectOption + JS click.");
              const beforeUrl = raw.url();
              await providerRevealBookingComRoomSelection(raw, {
                normalizeText,
                normalizeLooseText,
                normalizeDigits,
                findVisibleField,
                fillLocator,
                evaluateLocatorElement: evaluateLocatorElementWithArg,
                waitForEvaluateCondition,
                safePressEscape,
                safeMouseClick,
                waitForPageSignals,
              }, trace);
              await raw.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))).catch(() => {});
              await new Promise((r) => setTimeout(r, 120));

              // Find all <select> elements that have 0/1/2... room quantity options.
              // Use Playwright's selectOption() which properly triggers React's onChange.
              const allSelects = raw.locator("select");
              const count = await allSelects.count().catch(() => 0);
              let selectedDropdown = false;

              // First pass: check if any dropdown is already > 0 (previously set)
              for (let i = 0; i < count; i++) {
                const sel = allSelects.nth(i);
                try {
                  const val = await sel.inputValue().catch(() => "");
                  const opts = await sel.evaluate((el: HTMLSelectElement) =>
                    Array.from(el.options).map(o => o.value)
                  ).catch(() => [] as string[]);
                  if (opts.includes("0") && opts.includes("1") && val !== "0") {
                    trace(`Booking.com: dropdown ${i} already set to ${val} —?skipping select step.`);
                    selectedDropdown = true;
                    break;
                  }
                } catch { /* skip */ }
              }

              // Second pass: find cheapest dropdown at "0" and set it to "1"
              if (!selectedDropdown) {
                // Collect price+index pairs to pick cheapest
                type DropInfo = { idx: number; price: number };
                const candidates: DropInfo[] = [];
                for (let i = 0; i < count; i++) {
                  const sel = allSelects.nth(i);
                  try {
                    const opts = await sel.evaluate((el: HTMLSelectElement) =>
                      Array.from(el.options).map(o => o.value)
                    ).catch(() => [] as string[]);
                    if (!opts.includes("0") || !opts.includes("1")) continue;
                    const val = await sel.inputValue().catch(() => "0");
                    if (val !== "0") continue;
                    // Try to get price from nearest ancestor row
                    const price = await sel.evaluate((el) => {
                      const row = el.closest("tr, [class*='room'], div");
                      const m = (row?.textContent ?? "").match(/\$\s*([\d,]+)/);
                      return m ? parseFloat(m[1].replace(",", "")) : Infinity;
                    }).catch(() => Infinity);
                    candidates.push({ idx: i, price });
                  } catch { /* skip */ }
                }
                candidates.sort((a, b) => a.price - b.price);

                for (const { idx } of candidates) {
                  try {
                    const sel = allSelects.nth(idx);
                    const scrollableSel = sel as typeof sel & {
                      scrollIntoViewIfNeeded?: () => Promise<unknown>;
                    };
                    if (typeof scrollableSel.scrollIntoViewIfNeeded === "function") {
                      await scrollableSel.scrollIntoViewIfNeeded().catch(() => {});
                    }
                    await sel.selectOption("1");
                    trace(`Booking.com: set room dropdown index ${idx} to "1" via selectOption().`);
                    selectedDropdown = true;
                    await Promise.allSettled([
                      waitForVisibleActionText(raw, ["I'll reserve", "I—檒l reserve", "I will reserve", "reserve now", "Reserve", "Show prices"], 3500),
                      raw.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {}),
                    ]);
                    break;
                  } catch (e) {
                    trace(`Booking.com: selectOption on dropdown ${idx} failed: ${e}`);
                  }
                }
              }

              if (!selectedDropdown) {
                const domSet = await providerSetBookingComRoomQuantity(raw);
                if (domSet.ok) {
                  selectedDropdown = true;
                  trace(`Booking.com: ${domSet.summary} via DOM strategy.`);
                  await Promise.allSettled([
                    waitForVisibleActionText(raw, ["I'll reserve", "I閳ユ獟l reserve", "I will reserve", "reserve now", "Reserve", "Show prices"], 3500),
                    raw.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {}),
                  ]);
                } else {
                  trace(`Booking.com: ${domSet.summary}.`);
                  trace("Booking.com: could not find or set any room quantity dropdown.");
                }
              }

              // Click "I'll reserve" —?use Playwright locator click (real mouse event),
              // falling back to JS click. Use /reserve/i to avoid apostrophe issues.
              await raw.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))).catch(() => {});
              await new Promise((r) => setTimeout(r, 120));

              const rawWithRole = raw as typeof raw & {
                getByRole?: (role: string, options?: { name?: RegExp | string }) => ReturnType<typeof raw.locator>;
              };
              if (!rawWithRole.getByRole) {
                rawWithRole.getByRole = () => raw.locator("__codex_missing_getByRole__");
              }

              for (let attempt = 0; attempt < 3; attempt++) {
                {
                  const expandedOffer = await raw.evaluate(() => {
                    const normalize = (value: string) =>
                      value.toLowerCase().replace(/\s+/g, " ").trim();
                    const isVisible = (element: Element | null): element is HTMLElement => {
                      if (!(element instanceof HTMLElement)) return false;
                      const style = window.getComputedStyle(element);
                      const rect = element.getBoundingClientRect();
                      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
                    };

                    const candidates = Array.from(
                      document.querySelectorAll("button, a, [role='button'], [role='tab']")
                    ).filter((element) => {
                      if (!isVisible(element)) return false;
                      const text = normalize(element.textContent ?? "");
                      return (
                        text === "show prices" ||
                        text === "view prices" ||
                        text === "see availability" ||
                        text === "check availability" ||
                        text === "info & prices"
                      );
                    }) as HTMLElement[];

                    const candidate = candidates.find((element) => {
                      const text = normalize(element.textContent ?? "");
                      return text === "show prices" || text === "view prices";
                    });

                    if (!candidate) return "";
                    candidate.scrollIntoView({ block: "center" });
                    candidate.click();
                    return normalize(candidate.textContent ?? "");
                  }).catch(() => "");

                  if (expandedOffer) {
                    trace(`Booking.com: clicked "${expandedOffer}" on attempt ${attempt + 1} to expand room pricing.`);
                    await Promise.allSettled([
                      raw.waitForLoadState("domcontentloaded", { timeout: 3000 }),
                      waitForVisibleActionText(raw, ["Reserve", "I'll reserve", "I—檒l reserve", "I will reserve", "reserve now", "Show prices"], 2500),
                    ]);
                  }
                }

                // Strategy 1: Playwright locator click (triggers all mouse events)
                let clicked = false;
                let clickedLabel = "";

                if (!clicked) {
                  clickedLabel = await raw.evaluate(() => {
                    const normalize = (value: string) =>
                      value.toLowerCase().replace(/\s+/g, " ").trim();
                    const isVisible = (element: Element | null): element is HTMLElement => {
                      if (!(element instanceof HTMLElement)) return false;
                      const style = window.getComputedStyle(element);
                      const rect = element.getBoundingClientRect();
                      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
                    };

                    const selectorCandidates = [
                      "button.js-reservation-button",
                      "button.book_now_button_handler",
                      ".hprt-reservation-cta button",
                      ".reserve-block-js button",
                    ];

                    const target = selectorCandidates
                      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
                      .find((element) => isVisible(element)) as HTMLElement | undefined;

                    if (!target) return "";
                    target.scrollIntoView({ block: "center" });
                    target.click();
                    const form = target.closest("form") as HTMLFormElement | null;
                    form?.requestSubmit?.();
                    return normalize(target.textContent ?? "");
                  }).catch(() => "");

                  clicked = Boolean(clickedLabel);
                  if (clicked) {
                    trace(`Booking.com: DOM-clicked "${clickedLabel}" on attempt ${attempt + 1}.`);
                  }
                }

                try {
                  const reserveCandidates = [
                    raw.locator("button.js-reservation-button").first(),
                    raw.locator("button.book_now_button_handler").first(),
                    raw.locator(".hprt-reservation-cta button").first(),
                    raw.locator(".reserve-block-js button").first(),
                    raw.locator("button:has-text(\"Show prices\")").first(),
                    raw.locator("a:has-text(\"Show prices\")").first(),
                    raw.locator("button:has-text(\"I'll reserve\")").first(),
                    raw.locator("button:has-text(\"I—檒l reserve\")").first(),
                    raw.locator("button:has-text(\"I will reserve\")").first(),
                    raw.locator("button:has-text(\"reserve now\")").first(),
                    raw.locator("button:has-text(\"绔嬪嵆棰勮\")").first(),
                    raw.getByRole("button", { name: /show prices|i.?ll reserve|i will reserve|reserve now/i }).first(),
                    raw.getByRole("link", { name: /show prices/i }).first(),
                  ];
                  for (const reserveLocator of reserveCandidates) {
                    if (!await reserveLocator.isVisible({ timeout: 1200 }).catch(() => false)) continue;
                    const scrollableReserveLocator = reserveLocator as typeof reserveLocator & {
                      scrollIntoViewIfNeeded?: () => Promise<unknown>;
                    };
                    if (typeof scrollableReserveLocator.scrollIntoViewIfNeeded === "function") {
                      await scrollableReserveLocator.scrollIntoViewIfNeeded().catch(() => {});
                    }
                    await new Promise((r) => setTimeout(r, 80));
                    clickedLabel = await reserveLocator.textContent().catch(() => "") ?? "";
                    await reserveLocator.click({ force: true, timeout: 5000 });
                    clicked = true;
                    trace(`Booking.com: Playwright-clicked "${clickedLabel.replace(/\s+/g, " ").trim() || "booking CTA"}" on attempt ${attempt + 1}.`);
                    break;
                  }
                } catch (e) {
                  trace(`Booking.com: Playwright click failed on attempt ${attempt + 1}: ${e}`);
                }

                // Strategy 2: JS click fallback
                if (!clicked) {
                  clickedLabel = await raw.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll("button, a, [role='button'], [role='tab']"));
                    const normalize = (value: string) =>
                      value.toLowerCase().replace(/\s+/g, " ").trim();
                    const isVisible = (element: Element | null): element is HTMLElement => {
                      if (!(element instanceof HTMLElement)) return false;
                      const style = window.getComputedStyle(element);
                      const rect = element.getBoundingClientRect();
                      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
                    };
                    const visibleButtons = btns.filter((button) => isVisible(button));
                    const btn =
                      visibleButtons.find((b) => {
                        const text = normalize(b.textContent ?? "");
                        return text === "show prices" || text === "view prices";
                      }) ??
                      visibleButtons.find((b) => {
                        const text = normalize(b.textContent ?? "");
                        const rect = (b as HTMLElement).getBoundingClientRect();
                        const onRightSide = rect.left >= window.innerWidth * 0.55;
                        return (
                          onRightSide &&
                          (
                          text === "reserve" ||
                          text.includes("i'll reserve") ||
                          text.includes("i—檒l reserve") ||
                          text.includes("i will reserve") ||
                          text.includes("reserve now") ||
                          text.includes("绔嬪嵆棰勮")
                          )
                        );
                      }) ??
                      visibleButtons.find((b) => {
                        const text = normalize(b.textContent ?? "");
                        return (
                          text.includes("i'll reserve") ||
                          text.includes("i—檒l reserve") ||
                          text.includes("i will reserve") ||
                          text.includes("reserve now") ||
                          text.includes("show prices") ||
                          text.includes("绔嬪嵆棰勮")
                        );
                      });
                    if (!btn) return "";
                    btn.scrollIntoView({ block: "center" });
                    btn.click();
                    return normalize(btn.textContent ?? "");
                  }).catch(() => "");
                  clicked = Boolean(clickedLabel);
                  if (clicked) trace(`Booking.com: JS-clicked "${clickedLabel}" on attempt ${attempt + 1}.`);
                }

                if (clicked) {
                  await Promise.allSettled([
                    raw.waitForLoadState("domcontentloaded", { timeout: 5000 }),
                    waitForPageSignals(raw, {
                      fromUrl: beforeUrl,
                      untilUrlIncludes: ["secure.booking.com/book", "booking.com/book"],
                      untilTextIncludes: [
                        "enter your details",
                        "your details",
                        "phone number",
                        "your arrival time",
                      ],
                      timeoutMs: 8000,
                    }),
                  ]);
                  break;
                }
                trace(`Booking.com: reserve button not found on attempt ${attempt + 1}, waiting...`);
                await new Promise((r) => setTimeout(r, 250));
              }

              // Booking.com opens the checkout page in a new tab after "I'll reserve".
              // Scan all context pages and navigate raw to the checkout URL if found.
              await new Promise(r => setTimeout(r, 1500));
              try {
                const allPages = stagehand.context.pages();
                const checkoutEntry = allPages
                  .map(p => ({ p, url: getScopeUrl(getRawPage(p)) }))
                  .find(({ url }) => /secure\.booking\.com\/book/.test(url));
                if (checkoutEntry) {
                  const checkoutUrl = checkoutEntry.url;
                  if (raw.url() !== checkoutUrl) {
                    // Close the extra checkout tab before navigating raw to it.
                    const checkoutRaw = getRawPage(checkoutEntry.p);
                    if (checkoutRaw !== raw) {
                      await checkoutRaw.close().catch(() => {});
                    }
                    trace(`[RPA-room] checkout tab detected — navigating main page to: ${checkoutUrl.slice(0, 80)}`);
                    await raw.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
                    await raw.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
                  } else {
                    trace(`[RPA-room] already on checkout page`);
                  }
                } else {
                  trace(`[RPA-room] no checkout tab found — current URL: ${raw.url().slice(0, 80)}`);
                }
              } catch (tabErr) {
                trace(`[RPA-room] tab check failed: ${(tabErr as Error).message?.slice(0, 60)}`);
              }

              return true; // Always return true — never let AI agent handle this on Booking.com
            } catch (e) {
              trace(`Booking.com room selection failed: ${e}`);
              return true; // Still return true to prevent AI agent from taking over
            }
          }

          // Non-Booking.com: try deterministic button click first, then AI agent
          const clicked = await clickAllowedAdvanceButton(raw, ROOM_SELECTION_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" on the room-selection stage.`);
            return true;
          }
          if (bookingComContext) {
            trace("Booking.com room_selection: deterministic controls were not enough, and agent.execute fallback is disabled.");
            return false;
          }
          trace("No deterministic room-selection advance button was found, so a stage-specific agent recovery pass is running.");
          const tr0 = Date.now();
          const rResult = await agent.execute({
            instruction: coreBuildStageRecoveryInstruction(stage),
            maxSteps: 10,
          } as Parameters<typeof agent.execute>[0]) as AgentExecutionResult;
          trace(`Room-selection recovery finished in ${((Date.now() - tr0) / 1000).toFixed(1)}s —?"${(rResult.message ?? "").slice(0, 80)}"`);
          return true;
        }
        case "intermediate_gate": {
          const checkedBoxes = await clickAgreementCheckboxes(raw);
          trace(
            checkedBoxes > 0
              ? `Stage recovery checked ${checkedBoxes} consent/privacy checkbox(es) inside the booking widget.`
              : "Stage recovery did not find a new consent/privacy checkbox to check inside the booking widget."
          );
          // Wait for React state to propagate after checkbox check —?the "Book Now"
          // button is often disabled until the privacy checkbox is ticked, so clicking
          // it immediately after check() returns will find it still disabled.
          await new Promise((resolve) => setTimeout(resolve, 700));
          let clicked = await clickAllowedAdvanceButton(raw, INTERMEDIATE_GATE_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" on the intermediate booking gate.`);
            return true;
          }
          // Retry once with a force-click that bypasses the isLocatorEnabled guard,
          // in case the button's disabled attribute was removed but not yet reflected.
          clicked = await clickAdvanceButton(raw, INTERMEDIATE_GATE_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery force-clicked "${clicked}" on the intermediate booking gate (retry).`);
            return true;
          }
          if (bookingComContext) {
            trace("Booking.com intermediate_gate: deterministic controls were not enough, and agent.execute fallback is disabled.");
            return false;
          }
          trace("No deterministic intermediate booking button was found, so a stage-specific agent recovery pass is running.");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await agent.execute({ instruction: coreBuildStageRecoveryInstruction(stage), maxSteps: 8 } as any);
          return true;
        }
        default:
          return false;
      }
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      trace(`Stage assessment ${attempt + 1}: ${assessment.stage} —?${assessment.reason}`);

      // ── Restaurant platforms: no-results early exit ──────────────────────────
      // Runs regardless of stage (even "unknown") so we catch "didn't find" pages.
      const isRestaurantPlatform = startProvider?.id === "opentable-com" || startProvider?.id === "resy-com" || startProvider?.id === "yelp-com";
      if (startProvider?.id === "resy-com") {
        const resyNoResultsOuter = await raw.evaluate(() => {
          const text = (document.body?.innerText ?? "").toLowerCase();
          return text.includes("no results") || text.includes("no restaurants") || text.includes("nothing here") ||
                 (text.includes("didn't find") && text.includes("match"));
        }).catch(() => false);
        if (resyNoResultsOuter) {
          const label = targetHotelName ?? "This restaurant";
          trace(`[resy] "${label}" not found on Resy — no_availability`);
          const ss = await raw.screenshot({ type: "png" }).then(b => `data:image/png;base64,${b.toString("base64")}`).catch(() => undefined);
          return { status: "no_availability" as const, screenshotBase64: ss, handoffUrl: `https://resy.com/`, sessionUrl,
            summary: `"${label}" was not found on Resy. The restaurant may not accept reservations through Resy.`, debugTrace };
        }
      }
      // ── OpenTable: no-results early exit ─────────────────────────────────────
      void isRestaurantPlatform; // suppress unused warning
      if (startProvider?.id === "opentable-com") {
        const otNoResults = await raw.evaluate(() => {
          const text = (document.body?.innerText ?? "").toLowerCase();
          return (
            text.includes("we didn't find a match") ||
            text.includes("no results found") ||
            text.includes("couldn't find") ||
            text.includes("no restaurants found") ||
            (text.includes("didn't find") && text.includes("match"))
          );
        }).catch(() => false);
        if (otNoResults) {
          const label = targetHotelName ?? "This restaurant";
          trace(`[opentable] "${label}" not found on OpenTable — returning no_availability`);
          const noResultsScreenshot = await raw.screenshot({ type: "png" })
            .then(b => `data:image/png;base64,${b.toString("base64")}`)
            .catch(() => undefined);
          return {
            status: "no_availability" as const,
            screenshotBase64: noResultsScreenshot,
            handoffUrl: `https://www.opentable.com/s?term=${encodeURIComponent(label)}`,
            sessionUrl,
            summary: `"${label}" was not found on OpenTable. The restaurant may not be listed or the name may be slightly different. Try searching OpenTable directly.`,
            debugTrace,
          };
        }
      }

      // Provider drift guard runs BEFORE the stage break so it catches cases where the AI
      // executed multiple steps and advanced all the way to checkout_form / payment_gate on
      // the WRONG domain (e.g. Hotels.com AI navigated to hilton.com payment page in one pass).
      // Provider drift guard: if we've left the start provider's domain (e.g. Expedia → IHG hotel site),
      // navigate back to startUrl so the flow stays within the expected booking site.
      if (startProvider && !startProvider.matchesUrl(currentUrl) && !startProvider.matchesUrl(raw.url())) {
        // Check whether the current URL looks like a legitimate hotel booking redirect.
        // Rules differ by provider:
        //   Hotels.com: only expedia.com/checkout is a legitimate redirect (payment step).
        //               Any other brand site (Hilton, Marriott, etc.) must be rejected.
        //   Expedia:    allows brand-site redirects for certain hotels (IHG, Marriott, etc.)
        //               when the URL looks like a booking/checkout/payment page.
        const redirectUrl = raw.url().toLowerCase();
        let isLegitimateBookingRedirect: boolean;
        if (startProvider.id === "hotels-com") {
          // Hotels.com only legitimately redirects to expedia.com/checkout for payment.
          isLegitimateBookingRedirect =
            redirectUrl.includes("expedia.com") && redirectUrl.includes("/checkout");
        } else {
          // Generic rule for Expedia and other OTAs: allow brand-site booking pages.
          isLegitimateBookingRedirect =
            /select.?room.?rate|roomrate|\/reservation|\/book|\/checkout|\/payment/i.test(redirectUrl) ||
            assessment.stage === "checkout_form" ||
            assessment.stage === "payment_gate";
        }

        if (isLegitimateBookingRedirect) {
          trace(`[provider-guard] on external brand site but looks like a booking page — allowing redirect (${raw.url().slice(0, 80)})`);
        } else {
          trace(`[provider-guard] drifted away from ${startProvider.id} to ${raw.url().slice(0, 80)} — navigating back to startUrl`);
          try {
            await raw.goto(input.startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
            await raw.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          } catch (navErr) {
            trace(`[provider-guard] navigation back failed: ${(navErr as Error).message?.slice(0, 60)}`);
          }
          assessment = await assessBookingStage({ rawPage: raw, stagehand, startUrl: input.startUrl, requestedDates, agentMessage });
          pageText = assessment.pageText;
          currentUrl = assessment.currentUrl;
        }
      }

      // After drift guard has had a chance to navigate back, check if the stage is still
      // an early stage that needs recovery. If we're at checkout_form / payment_gate (on
      // the correct domain after navigating back), exit the loop and let the main flow continue.
      if (!["listing", "date_selection", "room_selection", "intermediate_gate"].includes(assessment.stage)) {
        break;
      }

      // Definitive no-availability: page text signals unavailability AND no Reserve buttons visible.
      // We do NOT abort on text signals alone — Expedia hotel overview pages often contain
      // "no availability" in widgets/sidebars even when rooms are bookable (false positive).
      if (assessment.stage === "room_selection" &&
          containsAny(assessment.pageText, NO_AVAILABILITY_SIGNALS)) {
        const hasReserveButton = await raw.evaluate(() => {
          const pattern = /reserve|book now|i.?ll reserve|select room|view prices/i;
          return Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
            .some(el => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && pattern.test((el.textContent ?? "").trim());
            });
        }).catch(() => false);
        if (!hasReserveButton) {
          trace(`No-availability signal detected at room_selection with no Reserve buttons — aborting.`);
          break;
        }
        trace(`No-availability text found but Reserve buttons exist — continuing to attempt room selection.`);
      }

      const acted = await attemptStageRecovery(assessment.stage);
      if (!acted) break;

      const postActionWaitMs =
        !!(getProvider(currentUrl) ?? getProvider(raw.url()) ?? (bookingComPageOpen ? getProvider(input.startUrl) : null))
          ? 350
          : 2500;
      await new Promise((resolve) => setTimeout(resolve, postActionWaitMs));
      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      pageText = assessment.pageText;
      currentUrl = assessment.currentUrl;
    }

    // Post-loop drift guard: the for-loop may have exited (attempt limit or !acted) while the
    // browser is on the wrong domain (e.g. Hotels.com AI went to hilton.com on the last attempt).
    // Navigate back to startUrl so downstream checkout / payment logic runs on the correct site.
    if (startProvider && !startProvider.matchesUrl(raw.url())) {
      const redirectUrl = raw.url().toLowerCase();
      const isLegitimatePostLoopRedirect = startProvider.id === "hotels-com"
        ? (redirectUrl.includes("expedia.com") && redirectUrl.includes("/checkout"))
        : /\/checkout|\/payment|\/book/i.test(redirectUrl) ||
          assessment.stage === "checkout_form" ||
          assessment.stage === "payment_gate";
      if (!isLegitimatePostLoopRedirect) {
        trace(`[provider-guard] post-loop: on wrong domain (${raw.url().slice(0, 80)}) — navigating back`);
        try {
          await raw.goto(input.startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
          await raw.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        } catch { /* ignore nav errors */ }
        assessment = await assessBookingStage({ rawPage: raw, stagehand, startUrl: input.startUrl, requestedDates, agentMessage });
        pageText = assessment.pageText;
        currentUrl = assessment.currentUrl;
      }
    }

    // 鈹€鈹€ Unknown stage: agent may have stopped mid-flow (maxSteps exhausted) 鈹€鈹€
    // If the stage is unknown after the main run (no recognisable page signals),
    // run one more agent pass to continue from wherever it left off.
    // EXCEPTION: Never run continuation agent on Booking.com —?it always types in
    // the search bar and navigates to the wrong hotel.
    if (
      assessment.stage === "unknown" &&
      !(getProvider(currentUrl) ?? getProvider(raw.url()) ?? (bookingComPageOpen ? getProvider(input.startUrl) : null))
    ) {
      trace("Stage is unknown after main run —?running a continuation pass (maxSteps=20).");
      const continuationInstruction =
        `You are continuing a hotel booking that was interrupted mid-flow. ` +
        `The target hotel URL is: ${input.startUrl}. ` +
        `Look at the current state of the browser and continue the booking process from where it left off. ` +
        `Your goal is to reach the payment/checkout page filled with the guest's information. ` +
        `Do NOT submit or pay —?stop just before the final payment button.`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contResult = await agent.execute({ instruction: continuationInstruction, maxSteps: 20 }) as any;
      const contMsg: string = contResult?.message ?? contResult?.output ?? "";
      trace(`Continuation pass finished —?message: "${contMsg.slice(0, 120)}"`);
      // Update agentMessage so all downstream checks (hitPaymentGate, field verification) see the latest message.
      if (contMsg) agentMessage = contMsg;
      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage: contMsg || agentMessage,
      });
      pageText = assessment.pageText;
      currentUrl = assessment.currentUrl;
      trace(`Post-continuation stage: ${assessment.stage} —?${assessment.reason}`);
    }

    // ── AI directly classified the page as no_availability ────────────────
    // The AI stage-detector emits "no_availability" when it sees pages like
    // OpenTable's "Permanently Closed" panel where it can't even tell whether
    // a listing exists. mapAIStageToRPA forwards this through (was: dropped to
    // unknown). Early-exit instead of running a continuation pass — the venue
    // is definitively not bookable and continuing wastes 20+ seconds.
    if (assessment.stage === "no_availability") {
      trace("Stage assessment determined the venue is not bookable — early exit.");
      const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
      return {
        status: "no_availability",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: assessment.reason,
        debugTrace,
        ...(capturedAvailableSlots.length > 0 ? { availableSlots: capturedAvailableSlots } : {}),
      };
    }

    // 鈹€鈹€ Detect stuck at listing/search page 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // Signs that we are still on the hotel listing / search page and never
    // reached a real booking or checkout step.
    if (assessment.stage === "listing") {
      trace("Final state check concluded the run was still on a listing/date-selection page.");
      const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;

      // Distinguish "hotel sold out / not in results" from generic listing stuck.
      // The trace logs from clickBookingComListingTarget use these specific phrases:
      //   - "hotel unavailable for selected dates (no search results)" → zero hotel cards on page
      //   - "page has hotels but none matched" → other hotels present, ours isn't
      // We also check the page text for explicit no-availability signals.
      const lowerPageText = pageText.toLowerCase();
      const noAvailabilityInText = NO_AVAILABILITY_SIGNALS.some((sig) => lowerPageText.includes(sig));
      const hotelNotInResults = debugTrace?.some((line) =>
        line.includes("hotel unavailable for selected dates") ||
        line.includes("page has hotels but none matched")
      ) ?? false;

      if (noAvailabilityInText || hotelNotInResults) {
        const hotelLabel = targetHotelName ?? "This property";
        trace(`Listing failure classified as no_availability: noAvailabilityInText=${noAvailabilityInText}, hotelNotInResults=${hotelNotInResults}`);
        return {
          status: "no_availability",
          screenshotBase64,
          handoffUrl: currentUrl,
          sessionUrl,
          summary: `${hotelLabel} was not found in Booking.com search results — the property may be unavailable or sold out for the requested dates.`,
          debugTrace,
          ...(capturedAvailableSlots.length > 0 ? { availableSlots: capturedAvailableSlots } : {}),
        };
      }

      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The requested dates are unavailable or couldn't be selected on this property. Open the link to choose different dates or book manually.",
        error: "Stuck at listing page — dates unavailable or not selectable",
        debugTrace,
        ...(capturedAvailableSlots.length > 0 ? { availableSlots: capturedAvailableSlots } : {}),
      };
    }

    // 鈹€鈹€ Direct form-fill fallback 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // If the agent landed on a guest info / checkout form but left fields empty
    // (e.g. because reCAPTCHA console errors confused it), fill them directly
    // using page.act() —?lower-level than the agent and not blocked by reCAPTCHA.
    const visibleCheckoutFields = assessment.visibleCheckoutFields;
    // For Booking.com's checkout URL (Step 2 + Step 3), always treat as guest form
    // regardless of visibleCheckoutFields —?the step 2 form fields may not be detected
    // by the generic hasVisibleCheckoutFields heuristic.
    // NOTE: Use raw.url() and input.startUrl in addition to currentUrl because
    // resolveCurrentUrl() can pick a non-booking.com iframe URL (analytics/tracking),
    // which would make isBookingCom=false and trigger fillFieldsInScopes incorrectly.
    const rawPageUrl = raw.url();
    const isBookingComCheckout =
      currentUrl.includes("secure.booking.com") || currentUrl.includes("booking.com/book") ||
      rawPageUrl.includes("secure.booking.com") || rawPageUrl.includes("booking.com/book");
    const onGuestForm =
      hasProfile &&
      assessment.stage !== "intermediate_gate" &&
      (visibleCheckoutFields || isBookingComCheckout);

    trace(`Post-recovery state: stage=${assessment.stage}, visibleCheckoutFields=${visibleCheckoutFields}, hasProfile=${hasProfile}, onGuestForm=${onGuestForm}, isBookingComCheckout=${isBookingComCheckout}, rawPageUrl=${rawPageUrl.slice(0, 80)}, currentUrl=${currentUrl.slice(0, 80)}`);

    if (onGuestForm) {
      trace("Detected guest/payment form and started direct field-fill verification.");

      // 鈹€鈹€ Booking.com: always run programmatic fill regardless of pre-filled state 鈹€鈹€
      // The account often pre-fills wrong values (wrong name order, wrong country/phone code).
      // We must override these with the correct profile values every time.
      // Use input.startUrl as the authoritative Booking.com check —?currentUrl may be a
      // non-booking.com URL resolved from an analytics/tracking iframe by resolveCurrentUrl().
      const provider = getProvider(currentUrl) ?? getProvider(rawPageUrl) ?? (bookingComPageOpen ? getProvider(input.startUrl) : null);
      if (provider && assessment.stage === "checkout_form") {
        // Dismiss any modals that appeared after navigation (e.g. Expedia "This booking is almost yours!")
        const preFormDismissed = await dismissBlockingModals(raw).catch(() => "");
        if (preFormDismissed) trace(`[RPA] Dismissed checkout modal(s) before form fill: ${preFormDismissed}`);

        if (process.env.AI_LOOP_FORM_FILL === "true") {
          // Providers can override AI form fill with a deterministic implementation.
          // Expedia/Hotels.com use this to avoid browser autocomplete mis-filling fields.
          if (provider.fillGuestForm) {
            trace("[RPA] Provider has fillGuestForm override — using programmatic fill instead of AI.");
            const enrichedHelpers = { ...bookingComHelpers, stagehand, rawPage: raw, autonomy: input.autonomySettings };
            await provider.fillGuestForm(raw, p, enrichedHelpers, trace);
            await new Promise(r => setTimeout(r, 600));
          } else {
          trace("Booking.com guest form — AI fill mode (AI_LOOP_FORM_FILL=true).");

          // Detect if address fields are present before filling — some Booking.com properties
          // (e.g. NYC hotels with resort fees/deposit) require address/city at checkout.
          // Only include address in AI fill when the form actually has those fields to avoid
          // mis-filling the "Special requests" textarea (which happened before this check).
          const formHasAddressFields = await raw.evaluate(() =>
            !!document.querySelector(
              'input[name="address1"], input[id*="address1"], ' +
              'input[autocomplete="street-address"], input[autocomplete="address-line1"]'
            )
          ).catch(() => false);

          await fillGuestFormWithAI(stagehand, p, trace, { includeAddress: formHasAddressFields });
          await new Promise(r => setTimeout(r, 600));

          // Supplement: directly fill phone via JS native setter if AI missed it.
          // Booking.com phone has a country-code <select> + digits-only input combo.
          // stagehand.act() sometimes fills the wrong element. We identify the real
          // phone number input by skipping elements that look like country-code selectors
          // (maxLength ≤ 4 or current value starts with '+' and is ≤ 4 chars).
          if (p.phone) {
            const digitsOnly = p.phone.replace(/\D/g, "");
            const phoneFilled = await raw.evaluate((digits) => {
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              const candidates = Array.from(
                document.querySelectorAll<HTMLInputElement>(
                  'input[type="tel"], input[autocomplete="tel"], ' +
                  'input[name*="phone" i], input[id*="phone" i]'
                )
              );
              const tel = candidates.find(el => {
                if (!el.offsetParent) return false; // not visible / detached
                const val = el.value.trim();
                const max = el.maxLength;
                // Skip country-code inputs (short max-length or '+N' value)
                if (max > 0 && max <= 5) return false;
                if (val.startsWith("+") && val.length <= 5) return false;
                return true;
              });
              if (!tel || tel.value) return false; // already filled — skip
              nativeSetter?.call(tel, digits);
              tel.dispatchEvent(new Event("input",  { bubbles: true }));
              tel.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }, digitsOnly).catch(() => false);
            if (phoneFilled) trace(`[fill-form] phone filled via JS native setter (digits: ${digitsOnly})`);
            else trace("[fill-form] phone JS fallback: input already filled or not found");
          }

          // Supplement: directly fill address/city/zip via JS native setter if present and empty.
          // AI fill may not fill these reliably due to Stagehand schema issues on custom inputs.
          if (formHasAddressFields && (p.address_line1 || p.city || p.zip)) {
            const addrFilled = await raw.evaluate(({ addr, city, zip }) => {
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              let count = 0;
              const fillEmpty = (sel: string, val: string) => {
                if (!val) return;
                const el = document.querySelector<HTMLInputElement>(sel);
                if (!el || el.value) return; // skip if already filled
                nativeSetter?.call(el, val);
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                count++;
              };
              fillEmpty('input[name="address1"], input[id*="address1"]', addr);
              fillEmpty('input[name="city"], input[id*="city"]', city);
              fillEmpty('input[name="zip"], input[id*="zip"], input[id*="postalCode"]', zip);
              return count;
            }, {
              addr: p.address_line1 ?? "",
              city: p.city ?? "",
              zip: p.zip ?? "",
            }).catch(() => 0);
            if (addrFilled > 0) trace(`[fill-form] filled ${addrFilled} address field(s) via JS native setter`);
          }

          // Form audit: scan DOM for any text fields still empty, targeted re-fill via AI.
          // This catches fields the initial AI pass missed (wrong element, schema error,
          // element appeared after a React re-render, etc.).
          // Runs after all JS fallbacks so it only touches genuinely empty fields.
          await auditAndRefillEmptyFields(stagehand, raw, p, trace);
          await new Promise(r => setTimeout(r, 400));

          // React controlled inputs: stagehand.act() uses locator.fill() which sets the DOM
          // value but doesn't fire React's synthetic events. The submit button stays disabled
          // until React re-validates. Fire nativeSetter + input/change events on every visible
          // input so React picks up the values and enables the submit button.
          const reactFlushed = await raw.evaluate(() => {
            const nativeInputSetter    = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,   "value")?.set;
            const nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            const nativeSelectSetter   = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,   "value")?.set;
            let count = 0;
            // Flush text inputs and textareas
            document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='hidden']), textarea").forEach(el => {
              const val = el.value;
              if (!val) return;
              if (el instanceof HTMLInputElement && nativeInputSetter)     nativeInputSetter.call(el, val);
              if (el instanceof HTMLTextAreaElement && nativeTextareaSetter) nativeTextareaSetter.call(el, val);
              el.dispatchEvent(new Event("input",  { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              count++;
            });
            // Also flush <select> dropdowns (e.g. country) — omitting these was
            // causing React form validation to fail because the country select's
            // React state never got updated after stagehand.act() set its value.
            document.querySelectorAll<HTMLSelectElement>("select").forEach(el => {
              const val = el.value;
              if (!val || val === "0" || val === "") return;
              if (nativeSelectSetter) nativeSelectSetter.call(el, val);
              el.dispatchEvent(new Event("input",  { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              count++;
            });
            return count;
          }).catch(() => 0);
          trace(`[fill-form] flushed React events on ${reactFlushed} field(s) (inputs + selects)`);
          await new Promise(r => setTimeout(r, 400));

          // Click the advance button — React should now have the form as valid
          try {
            await stagehand.act(
              'Click the "Next: Final details" or "Continue" or "Save and continue" button to proceed to the next step'
            );
            trace("[fill-form] clicked advance button after guest form fill");
            await new Promise(r => setTimeout(r, 1500));
          } catch (err) {
            trace(`[fill-form] advance button click failed: ${(err as Error).message?.slice(0, 80)}`);
          }
          // Check if we actually advanced — if still on guest-details, try a direct RPA button click
          // (AI filled fields are already present — no need to re-fill, just advance)
          const postAISignals = await provider?.getStageSignals(raw, raw.url(), await raw.evaluate(() => document.body.innerText).catch(() => ""));
          if (postAISignals?.guestDetailsStep && !postAISignals?.paymentStep) {
            trace("[RPA] AI advance did not navigate — trying direct RPA click on 'Next: Final details'.");
            // Blur active element first so submit isn't blocked by a focused field
            await raw.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.()).catch(() => {});
            const nextClicked = await raw.evaluate(() => {
              const pattern = /next.*final\s*details|next.*detail|continue/i;
              const isVisible = (el: Element | null): el is HTMLElement => {
                if (!(el instanceof HTMLElement)) return false;
                const s = window.getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
              };
              const btn = Array.from(document.querySelectorAll("button, a, [role='button']"))
                .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim())) as HTMLElement | undefined;
              if (!btn) return false;
              btn.scrollIntoView({ block: "center" });
              btn.click();
              (btn.closest("form") as HTMLFormElement | null)?.requestSubmit?.();
              return true;
            }).catch(() => false);

            if (nextClicked) {
              trace("[RPA] clicked 'Next: Final details' via direct DOM click.");
              await new Promise(r => setTimeout(r, 2000));
            }

            // Check again — if we're STILL on guest-details, run full RPA fill as last resort.
            // The AI fill may have missed the country <select> (React state not updated).
            // providerFillBookingComGuestForm uses Playwright selectOption() which properly
            // updates React state and re-enables the submit button.
            const stillOnGuestDetails = await provider?.getStageSignals(raw, raw.url(), await raw.evaluate(() => document.body.innerText).catch(() => ""))
              .then(s => !!(s?.guestDetailsStep && !s?.paymentStep))
              .catch(() => false);
            if (stillOnGuestDetails) {
              trace("[RPA] still on guest-details after DOM click — running full RPA fill as last resort.");
              // provider.fillGuestForm is not available in this branch (else = no override)
              // so just re-run AI fill as last resort is not needed; advance was already attempted.
              await new Promise(r => setTimeout(r, 800));
            }
          }
          } // end else (AI fill — no provider.fillGuestForm override)
        } else {
          trace("[RPA] Provider guest form — running programmatic field fill (overrides account pre-fill).");
          await provider?.fillGuestForm?.(raw, p, { ...bookingComHelpers, autonomy: input.autonomySettings }, trace);
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (provider && assessment.stage === "payment_gate") {
        trace("[RPA] Provider payment page — running card-field fill.");
        await provider?.fillPaymentForm?.(raw, p, bookingComHelpers, trace);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (provider && !["checkout_form", "payment_gate"].includes(assessment.stage)) {
        trace(`Provider checkout is open at stage=${assessment.stage}; skipping guest-form override until stage is clearer.`);
      }

      // Check whether the form is already filled (profile email visible in input values)
      let alreadyFilled = false;
      if (p.email) {
        alreadyFilled = await hasValueInScopes(raw, p.email);
      }

      if (!alreadyFilled && !provider) {
        // Dismiss any late-appearing modals (e.g. site nudge overlays) before filling
        const preGenericFormDismissed = await dismissBlockingModals(raw).catch(() => "");
        if (preGenericFormDismissed) trace(`[RPA] Dismissed modal(s) before generic form fill: ${preGenericFormDismissed}`);

        if (process.env.AI_LOOP_FORM_FILL === "true") {
          trace("Guest/payment fields — AI fill mode (AI_LOOP_FORM_FILL=true).");
          await fillGuestFormWithAI(stagehand, p, trace);
        } else {
          trace("[RPA] Guest/payment fields — running direct Playwright fill fallback.");
          // Use RAW Playwright fill() — bypasses Stagehand AI and reCAPTCHA DOM interference.
          // Try matching each field by placeholder text, then by accessible label name.
          const specs: FieldSpec[] = [
            { patterns: ["full name"], value: p.full_name ?? "" },
            { patterns: ["first name", "given name", "firstname"], value: p.first_name ?? "" },
            { patterns: ["last name", "family name", "surname", "lastname"], value: p.last_name ?? "" },
            { patterns: ["phone", "mobile", "telephone"], value: p.phone ?? "" },
            { patterns: ["email", "e-mail"], value: p.email ?? "" },
            { patterns: ["street address", "address line 1", "address 1", "billing address"], value: p.address_line1 ?? "" },
            { patterns: ["city"], value: p.city ?? "" },
            { patterns: ["state", "province"], value: p.state ?? "" },
            { patterns: ["zip", "postal code", "postcode"], value: p.zip ?? "" },
            { patterns: ["country"], value: p.country ?? "" },
            { patterns: ["name on card", "cardholder", "card holder"], value: p.card_name ?? "" },
            { patterns: ["card number", "credit card number"], value: p.card_number ?? "" },
            { patterns: ["expir", "expiry", "mm/yy", "mm / yy"], value: p.card_expiry ?? "" },
          ].filter(s => s.value);

          await fillFieldsInScopes(raw, specs);
        }

        // Small pause so the page can react to filled values (React state updates etc.)
        await new Promise(r => setTimeout(r, 800));

        // Re-read page state after direct fill
        assessment = await assessBookingStage({
          rawPage: raw,
          stagehand,
          startUrl: input.startUrl,
          requestedDates,
          agentMessage,
        });
        currentUrl = assessment.currentUrl;
        pageText = assessment.pageText;
      } else if (!provider) {
        trace("Guest/payment fields already contained profile data, so direct fill fallback was skipped.");
      }

      // Re-read state after any fills
      if (provider) {
        assessment = await assessBookingStage({
          rawPage: raw,
          stagehand,
          startUrl: input.startUrl,
          requestedDates,
          agentMessage,
        });
        currentUrl = assessment.currentUrl;
        pageText = assessment.pageText;
      }
    }

    // Independent payment_gate handler — runs even when visibleCheckoutFields=false.
    // Ticketmaster's card form lives in payments.ticketmaster.com cross-origin iframe,
    // so main-frame DOM queries find no inputs and onGuestForm stays false. The provider
    // is responsible for iframe traversal, so we trust it and call fillPaymentForm here.
    if (!onGuestForm && assessment.stage === "payment_gate") {
      const paymentProvider = getProvider(currentUrl) ?? getProvider(raw.url());
      if (paymentProvider?.fillPaymentForm) {
        trace("[RPA] Payment gate detected outside onGuestForm — running provider fillPaymentForm.");
        await paymentProvider.fillPaymentForm(raw, p, bookingComHelpers, trace);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    const activeProvider = getProvider(currentUrl) ?? getProvider(raw.url()) ?? (bookingComPageOpen ? getProvider(input.startUrl) : null);
    let providerSignals = activeProvider ? await activeProvider.getStageSignals(raw, currentUrl, pageText) : null;
    let bookingComFinalPaymentDomState = providerSignals?.paymentStep ?? false;
    let bookingComGuestDetailsDomState = providerSignals?.guestDetailsStep ?? false;

    if (!bookingComFinalPaymentDomState && bookingComGuestDetailsDomState) {
      // Booking.com sometimes transitions to the final-details/payment page a beat after
      // the CTA click/requestSubmit completes. Re-check once before declaring failure.
      await Promise.allSettled([
        raw.waitForLoadState("domcontentloaded", { timeout: 5000 }),
        waitForPageSignals(raw, {
          fromUrl: currentUrl,
          untilUrlIncludes: ["secure.booking.com/book"],
          untilTextIncludes: [
            "your payment details",
            "complete booking",
            "when do you want to pay",
            "pay now",
            "pay at the property",
            "card number",
            "credit or debit card",
          ],
          untilTextExcludes: [
            "your arrival time",
            "cribs and extra beds",
            "next: final details",
          ],
          timeoutMs: 7000,
        }),
      ]);

      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      currentUrl = assessment.currentUrl;
      pageText = assessment.pageText;
      providerSignals = activeProvider ? await activeProvider.getStageSignals(raw, currentUrl, pageText) : null;
      bookingComFinalPaymentDomState = providerSignals?.paymentStep ?? false;
      bookingComGuestDetailsDomState = providerSignals?.guestDetailsStep ?? false;
    }

    // For restaurant platforms (OpenTable, Resy): guestDetailsStep=true means we're on
    // the reservation form. Restaurants keep guest + card on the SAME page (unlike
    // Expedia/Booking.com which split them), so we handle everything in this branch:
    //   1. fillGuestForm (diner details)
    //   2. re-check paymentStep → if cc section present, run fillPaymentForm (stops at CVV)
    // We intentionally ignore !bookingComFinalPaymentDomState here — otherwise a
    // restaurant that requires a credit card would fall through to the 4889 branch,
    // which assumes guest details were filled on an earlier page and skips diner fill.
    const isRestaurantProvider = activeProvider?.id === "opentable-com" || activeProvider?.id === "resy-com";
    if (bookingComGuestDetailsDomState && isRestaurantProvider) {
      trace(`[${activeProvider?.id}] reservation form detected — filling guest info`);
      reachedGuestForm = true;
      if (activeProvider?.fillGuestForm) {
        await activeProvider.fillGuestForm(raw, p, { ...bookingComHelpers, autonomy: input.autonomySettings }, trace);
      }
      await new Promise(r => setTimeout(r, 800));

      // Re-check signals after guest fill: OpenTable's "Credit card required"
      // section may now be fully rendered/scrolled into view. If so, run the
      // payment pass so the user only has to type their CVV.
      let needsCardEntry = false;
      let paymentIncompleteFields: string[] = [];
      if (activeProvider) {
        const postGuestSignals = await activeProvider.getStageSignals(raw, raw.url(), "").catch(() => null);
        if (postGuestSignals?.paymentStep && activeProvider.fillPaymentForm) {
          const pAny = p as Record<string, unknown>;
          const cn = typeof pAny.card_number === "string" ? pAny.card_number : "";
          const ce = typeof pAny.card_expiry === "string" ? pAny.card_expiry : "";
          const cname = typeof pAny.card_name === "string" ? pAny.card_name : "";
          const zip = typeof pAny.zip === "string" ? pAny.zip : "";
          trace(`[${activeProvider.id}] pre-payment profile: cardNameLen=${cname.length} cardNumLen=${cn.length} cardExpiry="${ce}" zip="${zip}" profileKeys=${Object.keys(pAny).join(",")}`);
          trace(`[${activeProvider.id}] credit card required — running fillPaymentForm (stops at CVV)`);
          const paymentFillResult = await activeProvider.fillPaymentForm(raw, p, bookingComHelpers, trace);
          if (paymentFillResult && typeof paymentFillResult === "object") {
            const missing: string[] = [];
            if (paymentFillResult.name === false) missing.push("card name");
            if (paymentFillResult.number === false) missing.push("card number");
            if (paymentFillResult.expiry === false) missing.push("expiry");
            if (paymentFillResult.zip === false) missing.push("billing zip");
            if (paymentFillResult.agreed === false) missing.push("terms checkbox");
            paymentIncompleteFields = missing;
            if (missing.length > 0) {
              trace(`[${activeProvider.id}] payment fill incomplete — missing=${missing.join(", ")}`);
            }
          }
          await new Promise(r => setTimeout(r, 800));
          needsCardEntry = true;
        }
      }

      await new Promise(r => setTimeout(r, 700));
      const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
      const afterUrl = raw.url();
      // Check if form was submitted successfully (URL changed to confirmation)
      const isConfirmed = afterUrl.toLowerCase().includes("/confirmation") ||
        afterUrl.toLowerCase().includes("/confirmed") ||
        afterUrl.toLowerCase().includes("booking/complete");

      let summary: string;
      if (isConfirmed) {
        summary = `Reservation confirmed at ${targetHotelName ?? "the restaurant"}!`;
      } else if (needsCardEntry && paymentIncompleteFields.length > 0) {
        summary = `Reservation form filled for ${targetHotelName ?? "the restaurant"}, but some payment fields still need manual entry (${paymentIncompleteFields.join(", ")} + CVC).`;
      } else if (needsCardEntry) {
        summary = `Reservation form + card details filled for ${targetHotelName ?? "the restaurant"}. Enter CVC and click "Complete reservation" to finish.`;
      } else {
        summary = `Reservation form filled for ${targetHotelName ?? "the restaurant"}. Open the link to confirm.`;
      }

      return {
        status: isConfirmed ? "completed" : "paused_payment",
        screenshotBase64,
        handoffUrl: afterUrl,
        sessionUrl,
        summary,
        debugTrace,
      };
    }

    if (!bookingComFinalPaymentDomState && bookingComGuestDetailsDomState) {
      trace("Booking.com final state check: still on guest-details step, so payment/card filling is not allowed yet.");
      const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "Booking.com is still on the guest-details step. Personal details must be completed and 'Next: Final details' must succeed before any card fields are filled.",
        error: "Still on Booking.com guest-details step before final-details/payment page.",
        debugTrace,
      };
    }

    if (bookingComFinalPaymentDomState && activeProvider) {
      trace("Provider final payment page confirmed after guest-details step — running final card-field fill pass.");
      reachedGuestForm = true;

      // Before filling, wait briefly for the checkout page to render (Expedia lazy-loads card fields)
      await raw.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      const prePaymentDismissed = await raw.evaluate(() => {
        // Direct DOM click — bypass all abstraction layers
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
        const dismissed: string[] = [];
        for (const btn of buttons) {
          const text = (btn.textContent ?? "").trim().toLowerCase();
          const r = btn.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // "Continue booking" or X close button near "almost yours" text
          const isContinue = text === "continue booking" || text === "continue";
          if (!isContinue) continue;
          // Verify modal context — walk up and check for "almost yours" ancestor
          let ancestor: HTMLElement | null = btn.parentElement;
          while (ancestor && ancestor !== document.body) {
            if ((ancestor.textContent ?? "").toLowerCase().includes("almost yours")) {
              btn.click();
              dismissed.push(text);
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
        return dismissed.join(", ");
      }).catch(() => "");
      if (prePaymentDismissed) {
        trace(`[RPA] Pre-payment modal dismissed: ${prePaymentDismissed} — waiting for modal to close`);
        await new Promise(r => setTimeout(r, 800));
      }

      await activeProvider.fillPaymentForm?.(raw, p, bookingComHelpers, trace);

      // Wait for any post-fill modals (Expedia nudge modal may appear after Playwright interaction ends)
      await new Promise(r => setTimeout(r, 1500));
      const postPaymentDismissed = await raw.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
        const dismissed: string[] = [];
        for (const btn of buttons) {
          const text = (btn.textContent ?? "").trim().toLowerCase();
          const r = btn.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const isContinue = text === "continue booking" || text === "continue";
          const isClose = btn.getAttribute("aria-label")?.toLowerCase().includes("close") ||
            text === "×" || text === "✕" || text === "x";
          if (!isContinue && !isClose) continue;
          let ancestor: HTMLElement | null = btn.parentElement;
          while (ancestor && ancestor !== document.body) {
            if ((ancestor.textContent ?? "").toLowerCase().includes("almost yours")) {
              btn.click();
              dismissed.push(text);
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
        return dismissed.join(", ");
      }).catch(() => "");
      if (postPaymentDismissed) {
        trace(`[RPA] Post-payment modal dismissed: ${postPaymentDismissed} — retrying card fill`);
        await new Promise(r => setTimeout(r, 800));
        // Retry fill after modal is dismissed
        await activeProvider.fillPaymentForm?.(raw, p, bookingComHelpers, trace);
        await new Promise(r => setTimeout(r, 800));
      }

      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      currentUrl = assessment.currentUrl;
      pageText = assessment.pageText;
      providerSignals = activeProvider ? await activeProvider.getStageSignals(raw, currentUrl, pageText) : null;
      bookingComFinalPaymentDomState = providerSignals?.paymentStep ?? false;
    }

    const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;

    const hasEnteredFullName = p.full_name ? await hasValueInScopes(raw, p.full_name) : false;
    const hasEnteredFirstName = p.first_name ? await hasValueInScopes(raw, p.first_name) : false;
    const hasEnteredLastName = p.last_name ? await hasValueInScopes(raw, p.last_name) : false;
    const hasEnteredEmail = p.email ? await hasValueInScopes(raw, p.email) : false;
    const hasEnteredPhone = p.phone ? await hasValueInScopes(raw, p.phone) : false;
    const hasEnteredCardNumber = p.card_number ? await hasValueInScopes(raw, p.card_number) : false;
    const hasEnteredCardExpiry = p.card_expiry ? await hasValueInScopes(raw, p.card_expiry) : false;
    const bookingComVerification = await providerEvaluateBookingComVerification(
      raw,
      currentUrl,
      pageText,
      p,
      {
        fullName: hasEnteredFullName,
        firstName: hasEnteredFirstName,
        lastName: hasEnteredLastName,
        email: hasEnteredEmail,
        phone: hasEnteredPhone,
        cardNumber: hasEnteredCardNumber,
        cardExpiry: hasEnteredCardExpiry,
      },
      bookingComFinalPaymentDomState
    );
    const hasRequestedDates = !!(requestedDates.checkin && requestedDates.checkout);
    const selectedDatesMatchRequest = hasRequestedDates
      ? hasRequestedStaySelected(pageText, requestedDates)
      : true;
    const finalOutcome = determineFinalOutcome({
      assessment: {
        stage: assessment.stage,
        reason: assessment.reason,
        pageText: assessment.pageText,
        visibleCheckoutFields: assessment.visibleCheckoutFields,
        hitPaymentGate: assessment.hitPaymentGate,
        listingSignals: assessment.listingSignals,
        bookingProgressSignals: assessment.bookingProgressSignals,
        blocked: assessment.blocked,
      },
      screenshotBase64,
      handoffUrl: currentUrl,
      startUrl: input.startUrl,
      sessionUrl,
      debugTrace,
      selectedDatesMatchRequest,
      bookingComVerification,
      hasEnteredFullName,
      hasEnteredFirstName,
      hasEnteredLastName,
      hasEnteredEmail,
      hasEnteredPhone,
      hasEnteredCardNumber,
      hasEnteredCardExpiry,
      agentMessage,
      resultMessage: result.message,
      resultCompleted: !!result.completed,
      cardNumberProvided: !!p.card_number,
      cardExpiryProvided: !!p.card_expiry,
      bookingComPassedGuestDetails: bookingComFinalPaymentDomState,
    }, trace);

    // Keep the browser open for any non-completed terminal state so the user
    // can see the actual page the RPA landed on:
    //   paused_payment → enter CVC
    //   no_availability → "Eleven Madison Park isn't on OpenTable" etc — user
    //                      sees the last-tried page (OpenTable search / Resy /
    //                      Google Places handoff) and can continue manually
    //   error / captcha / needs_login → manual intervention required
    // Only "completed" (fully booked) closes the browser immediately because
    // there's nothing left for the user to do.
    const shouldHoldOpen =
      !useCloud && finalOutcome.status !== "completed";
    if (shouldHoldOpen) {
      holdBrowserOpenForManualReview(
        `Local mode: browser will stay open for ${Math.round(BROWSER_KEEP_OPEN_MS / 60000)} minutes — status=${finalOutcome.status}, review the page and continue manually if needed.`
      );
      if (finalOutcome.status === "paused_payment") {
        console.log("\n鉁?[stagehand] Payment page is open —?use OneAgent live view or the browser window to complete payment.\n");
      }
    }

    return finalOutcome;
  } catch (err) {
    const { message: error, statusCode, serialized } = extractErrorDetails(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // Preserve the raw error string before any further interpretation, for diagnostics.
    const rawError = serialized ?? error;

    // Write to persistent agent log for debugging
    await writeAgentLog({
      session_id: input.jobId ?? "",
      job_id: input.jobId ?? null,
      level: "error",
      source: "stagehand-executor",
      message: error,
      details: {
        startUrl: input.startUrl,
        task: input.task.slice(0, 500),
        stepIndex: input.stepIndex,
        statusCode,
        serializedError: serialized?.slice(0, 2000),
        stack: stack?.slice(0, 1000),
        model: input.agentModel?.model ?? modelName,
        usingCloud: useCloud,
      },
    });

    // Captcha detection
    if (
      error.toLowerCase().includes("captcha") ||
      error.toLowerCase().includes("cloudflare") ||
      error.toLowerCase().includes("blocked")
    ) {
      trace(`Executor threw a blocking error: ${error}`);
      return {
        status: "captcha",
        handoffUrl: input.startUrl,
        summary: "The site blocked the agent. Open the link to continue manually.",
        error,
        debugTrace,
      };
    }

    if (
      statusCode === 402 ||
      error.toLowerCase().includes("billing") ||
      error.toLowerCase().includes("credits") ||
      error.toLowerCase().includes("quota") ||
      error.toLowerCase().includes("payment required") ||
      rawError.toLowerCase().includes("minutes limit")
    ) {
      trace(`Executor hit 402. Raw: ${rawError.slice(0, 400)}`);

      // Specific Browserbase free-plan minutes exhaustion
      if (rawError.toLowerCase().includes("browser minutes limit") ||
          rawError.toLowerCase().includes("free plan")) {
        return {
          status: "error",
          handoffUrl: input.startUrl,
          summary: "Browserbase free plan browser minutes exhausted.",
          error: "Browserbase free plan limit reached —?upgrade at browserbase.com/plans, or remove BROWSERBASE_API_KEY to run locally.",
          debugTrace,
        };
      }

      // Generic 402 —?try to name the provider
      const isBrowserbase = rawError.toLowerCase().includes("browserbase") ||
        rawError.toLowerCase().includes("session") ||
        rawError.toLowerCase().includes("concurren");
      const isModelApi = rawError.toLowerCase().includes("openai") ||
        rawError.toLowerCase().includes("anthropic") ||
        rawError.toLowerCase().includes("google") ||
        rawError.toLowerCase().includes("gemini");
      const providerHint = isBrowserbase
        ? "Browserbase"
        : isModelApi
        ? `Model API (${modelName})`
        : `unknown provider —?model: ${modelName}`;

      return {
        status: "error",
        handoffUrl: input.startUrl,
        summary: "The automation provider rejected this run before the booking flow could finish.",
        error: `Quota/billing issue (HTTP 402) from ${providerHint}. Check credits and retry.`,
        debugTrace,
      };
    }

    trace(`Executor threw an unexpected error: ${error}`);
    // If the guest/payment form was already filled before the throw, don't
    // mark the whole step as hard-error — the user can visually review the
    // browser (kept open by the safety net) and submit manually.
    if (reachedGuestForm) {
      trace("reachedGuestForm=true at throw — returning paused_payment so UI treats this as awaiting manual confirmation.");
      return {
        status: "paused_payment",
        handoffUrl: input.startUrl,
        summary: "Form pre-filled. Please review the browser and submit the booking manually.",
        error,
        debugTrace,
      };
    }
    return {
      status: "error",
      handoffUrl: input.startUrl,
      summary: "An unexpected error occurred.",
      error,
      debugTrace,
    };
  } finally {
    // Safety net: if we already filled guest/payment form fields but the
    // outcome was error (or unexpected throw), keep the browser open so the
    // user can visually review what's on the page and submit manually.
    // Mirrors the paused_payment TTL (15 min).
    if (!keepBrowserOpen && reachedGuestForm && !useCloud && input.jobId) {
      holdBrowserOpenForManualReview("Safety net: guest form was reached — keeping browser open 15 min for manual review/submit.");
    }

    if (!keepBrowserOpen) {
      if (input.jobId) {
        browserSessionStore.delete(input.jobId);
        activeStagehands.delete(input.jobId);
      }
      await stagehand.close().catch(() => {});
    }
    // If keepBrowserOpen=true, the entry stays in activeStagehands so the next
    // Reset & Retry will close this browser before opening a new one.
  }
}

