import type { LayerModel } from "@/lib/llm-client";

export const MAX_CAPTURE_IMAGE_BYTES = 8 * 1024 * 1024;

const SUPPORTED_IMAGE_DATA_URL_RE =
  /^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+$/i;

export interface CaptureImagePayload {
  type: "image";
  mime_type: string;
  data_url: string;
  name?: string;
  size?: number;
}

export interface CaptureImageAnalysis {
  status: "analyzed" | "unavailable" | "failed";
  summary_text: string;
  provider?: "openai";
  model?: string;
  error?: string;
}

export function summarizeCaptureImageAnalysisForUser(
  analysis: CaptureImageAnalysis,
): string | null {
  if (analysis.status === "unavailable") {
    return "I received the screenshot, but image analysis is not available in this environment yet.";
  }
  if (analysis.status === "failed") {
    return "I received the screenshot, but image analysis failed, so I need you to describe the event, place, or provider before I create a task.";
  }

  const fields = parseVisionSummaryFields(analysis.summary_text);
  const visibleFacts: string[] = [];
  addVisibleFact(visibleFacts, "title", fields.title);
  addVisibleFact(visibleFacts, "provider", fields.provider);
  addVisibleFact(visibleFacts, "city", fields.city);
  addVisibleFact(visibleFacts, "date", fields.date);
  addVisibleFact(visibleFacts, "time", fields.time);
  addVisibleFact(visibleFacts, "price/budget", fields.price_or_budget);

  const concise = sanitizeVisionField(fields.concise_summary);
  const missing = sanitizeVisionField(fields.missing_fields);
  if (visibleFacts.length === 0 && !concise) {
    return "I analyzed the screenshot, but I could not identify enough travel details from it.";
  }

  const seen = visibleFacts.length > 0
    ? `I analyzed the screenshot and can see: ${visibleFacts.join("; ")}.`
    : `I analyzed the screenshot: ${concise}.`;
  return missing ? `${seen} Still needed: ${missing}.` : seen;
}

export function applyCaptureImageAssistantPrefix(
  result: { assistant_reply?: string | null },
  analysis: CaptureImageAnalysis | null,
): void {
  if (!analysis) return;
  const prefix = summarizeCaptureImageAnalysisForUser(analysis);
  if (!prefix) return;
  const existing = result.assistant_reply?.trim() ?? "";
  if (!existing) {
    result.assistant_reply = prefix;
    return;
  }
  if (
    existing.includes(prefix) ||
    existing.startsWith("I analyzed the screenshot") ||
    existing.startsWith("I received the screenshot")
  ) {
    return;
  }
  result.assistant_reply = `${prefix}\n\n${existing}`;
}

export function parseCaptureImagePayload(value: unknown): CaptureImagePayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== "image") return null;
  const dataUrl = typeof raw.data_url === "string" ? raw.data_url.trim() : "";
  const mimeType =
    typeof raw.mime_type === "string" ? raw.mime_type.trim().toLowerCase() : "";
  if (!dataUrl || !mimeType.startsWith("image/")) return null;
  if (!SUPPORTED_IMAGE_DATA_URL_RE.test(dataUrl)) return null;
  const declaredSize = typeof raw.size === "number" && Number.isFinite(raw.size)
    ? Math.max(0, Math.floor(raw.size))
    : estimateDataUrlBytes(dataUrl);
  if (declaredSize > MAX_CAPTURE_IMAGE_BYTES) return null;
  return {
    type: "image",
    mime_type: mimeType,
    data_url: dataUrl,
    ...(typeof raw.name === "string" && raw.name.trim()
      ? { name: raw.name.trim().slice(0, 120) }
      : {}),
    size: declaredSize,
  };
}

export function buildScreenshotCaptureMessage(input: {
  userText: string;
  analysis: CaptureImageAnalysis;
}): string {
  const userText = input.userText.trim();
  const base = userText || "Please analyze this travel screenshot and identify the task.";
  return [
    "[screenshot attached]",
    input.analysis.summary_text,
    userText ? `User instruction: ${userText}` : "User instruction: not provided.",
    "Use the screenshot facts only as capture evidence. Ask for missing date, time, city, budget, party size, or provider choices before execution.",
  ].join("\n");
}

