import { chromium, type Browser, type Page } from "playwright";
import { saveBrowserSnapshot } from "../browser-snapshot-store";
import { writeAudit } from "../core/audit/audit-log";
import type { ExecutionJobResult, ExecutionJobStatus } from "../core/execution/types";
import { liveLogClose, liveLogPush, liveLogReset } from "../live-log-store";
import type { BookingExecutor, BookingExecutorInput } from "./types";

type OpenAIComputerAction = {
  type: string;
  x?: number;
  y?: number;
  button?: string;
  text?: string;
  keys?: string[];
  scroll_x?: number;
  scroll_y?: number;
  path?: Array<{ x: number; y: number }>;
};

type OpenAIComputerCall = {
  type: "computer_call";
  call_id?: string;
  id?: string;
  pending_safety_checks?: Array<Record<string, unknown>>;
  actions?: OpenAIComputerAction[];
  // Legacy preview compatibility; GA Computer Use uses actions[].
  action?: OpenAIComputerAction;
};

type OpenAIResponse = {
  id: string;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
};

const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_MAX_STEPS = 30;
const DEFAULT_COMPUTER_USE_MODEL = "computer-use-preview";

const computerUseTool = {
  type: "computer_use_preview",
  environment: "browser",
  display_width: DEFAULT_VIEWPORT.width,
  display_height: DEFAULT_VIEWPORT.height,
};

export const computerUseExecutor: BookingExecutor = {
  id: "computer_use",
  async run(input: BookingExecutorInput): Promise<ExecutionJobResult> {
    return runComputerUse(input);
  },
};

