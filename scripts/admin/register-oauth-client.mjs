/**
 * Admin CLI: register a new OAuth 2.0 client (e.g. ChatGPT Apps, Claude.ai web).
 *
 * Usage:
 *   POSTGRES_URL=... node scripts/admin/register-oauth-client.mjs \
 *     --id chatgpt-apps \
 *     --name "ChatGPT Apps" \
 *     --redirect-uris "https://chat.openai.com/aip/callback,https://chatgpt.com/aip/callback" \
 *     [--scopes book,read]
 *
 * Prints client_id + plaintext client_secret ONCE. We only persist
 * sha256(secret). If you lose the secret, re-run with a new --id (or
 * delete the row in SQL and re-register).
 */

import { sql } from "@vercel/postgres";
import { createHash, randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const v = argv[i + 1];
    args[k.slice(2)] = v;
    i++;
  }
  return args;
}

function help() {
  console.log(`
register-oauth-client — register an OAuth client for /oauth/authorize.

Required:
  --id <slug>              Client identifier (lowercase-kebab, e.g. "chatgpt-apps").
  --name <name>            Human-facing name shown on consent page (e.g. "ChatGPT Apps").
  --redirect-uris <csv>    Comma-separated allowed redirect URIs.

Optional:
  --scopes <csv>           Allowed scopes. Default "book,read".

Examples:
  node scripts/admin/register-oauth-client.mjs \\
    --id chatgpt-apps --name "ChatGPT Apps" \\
    --redirect-uris "https://chat.openai.com/aip/callback,https://chatgpt.com/aip/callback"

  node scripts/admin/register-oauth-client.mjs \\
    --id claude-ai --name "Claude.ai" \\
    --redirect-uris "https://claude.ai/api/mcp/auth_callback"
`.trim());
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help !== undefined || !args.id || !args.name || !args["redirect-uris"]) {
    help();
    process.exit(args.id && args.name && args["redirect-uris"] ? 0 : 1);
  }

  const id = args.id.trim();
  const name = args.name.trim();
  const redirectUris = args["redirect-uris"]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const scopes = (args.scopes ?? "book,read")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error("--id must be lowercase-kebab (e.g. chatgpt-apps)");
    process.exit(1);
  }

  for (const uri of redirectUris) {
    try {
      const u = new URL(uri);
      if (u.protocol !== "https:" && u.hostname !== "localhost") {
        console.error(`redirect_uri must be https (or localhost): ${uri}`);
        process.exit(1);
      }
    } catch {
      console.error(`invalid redirect_uri URL: ${uri}`);
      process.exit(1);
    }
  }

  const allowedScopes = new Set(["book", "read"]);
  const badScopes = scopes.filter((s) => !allowedScopes.has(s));
  if (badScopes.length) {
    console.error(`Unknown scopes: ${badScopes.join(", ")}. Allowed: book, read`);
    process.exit(1);
  }

  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL env var required. Source it from .env.local or Vercel.");
    process.exit(1);
  }

  // Mirror lib/db.ts ensureOAuthTables() so this script is self-contained.
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      client_secret_hash VARCHAR(64) NOT NULL,
      redirect_uris      JSONB NOT NULL DEFAULT '[]',
      allowed_scopes     JSONB NOT NULL DEFAULT '[]',
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const existing = await sql`SELECT id FROM oauth_clients WHERE id = ${id} LIMIT 1`;
  if (existing.rows.length) {
    console.error(
      `Client "${id}" already exists. Delete first if you need to rotate the secret:\n` +
        `  DELETE FROM oauth_clients WHERE id = '${id}';`,
    );
    process.exit(1);
  }

  const secret = randomBytes(32).toString("base64url"); // 43 chars
  const secretHash = createHash("sha256").update(secret).digest("hex");

  await sql`
    INSERT INTO oauth_clients (id, name, client_secret_hash, redirect_uris, allowed_scopes)
    VALUES (
      ${id},
      ${name},
      ${secretHash},
      ${JSON.stringify(redirectUris)}::jsonb,
      ${JSON.stringify(scopes)}::jsonb
    )
  `;

  console.log("\nOAuth client registered. Save the secret NOW — it will not be shown again.\n");
  console.log("  client_id:      " + id);
  console.log("  name:           " + name);
  console.log("  redirect_uris:  " + redirectUris.join(", "));
  console.log("  allowed_scopes: " + scopes.join(", "));
  console.log("\n  client_secret (copy this):\n");
  console.log("    " + secret);
  console.log("\nGive this client_id + client_secret to the platform you're integrating with");
  console.log("(ChatGPT Apps form, Claude.ai MCP server settings, etc).\n");
}

main().catch((err) => {
  console.error("register-oauth-client failed:", err);
  process.exit(1);
});
