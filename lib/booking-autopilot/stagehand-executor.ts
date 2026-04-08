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
  resolveProviderContext,
  resolveProviderIdForUrl,
} from "./core/provider-router";
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
  fillBookingComGuestForm as providerFillBookingComGuestForm,
  fillBookingComPaymentForm as providerFillBookingComPaymentForm,
  getBookingComStageSignals as providerGetBookingComStageSignals,
  revealBookingComRoomSelection as providerRevealBookingComRoomSelection,
  setBookingComRoomQuantity as providerSetBookingComRoomQuantity,
} from "./providers/booking-com";
import { determineFinalOutcome, NO_AVAILABILITY_SIGNALS } from "./core/final-outcome";
import { fillGuestFormWithAI } from "./ai-loop/fill-form";
import { clickTargetListingAI, selectCheapestRoomAI } from "./ai-loop/find-listing";
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
import fs from "fs";
import path from "path";

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
 * Run a booking task on any website using AI vision.
 *
 * The agent navigates the site, fills all known fields (name / email / phone /
 * dates / party size), and stops before entering payment information.
 * Returns a screenshot and the handoff URL so the user can complete payment.
 */
export async function runBrowserTask(
  input: BrowserTaskInput
): Promise<BrowserTaskResult> {
  // AI_LOOP_FULL=true activates all AI sub-flags simultaneously.
  // RPA code is never removed — each flag independently falls back to RPA on failure.
  if (process.env.AI_LOOP_FULL === "true") {
    process.env.AI_LOOP_STAGE_DETECT = "true";
    process.env.AI_LOOP_FORM_FILL    = "true";
    process.env.AI_LOOP_LISTING      = "true";
  }

  const debugTrace: string[] = [];
  const trace = (message: string) => {
    debugTrace.push(message);
    // Print to terminal in dev so you can follow execution without opening the DB.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[stagehand] ${message}`);
    }
  };
  const bookingComHelpers = createBookingComHelpers();

  const useCloud =
    !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);

  // Vercel serverless has no Chromium 鈥?local mode will crash with a confusing
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

  // Resolve model name 鈥?Stagehand v3 uses "provider/model" format
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

  const stagehand = new Stagehand({
    env: useCloud ? "BROWSERBASE" : "LOCAL",
    ...(useCloud && {
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      // Residential proxies bypass OTA bot-detection (booking.com, Expedia).
      // Requires Browserbase plan that includes proxies 鈥?disable if on free plan.
      ...(process.env.BROWSERBASE_USE_PROXIES === "true" && {
        browserbaseSessionCreateParams: { proxies: true },
      }),
    }),
    model: modelName,  // just the string 鈥?Stagehand reads key from env vars above
    verbose: 0,
    disablePino: true,
    // Dev: set PLAYWRIGHT_HEADLESS=false to watch the browser window.
    // slowMo is not in Stagehand v3 localBrowserLaunchOptions 鈥?use PLAYWRIGHT_SLOW_MO
    // via the Playwright env var PWDEBUG or by patching context after init() instead.
    ...(!useCloud && {
      localBrowserLaunchOptions: {
        headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
      },
    }),
  });

  trace(`Executor starting 鈥?model: ${modelName}, browser: ${useCloud ? "Browserbase" : "local"}, proxies: ${process.env.BROWSERBASE_USE_PROXIES === "true"}`);

  // In local mode, keep the browser open when we reach paused_payment so the
  // user can see the pre-filled payment form and enter CVV themselves.
  // Auto-close after 10 minutes.
  let keepBrowserOpen = false;

  try {
    await stagehand.init();
    // v3 API: get active page from context (resolvePage is private)
    const page = stagehand.context.activePage() ?? await stagehand.context.newPage();
    // Register the page in the live-view store immediately so SSE stream can
    // take screenshots during the entire booking process (not just after payment).
    // Only in local mode — Browserbase sessions have their own live view URL.
    if (!useCloud && input.jobId) {
      // Use a dynamic getter so the live-view stream always screenshots the currently
      // active page — even after tab switches or stagehand.act() navigations.
      browserSessionStore.setGetter(input.jobId, () => {
        const ap = stagehand.context.activePage();
        return ap ? getRawPage(ap) : null;
      }, 15 * 60 * 1000);
      trace('Local mode: registered dynamic page getter in live-view store for real-time streaming.');
    }


    // 鈹€鈹€ Inject saved session cookies (e.g. Booking.com login) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // Cookies are saved once via: node scripts/save-booking-cookies.mjs
    // They persist your logged-in session so the agent starts already authenticated.
    const startProviderId = resolveProviderIdForUrl(input.startUrl);

    if (startProviderId === "booking-com") {
      try {
        const cookiesPath = path.join(process.cwd(), ".booking-cookies.json");
        if (fs.existsSync(cookiesPath)) {
          const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf-8"));
          // Use stagehand.context.addCookies() directly 鈥?V3Context exposes this natively
          // and avoids the getRawPage 鈫?.context() indirection that may not work in v3.
          await stagehand.context.addCookies(cookies);
          // Override language to English 鈥?saved cookies may have Chinese preference.
          await stagehand.context.addCookies([
            { name: "bk_lang",      value: "en-us", domain: ".booking.com", path: "/" },
            { name: "lang",         value: "en-us", domain: ".booking.com", path: "/" },
            { name: "selectedLang", value: "en-us", domain: ".booking.com", path: "/" },
          ]);
          trace(`Injected ${cookies.length} Booking.com session cookies from .booking-cookies.json`);
        } else {
          trace("No .booking-cookies.json found 鈥?run: node scripts/save-booking-cookies.mjs");
        }
      } catch (err) {
        trace(`Cookie injection failed: ${err} 鈥?proceeding without saved session.`);
      }
    }

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
      // may be exposed as .browserContext or .context 鈥?try both.
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

      // Also inject Booking.com search-bar disabler on every page load.
      // This prevents the agent from typing form values into the top search bar.
      await addInitTarget.addInitScript(() => {
        function lockSearchBar(el: HTMLInputElement) {
          const lockedEl = el as HTMLInputElement & { __sb_locked__?: boolean };
          if (lockedEl.__sb_locked__) return;
          lockedEl.__sb_locked__ = true;
          el.value = "";
          el.setAttribute("readonly", "true");
          el.setAttribute("tabindex", "-1");
          el.style.pointerEvents = "none";
          el.style.opacity = "0.6";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          // Prevent focus and typing via event capture
          el.addEventListener("focus",     (e) => { e.stopPropagation(); (e.target as HTMLElement).blur(); }, true);
            el.addEventListener("mousedown",  (e) => { e.preventDefault(); e.stopPropagation(); }, true);
            el.addEventListener("keydown",    (e) => { e.preventDefault(); e.stopPropagation(); }, true);
            el.addEventListener("beforeinput",(e) => { e.preventDefault(); e.stopPropagation(); }, true);
          }
          function disableBookingSearchBar() {
            if (!location.hostname.includes("booking.com")) return;
            // Only lock on hotel/search pages 鈥?NOT on guest-form / checkout pages
            if (location.pathname.includes("/book") || location.pathname.includes("/checkout")) return;
            const searchBarSelectors = [
              "input[name='ss']", "input[placeholder*='鐩殑鍦?]",
              "input[placeholder*='Destination']", "input[placeholder*='destination']",
              "#ss", ".sb-searchbox__input",
            ];
            searchBarSelectors.forEach(sel => {
              document.querySelectorAll<HTMLInputElement>(sel).forEach(lockSearchBar);
            });
          }
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", disableBookingSearchBar);
          } else {
            disableBookingSearchBar();
          }
          const obs = new MutationObserver(disableBookingSearchBar);
          const observeTarget = document.body || document.documentElement;
          if (observeTarget) obs.observe(observeTarget, { childList: true, subtree: true });
        });
    }

    // 鈹€鈹€ Booking.com: close any open autocomplete dropdown 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    if (resolveProviderIdForUrl(page.url()) === "booking-com") {
      try { await safePressEscape(getRawPage(page)); } catch { /* ignore */ }
    }

    // 鈹€鈹€ Booking.com: disable top search bar + scroll to room list 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // The agent REPEATEDLY types form data (phone, card, names) into the top
    // destination search bar. We neutralise it by:
    //   1. Making the input readonly + blurring it (agent can't type into it)
    //   2. Scrolling the page so the search bar is out of the visible viewport
    //   3. Pressing Escape to close any open autocomplete
    if (resolveProviderIdForUrl(page.url()) === "booking-com") {
      try {
        await new Promise((r) => setTimeout(r, 1500)); // let page settle
        await getRawPage(page).evaluate(() => {
          // Disable / make readonly every input inside the top search bar widget
          const searchBarSelectors = [
            "input[name='ss']",
            "input[placeholder*='鐩殑鍦?]",
            "input[placeholder*='Destination']",
            "input[placeholder*='destination']",
            "[data-testid='searchbox-tabs-container'] input",
            ".sb-searchbox input",
            "#ss",
          ];
            for (const sel of searchBarSelectors) {
              document.querySelectorAll<HTMLInputElement>(sel).forEach(el => {
                el.value = "";
                el.setAttribute("readonly", "true");
                el.setAttribute("tabindex", "-1");
                el.style.pointerEvents = "none";
                el.blur();
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              });
            }

          // Also scroll to the room availability section
          const roomSection =
            document.querySelector("#hp_availability_tempcontainer") ||
            document.querySelector("[data-testid='availability-cta-btn']") ||
            document.querySelector(".hprt-table") ||
            document.querySelector("[class*='roomType']") ||
            document.querySelector("[class*='room-list']");
          if (roomSection) {
            roomSection.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            window.scrollBy(0, 700);
          }
        });
        await safePressEscape(getRawPage(page));
        trace("Booking.com: disabled top search bar inputs and scrolled to room list.");
      } catch { /* ignore 鈥?non-fatal */ }
    }

    // 鈹€鈹€ Early check: site unreachable (network error before agent runs) 鈹€鈹€鈹€鈹€鈹€
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
      const botBlocked =
        earlyText.includes("something went wrong") ||
        earlyText.includes("access denied") ||
        earlyText.includes("reference no.") ||
        earlyText.includes("please enable cookies") ||
        earlyText.includes("checking your browser") ||
        earlyText.includes("show us your human side") ||   // Expedia CAPTCHA
        earlyText.includes("bot or not") ||                // Expedia CAPTCHA title
        earlyText.includes("we can't tell if you're a human") ||  // Expedia CAPTCHA
        earlyText.includes("please type the numbers you hear");    // Expedia audio CAPTCHA
      if (unreachable || botBlocked) {
        const reason = botBlocked ? "Bot detection / error page" : "Network unreachable";
        trace(`${reason} detected on landing page 鈥?stopping early.`);
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

    // 鈹€鈹€ Early check: booking.com search failed 鈥?redirect to fallback 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
          // Bot redirect 鈥?let the user open the original search URL in their own browser
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
          // booking.com search failed (errorc_searchstring_not_found) 鈥?retry with fallback URL.
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

    // Agent uses the same model string 鈥?key is already in process.env
    const agent = stagehand.agent({
      // agentMode: "hybrid" 鈥?not yet available in this Stagehand v3 build; will
      // default to hybrid automatically in an upcoming release per the SDK warning.
      model: modelName,
      systemPrompt: `You are a booking assistant completing a hotel reservation on behalf of a user. Be decisive 鈥?never ask questions, always try the most reasonable action.

GOAL: Complete all steps up to (but NOT including) CVV entry or final payment confirmation.
Required steps in order: dates 鈫?room selection 鈫?skip upsell pages 鈫?guest info form 鈫?card number + expiry 鈫?STOP.

STOP IMMEDIATELY before: CVV field, "Pay Now", "Confirm Payment", "Complete Purchase", "Complete Booking", "Confirm Booking", "Submit Payment".
DO NOT stop at: "Reserve", "Continue", "Proceed to payment", "Book Now" (intermediate) 鈥?click these to advance.

KEY RULES:
- Cookie/consent banner 鈫?click "Decline all" / "Reject all" first, then proceed.
- Domain redirect 鈫?stay on the redirected site, it is correct.
- "Add Extras" / "Upgrade" upsell page 鈫?click "No thanks, skip it" immediately.
- Room selection page 鈫?select cheapest room and click Continue/Reserve. Do NOT fill guest info here.
- "Select a Rate" page (shows multiple rate options with prices) 鈫?always pick the lowest-priced rate UNLESS the task explicitly mentions breakfast, free cancellation, or a specific rate preference. Click "Select" on that rate to continue.
- Booking.com room list with QUANTITY DROPDOWNS (each room shows a "0" dropdown): find the cheapest available room, change its dropdown from "0" to "1". After setting it to 1, a blue "鐜板湪灏遍璁? (Book Now) button will appear in the RIGHT-SIDE SUMMARY PANEL 鈥?click that button immediately. Do NOT interact with the search bar at the top of the page. Do NOT navigate away.
- Calendar month wrong 鈫?click 鈥?鈥?arrow to navigate; verify header before clicking a date.
- IHG/single-date calendar (shows per-night price on each cell, has Stay duration +/鈭?control) 鈫?click check-in date ONLY, then use + button to set nights, then CONTINUE.
- If hotel detail page shows wrong dates 鈫?update the date picker first, then View Prices.
- "Book Now" at a consent/review summary (no name/email/card fields visible yet) 鈫?check terms checkbox, then click it to open the actual form.
- Terms/privacy checkboxes 鈫?always check before clicking booking buttons.
- Fill guest fields one at a time; only fill on the actual checkout form page.
- Browser/CORS/reCAPTCHA console errors 鈫?ignore, keep going.
- If clicking a button opens a NEW TAB or new browser window 鈫?immediately switch focus to that new tab and continue the booking flow there. Do not stay on the original tab.
- On a Booking.com hotel detail page: your FIRST action must be to SCROLL DOWN to find the room list ("绌烘埧鎯呭喌" / "Available rooms"). Do NOT interact with anything at the top of the page. Do NOT click or type into the search bar (the bar showing destination / dates / guests at the very top) 鈥?that is for new hotel searches only. Do NOT type the guest's name, email, or any personal info anywhere on this page 鈥?that comes on the NEXT page after you click "鐜板湪灏遍璁?.
- The room list on a Booking.com hotel page is BELOW the fold 鈥?you must scroll down to see it. Only after you can see the room rows should you interact with room selection.
- The Booking.com room selection page has TWO distinct areas: (1) the room list with quantity dropdowns in the CENTER, and (2) the summary panel on the RIGHT with the blue "鐜板湪灏遍璁? button. The correct sequence is: change dropdown to "1" 鈫?immediately click the blue "鐜板湪灏遍璁? in the right panel 鈫?done. Nothing else happens on this page.
- Booking.com checkout forms may appear in CHINESE. Treat these Chinese labels as their English equivalents: 濮?Last name, 鍚?First name, 鐢靛瓙閭鍦板潃=Email, 鎵嬫満鍙风爜=Phone, 鍥藉/鍦板尯=Country, 鍗″彿=Card number, 鍒版湡鏃?Expiry date, 鎸佸崱浜哄鍚?Cardholder name, 瀹屾垚棰勮=Complete booking (STOP before this), 绔嬪嵆浠樻=Pay now (STOP before this).
- After switching to a new tab, wait for it to fully load before taking any action.

The user will enter CVV and confirm payment themselves.`,
    });

    // For Booking.com hotel detail pages, skip the initial agent run entirely.
    // Our programmatic recovery code handles room selection and form filling directly.
    // Running the agent here wastes 300+ seconds and causes search-bar interference.
    const landedUrlAfterSetup = page.url();
    const openPageUrls = stagehand.context.pages().map((p) => getScopeUrl(getRawPage(p)));
    const bookingComPageOpen = resolveProviderContext({
      startUrl: input.startUrl,
      currentUrl: landedUrlAfterSetup,
      openPageUrls,
    }).bookingComContext;
    const initialMaxSteps = bookingComPageOpen ? 0 : 40;

    trace(`Agent starting main run (maxSteps=${initialMaxSteps}, model=${modelName})${bookingComPageOpen ? " [Booking.com detected: agent.execute disabled, using programmatic flow only]" : ""}`);
    const t0 = Date.now();
    const result = initialMaxSteps === 0
      ? { message: "Skipped initial agent run 鈥?Booking.com programmatic flow active." }
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
      // ignore 鈥?keep using the original page
    }
    const raw = getRawPage(activePage);
    const mainMsg = (result.message ?? "").slice(0, 200);
    trace(`Agent finished main run in ${((Date.now() - t0) / 1000).toFixed(1)}s 鈥?message: "${mainMsg.slice(0, 120)}"`);

    // Detect fatal API errors (out of credits, invalid key, quota exceeded).
    // Continuing the recovery loop is pointless 鈥?every agent call will fail too.
    const fatalApiError =
      /credit balance is too low|insufficient_quota|invalid.{0,20}api.{0,20}key|rate limit exceeded|payment required|quota exceeded|credits? exhausted|billing error|billing issue|browser minutes limit/i.test(mainMsg);
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

    // Check ALL open pages 鈥?booking sites often open a new tab for the
    // checkout flow, so activePage() may still point to the original hotel
    // homepage while the real booking progress is in another tab.
    let agentMessage = (result.message ?? "").toLowerCase();
    let currentUrl = await resolveCurrentUrl(raw, stagehand, input.startUrl);
    const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;

    const p = buildEffectiveProfile(input.profile, input.task);
    const hasProfile = !!(p.full_name || p.first_name || p.last_name || p.email || p.phone);
    trace(`Profile check: hasProfile=${hasProfile}, fields=${[p.full_name?"full_name":null, p.first_name?"first_name":null, p.email?"email":null, p.phone?"phone":null].filter(Boolean).join(",") || "none"}`);
    const requestedDates = extractRequestedStayDates(input.task);
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
      const bookingComContext = resolveProviderContext({
        startUrl: input.startUrl,
        currentUrl,
        rawPageUrl: raw.url(),
        openPageUrls: bookingComPageOpen ? [input.startUrl] : [],
      }).bookingComContext;

      switch (stage) {
        case "listing": {
          if (process.env.AI_LOOP_LISTING === "true") {
            if (!targetHotelName) {
              trace("[ai-listing] target hotel name could not be parsed from the task.");
              return false;
            }
            const result = await clickTargetListingAI(stagehand, targetHotelName, trace);
            if (result === "no_availability") return false;
            if (result === "clicked") {
              // Booking.com opens hotel pages in a new tab.
              // Wait briefly, then check if a new hotel-detail tab was opened.
              // If so, navigate raw (current page) to the same URL so all subsequent
              // operations stay on one page (raw is const — can't reassign).
              await new Promise(r => setTimeout(r, 1200));
              try {
                const allPages = stagehand.context.pages();
                const hotelPageEntry = allPages
                  .map(p => ({ p, url: getScopeUrl(getRawPage(p)) }))
                  .find(({ url }) =>
                    /booking\.com\/hotel\//.test(url) ||
                    /secure\.booking\.com\/book/.test(url)
                  );
                if (hotelPageEntry) {
                  const hotelUrl = hotelPageEntry.url;
                  if (raw.url() !== hotelUrl) {
                    trace(`[ai-listing] new hotel tab detected — navigating main page to: ${hotelUrl.slice(0, 80)}`);
                    await raw.goto(hotelUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
                    await raw.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
                  } else {
                    trace(`[ai-listing] already on hotel page: ${hotelUrl.slice(0, 80)}`);
                  }
                } else {
                  trace(`[ai-listing] no new hotel tab detected — checking current URL: ${raw.url().slice(0, 80)}`);
                }
              } catch (err) {
                trace(`[ai-listing] post-click tab check failed: ${(err as Error).message?.slice(0, 60)}`);
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
          // Never run AI agent for date_selection on Booking.com 鈥?it types in the search bar.
          if (bookingComContext) {
            trace("Booking.com date_selection: skipping AI agent to prevent search-bar interference.");
            return false;
          }
          trace("No deterministic date-selection advance button was found, so a stage-specific agent recovery pass is running.");
          await agent.execute({ instruction: coreBuildStageRecoveryInstruction(stage), maxSteps: 8 });
          return true;
        }
        case "room_selection": {
          if (process.env.AI_LOOP_LISTING === "true") {
            const result = await selectCheapestRoomAI(stagehand, trace);
            if (result === "no_availability") return false;
            return true;
          }
          // ── Booking.com: use Playwright native selectOption() + JS click ──
          // NEVER fall back to AI agent on Booking.com — it always types in the
          // search bar instead of selecting rooms.
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
                    trace(`Booking.com: dropdown ${i} already set to ${val} 鈥?skipping select step.`);
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
                      waitForVisibleActionText(raw, ["I'll reserve", "I鈥檒l reserve", "I will reserve", "reserve now", "Reserve", "Show prices"], 3500),
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

              // Click "I'll reserve" 鈥?use Playwright locator click (real mouse event),
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
                      waitForVisibleActionText(raw, ["Reserve", "I'll reserve", "I鈥檒l reserve", "I will reserve", "reserve now", "Show prices"], 2500),
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
                    raw.locator("button:has-text(\"I鈥檒l reserve\")").first(),
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
                          text.includes("i鈥檒l reserve") ||
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
                          text.includes("i鈥檒l reserve") ||
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

              return true; // Always return true 鈥?never let AI agent handle this on Booking.com
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
          trace(`Room-selection recovery finished in ${((Date.now() - tr0) / 1000).toFixed(1)}s 鈥?"${(rResult.message ?? "").slice(0, 80)}"`);
          return true;
        }
        case "intermediate_gate": {
          const checkedBoxes = await clickAgreementCheckboxes(raw);
          trace(
            checkedBoxes > 0
              ? `Stage recovery checked ${checkedBoxes} consent/privacy checkbox(es) inside the booking widget.`
              : "Stage recovery did not find a new consent/privacy checkbox to check inside the booking widget."
          );
          // Wait for React state to propagate after checkbox check 鈥?the "Book Now"
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

    for (let attempt = 0; attempt < 4; attempt += 1) {
      trace(`Stage assessment ${attempt + 1}: ${assessment.stage} 鈥?${assessment.reason}`);
      if (!["listing", "date_selection", "room_selection", "intermediate_gate"].includes(assessment.stage)) {
        break;
      }

      if (assessment.stage === "room_selection" &&
          containsAny(assessment.pageText, NO_AVAILABILITY_SIGNALS)) {
        trace(`No-availability signal detected at room_selection 鈥?aborting recovery loop.`);
        break;
      }

      // Also bail if the agent message already told us there are no rooms.
      const agentSaysNoAvailability = /no (rooms?|availability|vacancies|rates?)|sold out|fully booked|not available/i.test(agentMessage);
      if (assessment.stage === "room_selection" && agentSaysNoAvailability) {
        trace(`Agent message indicates no availability 鈥?aborting recovery loop.`);
        break;
      }

      const acted = await attemptStageRecovery(assessment.stage);
      if (!acted) break;

      const postActionWaitMs =
        resolveProviderContext({
          startUrl: bookingComPageOpen ? input.startUrl : undefined,
          currentUrl,
          rawPageUrl: raw.url(),
        }).bookingComContext
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

    // 鈹€鈹€ Unknown stage: agent may have stopped mid-flow (maxSteps exhausted) 鈹€鈹€
    // If the stage is unknown after the main run (no recognisable page signals),
    // run one more agent pass to continue from wherever it left off.
    // EXCEPTION: Never run continuation agent on Booking.com 鈥?it always types in
    // the search bar and navigates to the wrong hotel.
    if (
      assessment.stage === "unknown" &&
      !resolveProviderContext({
        startUrl: input.startUrl,
        currentUrl,
        rawPageUrl: raw.url(),
      }).bookingComContext
    ) {
      trace("Stage is unknown after main run 鈥?running a continuation pass (maxSteps=20).");
      const continuationInstruction =
        `You are continuing a hotel booking that was interrupted mid-flow. ` +
        `The target hotel URL is: ${input.startUrl}. ` +
        `Look at the current state of the browser and continue the booking process from where it left off. ` +
        `Your goal is to reach the payment/checkout page filled with the guest's information. ` +
        `Do NOT submit or pay 鈥?stop just before the final payment button.`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contResult = await agent.execute({ instruction: continuationInstruction, maxSteps: 20 }) as any;
      const contMsg: string = contResult?.message ?? contResult?.output ?? "";
      trace(`Continuation pass finished 鈥?message: "${contMsg.slice(0, 120)}"`);
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
      trace(`Post-continuation stage: ${assessment.stage} 鈥?${assessment.reason}`);
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
      };
    }

    // 鈹€鈹€ Direct form-fill fallback 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // If the agent landed on a guest info / checkout form but left fields empty
    // (e.g. because reCAPTCHA console errors confused it), fill them directly
    // using page.act() 鈥?lower-level than the agent and not blocked by reCAPTCHA.
    const visibleCheckoutFields = assessment.visibleCheckoutFields;
    // For Booking.com's checkout URL (Step 2 + Step 3), always treat as guest form
    // regardless of visibleCheckoutFields 鈥?the step 2 form fields may not be detected
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
      // Use input.startUrl as the authoritative Booking.com check 鈥?currentUrl may be a
      // non-booking.com URL resolved from an analytics/tracking iframe by resolveCurrentUrl().
      const isBookingCom = resolveProviderContext({
        startUrl: input.startUrl,
        currentUrl,
        rawPageUrl,
      }).bookingComContext;
      if (isBookingCom && assessment.stage === "checkout_form") {
        if (process.env.AI_LOOP_FORM_FILL === "true") {
          trace("Booking.com guest form — AI fill mode (AI_LOOP_FORM_FILL=true).");
          await fillGuestFormWithAI(stagehand, p, trace);
          await new Promise(r => setTimeout(r, 600));

          // React controlled inputs: stagehand.act() uses locator.fill() which sets the DOM
          // value but doesn't fire React's synthetic events. The submit button stays disabled
          // until React re-validates. Fire nativeSetter + input/change events on every visible
          // input so React picks up the values and enables the submit button.
          const reactFlushed = await raw.evaluate(() => {
            const nativeInputSetter   = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,   "value")?.set;
            const nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            let count = 0;
            document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='hidden']), textarea").forEach(el => {
              const val = el.value;
              if (!val) return;
              if (el instanceof HTMLInputElement && nativeInputSetter)     nativeInputSetter.call(el, val);
              if (el instanceof HTMLTextAreaElement && nativeTextareaSetter) nativeTextareaSetter.call(el, val);
              el.dispatchEvent(new Event("input",  { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              count++;
            });
            return count;
          }).catch(() => 0);
          trace(`[fill-form] flushed React events on ${reactFlushed} input(s)`);
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
          const postAISignals = await providerGetBookingComStageSignals(raw, raw.url(), await raw.evaluate(() => document.body.innerText).catch(() => ""), false);
          if (postAISignals.guestDetailsStep && !postAISignals.finalPaymentState) {
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
              await new Promise(r => setTimeout(r, 1500));
            } else {
              // Last resort: run full RPA fill+advance (fields will be skipped as already filled)
              trace("[RPA] direct click failed — running full RPA providerFillBookingComGuestForm as last resort.");
              await providerFillBookingComGuestForm(raw, p, bookingComHelpers, trace);
              await new Promise(r => setTimeout(r, 600));
            }
          }
        } else {
          trace("[RPA] Booking.com guest form — running programmatic field fill (overrides account pre-fill).");
          await providerFillBookingComGuestForm(raw, p, bookingComHelpers, trace);
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (isBookingCom && assessment.stage === "payment_gate") {
        trace("[RPA] Booking.com payment page — running card-field fill.");
        await providerFillBookingComPaymentForm(raw, p, bookingComHelpers, trace);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (isBookingCom && !["checkout_form", "payment_gate"].includes(assessment.stage)) {
        trace(`Booking.com checkout is open at stage=${assessment.stage}; skipping guest-form override until stage is clearer.`);
      }

      // Check whether the form is already filled (profile email visible in input values)
      let alreadyFilled = false;
      if (p.email) {
        alreadyFilled = await hasValueInScopes(raw, p.email);
      }

      if (!alreadyFilled && !isBookingCom) {
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
      } else if (!isBookingCom) {
        trace("Guest/payment fields already contained profile data, so direct fill fallback was skipped.");
      }

      // Re-read state after any fills
      if (isBookingCom) {
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

    let bookingComSignals = await providerGetBookingComStageSignals(raw, currentUrl, pageText, visibleCheckoutFields);
    let bookingComFinalPaymentDomState = bookingComSignals.finalPaymentState;
    let bookingComGuestDetailsDomState = bookingComSignals.guestDetailsStep;

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
      bookingComSignals = await providerGetBookingComStageSignals(raw, currentUrl, pageText, visibleCheckoutFields);
      bookingComFinalPaymentDomState = bookingComSignals.finalPaymentState;
      bookingComGuestDetailsDomState = bookingComSignals.guestDetailsStep;
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

    if (bookingComFinalPaymentDomState && resolveProviderContext({ currentUrl }).bookingComContext) {
      trace("Booking.com final payment page confirmed after guest-details step 鈥?running final card-field fill pass.");
      await providerFillBookingComPaymentForm(raw, p, bookingComHelpers, trace);
      await new Promise((resolve) => setTimeout(resolve, 800));

      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      currentUrl = assessment.currentUrl;
      pageText = assessment.pageText;
      bookingComSignals = await providerGetBookingComStageSignals(raw, currentUrl, pageText, visibleCheckoutFields);
      bookingComFinalPaymentDomState = bookingComSignals.finalPaymentState;
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

    if (finalOutcome.status === "paused_payment" && !useCloud) {
      keepBrowserOpen = true;
      trace("Local mode: browser will stay open for 15 minutes 鈥?live view available in OneAgent.");
      console.log("\n鉁?[stagehand] Payment page is open 鈥?use OneAgent live view or the browser window to complete payment.\n");
      // Getter is already registered from init — just extend TTL for paused_payment hold.
      browserSessionStore.setGetter(input.jobId, () => {
        const ap = stagehand.context.activePage();
        return ap ? getRawPage(ap) : null;
      }, 15 * 60 * 1000);
      setTimeout(() => {
        browserSessionStore.delete(input.jobId);
        stagehand.close().catch(() => {});
      }, 15 * 60 * 1000);
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
          error: "Browserbase free plan limit reached 鈥?upgrade at browserbase.com/plans, or remove BROWSERBASE_API_KEY to run locally.",
          debugTrace,
        };
      }

      // Generic 402 鈥?try to name the provider
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
        : `unknown provider 鈥?model: ${modelName}`;

      return {
        status: "error",
        handoffUrl: input.startUrl,
        summary: "The automation provider rejected this run before the booking flow could finish.",
        error: `Quota/billing issue (HTTP 402) from ${providerHint}. Check credits and retry.`,
        debugTrace,
      };
    }

    trace(`Executor threw an unexpected error: ${error}`);
    return {
      status: "error",
      handoffUrl: input.startUrl,
      summary: "An unexpected error occurred.",
      error,
      debugTrace,
    };
  } finally {
    if (!keepBrowserOpen) {
      if (input.jobId) browserSessionStore.delete(input.jobId);
      await stagehand.close().catch(() => {});
    }
  }
}

