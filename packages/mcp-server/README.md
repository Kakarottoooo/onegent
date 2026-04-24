# @onegent/mcp-server

> **Travel Booking Agent** — Book restaurants, hotels, flights, and activities through an AI agent that navigates real booking sites.

**Onegent — AI books your trip end-to-end.**

This is a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [Onegent](https://onegent.com)'s trip-booking execution engine to AI clients — Claude Desktop, Claude.ai, ChatGPT Apps, or any other MCP-compatible LLM host.

Instead of giving the LLM generic web-browsing tools and hoping it figures out a booking flow, this server hands it six purpose-built tools that map directly to Onegent's production REST API. The agent navigates OpenTable / Resy / Booking.com / Expedia / Viator on your behalf and stops before charging your card — you confirm the final submit.

## What it can book

| Tool | What it does | Typical completion |
|---|---|---|
| `book_restaurant` | Dining reservations on OpenTable, Resy, direct sites | 30–120 s |
| `book_hotel` | Rooms on Booking.com, Expedia, Hotels.com | 60–180 s |
| `book_flight` *(preview)* | Airfare via Expedia / airline sites | 90–240 s |
| `book_activity` *(preview)* | Tours, tickets, attractions on Viator / GetYourGuide | 60–180 s |
| `get_job_status` | Poll a booking's progress | — |
| `get_job_audit` | See what the agent observed (for diagnosing failures) | — |

All bookings run asynchronously. `book_*` tools return a `jobId`; the LLM should poll `get_job_status` until the status is terminal.

## Install

### Claude Desktop

Add this block to `claude_desktop_config.json` (Settings → Developer → Edit Config):

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

Restart Claude Desktop. A hammer icon should appear in the composer; clicking it shows "Travel Booking Agent" with 6 tools.

### Claude.ai (remote MCP — coming in 0.2.x)

OAuth-backed remote MCP support is on the roadmap. Until then use the Desktop path above.

### ChatGPT Apps

See [`docs/integrations/chatgpt-apps.md`](https://github.com/kakarottoooo/onegent/blob/master/docs/integrations/chatgpt-apps.md) in the main repo.

### Other MCP clients

Any host that launches stdio MCP servers via command/args works. Set `ONEGENT_API_KEY` in the server's env.

## Get an API key

1. Visit https://onegent.com/developers (launching with v0.2.36+ — email `beta@onegent.com` for early access)
2. Sign in and create a key scoped to the scenarios you need
3. Keys are prefixed `ogk_live_` for production or `ogk_test_` for sandbox

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ONEGENT_API_KEY` | yes | — | Format: `ogk_(live\|test)_xxxxxxxx…`. Treat like a secret. |
| `ONEGENT_API_BASE_URL` | no | `https://onegent.com/api/v1` | Override for self-hosted / staging |

## Usage (sample LLM turn)

> **User:** Book Carbone in NYC for 2 people on April 28 at 7pm. My email is alice@example.com, phone +1-415-555-0123.
>
> **LLM:** *(calls `book_restaurant` with restaurant_name="Carbone", city="New York", date="2026-04-28", time="19:00", covers=2, profile={...})*
>
> → Returns `jobId: abc-123`, status `queued`.
>
> **LLM:** *(after 20 seconds, calls `get_job_status` with jobId="abc-123")*
>
> → status `running`, provider `opentable`.
>
> **LLM:** *(after 30 more seconds, polls again)*
>
> → status `done`, confirmationCode `XYZ-789`.
>
> **LLM:** "Your table is booked. Confirmation: XYZ-789."

## Troubleshooting

**`ONEGENT_API_KEY env var is required`**
The key isn't reaching the server. Check the `env` block in your MCP client config is a proper JSON object, not a string.

**`401 invalid_api_key`**
The key format is right (`ogk_live_…`) but it doesn't match any active key. Regenerate at /developers.

**`400 zod` validation error**
The LLM called a tool with bad args. The error message lists which fields are wrong — usually `date` format (must be `YYYY-MM-DD`) or missing `profile`/`profileId`.

**Job stuck in `queued` for minutes**
Onegent's executor queue may be backed up. Call `get_job_audit` for details, or email support@onegent.com with the jobId.

**`paused_payment` is expected**
Onegent never submits CVV on its own — by design. The user must confirm the final charge in the Onegent web app. This is a safety feature.

## Development

This package lives in the Onegent monorepo at [`packages/mcp-server/`](https://github.com/kakarottoooo/onegent/tree/master/packages/mcp-server).

```bash
git clone https://github.com/kakarottoooo/onegent.git
cd onegent
npm install
npm run build:mcp
# Run against staging:
ONEGENT_API_BASE_URL=https://staging.onegent.com/api/v1 \
ONEGENT_API_KEY=ogk_test_... \
  node packages/mcp-server/dist/index.js
```

## License

MIT
