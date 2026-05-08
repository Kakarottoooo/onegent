import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveActivityProviderSkillUrl } from "@/lib/activity-skills";
import {
  buildLabEvent,
  serializeLabEvent,
} from "@/lib/stage0b-skill-runtime/event-writer";
import {
  buildL2RecoveryResult,
  STAGE0B_HARD_STOPS,
} from "@/lib/stage0b-skill-runtime/l2-recovery-result";
import {
  STAGE0B_TEST_PLAN,
} from "@/lib/stage0b-skill-runtime/test-plan";
import {
  TICKETMASTER_SKILL_FORGE_PLAN,
} from "@/lib/stage0b-skill-runtime/ticketmaster-forge-plan";
import type {
  LabEvent,
  LabHardStopReason,
  LabTestPlanEntry,
  LabVisibleFacts,
  L2RecoveryClass,
  L2RecoveryResult,
  SkillPatchProposal,
  Stage0bLabPlanName,
  Stage0bLabProvider,
} from "@/lib/stage0b-skill-runtime/types";

export type Stage0BLabRunnerArgs = {
  live: boolean;
  dryRun: boolean;
  provider?: Stage0bLabProvider;
  id?: string;
  limit?: number;
  evidenceRoot: string;
  browserHarnessCommand: string;
  stopOnError: boolean;
  keepOpen: boolean;
  plan: Stage0bLabPlanName;
};

export type BrowserHarnessPayload = {
  ok: boolean;
  currentUrl?: string;
  title?: string;
  screenshotPath?: string;
  visibleFacts?: LabVisibleFacts;
  followedSafeLink?: boolean;
  followTarget?: {
    text?: string;
    href?: string;
  };
  hardStops?: LabHardStopReason[];
  error?: string;
  traceback?: string;
};

export type Stage0BLabRunSummary = {
  runId: string;
  entryId: string;
  provider: Stage0bLabProvider;
  classification: L2RecoveryClass;
  safeNextAction: string;
  resultPath: string;
  eventsPath: string;
};

const SENTINEL_START = "ONEGENT_STAGE0B_RESULT_START";
const SENTINEL_END = "ONEGENT_STAGE0B_RESULT_END";

