/**
 * POST /oauth/authorize/decide — handles Approve / Deny from the consent
 * page. Re-validates everything (defense in depth: don't trust hidden form
 * fields just because they came from our own page), then either:
 *   - decision=approve → mint authorization_code, 302 to redirect_uri?code=...&state=...
 *   - decision=deny    → 302 to redirect_uri?error=access_denied&state=...
 *
 * The authorization_code is single-use and expires in 10 minutes. The
 * client exchanges it at /oauth/token together with the PKCE verifier.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { createAuthorizationCode, getOAuthClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: "invalid_request", message }, { status: 400 });
}

function appendQuery(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) {
    if (v.length) url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const scope = String(form.get("scope") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const codeChallengeMethod = String(form.get("code_challenge_method") ?? "");
  const decision = String(form.get("decision") ?? "");

  if (!clientId) return badRequest("client_id missing");
  if (!redirectUri) return badRequest("redirect_uri missing");
  if (!codeChallenge) return badRequest("code_challenge missing");
  if (codeChallengeMethod !== "S256") return badRequest("code_challenge_method must be S256");
  if (decision !== "approve" && decision !== "deny") return badRequest("decision must be approve or deny");

  // Re-validate the client + redirect_uri server-side. We don't trust the
  // hidden form fields just because they came from our own consent page —
  // a malicious form could swap redirect_uri after Clerk login.
  const client = await getOAuthClient(clientId);
  if (!client) return badRequest(`unknown client_id: ${clientId}`);
  if (!client.redirect_uris.includes(redirectUri))
    return badRequest("redirect_uri not registered for this client");

  const requestedScopes = scope
    .split(/[\s+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badScopes = requestedScopes.filter((s) => !client.allowed_scopes.includes(s));
  if (badScopes.length) return badRequest(`scope not allowed: ${badScopes.join(", ")}`);

  const { userId } = await auth();
  if (!userId) {
    // Session expired between consent render and decide POST — bounce back
    // to the consent page so they can sign in again. Reconstruct the URL.
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: requestedScopes.join(" "),
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    });
    if (state) params.set("state", state);
    return NextResponse.redirect(new URL(`/oauth/authorize?${params.toString()}`, req.url));
  }

  if (decision === "deny") {
    return NextResponse.redirect(
      appendQuery(redirectUri, { error: "access_denied", state }),
      { status: 302 },
    );
  }

  const code = await createAuthorizationCode({
    clientId,
    userId,
    redirectUri,
    scopes: requestedScopes,
    codeChallenge,
    codeChallengeMethod,
  });

  return NextResponse.redirect(appendQuery(redirectUri, { code, state }), { status: 302 });
}
