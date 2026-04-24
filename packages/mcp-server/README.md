# @onegent/mcp-server

> **Travel Booking Agent** — Book restaurants, hotels, flights, and activities through an AI agent that navigates real booking sites.

Onegent — AI books your trip end-to-end.

This is a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [Onegent](https://onegent.com)'s trip-booking execution engine to AI clients (Claude Desktop, ChatGPT Apps, etc.).

Full install & usage docs: see [`docs/integrations/claude-mcp.md`](https://github.com/kakarottoooo/onegent/blob/master/docs/integrations/claude-mcp.md) in the main repo.

## Quickstart

```json
{
  "mcpServers": {
    "onegent": {
      "command": "npx",
      "args": ["-y", "@onegent/mcp-server"],
      "env": { "ONEGENT_API_KEY": "ogk_live_..." }
    }
  }
}
```

Get an API key at https://onegent.com/developers (coming soon — email beta@onegent.com for early access).

## License

MIT
