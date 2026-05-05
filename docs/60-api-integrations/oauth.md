# Onegent OAuth 2.0 — integrate Onegent into your AI agent

> **Onegent — AI books your trip end-to-end.**
> This guide shows you how to plug Onegent into a custom agent (LangChain, CrewAI, AutoGen, your own framework) using the standard OAuth 2.0 dance — no API key copy/paste, end users sign in once and you get a Bearer token to call Onegent's MCP tools.

If you're building for **Claude Desktop**, see [Claude integration](./integrations/claude-mcp). If you're submitting to **ChatGPT Apps marketplace**, see [ChatGPT Apps integration](./integrations/chatgpt-apps). This page covers the protocol-level integration that powers both — and that anything else can reuse.

## Quick reference

| Endpoint | Purpose | Spec |
|---|---|---|
| `GET /.well-known/oauth-authorization-server` | Authorization-server metadata | RFC 8414 |
| `GET /.well-known/oauth-protected-resource` | Resource-server metadata | RFC 9728 |
| `GET  /oauth/authorize` | Consent page (Clerk-gated) | RFC 6749 §4.1 |
| `POST /oauth/token` | Code → tokens, refresh rotation | RFC 6749 §3.2 |
| `POST /oauth/revoke` | Revoke a token | RFC 7009 |
| `POST /oauth/register` | Dynamic client registration | RFC 7591 |
| `POST /api/mcp` | The actual booking tools (JSON-RPC over MCP Streamable HTTP) | MCP 2025-06-18 |

PKCE (S256) is **required** on the authorization-code grant. Refresh tokens **rotate** on every use. Tokens are **opaque** (sha256 stored, no JWT). Two coarse-grained scopes: `book` and `read`.

## Prerequisites

- HTTPS callback URL on your side (or `http://localhost` for development).
- Ability to make outbound HTTPS requests, generate random bytes, and SHA-256 hash a string. Any modern language has these.
- An Onegent account is **not** required to integrate — your end users sign into theirs during the OAuth flow.

## End-to-end overview

```
your agent                          Onegent                    end user
──────────                          ───────                    ────────
GET /.well-known/* (1) ────────────► metadata
POST /oauth/register (2)  ────────► client_id + client_secret

build URL → redirect user (3) ────────────────────────────────► consent page
                                    Clerk sign-in
                                    Approve ──────────► redirect_uri ?code=...&state=...
                                                                ↓
                                    ◄────────────────── your callback receives code

POST /oauth/token (4) ─────────────► access_token + refresh_token

POST /api/mcp (5) ─────────────────► tool calls
  Authorization: Bearer <access_token>
```

Five steps. Steps 1–2 happen once (or on every cold-start). Steps 3–4 happen once per end user. Step 5 happens on every tool invocation.

## 1. Discovery

Two `.well-known` endpoints encode everything a client needs to drive the rest of the flow.

```bash
curl https://onegent.one/.well-known/oauth-authorization-server
```

Returns (RFC 8414):

```json
{
  "issuer": "https://onegent.one",
  "authorization_endpoint": "https://onegent.one/oauth/authorize",
  "token_endpoint": "https://onegent.one/oauth/token",
  "revocation_endpoint": "https://onegent.one/oauth/revoke",
  "registration_endpoint": "https://onegent.one/oauth/register",
  "scopes_supported": ["book", "read"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post"
  ]
}
```

```bash
curl https://onegent.one/.well-known/oauth-protected-resource
```

Returns (RFC 9728):

```json
{
  "resource": "https://onegent.one/api/mcp",
  "authorization_servers": ["https://onegent.one"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["book", "read"]
}
```

Hard-coding endpoint URLs works today, but **always discover dynamically** if you can — that way you stay correct if Onegent ever rotates a path.

## 2. Register a client

Two paths. Pick the one that fits your distribution model.

### Option A — Dynamic client registration (RFC 7591)

Best for connectors that show up in marketplace UIs (claude.ai, ChatGPT Apps, your own listing). The client registers itself the first time it's added.

```bash
curl -X POST https://onegent.one/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Acme Travel Concierge",
    "client_uri": "https://acme-travel.example.com",
    "redirect_uris": ["https://acme-travel.example.com/oauth/callback"],
    "scope": "book read"
  }'
```

`201 Created` returns:

