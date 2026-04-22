/**
 * Layered LLM client — routes chat completion calls to the configured provider
 * for a given agent layer (conversational / browser / reasoning / ranking).
 *
 * Phase 1 scope: conversational layer is wired end-to-end via MiniMax (default).
 * Other providers (OpenAI / Anthropic / Google) are stubs that match the
 * interface so they can be filled in without touching call sites.
 */

import { minimaxProvider } from "./providers/minimax";
import { openaiProvider } from "./providers/openai";
import { anthropicProvider } from "./providers/anthropic";
import { googleProvider } from "./providers/google";

export type Layer = "conversational" | "browser" | "reasoning" | "ranking";

export type Provider = "minimax" | "openai" | "anthropic" | "google";

export interface LayerModel {
  provider: Provider;
  model: string;
  /** Optional user-supplied API key. When empty, the provider falls back to env. */
  apiKey?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  layer: Layer;
  system?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  timeout_ms?: number;
  /** Hint to the provider that the response should be JSON. */
  response_format?: "json" | "text";
  /**
   * Optional per-call override of the layer's configured model.
   * Used when the browser-side user config reaches the server through a request payload.
   */
  userModel?: LayerModel;
}

export interface ProviderClient {
  chat(
    params: Omit<ChatCompletionParams, "layer" | "userModel">,
    model: LayerModel
  ): Promise<string>;
}

const PROVIDERS: Record<Provider, ProviderClient> = {
  minimax: minimaxProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
};

/**
 * Default model per layer when the user has not configured one.
 * Conversational defaults to MiniMax because the project already ships a MiniMax key
 * via env and the model is fast + multilingual-friendly.
 * Browser defaults to OpenAI gpt-4o-mini to match the historical Stagehand default.
 */
export const DEFAULT_LAYER_MODEL: Record<Layer, LayerModel> = {
  conversational: { provider: "minimax", model: "MiniMax-Text-01" },
  browser: { provider: "openai", model: "gpt-4o-mini" },
  reasoning: { provider: "minimax", model: "MiniMax-Text-01" },
  ranking: { provider: "minimax", model: "MiniMax-Text-01" },
};

export function resolveLayerModel(layer: Layer, userModel?: LayerModel): LayerModel {
  if (userModel && userModel.provider && userModel.model) return userModel;
  return DEFAULT_LAYER_MODEL[layer];
}

export async function chatCompletion(params: ChatCompletionParams): Promise<string> {
  const model = resolveLayerModel(params.layer, params.userModel);
  const provider = PROVIDERS[model.provider];
  if (!provider) {
    throw new Error(`Unknown provider: ${model.provider}`);
  }
  const { layer: _layer, userModel: _user, ...rest } = params;
  return provider.chat(rest, model);
}
