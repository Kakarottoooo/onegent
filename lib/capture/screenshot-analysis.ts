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
  const model = resolveOpenAiVisionModel(input.userModel);
  if (!model.apiKey) {
    return {
      status: "unavailable",
      summary_text:
        "Screenshot received, but no OpenAI vision API key is configured for server-side image analysis. Treat this as a screenshot capture and ask the user for a short description of the place, event, hotel, flight, or trip they want Onegent to act on.",
    };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        response_format: { type: "json_object" },
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: [
              "You extract travel-task facts from screenshots for Onegent.",
              "Return compact JSON only.",
              "Do not invent facts that are not visible or supplied by the user.",
              "If the screenshot is not travel-related, say scenario null and list what context is missing.",
              "Never say the task is ready for payment, login, seat selection, or final confirmation.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  user_instruction: input.userText.trim() || null,
                  requested_output: {
                    scenario:
                      "restaurant | hotel | flight | activity | trip | null",
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
                type: "image_url",
                image_url: { url: input.image.data_url, detail: "low" },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI vision request failed: ${res.status} ${body.slice(0, 160)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    const normalized = normalizeVisionJson(content);
    return {
      status: "analyzed",
      provider: "openai",
      model: model.model,
      summary_text: normalized,
    };
  } catch (err) {
    return {
      status: "failed",
      provider: "openai",
      model: model.model,
      error: err instanceof Error ? err.message : String(err),
      summary_text:
        "Screenshot received, but image analysis failed. Treat this as a screenshot capture and ask the user for a short description before creating or running a task.",
    };
  }
}

function resolveOpenAiVisionModel(userModel: unknown): { model: string; apiKey: string | null } {
  const envKey = process.env.OPENAI_API_KEY?.trim() || null;
  const fallbackModel = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini";
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

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((base64.replace(/\s/g, "").length * 3) / 4);
}