```json
{
  "client_id": "dcr_…",
  "client_secret": "…",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://acme-travel.example.com/oauth/callback"],
  "client_name": "Acme Travel Concierge",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "scope": "book read"
}
```

**Save the `client_secret` immediately.** Onegent only stores `sha256(secret)`; if you lose it you must register again.

**Constraints to know:**
- `redirect_uris` must be `https://` (or `http://localhost` / `http://127.0.0.1` for development).
- `client_name` is shown verbatim on the consent page. Names containing protected brand strings (Onegent, Anthropic, OpenAI, Apple, Google, Microsoft) are rejected with `400 invalid_client_metadata`. Email beta@onegent.one for a manual mint if you legitimately need a name in that list.
- `scope` you request narrows what users can grant; we always intersect with `["book", "read"]`.

### Option B — Pre-registered client

Best for integrations where you don't need DCR friction (private internal agents, single-tenant deployments). Email beta@onegent.one with:

- A short app description
- Stable `redirect_uri`(s)
- Whether you need only `read`, only `book`, or both

We mint and ship you a `client_id` + `client_secret` out of band. No expiration. Rotate any time by asking again.

## 3. Authorization code + PKCE

Generate a fresh PKCE pair per authorization attempt.

**Code verifier** — 43–128 random URL-safe characters:

```ts
function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes); // 43 chars
}
```

**Code challenge** — SHA-256 of the verifier, base64url-encoded:

```ts
async function deriveChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(hash));
}
```

Build the authorization URL and redirect the user's browser there:

```
https://onegent.one/oauth/authorize
  ?response_type=code
  &client_id=<your_client_id>
  &redirect_uri=<urlencoded https://yourapp.example.com/oauth/callback>
  &scope=book+read
  &state=<random>
  &code_challenge=<S256 challenge>
  &code_challenge_method=S256
```

What the user sees:

1. If not signed in, Onegent's Clerk sign-in page (email + password, social login, or magic link — depending on their account configuration).
2. The Onegent-branded consent card showing your `client_name`, `client_uri`, the requested scopes, and **Approve / Deny** buttons.
3. After Approve, Onegent redirects to your `redirect_uri` with `?code=<auth_code>&state=<state>`.

Validate `state` matches the value you generated. Then continue to step 4.

If the user clicks Deny, Onegent redirects with `?error=access_denied&state=<state>` and no `code` parameter. Treat this as the user opting out — don't retry automatically.

## 4. Exchange the code for tokens

Authorization codes are **single-use** and expire after **10 minutes**. Exchange them immediately.

```bash
curl -X POST https://onegent.one/oauth/token \
  -u "<client_id>:<client_secret>" \
  -d "grant_type=authorization_code" \
  -d "code=<the code from step 3>" \
  -d "redirect_uri=<exact same redirect_uri from step 3>" \
  -d "code_verifier=<the verifier you generated, NOT the challenge>"
```

`200 OK` returns:

```json
{
  "access_token": "…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "…",
  "scope": "book read"
}
```

**Important:** the `redirect_uri` field at `/oauth/token` must byte-for-byte match what you sent at `/oauth/authorize`. RFC 6749 §4.1.3.

Store the access_token (1 h lifetime) and refresh_token (30 d lifetime) bound to the user identity in your system.

### Errors

`400 invalid_grant` — the authorization code is invalid, expired, already redeemed, or the PKCE verifier doesn't match the challenge. Don't retry; restart from step 3.

`401 invalid_client` — `client_id` / `client_secret` mismatch. Check your env vars.

## 5. Call `/api/mcp`

Once you have an access_token, call `/api/mcp` like any MCP Streamable HTTP server. Onegent exposes 6 tools.

### List tools (always allowed)

```bash
curl -X POST https://onegent.one/api/mcp \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Returns the 6 tools with full JSON schemas (input shapes, descriptions, MCP annotations: `readOnlyHint`, `openWorldHint`, `destructiveHint`).

### Invoke a tool

```bash
curl -X POST https://onegent.one/api/mcp \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "book_restaurant",
      "arguments": {
        "restaurant_name": "Carbone",
        "city": "New York",
        "date": "2026-06-15",
        "time": "19:00",
        "covers": 2,
        "profile": {
          "first_name": "Alex",
          "last_name": "Example",
          "email": "alex@example.com",
          "phone": "+14155550123"
        }
      }
    }
  }'