async function runComputerUse(input: BookingExecutorInput): Promise<ExecutionJobResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const createdAt = input.createdAt;
  const stepIndex = input.ctx.stepIndex;
  const jobId = input.ctx.jobId;

  if (!apiKey) {
    return result(input, "error", "OPENAI_API_KEY is required for computer_use executor.", createdAt);
  }

  liveLogReset(jobId);
  trace(jobId, "[computer-use] starting visual executor");

  let browser: Browser | undefined;
  let finalScreenshot: string | undefined;

  try {
    browser = await chromium.launch({
      headless: process.env.ONEGENT_COMPUTER_USE_HEADLESS !== "false",
    });
    const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
    await page.goto(input.browserTask.startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    finalScreenshot = await capture(page, input, "Opened booking page", input.browserTask.startUrl, "live");

    await writeAudit({
      jobId,
      stepIndex,
      type: "step_started",
      message: `Computer Use opened ${shortHost(input.browserTask.startUrl)}`,
      details: { executor: "computer_use", startUrl: input.browserTask.startUrl },
    });

    const prompt = buildComputerUsePrompt(input);
    let response = await createOpenAIResponse(apiKey, {
      model: process.env.OPENAI_COMPUTER_USE_MODEL ?? DEFAULT_COMPUTER_USE_MODEL,
      tools: [computerUseTool],
      truncation: "auto",
      input: prompt,
    });

    let finalText = getResponseText(response);
    const maxSteps = parseInt(process.env.ONEGENT_COMPUTER_USE_MAX_STEPS ?? `${DEFAULT_MAX_STEPS}`, 10);

    for (let i = 0; i < maxSteps; i += 1) {
      const calls = getComputerCalls(response);
      if (calls.length === 0) break;

      const outputs = [];
      for (const call of calls) {
        const actions = call.actions ?? (call.action ? [call.action] : []);
        for (const action of actions) {
          trace(jobId, `[computer-use] action ${action.type}${formatAction(action)}`);
          await executeComputerAction(page, action);
          await page.waitForTimeout(450);
        }

        finalScreenshot = await capture(
          page,
          input,
          describeActions(actions),
          await safeUrl(page),
          "live",
          lastPointerAction(actions),
        );

        const callId = call.call_id ?? call.id;
        if (!callId) {
          throw new Error("Computer Use response omitted call_id.");
        }
        outputs.push({
          type: "computer_call_output",
          call_id: callId,
          acknowledged_safety_checks: call.pending_safety_checks ?? [],
          current_url: await safeUrl(page),
          output: {
            type: "input_image",
            image_url: `data:image/png;base64,${finalScreenshot}`,
          },
        });
      }

      const observed = await classifyPage(page);
      if (observed.status === "needs_otp" || observed.status === "ready_for_confirmation") {
        finalText = observed.summary;
        await writeAudit({
          jobId,
          stepIndex,
          type: observed.status === "needs_otp" ? "job_needs_otp" : "job_ready_for_confirmation",
          message: observed.summary,
          details: { executor: "computer_use", url: await safeUrl(page) },
        });
        return result(input, observed.status, observed.summary, createdAt, {
          handoffUrl: await safeUrl(page),
          screenshotBase64: finalScreenshot,
        });
      }

      response = await createOpenAIResponse(apiKey, {
        model: process.env.OPENAI_COMPUTER_USE_MODEL ?? DEFAULT_COMPUTER_USE_MODEL,
        tools: [computerUseTool],
        truncation: "auto",
        previous_response_id: response.id,
        input: outputs,
      });
      finalText = getResponseText(response) || finalText;
    }

    finalScreenshot = await capture(page, input, "Final visual state", await safeUrl(page), "info");
    const observed = await classifyPage(page, finalText);
    await writeAudit({
      jobId,
      stepIndex,
      type:
        observed.status === "needs_otp"
          ? "job_needs_otp"
          : observed.status === "ready_for_confirmation"
          ? "job_ready_for_confirmation"
          : observed.status === "completed"
          ? "job_completed"
          : observed.status === "no_availability"
          ? "job_failed"
          : observed.status === "needs_login"
          ? "job_failed"
          : "job_failed",
      message: observed.summary,
      details: { executor: "computer_use", url: await safeUrl(page), finalText },
    });

    return result(input, observed.status, observed.summary, createdAt, {
      handoffUrl: await safeUrl(page),
      screenshotBase64: finalScreenshot,
      error: observed.status === "error" ? observed.summary : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace(jobId, `[computer-use] failed: ${message}`);
    await writeAudit({
      jobId,
      stepIndex,
      type: "job_failed",
      message: `Computer Use failed: ${message}`,
      details: { executor: "computer_use" },
    });
    return result(input, "error", message, createdAt, {
      screenshotBase64: finalScreenshot,
      error: message,
    });
  } finally {
    if (browser && process.env.ONEGENT_COMPUTER_USE_KEEP_BROWSER !== "true") {
      await browser.close().catch(() => {});
    }
    liveLogClose(jobId);
  }
}

function buildComputerUsePrompt(input: BookingExecutorInput): string {
  const profile = input.browserTask.profile;
  return [
    "You are Onegent's visual booking executor.",
    "Complete the booking workflow using the browser screen.",
    "Never click a final irreversible confirmation, purchase, reserve, or payment button that would actually place the booking.",
    "Stop when you reach one of these states: email/SMS one-time passcode required; login required; final user confirmation required; no availability confirmed; captcha/bot block.",
    "Do not enter CVV. Do not submit payment.",
    "If a button says Confirm, Reserve Now, Complete reservation, Purchase, Pay, or Book, only click it when it is clearly an intermediate step before login/OTP/payment. Stop before the final action that commits the reservation.",
    "When you stop, include exactly one handoff token in your response: ONEGENT_NEEDS_OTP, ONEGENT_NEEDS_LOGIN, ONEGENT_PAUSED_PAYMENT, ONEGENT_READY_FOR_CONFIRMATION, ONEGENT_NO_AVAILABILITY, ONEGENT_COMPLETED, or ONEGENT_FAILED.",
    `Task: ${input.browserTask.task}`,
    `Start URL: ${input.browserTask.startUrl}`,
    `Contact profile: ${profile.first_name} ${profile.last_name}, email ${profile.email}, phone ${profile.phone}.`,
  ].join("\n");
}

async function createOpenAIResponse(apiKey: string, body: Record<string, unknown>): Promise<OpenAIResponse> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI Responses API ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as OpenAIResponse;
}

async function executeComputerAction(page: Page, action: OpenAIComputerAction): Promise<void> {
  switch (action.type) {
    case "click":
      await page.mouse.click(action.x ?? 0, action.y ?? 0, { button: normalizeButton(action.button) });
      return;
    case "double_click":
    case "doubleClick":
      await page.mouse.dblclick(action.x ?? 0, action.y ?? 0, { button: normalizeButton(action.button) });
      return;
    case "move":
      await page.mouse.move(action.x ?? 0, action.y ?? 0);
      return;
    case "scroll":
      await page.mouse.move(action.x ?? DEFAULT_VIEWPORT.width / 2, action.y ?? DEFAULT_VIEWPORT.height / 2);
      await page.mouse.wheel(action.scroll_x ?? 0, action.scroll_y ?? 0);
      return;
    case "keypress":
      for (const key of action.keys ?? []) {
        await page.keyboard.press(key);
      }
      return;
    case "type":
      if (action.text) await page.keyboard.type(action.text);
      return;
    case "wait":
      await page.waitForTimeout(1000);
      return;
    case "screenshot":
      return;
    case "drag":
      if (!action.path?.length) return;
      await page.mouse.move(action.path[0].x, action.path[0].y);
      await page.mouse.down();
      for (const point of action.path.slice(1)) {
        await page.mouse.move(point.x, point.y);
      }
      await page.mouse.up();
      return;
    default:
      throw new Error(`Unsupported computer action: ${action.type}`);
  }
}

async function capture(
  page: Page,
  input: BookingExecutorInput,
  title: string,
  detail: string,
  status: "info" | "live" | "success" | "warning" | "error",
  action?: OpenAIComputerAction,
): Promise<string> {
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  const imageBase64 = buffer.toString("base64");
  await saveBrowserSnapshot({
    jobId: input.ctx.jobId,
    ts: new Date().toISOString(),
    title,
    detail,
    status,
    imageBase64,
    url: await safeUrl(page),
    marker:
      typeof action?.x === "number" && typeof action?.y === "number"
        ? {
            xPct: Math.max(0, Math.min(100, (action.x / DEFAULT_VIEWPORT.width) * 100)),
            yPct: Math.max(0, Math.min(100, (action.y / DEFAULT_VIEWPORT.height) * 100)),
            label: action.type,
          }
        : undefined,
  });
  return imageBase64;
}

async function classifyPage(
  page: Page,
  modelText = "",
): Promise<{ status: ExecutionJobStatus; summary: string }> {
  const text = `${modelText}\n${await page.locator("body").innerText({ timeout: 2500 }).catch(() => "")}`;

  if (text.includes("ONEGENT_NEEDS_OTP")) {
    return { status: "needs_otp", summary: "The booking flow is waiting for a one-time verification code." };
  }
  if (text.includes("ONEGENT_NEEDS_LOGIN")) {
    return { status: "needs_login", summary: "The booking site requires account login or identity verification." };
  }
  if (text.includes("ONEGENT_PAUSED_PAYMENT")) {
    return { status: "paused_payment", summary: "The booking flow reached a payment gate." };
  }
  if (text.includes("ONEGENT_READY_FOR_CONFIRMATION")) {
    return {
      status: "ready_for_confirmation",
      summary: "The booking flow reached the final user confirmation gate.",
    };
  }
  if (text.includes("ONEGENT_NO_AVAILABILITY")) {
    return { status: "no_availability", summary: "No matching availability was found for the requested booking." };
  }
  if (text.includes("ONEGENT_COMPLETED")) {
    return { status: "completed", summary: "The booking flow appears to be completed." };
  }

  if (/captcha|access denied|bot|blocked/i.test(text)) {
    return { status: "captcha", summary: "The booking site blocked the automated browser." };
  }
  if (/check your email|confirmation code|one[- ]?time code|one[- ]?time passcode|verification code/i.test(text)) {
    return { status: "needs_otp", summary: "The booking flow is waiting for a one-time verification code." };
  }
  if (/log in|required to sign in|please log in|mobile number to verify/i.test(text)) {
    return { status: "needs_login", summary: "The booking site requires account login or identity verification." };
  }
  if (/no availability|not available|can't accommodate|sold out|no times/i.test(text)) {
    return { status: "no_availability", summary: "No matching availability was found for the requested booking." };
  }
  if (/cvv|cvc|security code|card security|payment information/i.test(text)) {
    return { status: "paused_payment", summary: "The booking flow reached a payment gate." };
  }
  if (/done|completed|reservation is confirmed|booking confirmed/i.test(text)) {
    return { status: "completed", summary: "The booking flow appears to be completed." };
  }
  return {
    status: "error",
    summary: modelText || "Computer Use stopped without reaching a known handoff state.",
  };
}

function getComputerCalls(response: OpenAIResponse): OpenAIComputerCall[] {
  return (response.output ?? []).filter((item): item is OpenAIComputerCall => item.type === "computer_call");
}

function getResponseText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("\n");
}

