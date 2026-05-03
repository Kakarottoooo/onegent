import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  PHASE0_REPORT_KIND,
  PHASE0_REPORT_SCHEMA_VERSION,
  phase0TaskSnapshotsUrl,
  phase0TaskTimelineUrl,
} from "../lib/benchmark/phase0-report";
import { createApiKey } from "../lib/db";

type Flags = Record<string, string | boolean>;

type OutcomeBucket =
  | "booking_confirmed"
  | "ready_for_confirmation"
  | "safe_handoff"
  | "no_availability_correct"
  | "recovered_via_fallback"
  | "failed_with_clear_reason"
  | "failed_unknown"
  | "severe_error";

type TaskState =
  | "draft"
  | "executing"
  | "awaiting_profile"
  | "awaiting_login"
  | "awaiting_otp"
  | "awaiting_approval"
  | "ready_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

interface FallbackPolicy {
  time_window_minutes?: number;
  allow_platform_switch?: boolean;
  allow_venue_switch?: boolean;
  require_user_approval_before_booking?: boolean;
}

interface BenchmarkCase {
  id: string;
  class: string;
  stability: "stable" | "seasonal" | "adversarial" | "negative";
  provider: "Resy";
  prompt: string;
  expectedOutcomes: OutcomeBucket[];
  acceptableFailureTaxonomy: string[];
  severeTripwires: string[];
  restaurantName: string;
  city: string;
  date: string;
  time: string;
  covers: number;
  resySlug: string;
  fallbackPolicy: FallbackPolicy;
}

interface BenchmarkSuite {
  suiteId: string;
  version: number;
  expectedResyCaseCountFromDoc: number;
  observedResyCaseCount: number;
  acceptanceGate: {
    bookingReadyRateMin: number;
    safeOutcomeRateMin: number;
    severeErrorRateMax: number;
    taxonomyCoverageRateMin: number;
  };
  cases: BenchmarkCase[];
}

interface PublicTask {
  id: string;
  state: TaskState;
  currentBookingJobId?: string | null;
  terminalReason?: string | null;
  terminalCode?: string | null;
}

interface TaskResponse {
  task: PublicTask;
  currentJob?: { id?: string; status?: string | null } | null;
  events?: unknown[];
}

interface TimelineResponse {
  events?: unknown[];
  taskEvents?: unknown[];
  entries?: Array<{ line?: string; ts?: string }>;
  closed?: boolean;
}

interface CaseResult {
  caseId: string;
  prompt: string;
  taskId?: string;
  currentJobId?: string | null;
  state?: TaskState;
  terminalCode?: string | null;
  terminalReason?: string | null;
  outcome: OutcomeBucket;
  taxonomyCode?: string;
  expectedOutcomes: OutcomeBucket[];
  acceptableFailureTaxonomy: string[];
  safe: boolean;
  bookingReady: boolean;
  severe: boolean;
  expectedOutcomeMatched: boolean;
  taxonomyAccepted: boolean;
  durationMs: number;
  timelineUrl?: string | null;
  snapshotsUrl?: string | null;
  error?: string;
}

