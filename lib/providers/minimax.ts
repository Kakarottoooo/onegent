import { minimaxChat } from "../minimax";
import type { ProviderClient } from "../llm-client";

export const minimaxProvider: ProviderClient = {
  async chat(params, _model) {
    return minimaxChat({
      system: params.system,
      messages: params.messages,
      max_tokens: params.max_tokens,
      timeout_ms: params.timeout_ms,
    });
  },
};
