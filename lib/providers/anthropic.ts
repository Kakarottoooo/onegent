import type { ProviderClient } from "../llm-client";

export const anthropicProvider: ProviderClient = {
  async chat(_params, _model) {
    throw new Error(
      "[llm-client] Anthropic provider is not wired yet. Phase 1 only implements MiniMax."
    );
  },
};
