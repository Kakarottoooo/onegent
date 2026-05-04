# ChatGPT — Onegent integration

> **Onegent — AI books your trip end-to-end.**

ChatGPT does not natively speak MCP stdio, so the Claude Desktop recipe in [`claude-mcp.md`](./claude-mcp.md) doesn't apply. ChatGPT integrates via two paths, both supported by this package.

| Path | Status | Best for |
|---|---|---|
| [ChatGPT Apps SDK](#1-chatgpt-apps-recommended-long-term) | Preview | Public directory distribution |
| [Custom GPT Action](#2-custom-gpt-action-available-today) | Available | Private teams, immediate use |

## 1. ChatGPT Apps (recommended long-term)

The new [ChatGPT Apps SDK](https://platform.openai.com/docs/apps) uses MCP over Streamable HTTP. Onegent's `@onegent/mcp-server` package supports HTTP mode natively:

```bash
onegent-mcp-server --http --port 3333
```

### Architecture

```
User in ChatGPT
      │
      ▼
  OpenAI ────────► HTTPS ────────► @onegent/mcp-server --http
                                          │
                                          ▼
                                 https://onegent.one/api/v1/*
```

OpenAI routes the user's natural-language request to an MCP server you've registered. Your MCP server calls Onegent's REST API with the user's scoped API key.

### Preparing the submission

1. **Host the HTTP MCP server** at a stable HTTPS URL. Options:
   - **Onegent-hosted (recommended)**: we're deploying `https://onegent.one/api/mcp` in v0.2.37+. Third parties can use this directly — no self-hosting required. You'd submit an "app" that proxies to our endpoint.
   - **Self-host**: run the package on Fly, Cloud Run, Railway, or any HTTPS-terminating platform. Reverse-proxy 443 → the container's 3333.

2. **Prepare the manifest**. Start from the template at [`packages/mcp-server/chatgpt-apps/manifest.json`](../../packages/mcp-server/chatgpt-apps/manifest.json). Key fields:

   ```jsonc
   {
     "name": "Travel Booking Agent",
     "description": "Book restaurants, hotels, flights, and activities through an AI agent that navigates real booking sites.",
     "mcp": {
       "url": "https://your-host.example.com/",
       "transport": "streamable_http",
       "auth": { "type": "api_key", "headerName": "Authorization", "headerPrefix": "Bearer " }
     }
   }
   ```

   > ⚠ Always validate against the latest OpenAI schema before submission. Field names above reflect the MCP-era spec and may shift while Apps SDK is in preview.

3. **Submit at** https://platform.openai.com/apps (account with Apps access required). Review typically takes 5–10 business days. Expect questions about the payment-safety model — link to the "Payment safety" section in `claude-mcp.md`.

### Auth: how users paste their key

ChatGPT Apps lets users attach an API key during app install. When the user talks to the app, ChatGPT includes the key in the MCP request's `Authorization` header. `@onegent/mcp-server` reads this transparently via `ONEGENT_API_KEY` env fallback — but for hosted Apps, OpenAI populates the header directly and there's no local env.

Test this with curl to confirm before submitting:

```bash
curl -X POST https://your-host.example.com/ \
  -H "Authorization: Bearer ogk_test_xxx" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

You should get an SSE response listing all 6 tools.

## 2. Custom GPT Action (available today)

The older but still-supported Custom GPT path lets you build a private GPT that calls Onegent's REST API via an OpenAPI spec. This bypasses MCP entirely but works out of the box with no approval process.

### Setup

1. Go to [chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor) → **Create**
2. In **Configure → Actions → Create new action**
3. Paste this OpenAPI 3.1 spec (abridged; the full surface is in [`docs/60-api-integrations/api-v1.md`](../api/v1.md)):

   ```yaml
   openapi: 3.1.0
   info:
     title: Onegent Travel Booking Execution API
     version: "1"
   servers:
     - url: https://onegent.one/api/v1
   paths:
     /execution-jobs:
       post:
         operationId: createExecutionJob
         summary: Start a booking job
         requestBody:
           required: true
           content:
             application/json:
               schema:
                 type: object
                 properties:
                   request:
                     type: object
                     properties:
                       scenario: { type: string, enum: [restaurant, hotel, flight, activity] }
                       params: { type: object }
                   profile:
                     type: object
                 required: [request]
         responses:
           "202":
             description: Job created
     /execution-jobs/{jobId}:
       get:
         operationId: getExecutionJob
         parameters:
           - in: path
             name: jobId
             required: true
             schema: { type: string }
         responses:
           "200": { description: Job status }
   components:
     securitySchemes:
       bearer:
         type: http
         scheme: bearer
   security:
     - bearer: []
   ```

4. In **Authentication**, select **API Key** → **Custom (Bearer)**. Paste your `ogk_live_...` key.
5. In the GPT's instructions, paste:

   > You help users book restaurants, hotels, flights, and activities. Use the Onegent API: POST /execution-jobs to start, then GET /execution-jobs/{jobId} to poll. The agent pauses for payment at status "paused_payment" — tell the user to confirm in their Onegent app.

6. Save. Test in the editor.

### Limitations of Custom GPT

- Only available to your personal account (or your team's, with Team/Enterprise plans)
- Cannot be listed in the GPT Store as of April 2026 for third-party-API actions that aren't pre-approved
- Requires user to paste their key during GPT setup (not per-conversation)
- No MCP instructions/resources support — ChatGPT just sees the OpenAPI shape

For everything past an internal demo, submit via the Apps SDK path above.

## Reference

- Package source: [`packages/mcp-server`](../../packages/mcp-server)
- Manifest template: [`packages/mcp-server/chatgpt-apps/manifest.json`](../../packages/mcp-server/chatgpt-apps/manifest.json)
- REST API: [`docs/60-api-integrations/api-v1.md`](../api/v1.md)
- Claude Desktop path (for comparison): [`docs/60-api-integrations/claude-mcp.md`](./claude-mcp.md)
