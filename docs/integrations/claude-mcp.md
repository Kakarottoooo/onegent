# Claude Desktop — Onegent MCP integration

> **Onegent — AI books your trip end-to-end.**
> Book restaurants, hotels, flights, and activities through Claude Desktop using Onegent's Travel Booking Agent.

## Prerequisites

- [Claude Desktop](https://claude.ai/download) 0.7.0 or newer (MCP support required)
- Node.js 18+ on your machine (`npx` is used to run the server)
- An Onegent API key — request one at `beta@onegent.one` until the self-serve `/developers` page launches

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
Your key format is right but it doesn't match an active key. Regenerate via `beta@onegent.one` for now; self-serve key rotation at `/developers` ships in v0.2.36+.

**"Network error / timeout"**
Can you hit `https://onegent.one/api/v1/metrics/providers/opentable` from your terminal with a valid key? If not, the Onegent API is unreachable — check https://onegent.one/status.

**Job is stuck in `queued` for >2 minutes**
Onegent's executor queue is either overloaded or your request hit a provider we don't yet support at the requested city. Call `get_job_audit` with the jobId to see what the agent observed.

**Claude keeps re-polling the same job forever**
Claude Desktop has a per-conversation tool call budget. If the job is still running when the budget runs out, save the jobId and paste it into a new chat — `get_job_status` with that jobId continues to work.

## 6. Claude.ai (remote MCP) — roadmap

Claude Desktop uses stdio transport, which needs a local Node.js runtime. For Claude.ai web users, MCP servers must be hosted remotely and authenticate via OAuth 2.0. Onegent's hosted remote MCP connector is on the roadmap for v0.2.37+.

Until then: Claude Desktop on Mac/Windows is the supported path.

## Reference

- Package source: [`packages/mcp-server`](https://github.com/kakarottoooo/onegent/tree/master/packages/mcp-server)
- REST API this wraps: [`docs/api/v1.md`](../api/v1.md)
- Report bugs: https://github.com/kakarottoooo/onegent/issues
