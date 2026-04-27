/**
 * Scope enforcement for OAuth-authenticated MCP requests.
 *
 * Coarse-grained scopes (per .well-known discovery): "book" | "read".
 * Tool → scope mapping below — keep aligned with packages/mcp-server/src/tools/*.
 *
 * Only `tools/call` is gated. `tools/list`, `initialize`, ping, etc. don't
 * touch user data and are allowed for any authenticated request.
 *
 * API-key auth (ogk_live_*) bypasses this check entirely — the API key is
 * already tied to a single user with implicit full access.
 */

export type OnegentScope = "book" | "read";

const TOOL_SCOPES: Record<string, OnegentScope> = {
  book_restaurant: "book",
  book_hotel: "book",
  book_flight: "book",
  book_activity: "book",
  get_job_status: "read",
  get_job_audit: "read",
};

export interface ScopeCheckOk {
  ok: true;
}

export interface ScopeCheckDenied {
  ok: false;
  toolName: string;
  required: OnegentScope;
  granted: string[];
}

export type ScopeCheckResult = ScopeCheckOk | ScopeCheckDenied;

/**
 * Inspect a JSON-RPC body and decide whether the granted scopes cover the
 * tool being invoked. Non-`tools/call` methods always pass through.
 */
export function checkScopeForRpc(
  parsedBody: unknown,
  grantedScopes: string[],
): ScopeCheckResult {
  if (!parsedBody || typeof parsedBody !== "object") return { ok: true };
  const rpc = parsedBody as {
    method?: unknown;
    params?: { name?: unknown };
  };
  if (rpc.method !== "tools/call") return { ok: true };
  const toolName = rpc.params?.name;
  if (typeof toolName !== "string") return { ok: true };
  const required = TOOL_SCOPES[toolName];
  if (!required) return { ok: true };
  if (!grantedScopes.includes(required)) {
    return { ok: false, toolName, required, granted: grantedScopes };
  }
  return { ok: true };
}
