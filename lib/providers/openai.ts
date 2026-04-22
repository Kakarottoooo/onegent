import type { ProviderClient } from "../llm-client";

export const openaiProvider: ProviderClient = {
  async chat(_params, _model) {
    throw new Error(
      "[llm-client] OpenAI provider is not wired yet. Phase 1 only implements MiniMax."
    );
  },
};