const FIXTURE_PATH = path.resolve(process.cwd(), "benchmark", "restaurant-resy-phase0.json");
const REPORT_DIR = path.resolve(process.cwd(), "benchmark", "runs");
const USER_WAITING_STATES = new Set(["awaiting_profile", "awaiting_login", "awaiting_otp", "ready_for_confirmation"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const BOOKING_READY_BUCKETS = new Set<OutcomeBucket>([
  "booking_confirmed",
  "ready_for_confirmation",
  "recovered_via_fallback",
]);
const SAFE_BUCKETS = new Set<OutcomeBucket>([
  "booking_confirmed",
  "ready_for_confirmation",
  "safe_handoff",
  "no_availability_correct",
  "recovered_via_fallback",
  "failed_with_clear_reason",
]);

function loadDotenv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const raw = fs.readFileSync(candidate, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
    return;
  }
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return flags;
}

function stringFlag(flags: Flags, key: string, fallback?: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberFlag(flags: Flags, key: string, fallback: number): number {
  const value = flags[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFlag(flags: Flags, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function resolveApiKey(baseUrl: string, flags: Flags, dryRun: boolean): Promise<string | undefined> {
  const explicit =
    stringFlag(flags, "api-key") ??
    process.env.ONEGENT_BENCHMARK_API_KEY ??
    process.env.ONEGENT_API_KEY ??
    process.env.API_KEY;
  if (explicit || dryRun) return explicit;
  if (!isLocalBaseUrl(baseUrl)) return undefined;

  const created = await createApiKey({
    organizationName: "Phase 0 local benchmark",
    env: "test",
    allowedJobTypes: ["restaurant"],
    rateLimitPerDay: 200,
    userId: null,
  });
  console.log("[phase0] minted ephemeral local benchmark API key (not printed)");
  return created.plaintextKey;
}

function usage(): void {
  console.log(`Usage:
  npx tsx scripts/run-phase0-resy-benchmark.ts --dry-run
  npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003
  npx tsx scripts/run-phase0-resy-benchmark.ts --limit 3
  npx tsx scripts/run-phase0-resy-benchmark.ts --dispatch-only

Options:
  --base-url <url>       Defaults to http://localhost:3000
  --api-key <ogk_...>    Defaults to ONEGENT_BENCHMARK_API_KEY, ONEGENT_API_KEY, or API_KEY
  --case <R-NNN>         Run one case
  --limit <n>            Limit selected cases
  --concurrency <n>      Defaults to 1. Keep 1 for local browser runs.
  --timeout-ms <n>       Per-case wait timeout. Defaults to 420000.
  --poll-ms <n>          Poll interval. Defaults to 2500.
  --live-openai          Required for live runs; prevents accidental Computer Use spend.
  --confirm-suite        Required with --live-openai when running more than one selected case.
  --dry-run              Print payloads; do not call the API.
  --dispatch-only        Create tasks but do not wait for completion.
  --allow-failures       Exit 0 even when the Phase 0 gate fails.
`);
}

function loadSuite(): BenchmarkSuite {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as BenchmarkSuite;
}

function liveOpenAiAllowed(flags: Flags): boolean {
  if (booleanFlag(flags, "live-openai")) return true;
  return /^(1|true|yes)$/i.test(process.env.ONEGENT_ALLOW_LIVE_OPENAI ?? "");
}

function selectCases(suite: BenchmarkSuite, flags: Flags): BenchmarkCase[] {
  const caseId = stringFlag(flags, "case");
  let cases = suite.cases;
  if (caseId) {
    cases = cases.filter((testCase) => testCase.id === caseId);
    if (cases.length === 0) throw new Error(`No benchmark case found for ${caseId}`);
  }
  const limit = numberFlag(flags, "limit", cases.length);
  return cases.slice(0, Math.max(0, limit));
}

function defaultProfile(): Record<string, unknown> {
  const fromEnv = process.env.ONEGENT_BENCHMARK_PROFILE_JSON;
  if (fromEnv) {
    const parsed = JSON.parse(fromEnv);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("ONEGENT_BENCHMARK_PROFILE_JSON must parse to an object.");
    }
    return parsed as Record<string, unknown>;
  }

  return {
    first_name: "Benchmark",
    last_name: "User",
    email: "benchmark@onegent.test",
    phone: "+15555550100",
    address_line1: "1 Test Street",
    city: "New York",
    state: "NY",
    zip: "10001",
    country: "US",
  };
}

function resyStartUrl(testCase: BenchmarkCase): string {
  const slug = encodeURIComponent(testCase.resySlug);
  const seats = encodeURIComponent(String(testCase.covers));
  const time = encodeURIComponent(testCase.time.replace(":", ""));
  return `https://resy.com/cities/new-york-ny/venues/${slug}?date=${testCase.date}&seats=${seats}&time=${time}`;
}

function buildCreatePayload(
  suite: BenchmarkSuite,
  testCase: BenchmarkCase,
  runId: string,
): Record<string, unknown> {
  const timeWindow = testCase.fallbackPolicy.time_window_minutes ?? 60;
  return {
    execution: {
      request: {
        scenario: "restaurant",
        params: {
          restaurant_name: testCase.restaurantName,
          city: testCase.city,
          date: testCase.date,
          time: testCase.time,
          covers: testCase.covers,
          startUrl: resyStartUrl(testCase),
          fallback_policy: {
            time_window_minutes: timeWindow,
            allow_platform_switch: false,
            allow_venue_switch: false,
            require_user_approval_before_booking: true,
          },
        },
      },
      profile: defaultProfile(),
      consent: {
        allowTimeAdjustment: true,
        maxTimeAdjustmentMinutes: timeWindow,
        allowVenueSwitch: false,
        maxRetries: 1,
        paymentPolicy: "stop_before_cvc",
        allowedProviders: ["resy-com"],
        maxJobDurationSeconds: 420,
      },
      clientMetadata: {
        agentId: "phase0-resy-benchmark",
        sessionId: runId,
        idempotencyKey: `${suite.suiteId}:${testCase.id}:${runId}`,
        preferredExecutor: "computer_use",
      },
    },
    task: {
      title: `${testCase.id} ${testCase.restaurantName}`,
      policy: {
        benchmarkSuiteId: suite.suiteId,
        benchmarkSuiteVersion: suite.version,
        benchmarkCaseId: testCase.id,
        prompt: testCase.prompt,
        provider: testCase.provider,
        stability: testCase.stability,
        expectedOutcomes: testCase.expectedOutcomes,
        acceptableFailureTaxonomy: testCase.acceptableFailureTaxonomy,
        severeTripwires: testCase.severeTripwires,
      },
    },
  };
}

async function requestJson<T>(
  url: string,
  options: RequestInit & { apiKey: string },
): Promise<T> {
  const { apiKey, headers, ...init } = options;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = body ? JSON.stringify(body) : response.statusText;
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return body as T;
}

async function createTravelTask(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<{ task: PublicTask; currentJobId?: string | null }> {
  return requestJson(`${baseUrl}/api/v1/travel-tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
    apiKey,
  });
}

async function getTravelTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<TaskResponse> {
  return requestJson(`${baseUrl}/api/v1/travel-tasks/${taskId}`, {
    method: "GET",
    apiKey,
  });
}

async function getTimeline(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<TimelineResponse> {
  return requestJson(`${baseUrl}/api/v1/travel-tasks/${taskId}/timeline-events?format=json`, {
    method: "GET",
    apiKey,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isClosedState(state: TaskState | undefined): boolean {
  return Boolean(state && (USER_WAITING_STATES.has(state) || TERMINAL_STATES.has(state)));
}

async function waitForTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<{ taskResponse: TaskResponse; timeline: TimelineResponse; timedOut: boolean }> {
  const startedAt = Date.now();
  let lastTask = await getTravelTask(baseUrl, apiKey, taskId);
  let lastTimeline = await getTimeline(baseUrl, apiKey, taskId).catch(() => ({}) as TimelineResponse);

  while (!isClosedState(lastTask.task?.state) && Date.now() - startedAt < timeoutMs) {
    await sleep(pollMs);
    lastTask = await getTravelTask(baseUrl, apiKey, taskId);
    lastTimeline = await getTimeline(baseUrl, apiKey, taskId).catch(() => lastTimeline);
    process.stdout.write(".");
  }

  return {
    taskResponse: lastTask,
    timeline: lastTimeline,
    timedOut: !isClosedState(lastTask.task?.state),
  };
}

function textBlob(taskResponse?: TaskResponse, timeline?: TimelineResponse): string {
  return JSON.stringify({ taskResponse, timeline }).toLowerCase();
}

function inferSevereTaxonomy(text: string): string | undefined {
  if (/\bwrong (restaurant|venue|property)\b|venue mismatch|restaurant mismatch/.test(text)) {
    return "F-LOGIC-WRONG-VENUE";
  }
  if (/\bwrong (time|date|slot)\b|date mismatch|time mismatch/.test(text)) {
    return "F-LOGIC-WRONG-TIME";
  }
  if (/\bwrong (party|covers|guests|guest count)\b|party size mismatch/.test(text)) {
    return "F-LOGIC-WRONG-PARTY";
  }
  if (/unauthorized payment|submitted payment|charged without|cvv submitted/.test(text)) {
    return "F-LOGIC-UNAUTHORIZED-PAYMENT";
  }
  if (/hallucinated confirmation|fake confirmation|claimed success without/.test(text)) {
    return "F-LOGIC-HALLUCINATED-CONFIRM";
  }
  return undefined;
}

function inferFailureTaxonomy(
  task: PublicTask | undefined,
  text: string,
  timedOut: boolean,
): string | undefined {
  const terminalCode = task?.terminalCode?.toLowerCase();
  if (terminalCode === "needs_profile_data" || task?.state === "awaiting_profile") return "F-DATA-PROFILE";
  if (terminalCode === "needs_login" || task?.state === "awaiting_login") return "F-PROVIDER-LOGIN";
  if (terminalCode === "needs_otp" || task?.state === "awaiting_otp") return "F-PROVIDER-OTP";
  if (terminalCode === "no_availability" || /no availability|not available|unavailable|sold out/.test(text)) return "F-AVAIL-NONE";
  if (terminalCode === "captcha" || /captcha|access denied|akamai|blocked/.test(text)) return "F-PROVIDER-CAPTCHA";
  if (/model_not_found|does not have access to model|computer-use-preview/.test(text)) return "F-INFRA-MODEL-ACCESS";
  if (/unknown parameter|invalid_request_error|responses api 400/.test(text)) return "F-INFRA-API-SCHEMA";
  if (/insufficient_quota|quota|billing|rate limit|responses api 402|responses api 429/.test(text)) return "F-INFRA-PROVIDER-QUOTA";
  if (/responses api 5\d\d|server_error|server had an error processing/i.test(text)) return "F-INFRA-CRASH";
  if (terminalCode === "executor_crashed" || /executor crashed|uncaught|exception|crash|keyboard\.press: unknown key/.test(text)) return "F-INFRA-CRASH";
  if (/timeout|timed out/.test(text) || timedOut) return "F-INFRA-TIMEOUT";
  if (/dom|selector|button|click failed|could not click/.test(text)) return "F-DATA-DOM";
  if (/no tables? for (?:that )?party|party size unavailable|can't accommodate.*party|covers unavailable|guest count unavailable|party size/i.test(text)) return "F-AVAIL-PARTY";
  if (/provider|resy|opentable/.test(text)) return "F-PROVIDER-UNKNOWN";
  return undefined;
}

function classifyResult(
  testCase: BenchmarkCase,
  taskResponse: TaskResponse | undefined,
  timeline: TimelineResponse | undefined,
  startedAt: number,
  timedOut: boolean,
  error?: string,
): CaseResult {
  const task = taskResponse?.task;
  const text = `${error ?? ""} ${textBlob(taskResponse, timeline)}`;
  const severeTaxonomy = inferSevereTaxonomy(text);
  const durationMs = Date.now() - startedAt;

  if (severeTaxonomy) {
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: "severe_error",
      taxonomyCode: severeTaxonomy,
      error,
    });
  }

  if (error) {
    const taxonomyCode = inferFailureTaxonomy(task, text, timedOut);
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: taxonomyCode ? "failed_with_clear_reason" : "failed_unknown",
      taxonomyCode,
      error,
    });
  }

  if (timedOut) {
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: "failed_with_clear_reason",
      taxonomyCode: "F-INFRA-TIMEOUT",
    });
  }

  const state = task?.state;
  const terminalCode = task?.terminalCode?.toLowerCase();

  if (state === "completed") {
    return finishResult(testCase, { task, durationMs, outcome: "booking_confirmed" });
  }
  if (state === "ready_for_confirmation") {
    const hasFallback = /fallback|provider_fallback|retry/i.test(text);
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: hasFallback ? "recovered_via_fallback" : "ready_for_confirmation",
    });
  }
  if (state === "awaiting_login" || state === "awaiting_otp" || state === "awaiting_profile") {
    const taxonomyCode = inferFailureTaxonomy(task, text, false);
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: state === "awaiting_otp" ? "safe_handoff" : "failed_with_clear_reason",
      taxonomyCode,
    });
  }
  if (state === "failed" && (terminalCode === "no_availability" || /no availability|not available|unavailable|sold out/.test(text))) {
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: "no_availability_correct",
      taxonomyCode: inferFailureTaxonomy(task, text, false) ?? "F-AVAIL-NONE",
    });
  }
  if (state === "failed" || state === "cancelled") {
    const taxonomyCode = inferFailureTaxonomy(task, text, false);
    return finishResult(testCase, {
      task,
      durationMs,
      outcome: taxonomyCode ? "failed_with_clear_reason" : "failed_unknown",
      taxonomyCode,
    });
  }

  return finishResult(testCase, {
    task,
    durationMs,
    outcome: "failed_unknown",
    taxonomyCode: inferFailureTaxonomy(task, text, false),
  });
}

function finishResult(
  testCase: BenchmarkCase,
  params: {
    task?: PublicTask;
    durationMs: number;
    outcome: OutcomeBucket;
    taxonomyCode?: string;
    error?: string;
  },
): CaseResult {
  const phase0OtpAccepted =
    testCase.provider === "Resy" &&
    params.outcome === "safe_handoff" &&
    params.taxonomyCode === "F-PROVIDER-OTP";
  const taxonomyAccepted =
    !params.taxonomyCode ||
    phase0OtpAccepted ||
    testCase.acceptableFailureTaxonomy.includes(params.taxonomyCode) ||
    testCase.severeTripwires.includes(params.taxonomyCode);
  return {
    caseId: testCase.id,
    prompt: testCase.prompt,
    taskId: params.task?.id,
    currentJobId: params.task?.currentBookingJobId,
    state: params.task?.state,
    terminalCode: params.task?.terminalCode,
    terminalReason: params.task?.terminalReason,
    outcome: params.outcome,
    taxonomyCode: params.taxonomyCode,
    expectedOutcomes: testCase.expectedOutcomes,
    acceptableFailureTaxonomy: testCase.acceptableFailureTaxonomy,
    safe: SAFE_BUCKETS.has(params.outcome),
    bookingReady: BOOKING_READY_BUCKETS.has(params.outcome),
    severe: params.outcome === "severe_error",
    expectedOutcomeMatched: testCase.expectedOutcomes.includes(params.outcome),
    taxonomyAccepted,
    durationMs: params.durationMs,
    timelineUrl: phase0TaskTimelineUrl(params.task?.id),
    snapshotsUrl: phase0TaskSnapshotsUrl(params.task?.id),
    error: params.error,
  };
}

async function runCase(params: {
  suite: BenchmarkSuite;
  testCase: BenchmarkCase;
  baseUrl: string;
  apiKey: string;
  runId: string;
  timeoutMs: number;
  pollMs: number;
  dryRun: boolean;
  dispatchOnly: boolean;
}): Promise<CaseResult> {
  const { suite, testCase, baseUrl, apiKey, runId, timeoutMs, pollMs, dryRun, dispatchOnly } = params;
  const startedAt = Date.now();
  const payload = buildCreatePayload(suite, testCase, runId);

  if (dryRun) {
    console.log(JSON.stringify({ caseId: testCase.id, payload }, null, 2));
    return finishResult(testCase, {
      durationMs: Date.now() - startedAt,
      outcome: "failed_with_clear_reason",
      taxonomyCode: "F-INFRA-DRY-RUN",
    });
  }

  try {
    const created = await createTravelTask(baseUrl, apiKey, payload);
    const taskId = created.task.id;
    console.log(`[${testCase.id}] created task=${taskId} job=${created.currentJobId ?? created.task.currentBookingJobId ?? "unknown"}`);

    if (dispatchOnly) {
      return finishResult(testCase, {
        task: created.task,
        durationMs: Date.now() - startedAt,
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-INFRA-DISPATCH-ONLY",
      });
    }

    const waited = await waitForTask(baseUrl, apiKey, taskId, timeoutMs, pollMs);
    console.log("");
    return classifyResult(testCase, waited.taskResponse, waited.timeline, startedAt, waited.timedOut);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return classifyResult(testCase, undefined, undefined, startedAt, false, message);
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}

function summarize(suite: BenchmarkSuite, results: CaseResult[]) {
  const total = results.length;
  const bookingReady = results.filter((result) => result.bookingReady).length;
  const safe = results.filter((result) => result.safe).length;
  const severe = results.filter((result) => result.severe).length;
  const taxonomyNeeded = results.filter((result) => !result.bookingReady);
  const taxonomyCovered = taxonomyNeeded.filter((result) => Boolean(result.taxonomyCode)).length;
  const bookingReadyRate = total ? bookingReady / total : 0;
  const safeOutcomeRate = total ? safe / total : 0;
  const severeErrorRate = total ? severe / total : 0;
  const taxonomyCoverageRate = taxonomyNeeded.length ? taxonomyCovered / taxonomyNeeded.length : 1;
  const gate = suite.acceptanceGate;

  return {
    total,
    bookingReady,
    safe,
    severe,
    taxonomyNeeded: taxonomyNeeded.length,
    taxonomyCovered,
    bookingReadyRate,
    safeOutcomeRate,
    severeErrorRate,
    taxonomyCoverageRate,
    passed:
      bookingReadyRate >= gate.bookingReadyRateMin &&
      safeOutcomeRate >= gate.safeOutcomeRateMin &&
      severeErrorRate <= gate.severeErrorRateMax &&
      taxonomyCoverageRate >= gate.taxonomyCoverageRateMin,
  };
}

function writeReport(report: Record<string, unknown>): string {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(REPORT_DIR, `phase0-resy-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  return outputPath;
}

async function main(): Promise<void> {
  loadDotenv();
  const flags = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "help") || booleanFlag(flags, "h")) {
    usage();
    return;
  }

  const suite = loadSuite();
  const selected = selectCases(suite, flags);
  const dryRun = booleanFlag(flags, "dry-run");
  const dispatchOnly = booleanFlag(flags, "dispatch-only");
  const baseUrl = stringFlag(flags, "base-url", process.env.ONEGENT_BASE_URL ?? "http://localhost:3000")!.replace(/\/$/, "");
  if (!dryRun && !liveOpenAiAllowed(flags)) {
    throw new Error(
      "Refusing to run live Phase 0 Computer Use benchmark without --live-openai " +
        "or ONEGENT_ALLOW_LIVE_OPENAI=1. Use --dry-run for payload validation.",
    );
  }
  if (!dryRun && selected.length > 1 && !booleanFlag(flags, "confirm-suite")) {
    throw new Error(
      `Refusing to run ${selected.length} live Phase 0 Computer Use cases without --confirm-suite. ` +
        "Use --case R-003 for a one-case smoke, or pass --confirm-suite when you intentionally want a multi-case spend.",
    );
  }
  const apiKey = await resolveApiKey(baseUrl, flags, dryRun);
  const concurrency = numberFlag(flags, "concurrency", 1);
  const timeoutMs = numberFlag(flags, "timeout-ms", 420_000);
  const pollMs = numberFlag(flags, "poll-ms", 2_500);
  const runId = stringFlag(flags, "run-id", `phase0-resy-${new Date().toISOString()}-${randomUUID()}`)!;

  if (!dryRun && !apiKey) {
    throw new Error("Missing API key. Pass --api-key or set ONEGENT_BENCHMARK_API_KEY / ONEGENT_API_KEY / API_KEY.");
  }
  if (suite.cases.length !== suite.observedResyCaseCount) {
    console.warn(`[phase0] fixture count mismatch: cases=${suite.cases.length}, observed=${suite.observedResyCaseCount}`);
  }
  if (suite.observedResyCaseCount !== suite.expectedResyCaseCountFromDoc) {
    console.warn(
      `[phase0] source doc count mismatch: doc says ${suite.expectedResyCaseCountFromDoc}, extracted ${suite.observedResyCaseCount}.`,
    );
  }

  console.log(`[phase0] suite=${suite.suiteId} selected=${selected.length} dryRun=${dryRun} dispatchOnly=${dispatchOnly}`);
  const results = await mapLimit(selected, concurrency, async (testCase, index) => {
    console.log(`[phase0] ${index + 1}/${selected.length} ${testCase.id} ${testCase.restaurantName} ${testCase.date} ${testCase.time} x${testCase.covers}`);
    return runCase({
      suite,
      testCase,
      baseUrl,
      apiKey: apiKey ?? "",
      runId,
      timeoutMs,
      pollMs,
      dryRun,
      dispatchOnly,
    });
  });

  const metrics = summarize(suite, results);
  const report = {
    schemaVersion: PHASE0_REPORT_SCHEMA_VERSION,
    reportKind: PHASE0_REPORT_KIND,
    runId,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    baseUrl,
    createdAt: new Date().toISOString(),
    dryRun,
    dispatchOnly,
    metrics,
    results,
  };
  const outputPath = dryRun ? null : writeReport(report);

  console.log(JSON.stringify(metrics, null, 2));
  if (outputPath) console.log(`[phase0] report=${outputPath}`);
  if (!dryRun && !metrics.passed && !booleanFlag(flags, "allow-failures")) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