export async function analyzeCaptureImageForText(input: {
  image: CaptureImagePayload;
  userText: string;
  userModel?: unknown;
}): Promise<CaptureImageAnalysis> {
  const initial = resolveOpenAiVisionModel(input.userModel);
  if (!initial.apiKey) {
    return {
      status: "unavailable",
      summary_text:
        "Screenshot received, but no OpenAI vision API key is configured for server-side image analysis. Treat this as a screenshot capture and ask the user for a short description of the place, event, hotel, flight, or trip they want Onegent to act on.",
    };
  }

  let model = initial.model;
  try {
    let response = await callOpenAiVisionResponses({
      apiKey: initial.apiKey,
      model,
      image: input.image,
      userText: input.userText,
    });
    if (!response.ok && model !== DEFAULT_OPENAI_VISION_MODEL && isModelAccessFailure(response.error)) {
      model = DEFAULT_OPENAI_VISION_MODEL;
      response = await callOpenAiVisionResponses({
        apiKey: initial.apiKey,
        model,
        image: input.image,
        userText: input.userText,
      });
    }
    if (!response.ok) throw new Error(response.error);
    const normalized = normalizeVisionJson(response.content);
    return {
      status: "analyzed",
      provider: "openai",
      model,
      summary_text: normalized,
    };
  } catch (err) {
    return {
      status: "failed",
      provider: "openai",
      model,
      error: err instanceof Error ? err.message : String(err),
      summary_text:
        "Screenshot received, but image analysis failed. Treat this as a screenshot capture and ask the user for a short description before creating or running a task.",
    };
  }
}

const DEFAULT_OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.5";

function resolveOpenAiVisionModel(userModel: unknown): { model: string; apiKey: string | null } {
  const envKey = process.env.OPENAI_API_KEY?.trim() || null;
  const fallbackModel = DEFAULT_OPENAI_VISION_MODEL;
  if (!userModel || typeof userModel !== "object") {
    return { model: fallbackModel, apiKey: envKey };
  }
  const m = userModel as Partial<LayerModel>;
  if (m.provider !== "openai") return { model: fallbackModel, apiKey: envKey };
  return {
    model: typeof m.model === "string" && m.model.trim() ? m.model.trim() : fallbackModel,
    apiKey: typeof m.apiKey === "string" && m.apiKey.trim() ? m.apiKey.trim() : envKey,
  };
}

async function callOpenAiVisionResponses(input: {
  apiKey: string;
  model: string;
  image: CaptureImagePayload;
  userText: string;
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      store: false,
      max_output_tokens: 700,
      instructions: [
        "You extract travel-task facts from screenshots for Onegent.",
        "Return compact JSON only.",
        "Do not invent facts that are not visible or supplied by the user.",
        "If the screenshot is not travel-related, say scenario null and list what context is missing.",
        "Never say the task is ready for payment, login, seat selection, or final confirmation.",
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                user_instruction: input.userText.trim() || null,
                requested_output: {
                  scenario: "restaurant | hotel | flight | activity | trip | null",
                  provider: "visible provider or null",
                  title: "visible place/event/hotel/flight/trip title or null",
                  city: "visible city or null",
                  date: "visible date or null",
                  time: "visible time or null",
                  price_or_budget: "visible price/budget or null",
                  source_url: "visible URL or null",
                  missing_fields: "array of missing required fields",
                  confidence: "0..1",
                  concise_summary: "one sentence for a downstream text parser",
                },
              }),
            },
            {
              type: "input_image",
              image_url: input.image.data_url,
              detail: "low",
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `OpenAI vision request failed: ${res.status} ${body.slice(0, 240)}`,
    };
  }
  const json = (await res.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ text?: string; type?: string }>;
    }>;
  };
  const content =
    json.output_text?.trim() ||
    json.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("\n")
      .trim() ||
    "";
  return { ok: true, content };
}

function isModelAccessFailure(error: string): boolean {
  return /does not have access to model|model_not_found|unsupported.*model|invalid.*model/i.test(error);
}

function normalizeVisionJson(content: string): string {
  if (!content) {
    return "Screenshot analysis returned no visible travel facts. Ask the user for context.";
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const lines: string[] = ["Screenshot analysis:"];
    for (const key of [
      "scenario",
      "provider",
      "title",
      "city",
      "date",
      "time",
      "price_or_budget",
      "source_url",
      "missing_fields",
      "confidence",
      "concise_summary",
    ]) {
      const value = parsed[key];
      if (value === null || value === undefined || value === "") continue;
      lines.push(`- ${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
    }
    return lines.length > 1 ? lines.join("\n") : `Screenshot analysis: ${content.slice(0, 1200)}`;
  } catch {
    return `Screenshot analysis: ${content.slice(0, 1200)}`;
  }
}

function parseVisionSummaryFields(summary: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of summary.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([a-z_]+)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = sanitizeVisionField(match[2]);
    if (value) out[key] = value;
  }
  return out;
}

function addVisibleFact(out: string[], label: string, value: string | undefined): void {
  const normalized = sanitizeVisionField(value);
  if (!normalized) return;
  out.push(`${label} ${normalized}`);
}

function sanitizeVisionField(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/^(null|undefined|n\/a|none|unknown)$/i, "")
    .trim();
  return normalized || null;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((base64.replace(/\s/g, "").length * 3) / 4);
}
