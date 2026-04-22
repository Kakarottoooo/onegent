import type { ProviderClient } from "../llm-client";

export const googleProvider: ProviderClient = {
  async chat(_params, _model) {
    throw new Error(
      "[llm-client] Google provider is not wired yet. Phase 1 only implements MiniMax."
    );
  },
};
