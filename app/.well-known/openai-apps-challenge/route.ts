/**
 * OpenAI Apps domain verification.
 *
 * OpenAI's ChatGPT Apps marketplace pings this URL to verify we control
 * onegent.one. Returns a static token that matches what we registered in
 * the Apps developer portal under MCP Server → Domain verification.
 *
 * Token issued: 2026-04-26 (Sprint 1 #2 / task #22)
 */

export const dynamic = "force-static";
export const runtime = "nodejs";

const VERIFICATION_TOKEN = "FdAFXgWxJC0KtfLgJkfMlNh6lzvUyWtUuPGciAN2V4Q";

export function GET(): Response {
  return new Response(VERIFICATION_TOKEN, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
