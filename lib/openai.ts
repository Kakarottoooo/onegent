/**
 * Thin wrapper around OpenAI's chat completions REST API.
 *
 * Drop-in shape-compatible replacement for `minimaxChat`: same params, same
 * return type (the assistant message content as a string). Used for the
 * restaurant ranker after MiniMax turned out unreliable on large prompts
 * (restaurants ship with per-venue review signal structs that blow up the
 * token count vs other categories, so MiniMax times out there most often).
 *
 * Env:
 *   - `OPENAI_API_KEY` (required)
 *   - `OPENAI_CHAT_MODEL` (optional override for restricted local projects)
 *   - We default to `gpt-4o-mini` — cheap, fast, and already used by Stagehand
 *     for its act() loops so no new billing setup is needed.
 */
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 30_000;

function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-5|o[134])(?:[.-]|$)/.test(model);
}

export async function openaiChat(params: {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  max_tokens?: number;
  timeout_ms?: number;
  model?: string;
  response_format?: { type: "json_object" };
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const messages = params.system
    ? [{ role: "system" as const, content: params.system }, ...params.messages]
    : params.messages;

  const model = params.model ?? DEFAULT_MODEL;
  const tokenBudget = params.max_tokens ?? 1024;
  const tokenParam = usesMaxCompletionTokens(model)
    ? { max_completion_tokens: tokenBudget }
    : { max_tokens: tokenBudget };

  let res: Response;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...tokenParam,
        temperature: 0.2,
        ...(params.response_format ? { response_format: params.response_format } : {}),
      }),
      signal: AbortSignal.timeout(params.timeout_ms ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`OpenAI API timed out after ${params.timeout_ms ?? DEFAULT_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}