const INSPECT_JS = String.raw`
(() => {
  const body = document.body;
  const rawText = body ? (body.innerText || "") : "";
  const text = rawText.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const title = (document.querySelector("h1")?.textContent || document.title || "").replace(/\s+/g, " ").trim();
  const normalizeWords = (value) => value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const targetTokens = normalizeWords(title)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !/^(ticket|tickets|event|events|tour|live|show|shows|find|your|presents|official|page)$/.test(token))
    .slice(0, 8);
  const requiresTargetMatch = /ticketmaster\./i.test(location.hostname) && /\/(?:artist|venue)\//i.test(location.pathname);
  const labelMatchesTarget = (label) => {
    if (!requiresTargetMatch || targetTokens.length === 0) return true;
    const normalizedLabel = normalizeWords(label);
    return targetTokens.some((token) => normalizedLabel.includes(token));
  };
  const labelHasDateSignal = (label) =>
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b/i.test(label);
  const linkLooksLikeProviderEvent = (link, label, buttonText) => {
    if (!/ticketmaster\./i.test(location.hostname) || !requiresTargetMatch) return true;
    try {
      const parsed = new URL(link || "", location.href);
      if (/ticketmaster\./i.test(parsed.hostname) && /\/event\//i.test(parsed.pathname)) return true;
    } catch {
      // Some Ticketmaster artist pages render Find Tickets as a button without
      // an event href in the static DOM. The visible row label is still useful
      // user-choice evidence when it names the target and carries a date.
    }
    return /find tickets|view seats|see tickets|get tickets|buy tickets/i.test(buttonText || "") &&
      labelHasDateSignal(label || "");
  };
  const clickableElements = Array.from(document.querySelectorAll("button,a,[role='button']"))
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const textValue = (el.textContent || "").replace(/\s+/g, " ").trim();
      return {
        text: textValue,
        href: el instanceof HTMLAnchorElement ? el.href : "",
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) => item.text);
  const buttonTexts = clickableElements
    .map((item) => item.text)
    .filter(Boolean)
    .slice(0, 80);
  const buttonLower = buttonTexts.join("\n").toLowerCase();
  const findTicketButtons = clickableElements.filter((item) => /find tickets|view seats|see tickets|get tickets|buy tickets/i.test(item.text));
  const ignoredTicketmasterCandidate = (label) =>
    /parking|pre-?show|lounge access|club access|special entry|hotel deals|find my hotel|add-ons?/i.test(label || "");
  const eventCandidates = findTicketButtons
    .map((item) => {
      const element = Array.from(document.querySelectorAll("button,a,[role='button']"))
        .find((el) => (el.textContent || "").replace(/\s+/g, " ").trim() === item.text);
      const container = element?.closest?.("li, article, section, [data-testid*='event'], [class*='event'], [class*='Event'], [class*='card'], [class*='Card']") || element?.parentElement;
      const label = (container?.textContent || item.text || "")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "")
        .slice(0, 500);
      const link = item.href || (container?.querySelector?.("a[href]")?.href || "");
      return { label, link, text: item.text, href: item.href, x: item.x, y: item.y, visible: item.visible };
    })
    .filter((item) =>
      item.label &&
      !/ticketmaster home page|skip to main content|search|help|gift cards|sell|fans also viewed/i.test(item.label) &&
      !ignoredTicketmasterCandidate(item.label) &&
      labelMatchesTarget(item.label) &&
      linkLooksLikeProviderEvent(item.link, item.label, item.text)
    );
  const eventInfoLinkCandidates = Array.from(document.querySelectorAll("a[href]"))
    .map((link) => {
      const href = link.href || "";
      const label = (link.textContent || link.getAttribute("aria-label") || link.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const rect = link.getBoundingClientRect();
      return {
        label,
        link: href,
        text: label,
        href,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
      };
    })
    .filter((item) => {
      if (!/ticketmaster\./i.test(location.hostname) || !requiresTargetMatch) return false;
      if (!item.label || ignoredTicketmasterCandidate(item.label)) return false;
      if (!labelMatchesTarget(item.label) || !labelHasDateSignal(item.label)) return false;
      try {
        const parsed = new URL(item.link, location.href);
        return /ticketmaster\./i.test(parsed.hostname) && /\/event\//i.test(parsed.pathname);
      } catch {
        return false;
      }
    });
  const seenCandidateKeys = new Set();
  const allEventCandidates = [...eventCandidates, ...eventInfoLinkCandidates]
    .filter((item) => {
      const key = item.link || item.label;
      if (!key || seenCandidateKeys.has(key)) return false;
      seenCandidateKeys.add(key);
      return true;
    })
    .slice(0, 20);
  const safeFollowTarget = findTicketButtons.find((item) =>
    item.visible &&
    !/sign in|log in|checkout|place order|confirm purchase|complete purchase|buy now|payment|card number/i.test(item.text)
  );
  const dateMatches = Array.from(text.matchAll(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b/gi))
    .map((match) => match[0])
    .slice(0, 20);
  const timeMatches = Array.from(text.matchAll(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/gi))
    .map((match) => match[0])
    .slice(0, 20);
  const hardStops = [];
  const urlLower = location.href.toLowerCase();
  const eventPageLike = /\/event\//i.test(location.pathname);
  const authUrl = /auth\.ticketmaster|\/login|\/signin|\/account/.test(urlLower);
  const passwordFieldVisible = Array.from(document.querySelectorAll("input[type='password']")).some((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const paymentInputVisible = Array.from(document.querySelectorAll("input,select,textarea")).some((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const haystack = [
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("autocomplete") || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("placeholder") || "",
      el.closest("label")?.textContent || "",
    ].join(" ").toLowerCase();
    return /card number|credit card|cc-number|cvv|cvc|security code|expiration|exp-date|billing address|name on card/.test(haystack);
  });
  const loginHeading = Array.from(document.querySelectorAll("h1,h2,[role='heading']"))
    .some((el) => /^(sign in|log in|login|create account|verify your account)$/i.test((el.textContent || "").trim()));
  const checkoutPaymentHeading = /checkout|order summary|subtotal|total due|place order|confirm purchase|complete purchase/.test(lower) &&
    /credit card|card number|billing address|payment method|cvv|expiration date/.test(lower);
  if (authUrl || passwordFieldVisible || loginHeading || /account required|verify your account/.test(lower)) {
    hardStops.push("login_or_signin_wall");
  }
  if (/captcha|recaptcha|hcaptcha|verify you are human|are you a real fan|security check|cloudflare/.test(lower)) {
    hardStops.push("captcha_or_challenge");
  }
  if (/one-time code|verification code|enter code|otp|two-factor|2fa|phone verification/.test(lower)) {
    hardStops.push("otp_or_phone_verification");
  }
  if (
    /select seats|choose seats|seat map/i.test(rawText) ||
    (eventPageLike && /lowest price|best seats|standard tickets|sec\s+\d+[\s\S]{0,80}row\s+\w+/i.test(rawText)) ||
    /view seats|select seats|choose seats/i.test(buttonTexts.join(" "))
  ) {
    hardStops.push("seat_selection_required");
  }
  if (paymentInputVisible || checkoutPaymentHeading) {
    hardStops.push("payment_form_visible");
  }
  if (/place order|confirm purchase|complete purchase|buy now|submit order/.test(buttonLower)) {
    hardStops.push("final_confirm_button");
  }
  if (/cookie/.test(lower) && /accept all|manage cookies|cookie settings/.test(buttonLower) && text.length < 1200) {
    hardStops.push("cookie_consent_blocking_render");
  }
  const notes = allEventCandidates.map((item) => item.label).slice(0, 20);
  if (/page requested could not be found|page not found|well,\s*this isn't right|we can't seem to find|something went wrong|try again later/.test(lower)) {
    notes.unshift("provider_error_page_visible");
  }
  if (/\bloading\b|please wait|hang tight/.test(lower)) {
    notes.unshift("loading_indicator_visible");
  }
  return {
    ok: true,
    currentUrl: location.href,
    title,
    visibleFacts: {
      title,
      visible_dates: dateMatches,
      visible_times: timeMatches,
      candidate_count: allEventCandidates.length,
      candidate_labels: allEventCandidates.map((item) => item.label),
      candidate_links: allEventCandidates.map((item) => item.link).filter(Boolean),
      notes,
    },
    safeFollowTarget,
    hardStops,
  };
})()
`;

