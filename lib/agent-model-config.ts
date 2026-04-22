/**
 * Shared source of truth for the user's agent model configuration.
 *
 * Phase 1 migrates the single flat `{model, apiKey}` slot — which historically
 * only drove Stagehand — into a layered shape where each agent layer
 * (conversational / browser / reasoning / ranking) can be configured
 * independently. Only `conversational` and `browser` are wired in Phase 1;
 * the rest are reserved so the UI can telegraph the extensibility plan.
 *
 * Storage: `localStorage["agent_model_config"]`. Legacy records (flat
 * `{model, apiKey}`) are migrated transparently on first read.
 */

import type { LayerModel, Provider } from "./llm-client";

export interface AgentModelConfig {
  conversational?: LayerModel;
  browser?: LayerModel;
  /** Reserved for future use. */
  reasoning?: LayerModel;
  /** Reserved for future use. */
  ranking?: LayerModel;
}

const STORAGE_KEY = "agent_model_config";

const KNOWN_PROVIDERS: readonly Provider[] = ["minimax", "openai", "anthropic", "google"];

function isProvider(value: string): value is Provider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Parse a Stagehand-style "provider/model" string into structured pieces.
 * Returns null when the input is empty or malformed.
 */
export function parseProviderSlashModel(
  providerSlash: string
): { provider: Provider; model: string } | null {
  if (!providerSlash) return null;
  const slash = providerSlash.indexOf("/");
  if (slash <= 0) return null;
  const providerId = providerSlash.slice(0, slash).toLowerCase();
  const model = providerSlash.slice(slash + 1);
  if (!isProvider(providerId) || !model) return null;
  return { provider: providerId, model };
}

/** Reverse of parseProviderSlashModel — rebuilds the Stagehand string. */
export function toProviderSlashModel(m: LayerModel): string {
  return `${m.provider}/${m.model}`;
}

function isLayerModel(value: unknown): value is LayerModel {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.provider === "string" &&
    isProvider(v.provider) &&
    typeof v.model === "string" &&
    v.model.length > 0
  );
}

/**
 * Accepts either:
 * - a legacy flat record `{model: "openai/gpt-4o-mini", apiKey: "..."}` and
 *   funnels it into the `browser` slot, or
 * - an already-layered record and returns it intact.
 */
function migrateLegacy(raw: Record<string, unknown>): AgentModelConfig {
  if (!raw || typeof raw !== "object") return {};

  // Already a layered record.
  const layered: AgentModelConfig = {};
  let sawLayered = false;
  for (const key of ["conversational", "browser", "reasoning", "ranking"] as const) {
    const entry = (raw as Record<string, unknown>)[key];
    if (isLayerModel(entry)) {
      layered[key] = {
        provider: entry.provider,
        model: entry.model,
        apiKey: typeof entry.apiKey === "string" ? entry.apiKey : undefined,
      };
      sawLayered = true;
    }
  }
  if (sawLayered) return layered;

  // Legacy `{model, apiKey}` shape — funnel into browser.
  const legacyModel = typeof raw.model === "string" ? raw.model : "";
  const legacyKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
  const parsed = parseProviderSlashModel(legacyModel);
  if (!parsed) return {};
  return {
    browser: {
      provider: parsed.provider,
      model: parsed.model,
      apiKey: legacyKey || undefined,
    },
  };
}

export function loadAgentModelConfig(): AgentModelConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return migrateLegacy(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function saveAgentModelConfig(cfg: AgentModelConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Swallow quota / access errors — the UI will surface them separately.
  }
}

export function setLayerModel(layer: keyof AgentModelConfig, model: LayerModel | undefined): void {
  const cfg = loadAgentModelConfig();
  if (model) {
    cfg[layer] = model;
  } else {
    delete cfg[layer];
  }
  saveAgentModelConfig(cfg);
}

/**
 * Stagehand expects the legacy `{model: "provider/model", apiKey}` shape.
 * Returns null when no browser model has been chosen and no api key is set,
 * so callers can decide whether to fall back to the server-side env key.
 */
export function getBrowserModelForStagehand(): { model: string; apiKey: string } | null {
  const cfg = loadAgentModelConfig();
  const browser = cfg.browser;
  if (!browser) return null;
  if (!browser.apiKey) return null;
  return {
    model: toProviderSlashModel(browser),
    apiKey: browser.apiKey,
  };
}

/**
 * Legacy bridge for the existing (pre-redesign) AgentModelTab UI, which still
 * thinks of the selection as `{model, apiKey}`. Writes the selection into the
 * `browser` slot of the layered record.
 */
export function setBrowserModelFromLegacy(providerSlash: string, apiKey: string): void {
  const cfg = loadAgentModelConfig();
  const parsed = parseProviderSlashModel(providerSlash);
  if (!parsed) {
    delete cfg.browser;
  } else {
    cfg.browser = {
      provider: parsed.provider,
      model: parsed.model,
      apiKey: apiKey || undefined,
    };
  }
  saveAgentModelConfig(cfg);
}

/**
 * Legacy reader for the existing AgentModelTab UI — returns the `browser`
 * slot flattened back into `{model, apiKey}`. Never throws.
 */
export function getBrowserModelAsLegacy(): { model: string; apiKey: string } {
  const cfg = loadAgentModelConfig();
  const browser = cfg.browser;
  if (!browser) return { model: "", apiKey: "" };
  return {
    model: toProviderSlashModel(browser),
    apiKey: browser.apiKey ?? "",
  };
}