```

Booking tools (`book_restaurant`, `book_hotel`, `book_flight`, `book_activity`) return a `jobId` immediately. The actual booking runs asynchronously. Poll `get_job_status` every 30 s until terminal:

```bash
curl -X POST https://onegent.one/api/mcp \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_job_status",
      "arguments": { "jobId": "<jobId from above>" }
    }
  }'
```

Statuses: `queued`, `running`, `done`, `error`, `paused_payment`, `captcha`, `needs_login`. The agent **always pauses at `paused_payment`** before any irreversible card-on-file step — your end user must approve the charge in Onegent's web app at https://onegent.one. This is the central safety invariant; design your UX around it.

## 6. Refresh tokens

Access tokens expire in 1 hour. Use the refresh token to get a new pair without redoing consent.

```bash
curl -X POST https://onegent.one/oauth/token \
  -u "<client_id>:<client_secret>" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=<refresh_token>"
```

`200 OK` returns a fresh `access_token` + a **new** `refresh_token`. The previous refresh token is **revoked atomically** — refresh tokens rotate on every use (RFC 6819 §5.2.2.3). Update your storage immediately; calling `/oauth/token` twice with the same refresh token returns `invalid_grant` on the second call.

If you ever get `invalid_grant` on a refresh, the user must redo the full authorization flow (step 3) — typically because the refresh token expired (30 d), the user revoked the grant via `/developers/connected-apps`, or someone else already used the refresh token.

## 7. Revoke a token

When the user disconnects in your UI, revoke their access:

```bash
curl -X POST https://onegent.one/oauth/revoke \
  -u "<client_id>:<client_secret>" \
  -d "token=<access_token_or_refresh_token>"
```

Always returns `200 OK` per RFC 7009 §2.2 — even for tokens that don't exist or are already revoked. This is intentional; it prevents token-enumeration attacks.

Revoking an access token does **not** automatically revoke its associated refresh token (and vice versa). Revoke both for full cleanup.

Users can independently revoke your app via Onegent's connected-apps dashboard; your tokens then start returning `401 invalid_token` without any signal to you. Always be ready to handle that.

## 8. Scopes

| Scope | Tools allowed |
|---|---|
| `book` | `book_restaurant`, `book_hotel`, `book_flight`, `book_activity` |
| `read`  | `get_job_status`, `get_job_audit` |

Coarse on purpose — fine-grained per-tool scoping was rejected during design because (a) it bloats the consent page with checkboxes the user can't reason about, and (b) the booking → poll-status loop only makes sense if both scopes are granted.

Request both at consent time unless your agent genuinely never books (`read`-only) or genuinely never polls (`book`-only). Most useful: ask for both.

`tools/call` with a tool whose required scope you don't hold returns:

```
HTTP 403
WWW-Authenticate: Bearer realm="onegent-mcp", error="insufficient_scope", scope="book"
{"error":"insufficient_scope","message":"Tool \"book_restaurant\" requires \"book\" scope; this token has [read]."}
```

## 9. Working code samples

### TypeScript (Node 18+, no SDK)

```ts
import { createHash, randomBytes } from "node:crypto";

const CLIENT_ID = process.env.ONEGENT_CLIENT_ID!;
const CLIENT_SECRET = process.env.ONEGENT_CLIENT_SECRET!;
const REDIRECT_URI = "https://your-agent.example.com/oauth/callback";

function base64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

