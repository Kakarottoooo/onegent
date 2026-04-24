/**
 * Require-API-Key guard for /api/v1/* route handlers.
 *
 * Usage (in a route handler):
 *
 *   export async function POST(req: NextRequest) {
 *     const auth = await requireApiKey(req);
 *     if (!auth.ok) return auth.response;
 *     const { context } = auth;
 *     // ... context.keyId, context.organizationName, context.allowedJobTypes
 *   }
 *
 * We don't use Next.js `middleware.ts` because:
 *   1) global middleware runs on Edge runtime — no @vercel/postgres
 *   2) we only want this guard on /api/v1/*, not every request
 *
 * Header format: `Authorization: Bearer ogk_live_<...>` (Stripe / OpenAI style).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { findApiKeyByHash, updateApiKeyLastUsed } from "@/lib/db";

export interface ApiKeyContext {
  keyId: string;
  organizationName: string;
  allowedJobTypes: string[] | null;
  keyPrefix: string;
}

export type RequireApiKeyResult =
  | { ok: true; context: ApiKeyContext }
  | { ok: false; response: NextResponse };

// Match "Bearer" at the start with either whitespace or end-of-string after —
// so "Bearer" alone (key forgotten) falls through to the empty-key branch,
// not the wrong-scheme branch. (Request trims trailing whitespace per RFC 7230.)
const BEARER_PREFIX = /^Bearer(\s+|$)/i;
const STRIP_BEARER = /^Bearer\s*/i;

function unauthorized(message: string, code: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="onegent-api"' } },
  );
}

export async function requireApiKey(
  req: NextRequest | Request,
): Promise<RequireApiKeyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return {
      ok: false,
      response: unauthorized(
        "Missing Authorization header. Expected: Authorization: Bearer ogk_live_<key>",
        "missing_authorization",
      ),
    };
  }

  if (!BEARER_PREFIX.test(authHeader)) {
    return {
      ok: false,
      response: unauthorized(
        "Authorization header must use Bearer scheme.",
        "invalid_auth_scheme",
      ),
    };
  }

  const plaintext = authHeader.replace(STRIP_BEARER, "").trim();
  if (!plaintext) {
    return {
      ok: false,
      response: unauthorized("Empty API key.", "empty_api_key"),
    };
  }

  // Cheap shape check — cuts DB lookups for obviously wrong values.
  if (!/^ogk_(live|test)_[A-Za-z0-9_-]{16,}$/.test(plaintext)) {
    return {
      ok: false,
      response: unauthorized(
        "API key format invalid. Expected ogk_live_<...> or ogk_test_<...>.",
        "malformed_api_key",
      ),
    };
  }

  const keyHash = createHash("sha256").update(plaintext).digest("hex");

  let row;
  try {
    row = await findApiKeyByHash(keyHash);
  } catch (err) {
    // DB is the auth system of record — if it's down, fail closed with 503.
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "auth_backend_unavailable",
            message: "Unable to verify API key right now. Please retry.",
          },
        },
        { status: 503 },
      ),
    };
  }

  if (!row) {
    return {
      ok: false,
      response: unauthorized(
        "Invalid or revoked API key.",
        "invalid_api_key",
      ),
    };
  }

  // Fire-and-forget last_used_at update. Don't block the request on this.
  void updateApiKeyLastUsed(row.id).catch(() => {
    // Intentionally swallow — auth already succeeded, telemetry is best-effort.
  });

  return {
    ok: true,
    context: {
      keyId: row.id,
      organizationName: row.organization_name,
      allowedJobTypes: row.allowed_job_types,
      keyPrefix: row.key_prefix,
    },
  };
}