function result(
  input: BookingExecutorInput,
  status: ExecutionJobStatus,
  summary: string,
  createdAt: string,
  extra: Partial<ExecutionJobResult> = {},
): ExecutionJobResult {
  const now = new Date().toISOString();
  return {
    jobId: input.ctx.jobId,
    status,
    summary,
    handoffUrl: extra.handoffUrl ?? input.browserTask.startUrl,
    sessionUrl: extra.sessionUrl,
    screenshotBase64: extra.screenshotBase64,
    decisionLog: extra.decisionLog ?? [],
    error: extra.error,
    availableSlots: extra.availableSlots,
    createdAt,
    updatedAt: now,
    completedAt: isTerminalStatus(status) ? now : undefined,
    attemptCount: 1,
    usedFallback: false,
  };
}

function isTerminalStatus(s: ExecutionJobStatus): boolean {
  return s !== "pending" && s !== "running";
}

function trace(jobId: string, line: string): void {
  liveLogPush(jobId, line);
}

function formatAction(action: OpenAIComputerAction): string {
  const xy = typeof action.x === "number" && typeof action.y === "number" ? ` @${action.x},${action.y}` : "";
  const text = action.text ? ` "${action.text.slice(0, 40)}"` : "";
  const keys = action.keys?.length ? ` ${action.keys.join("+")}` : "";
  return `${xy}${text}${keys}`;
}

function describeActions(actions: OpenAIComputerAction[]): string {
  if (actions.length === 0) return "Observed page";
  if (actions.length > 1) return `Ran ${actions.length} browser actions`;
  const [action] = actions;
  switch (action.type) {
    case "click":
    case "double_click":
    case "doubleClick":
      return "Clicked page control";
    case "type":
      return "Typed into form";
    case "keypress":
      return "Pressed keyboard shortcut";
    case "scroll":
      return "Scrolled page";
    default:
      return `Ran ${action.type}`;
  }
}

function lastPointerAction(actions: OpenAIComputerAction[]): OpenAIComputerAction | undefined {
  return [...actions]
    .reverse()
    .find((action) => typeof action.x === "number" && typeof action.y === "number");
}

function normalizeButton(button: string | undefined): "left" | "right" | "middle" {
  return button === "right" || button === "middle" ? button : "left";
}

async function safeUrl(page: Page): Promise<string> {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function shortHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.slice(0, 80);
  }
}