export function buildAuthorizeUrl(state: string): {
  url: string;
  codeVerifier: string;
} {
  const codeVerifier = base64url(randomBytes(32));
  const challenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const u = new URL("https://onegent.one/oauth/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", "book read");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return { url: u.toString(), codeVerifier };
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch("https://onegent.one/oauth/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function callTool(
  accessToken: string,
  name: string,
  args: unknown,
): Promise<unknown> {
  const res = await fetch("https://onegent.one/api/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`mcp call failed: ${await res.text()}`);
  return res.json();
}
```

### Python 3.11+ (requests + standard hashlib)

```python
import base64, hashlib, secrets
from urllib.parse import urlencode
import requests

CLIENT_ID = os.environ["ONEGENT_CLIENT_ID"]
CLIENT_SECRET = os.environ["ONEGENT_CLIENT_SECRET"]
REDIRECT_URI = "https://your-agent.example.com/oauth/callback"

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def build_authorize_url(state: str) -> tuple[str, str]:
    verifier = _b64(secrets.token_bytes(32))
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "book read",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return (
        f"https://onegent.one/oauth/authorize?{urlencode(params)}",
        verifier,
    )

def exchange_code(code: str, code_verifier: str) -> dict:
    r = requests.post(
        "https://onegent.one/oauth/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": code_verifier,
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()

def call_tool(access_token: str, name: str, arguments: dict) -> dict:
    r = requests.post(
        "https://onegent.one/api/mcp",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0",
            "id": secrets.token_hex(8),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()
```

### curl quickstart

```bash
# 1. PKCE pair (RFC 7636 test vector — use random in production)
VERIFIER="dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
CHALLENGE="E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

# 2. Open in browser, complete consent, copy ?code=... from redirect URL
echo "https://onegent.one/oauth/authorize?\
client_id=$CLIENT_ID&\
redirect_uri=$REDIRECT_URI&\
response_type=code&\
scope=book+read&\
state=xyz&\
code_challenge=$CHALLENGE&\
code_challenge_method=S256"

# 3. Exchange
curl -X POST https://onegent.one/oauth/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "redirect_uri=$REDIRECT_URI" \
  -d "code_verifier=$VERIFIER"

# 4. Call MCP
curl -X POST https://onegent.one/api/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## 10. Common errors

| HTTP | `error` | What it means | Fix |
|---|---|---|---|
| 400 | `invalid_request` | Missing required parameter, malformed body, PKCE verifier wrong length | Re-read the field requirements above |
| 400 | `invalid_grant` | Auth code consumed, expired, redirect_uri mismatch, or PKCE verifier doesn't hash to the stored challenge | Restart from `/oauth/authorize` |
| 400 | `invalid_redirect_uri` (`/oauth/register` only) | redirect_uri is not https or not localhost | Use `https://` |
| 400 | `invalid_client_metadata` (`/oauth/register` only) | client_name impersonates a protected brand, or other malformed metadata | Pick a different name; email us if you need an exception |
| 401 | `invalid_client` | client_id / client_secret mismatch | Verify env vars |
| 401 | `invalid_token` | Access token revoked, expired, or never existed | Refresh, or restart from `/oauth/authorize` |
| 401 | `missing_authorization` | No `Authorization: Bearer` header on `/api/mcp` | Add it |
| 403 | `insufficient_scope` | Tool requires a scope this token doesn't have | Re-authorize with the scope set you need |
| 503 | `auth_backend_unavailable` | Onegent's auth DB is degraded — typically transient | Retry with exponential backoff |

Every error body is JSON `{ "error": "...", "message": "..." }` (or `error_description` for OAuth-spec endpoints). On 401, the `WWW-Authenticate` header includes `resource_metadata="https://onegent.one/.well-known/oauth-protected-resource"` so you can re-discover endpoints without hard-coding.

## 11. Going further

- **End-user revocation UI.** Users can disconnect your app at any time via [/developers/connected-apps](https://onegent.one/developers/connected-apps). Your tokens immediately start returning `401 invalid_token`. Plan for it.
- **Multi-tenant agents.** Bind tokens to your end-user identity, not your agent process. One agent serving many users = many token rows in your DB.
- **Stay current.** This page describes the protocol as of v0.2.55.0 (2026-04-27). Onegent's `/.well-known` endpoints are the source of truth — discover dynamically and you'll automatically pick up future changes (new scopes, new auth methods, etc.) without code changes.
- **API key alternative.** If you don't need end-user OAuth (single-tenant deployment, your team owns the bookings), Onegent also accepts `Authorization: Bearer ogk_live_...` on `/api/mcp` — see the [REST API reference](./api/v1) for how to mint keys at [/developers/keys](https://onegent.one/developers/keys).

## Reference

- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [Token Revocation RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009)
- [Authorization Server Metadata RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)
- [Dynamic Client Registration RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)
- [Protected Resource Metadata RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)
- [Model Context Protocol — Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [Onegent REST API reference](./api/v1)
- [Onegent Claude integration](./integrations/claude-mcp)
- [Onegent ChatGPT Apps integration](./integrations/chatgpt-apps)
- Bugs / questions: https://github.com/Kakarottoooo/onegent/issues, beta@onegent.one
