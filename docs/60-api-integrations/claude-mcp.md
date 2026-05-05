# Claude Desktop — Onegent MCP integration

> **Onegent — AI books your trip end-to-end.**
> Book restaurants, hotels, flights, and activities through Claude Desktop using Onegent's Travel Booking Agent.

## Prerequisites

- An Onegent account — [sign up](https://onegent.one) (free).
- **For Claude Desktop (sections 1–5 below):**
  - [Claude Desktop](https://claude.ai/download) 0.7.0 or newer.
  - Node.js 18+ on your machine (`npx` runs the server).
  - An API key generated at [/developers/keys](https://onegent.one/developers/keys).
- **For Claude.ai web (section 6 below):** no API key, no Node.js. The connector handles auth via OAuth 2.0 — you just sign in during setup.

## 1. Install

Open Claude Desktop, then go to **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json` in your editor (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`).

Add an `onegent` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "onegent": {
      "command": "npx",
      "args": ["-y", "@onegent/mcp-server"],
      "env": {
        "ONEGENT_API_KEY": "ogk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

If you already have other MCP servers configured, add `onegent` as a sibling — don't overwrite the block.

Save the file and **fully quit Claude Desktop** (Cmd+Q / File → Exit), then relaunch. The first launch will download `@onegent/mcp-server` via npx; this takes 5–15 seconds.

## 2. Verify

In a new Claude chat, look for the **hammer icon** at the bottom of the composer. Click it — you should see **"Travel Booking Agent"** with 6 tools:

- `book_restaurant`
- `book_hotel`
- `book_flight` *(preview)*
- `book_activity` *(preview)*
- `get_job_status`
- `get_job_audit`

If the hammer icon isn't there or the server is missing:
- Confirm the JSON is valid (no trailing commas)
- Check Claude Desktop's logs (Settings → Developer → Open Logs Folder) for `mcp-server-onegent.log`
- The most common failure is `ONEGENT_API_KEY env var is required` — your `env` block must be a JSON object, not a string

## 3. First booking

In Claude, say something like:

> Book a table at Carbone in New York on April 28 at 7pm for 2 people. My name is Alice Example, alice@example.com, phone +1-415-555-0123.

Claude will pick `book_restaurant`, fill the fields, and call it. The tool returns a jobId and status `queued`. Claude will then poll `get_job_status` every 15–30 seconds until the booking completes.

Expected timeline:

| Elapsed | Typical status |
|---|---|
| 0–5 s | `queued` |
| 5–30 s | `running` (agent is navigating the site) |
| 30–90 s | `running` (agent is filling the form) |
| 90–120 s | `done` with `confirmationCode`, OR `paused_payment` if the venue requires card auth |

When you see `confirmationCode`, the reservation is live — check your email for the venue's confirmation too.

## 4. Payment safety

Onegent **never submits your credit card CVV automatically.** When the agent reaches a payment step, the job pauses at status `paused_payment`. You must:

1. Open https://onegent.one in your browser
2. Sign in with the same account that owns the API key
3. Review the booking and click **Confirm charge**

This is non-negotiable — it's the safety invariant that lets us give an LLM booking power without risking surprise charges. Treat it as a feature, not a bug.

## 5. Troubleshooting

**"Unknown tool: book_restaurant"**
Claude didn't load the server. Fully quit + relaunch Claude Desktop. Check the log file.

**"401 invalid_api_key"**
Your key format is right but it doesn't match an active key. Revoke + regenerate at [/developers/keys](https://onegent.one/developers/keys), then update the `ONEGENT_API_KEY` value in `claude_desktop_config.json` and relaunch Claude Desktop.

**"Network error / timeout"**
Can you hit `https://onegent.one/api/v1/metrics/providers/opentable` from your terminal with a valid key? If not, the Onegent API is unreachable — check https://onegent.one/status.

**Job is stuck in `queued` for >2 minutes**
Onegent's executor queue is either overloaded or your request hit a provider we don't yet support at the requested city. Call `get_job_audit` with the jobId to see what the agent observed.

**Claude keeps re-polling the same job forever**
Claude Desktop has a per-conversation tool call budget. If the job is still running when the budget runs out, save the jobId and paste it into a new chat — `get_job_status` with that jobId continues to work.

## 6. Claude.ai web (remote MCP)

Claude.ai web supports remote MCP servers over Streamable HTTP — no local install, no Node.js, no API-key copy-paste. Onegent's hosted endpoint at `https://onegent.one/api/mcp` accepts OAuth 2.0 Bearer tokens; sign in once and the Travel Booking Agent shows up in every chat.

### Add Onegent in Claude.ai

1. Open https://claude.ai → **Settings** → **Connectors** (the wording may be **Custom integrations** or **Integrations** depending on your account's rollout).
2. Add a new custom connector with the URL:
   ```
   https://onegent.one/api/mcp
   ```
3. Claude.ai discovers Onegent's OAuth endpoints from [`/.well-known/oauth-authorization-server`](https://onegent.one/.well-known/oauth-authorization-server) and redirects you to Onegent's consent page.
4. Sign in to Onegent (the same account you use at https://onegent.one). Review the requested scopes — `book` (the four `book_*` tools) and `read` (`get_job_status`, `get_job_audit`) — then click **Approve**.
5. Open any new Claude chat. The hammer icon should list **Travel Booking Agent** with the same 6 tools as Claude Desktop in section 2.

### Behind the scenes

```
                claude.ai web                            Onegent
                ─────────────                            ───────
discovery   →   GET /.well-known/oauth-authorization-server
                    issuer + endpoints + supported scopes/methods

authorize   →   redirect to /oauth/authorize?response_type=code
                    &client_id=…&redirect_uri=…&scope=book+read
                    &code_challenge=<S256>&state=…
                                                          ↓
                                                   Clerk-gated consent page
                                                          ↓
                                                  user clicks Approve
                                                          ↓
                redirect back to claude.ai with ?code=…&state=…

token       →   POST /oauth/token (Basic client_secret + PKCE verifier)
                    ← access_token (1h) + refresh_token (30d) + scope

each call   →   POST /api/mcp with Authorization: Bearer <access_token>
                    Onegent validates the token, scope-checks the tool,
                    bridges the OAuth user to the underlying execution
                    engine, and returns the same JSON-RPC shape as the
                    stdio path.
```

PKCE is mandatory (S256 only). Refresh tokens rotate on every use. The full machine-readable metadata lives at the `.well-known` URL above.

### Scopes

| Scope | Tools allowed |
|---|---|
| `book` | `book_restaurant`, `book_hotel`, `book_flight`, `book_activity` |
| `read` | `get_job_status`, `get_job_audit` |

Claude.ai requests both at consent so the agent can book *and* poll status. Granting only one scope still works for the matching tool subset, but the booking → status loop won't be useful with `book` alone.

### Revoking access

- **From Claude.ai**: Settings → Connectors → Onegent → **Remove**. Claude.ai discards its stored tokens.
- **From the protocol level**: Onegent's `/oauth/revoke` (RFC 7009) accepts the access_token directly. Useful if you need to invalidate a specific grant without re-running the connector flow.

Access tokens expire after 1 hour and refresh tokens after 30 days, so an abandoned connector becomes inert quickly even without explicit revoke.

### Troubleshooting

**"This integration could not be added" / "Discovery failed"**
The `.well-known` metadata must be reachable. Confirm:

```bash
curl https://onegent.one/.well-known/oauth-authorization-server
```

returns JSON with `authorization_endpoint` and `token_endpoint`. If you're behind a corporate proxy that strips `.well-known` paths, ask your network team to allowlist it.

**"insufficient_scope" when invoking a `book_*` tool**
The grant only covered `read`. Disconnect Onegent in claude.ai, reconnect, and Approve both scopes.

**`invalid_token` (401) on every call**
The access token expired. Claude.ai should silently refresh; if it doesn't, remove + re-add the connector to force a fresh OAuth dance.

## Reference

- Package source: [`packages/mcp-server`](https://github.com/kakarottoooo/onegent/tree/master/packages/mcp-server)
- REST API this wraps: [`docs/60-api-integrations/api-v1.md`](../api/v1.md)
- Report bugs: https://github.com/kakarottoooo/onegent/issues
