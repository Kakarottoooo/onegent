export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function extractErrorDetails(err: unknown): {
  message: string;
  statusCode?: number;
  serialized?: string;
} {
  const asRecord =
    err && typeof err === "object" ? (err as Record<string, unknown>) : undefined;

  const statusCandidates = [
    asRecord?.status,
    asRecord?.statusCode,
    asRecord?.code,
    asRecord?.response && typeof asRecord.response === "object"
      ? (asRecord.response as Record<string, unknown>).status
      : undefined,
  ];
  const statusCode = statusCandidates
    .map((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    })
    .find((value): value is number => value !== undefined);

  const nestedResponse =
    asRecord?.response && typeof asRecord.response === "object"
      ? (asRecord.response as Record<string, unknown>)
      : undefined;
  const nestedError =
    asRecord?.error && typeof asRecord.error === "object"
      ? (asRecord.error as Record<string, unknown>)
      : undefined;

  const messageCandidates = [
    err instanceof Error ? err.message : undefined,
    typeof asRecord?.message === "string" ? asRecord.message : undefined,
    typeof nestedError?.message === "string" ? nestedError.message : undefined,
    typeof nestedResponse?.statusText === "string" ? nestedResponse.statusText : undefined,
  ].filter(Boolean) as string[];

  let message = messageCandidates[0] || (typeof err === "string" ? err : safeJsonStringify(err));

  if ((message === "Unknown error" || message === "Unknown error: 402" || message === "[object Object]") && statusCode) {
    message = `HTTP ${statusCode}`;
  }

  if (
    statusCode === 402 ||
    /\b402\b/.test(message) ||
    /payment required|insufficient credits|quota|billing/i.test(message)
  ) {
    message = "HTTP 402 from browser/model provider (likely billing, credits, or quota exhausted)";
  }

  return {
    message,
    statusCode,
    serialized: safeJsonStringify(err),
  };
}