export function parseStage0BLabRunnerArgs(argv: string[]): Stage0BLabRunnerArgs {
  const args: Stage0BLabRunnerArgs = {
    live: false,
    dryRun: false,
    evidenceRoot: ".stage0b-evidence",
    browserHarnessCommand: "browser-harness",
    stopOnError: false,
    keepOpen: false,
    plan: "stage0b",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--live") {
      args.live = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--provider") {
      if (next !== "ticketmaster" && next !== "seatgeek") {
        throw new Error(`Unsupported --provider value: ${next ?? ""}`);
      }
      args.provider = next;
      index += 1;
    } else if (token === "--plan") {
      if (next !== "stage0b" && next !== "ticketmaster-forge") {
        throw new Error(`Unsupported --plan value: ${next ?? ""}`);
      }
      args.plan = next;
      index += 1;
    } else if (token === "--id") {
      if (!next) throw new Error("--id requires a value");
      args.id = next;
      index += 1;
    } else if (token === "--limit") {
      const parsed = Number.parseInt(next ?? "", 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      args.limit = parsed;
      index += 1;
    } else if (token === "--evidence-root") {
      if (!next) throw new Error("--evidence-root requires a value");
      args.evidenceRoot = next;
      index += 1;
    } else if (token === "--browser-harness") {
      if (!next) throw new Error("--browser-harness requires a value");
      args.browserHarnessCommand = next;
      index += 1;
    } else if (token === "--stop-on-error") {
      args.stopOnError = true;
    } else if (token === "--keep-open") {
      args.keepOpen = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function selectStage0BLabEntries(args: Pick<Stage0BLabRunnerArgs, "provider" | "id" | "limit"> & Partial<Pick<Stage0BLabRunnerArgs, "plan">>): LabTestPlanEntry[] {
  let entries = labPlanEntries(args.plan ?? "stage0b");
  if (args.provider) {
    entries = entries.filter((entry) => entry.provider === args.provider);
  }
  if (args.id) {
    entries = entries.filter((entry) => entry.id === args.id);
  }
  if (typeof args.limit === "number") {
    entries = entries.slice(0, args.limit);
  }
  if (entries.length === 0) {
    throw new Error("No Stage 0B lab entries matched the requested filters");
  }
  return entries;
}

function labPlanEntries(plan: Stage0bLabPlanName): LabTestPlanEntry[] {
  return plan === "ticketmaster-forge"
    ? TICKETMASTER_SKILL_FORGE_PLAN.slice()
    : STAGE0B_TEST_PLAN.slice();
}

export function buildBrowserHarnessPython(entry: LabTestPlanEntry, screenshotPath: string, keepOpen = false): string {
  return [
    "import json, traceback",
    `url = ${pythonString(entry.url)}`,
    `screenshot_path = ${pythonString(screenshotPath)}`,
    `expected_direct = ${entry.expected_resolver_execution_mode === "direct_execution" ? "True" : "False"}`,
    `keep_open = ${keepOpen ? "True" : "False"}`,
    `inspect_js = ${pythonString(INSPECT_JS)}`,
    "payload = {}",
    "opened_target = None",
    "try:",
    "    opened_target = new_tab(url)",
    "    wait_for_load()",
    "    wait(3)",
    "    info = page_info()",
    "    observed = js(inspect_js)",
    "    payload = observed if isinstance(observed, dict) else {}",
    "    visible = payload.get('visibleFacts') if isinstance(payload.get('visibleFacts'), dict) else {}",
    "    candidate_count = visible.get('candidate_count') if isinstance(visible, dict) else 0",
    "    target = payload.get('safeFollowTarget') if isinstance(payload.get('safeFollowTarget'), dict) else None",
    "    if target and (expected_direct or candidate_count == 1):",
    "        click_at_xy(target.get('x'), target.get('y'))",
    "        wait_for_load()",
    "        wait(3)",
    "        after = js(inspect_js)",
    "        if isinstance(after, dict):",
    "            after['followedSafeLink'] = True",
    "            after['followTarget'] = {'text': target.get('text'), 'href': target.get('href')}",
    "            after['beforeFollowVisibleFacts'] = visible",
    "            payload = after",
    "    captured = capture_screenshot(screenshot_path, full=True)",
    "    payload['ok'] = True",
    "    payload['screenshotPath'] = captured or screenshot_path",
    "    if isinstance(info, dict):",
    "        payload.setdefault('currentUrl', info.get('url'))",
    "        payload.setdefault('title', info.get('title'))",
    "except Exception as exc:",
    "    captured = None",
    "    info = {}",
    "    try:",
    "        captured = capture_screenshot(screenshot_path, full=True)",
    "    except Exception:",
    "        captured = None",
    "    try:",
    "        info = page_info()",
    "    except Exception:",
    "        info = {}",
    "    payload = {'ok': False, 'error': str(exc), 'traceback': traceback.format_exc()}",
    "    if captured:",
    "        payload['screenshotPath'] = captured",
    "    if isinstance(info, dict):",
    "        payload['currentUrl'] = info.get('url')",
    "        payload['title'] = info.get('title')",
    "finally:",
    "    if opened_target and not keep_open:",
    "        try:",
    "            cdp('Target.closeTarget', targetId=opened_target)",
    "            payload['closedLabTab'] = True",
    "        except Exception as close_exc:",
    "            payload.setdefault('closeError', str(close_exc))",
    `print(${pythonString(SENTINEL_START)})`,
    "print(json.dumps(payload, ensure_ascii=False))",
    `print(${pythonString(SENTINEL_END)})`,
  ].join("\n");
}

export function parseBrowserHarnessPayload(stdout: string): BrowserHarnessPayload {
  const start = stdout.indexOf(SENTINEL_START);
  const end = stdout.indexOf(SENTINEL_END);
  if (start === -1 || end === -1 || end <= start) {
    return {
      ok: false,
      error: "browser-harness output did not contain the Stage 0B result sentinel",
    };
  }
  const jsonText = stdout.slice(start + SENTINEL_START.length, end).trim();
  try {
    return normalizePayload(JSON.parse(jsonText));
  } catch (error) {
    return {
      ok: false,
      error: `browser-harness returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function buildStage0BLabResult(input: {
  entry: LabTestPlanEntry;
  payload: BrowserHarnessPayload;
  runId: string;
  eventsPath: string;
  screenshotPath?: string;
  startedAt: string;
  finishedAt: string;
}): { events: LabEvent[]; result: L2RecoveryResult } {
  const events: LabEvent[] = [];
  let seq = 1;
  const currentUrl = input.payload.currentUrl || input.entry.url;
  const resolvedFinal = resolveActivityProviderSkillUrl(currentUrl);
  const finalPageType = !resolvedFinal || resolvedFinal.pageType === "unknown_provider_page"
    ? input.entry.expected_resolver_page_type
    : resolvedFinal.pageType;
  const visibleFacts = input.payload.visibleFacts;
  const hardStop = firstHardStop(input.payload.hardStops);
  const screenshotPath = input.screenshotPath || input.payload.screenshotPath;

  events.push(buildLabEvent({
    run_id: input.runId,
    seq: seq++,
    provider: input.entry.provider,
    page_type: finalPageType,
    action: "navigate",
    currentUrl,
    outcome: input.payload.ok ? "ok" : "error",
    notes: input.payload.ok ? "Browser Harness opened the provider page." : input.payload.error || "Browser Harness failed.",
  }));

  if (visibleFacts) {
    events.push(buildLabEvent({
      run_id: input.runId,
      seq: seq++,
      provider: input.entry.provider,
      page_type: finalPageType,
      action: "inspect",
      currentUrl,
      outcome: "ok",
      visible_facts: visibleFacts,
      notes: "Collected visible candidate facts from the rendered page.",
    }));
  }

  if (input.payload.followedSafeLink) {
    events.push(buildLabEvent({
      run_id: input.runId,
      seq: seq++,
      provider: input.entry.provider,
      page_type: finalPageType,
      action: "follow_safe_link",
      currentUrl,
      outcome: "ok",
      notes: `Clicked safe provider CTA: ${input.payload.followTarget?.text || "unknown"}.`,
    }));
  }

  if (screenshotPath) {
    events.push(buildLabEvent({
      run_id: input.runId,
      seq: seq++,
      provider: input.entry.provider,
      page_type: finalPageType,
      action: "screenshot",
      currentUrl,
      outcome: "ok",
      screenshotPath,
      notes: "Captured page screenshot for Stage 0B evidence.",
    }));
  }

  if (hardStop) {
    events.push(buildLabEvent({
      run_id: input.runId,
      seq: seq++,
      provider: input.entry.provider,
      page_type: finalPageType,
      action: "halt_at_hard_stop",
      currentUrl,
      outcome: "halted",
      hardStop,
      notes: `Stopped at Stage 0B hard stop: ${hardStop}.`,
    }));
  }

  const classification = classifyStage0BOutcome(input.entry, input.payload);
  const skillPatchProposal = classification === "skill_patch_needed"
    ? buildSkillPatchProposal(input.entry, input.payload)
    : undefined;

  events.push(buildLabEvent({
    run_id: input.runId,
    seq: seq++,
    provider: input.entry.provider,
    page_type: finalPageType,
    action: "complete",
    currentUrl,
    outcome: classification === "provider_degraded" || classification === "insufficient_evidence" || classification === "skill_patch_needed" ? "error" : "ok",
    notes: `Classified Stage 0B run as ${classification}.`,
  }));

  const result = buildL2RecoveryResult({
    run_id: input.runId,
    provider: input.entry.provider,
    classification,
    ...(skillPatchProposal ? { skill_patch_proposal: skillPatchProposal } : {}),
    evidence: {
      input_url: input.entry.url,
      final_url: currentUrl,
      final_page_type: finalPageType,
      jsonl_path: input.eventsPath,
      event_count: events.length,
      screenshot_paths: screenshotPath ? [screenshotPath] : [],
      visible_facts: visibleFacts ?? {},
      hard_stops: hardStop ? [hardStop] : [],
    },
    started_at: input.startedAt,
    finished_at: input.finishedAt,
  });

  return { events, result };
}

export function classifyStage0BOutcome(
  entry: LabTestPlanEntry,
  payload: BrowserHarnessPayload,
): L2RecoveryClass {
  if (!payload.ok) {
    return "provider_degraded";
  }
  if (payload.visibleFacts && looksLikeProviderErrorPage(payload.visibleFacts)) {
    return "provider_degraded";
  }
  const hardStop = firstHardStop(payload.hardStops);
  if (hardStop === "login_or_signin_wall" || hardStop === "otp_or_phone_verification") {
    return "account_session_required";
  }
  if (hardStop === "seat_selection_required") {
    return "user_seat_selection_required";
  }
  if (hardStop === "payment_form_visible" || hardStop === "final_confirm_button") {
    return "payment_or_final_action_required";
  }
  if (hardStop) {
    return "provider_degraded";
  }
  if (!payload.visibleFacts || !payload.screenshotPath) {
    return "insufficient_evidence";
  }
  const candidateCount = payload.visibleFacts.candidate_count ?? 0;
  if (entry.expected_resolver_execution_mode === "direct_execution") {
    if (payload.followedSafeLink || candidateCount > 0) {
      return "exact_event_ready";
    }
    return "skill_patch_needed";
  }
  if (candidateCount === 1) {
    return "single_candidate_ready";
  }
  if (candidateCount === 0 && !looksLikeNoEventsPage(payload.visibleFacts)) {
    return "skill_patch_needed";
  }
  return "provider_listing_needs_choice";
}

export function runBrowserHarnessEntry(
  entry: LabTestPlanEntry,
  args: Pick<Stage0BLabRunnerArgs, "browserHarnessCommand" | "keepOpen">,
  screenshotPath: string,
): BrowserHarnessPayload {
  const python = buildBrowserHarnessPython(entry, screenshotPath, args.keepOpen);
  const completed = spawnSync(args.browserHarnessCommand, ["-c", python], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  if (completed.error) {
    return {
      ok: false,
      error: completed.error.message,
    };
  }
  if (completed.status !== 0) {
    return {
      ok: false,
      error: `browser-harness exited ${completed.status}: ${completed.stderr || completed.stdout}`,
    };
  }
  return parseBrowserHarnessPayload(completed.stdout || "");
}

export function runStage0BLabEntry(
  entry: LabTestPlanEntry,
  args: Pick<Stage0BLabRunnerArgs, "evidenceRoot" | "browserHarnessCommand" | "keepOpen">,
): Stage0BLabRunSummary {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const runDir = path.join(args.evidenceRoot, runId);
  const screenshotDir = path.join(runDir, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  const screenshotPath = path.join(screenshotDir, `${entry.id}.png`);
  const screenshotEvidencePath = toEvidencePath(screenshotPath);
  const eventsPath = path.join(runDir, "events.jsonl");
  const eventsEvidencePath = toEvidencePath(eventsPath);
  const resultPath = path.join(runDir, "result.json");

  const payload = runBrowserHarnessEntry(entry, args, path.resolve(screenshotPath));
  const finishedAt = new Date().toISOString();
  const { events, result } = buildStage0BLabResult({
    entry,
    payload,
    runId,
    eventsPath: eventsEvidencePath,
    screenshotPath: payload.screenshotPath ? screenshotEvidencePath : undefined,
    startedAt,
    finishedAt,
  });

  writeFileSync(eventsPath, events.map(serializeLabEvent).join("\n") + "\n", "utf8");
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");

  return {
    runId,
    entryId: entry.id,
    provider: entry.provider,
    classification: result.classification,
    safeNextAction: result.safe_next_action,
    resultPath: toEvidencePath(resultPath),
    eventsPath: eventsEvidencePath,
  };
}

export function formatStage0BLabDryRun(entries: LabTestPlanEntry[]): string {
  const rows = entries.map((entry) => `${entry.id}\t${entry.provider}\t${entry.expected_resolver_page_type}\t${entry.expected_resolver_execution_mode}\t${entry.url}`);
  return [
    "Stage 0B Activity Provider Skill Runtime lab plan",
    "id\tprovider\tpage_type\texecution_mode\turl",
    ...rows,
  ].join("\n");
}

function firstHardStop(hardStops: LabHardStopReason[] | undefined): LabHardStopReason | undefined {
  if (!hardStops?.length) return undefined;
  for (const hardStop of STAGE0B_HARD_STOPS) {
    if (hardStops.includes(hardStop)) return hardStop;
  }
  return hardStops[0];
}

function normalizePayload(value: unknown): BrowserHarnessPayload {
  const record = isRecord(value) ? value : {};
  const visibleFacts = isRecord(record.visibleFacts) ? record.visibleFacts : undefined;
  return {
    ok: record.ok === true,
    currentUrl: typeof record.currentUrl === "string" ? record.currentUrl : undefined,
    title: typeof record.title === "string" ? record.title : undefined,
    screenshotPath: typeof record.screenshotPath === "string" ? record.screenshotPath : undefined,
    visibleFacts: visibleFacts ? normalizeVisibleFacts(visibleFacts) : undefined,
    followedSafeLink: record.followedSafeLink === true,
    followTarget: isRecord(record.followTarget)
      ? {
          text: typeof record.followTarget.text === "string" ? record.followTarget.text : undefined,
          href: typeof record.followTarget.href === "string" ? record.followTarget.href : undefined,
        }
      : undefined,
    hardStops: Array.isArray(record.hardStops)
      ? record.hardStops.filter(isLabHardStop)
      : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    traceback: typeof record.traceback === "string" ? record.traceback : undefined,
  };
}

function looksLikeProviderErrorPage(visibleFacts: LabVisibleFacts): boolean {
  const title = visibleFacts.title?.trim().toLowerCase() || "";
  const notes = visibleFacts.notes?.join(" ").toLowerCase() || "";
  const haystack = `${title} ${notes}`;
  if (
    /ticketmaster\s*-\s*browse/.test(title) &&
    (visibleFacts.candidate_count ?? 0) === 0 &&
    (visibleFacts.visible_dates?.length ?? 0) === 0
  ) {
    return true;
  }
  return /provider_error_page_visible|page not found|404|not found|well,\s*this isn't right|something went wrong|try again later/.test(haystack);
}

function looksLikeNoEventsPage(visibleFacts: LabVisibleFacts): boolean {
  const title = visibleFacts.title?.trim().toLowerCase() || "";
  const notes = visibleFacts.notes?.join(" ").toLowerCase() || "";
  const haystack = `${title} ${notes}`;
  return /no events|no tickets|no results|couldn't find|cannot find|nothing available/.test(haystack);
}

function buildSkillPatchProposal(
  entry: LabTestPlanEntry,
  payload: BrowserHarnessPayload,
): SkillPatchProposal {
  const title = payload.visibleFacts?.title || entry.id;
  return {
    kind: "selector_drift",
    title: `${entry.provider} candidate extraction produced no candidates`,
    observed_evidence: [
      `Plan ${entry.id} (${entry.expected_resolver_page_type}) rendered "${title}" at ${payload.currentUrl || entry.url}.`,
      "The page was not classified as an error/no-events page, but the lab extracted zero visible candidate rows.",
    ].join(" "),
    patch_target: "lib/stage0b-skill-runtime/lab-runner.ts",
    proposed_change:
      "Update the Stage 0B candidate extraction selectors for this provider/page shape, then add a no-live fixture before rerunning the controlled lab.",
    risk: "medium",
    evidence_event_seqs: [2],
  };
}

function normalizeVisibleFacts(record: Record<string, unknown>): LabVisibleFacts {
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    visible_dates: Array.isArray(record.visible_dates) ? record.visible_dates.filter((value): value is string => typeof value === "string") : undefined,
    visible_times: Array.isArray(record.visible_times) ? record.visible_times.filter((value): value is string => typeof value === "string") : undefined,
    candidate_count: typeof record.candidate_count === "number" ? record.candidate_count : undefined,
    candidate_labels: Array.isArray(record.candidate_labels) ? record.candidate_labels.filter((value): value is string => typeof value === "string") : undefined,
    candidate_links: Array.isArray(record.candidate_links) ? record.candidate_links.filter((value): value is string => typeof value === "string") : undefined,
    notes: Array.isArray(record.notes) ? record.notes.filter((value): value is string => typeof value === "string") : undefined,
  };
}

function isLabHardStop(value: unknown): value is LabHardStopReason {
  return typeof value === "string" && STAGE0B_HARD_STOPS.includes(value as LabHardStopReason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pythonString(value: string): string {
  return JSON.stringify(value);
}

function toEvidencePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
