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
import type {
  LabEvent,
  LabHardStopReason,
  LabTestPlanEntry,
  LabVisibleFacts,
  L2RecoveryClass,
  L2RecoveryResult,
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
  const authUrl = /auth\.ticketmaster|\/login|\/signin|\/account/.test(urlLower);
  const passwordFieldVisible = Array.from(document.querySelectorAll("input[type='password']")).some((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const loginHeading = Array.from(document.querySelectorAll("h1,h2,[role='heading']"))
    .some((el) => /^(sign in|log in|login|create account|verify your account)$/i.test((el.textContent || "").trim()));
  if (authUrl || passwordFieldVisible || loginHeading || /account required|verify your account/.test(lower)) {
    hardStops.push("login_or_signin_wall");
  }
  if (/captcha|recaptcha|hcaptcha|verify you are human|are you a real fan|security check|cloudflare/.test(lower)) {
    hardStops.push("captcha_or_challenge");
  }
  if (/one-time code|verification code|enter code|otp|two-factor|2fa|phone verification/.test(lower)) {
    hardStops.push("otp_or_phone_verification");
  }
  if (/select seats|choose seats|seat map|section\s+\d+|row\s+\w+/.test(lower) || /view seats|select seats|choose seats/i.test(buttonTexts.join(" "))) {
    hardStops.push("seat_selection_required");
  }
  if (/credit card|card number|billing address|payment method|cvv|expiration date/.test(lower)) {
    hardStops.push("payment_form_visible");
  }
  if (/place order|confirm purchase|complete purchase|buy now|submit order/.test(buttonLower)) {
    hardStops.push("final_confirm_button");
  }
  if (/cookie/.test(lower) && /accept all|manage cookies|cookie settings/.test(buttonLower) && text.length < 1200) {
    hardStops.push("cookie_consent_blocking_render");
  }
  return {
    ok: true,
    currentUrl: location.href,
    title,
    visibleFacts: {
      title,
      visible_dates: dateMatches,
      visible_times: timeMatches,
      candidate_count: findTicketButtons.length,
      notes: buttonTexts.slice(0, 20),
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
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function selectStage0BLabEntries(args: Pick<Stage0BLabRunnerArgs, "provider" | "id" | "limit">): LabTestPlanEntry[] {
  let entries = STAGE0B_TEST_PLAN.slice();
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

export function buildBrowserHarnessPython(entry: LabTestPlanEntry, screenshotPath: string): string {
  return [
    "import json, traceback",
    `url = ${pythonString(entry.url)}`,
    `screenshot_path = ${pythonString(screenshotPath)}`,
    `expected_direct = ${entry.expected_resolver_execution_mode === "direct_execution" ? "True" : "False"}`,
    `inspect_js = ${pythonString(INSPECT_JS)}`,
    "payload = {}",
    "try:",
    "    page = new_tab(url)",
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
    "    payload = {'ok': False, 'error': str(exc), 'traceback': traceback.format_exc()}",
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
  if (entry.expected_resolver_execution_mode === "direct_execution") {
    return "exact_event_ready";
  }
  const candidateCount = payload.visibleFacts.candidate_count ?? 0;
  if (candidateCount === 1) {
    return "single_candidate_ready";
  }
  return "provider_listing_needs_choice";
}

export function runBrowserHarnessEntry(
  entry: LabTestPlanEntry,
  args: Pick<Stage0BLabRunnerArgs, "browserHarnessCommand">,
  screenshotPath: string,
): BrowserHarnessPayload {
  const python = buildBrowserHarnessPython(entry, screenshotPath);
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
  args: Pick<Stage0BLabRunnerArgs, "evidenceRoot" | "browserHarnessCommand">,
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

function normalizeVisibleFacts(record: Record<string, unknown>): LabVisibleFacts {
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    visible_dates: Array.isArray(record.visible_dates) ? record.visible_dates.filter((value): value is string => typeof value === "string") : undefined,
    visible_times: Array.isArray(record.visible_times) ? record.visible_times.filter((value): value is string => typeof value === "string") : undefined,
    candidate_count: typeof record.candidate_count === "number" ? record.candidate_count : undefined,
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
