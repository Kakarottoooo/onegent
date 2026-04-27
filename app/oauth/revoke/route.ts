/**
 * POST /oauth/revoke — RFC 7009 token revocation.
 *
 * Clients call this to invalidate an access_token (e.g. on user logout
 * or "Disconnect" in their app). RFC 7009 says we MUST return 200 even
 * if the token doesn't exist or is already revoked, to prevent clients
 * from probing for valid tokens.
 *
 * Refresh-token revocation is not implemented here yet — the token
 * endpoint already rotates refresh tokens, and revoking the access
 * token cuts off near-term API access. We can add token_type_hint=
 * refresh_token later if a real client asks for it.
 *
 * Client authentication is required to prevent random callers from
 * revoking tokens they don't own. Same dual scheme as /oauth/token.
 */

import { NextRequest, NextResponse } from "next/server";

import { revokeAccessToken, verifyOAuthClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

function parseBasicAuth(header: string | null): ClientCredentials | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  const clientId = decodeURIComponent(decoded.slice(0, idx));
  const clientSecret = decodeURIComponent(decoded.slice(idx + 1));
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Body must be form-urlencoded." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const basic = parseBasicAuth(req.headers.get("authorization"));
  const formClientId = form.get("client_id");
  const formClientSecret = form.get("client_secret");

  let creds: ClientCredentials | null = basic;
  if (!creds && typeof formClientId === "string" && typeof formClientSecret === "string") {
    creds = { clientId: formClientId, clientSecret: formClientSecret };
  }

  if (!creds) {
    return NextResponse.json(
      { error: "invalid_client" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="oauth"', "Cache-Control": "no-store" },
      },
    );
  }

  const client = await verifyOAuthClient(creds.clientId, creds.clientSecret);
  if (!client) {
    return NextResponse.json(
      { error: "invalid_client" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="oauth"', "Cache-Control": "no-store" },
      },
    );
  }

  const token = form.get("token");
  if (typeof token !== "string" || !token) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "token required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // RFC 7009 §2.2: invalid tokens must still return 200 OK.
  await revokeAccessToken(token);

  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
