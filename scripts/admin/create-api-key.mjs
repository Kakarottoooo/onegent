/**
 * Admin CLI: mint a new API key for /api/v1/* access.
 *
 * Usage:
 *   POSTGRES_URL=... node scripts/admin/create-api-key.mjs \
 *     --org "Acme Travel" [--env live|test] \
 *     [--scenarios restaurant,hotel,flight,activity] \
 *     [--rate-limit-per-day 1000]
 *
 * Prints the plaintext key ONCE. We only persist sha256(plaintext).
 * If you lose the plaintext, revoke and re-mint.
 *
 * No dependencies beyond @vercel/postgres (already installed). Uses Node
 * crypto for hashing and uuid. Intentionally does NOT import lib/db
 * because that's TypeScript and we have no ts runner yet.
 */

import { sql } from "@vercel/postgres";
import { createHash, randomBytes, randomUUID } from "node:crypto";

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
create-api-key — mint an /api/v1/* API key.

Required:
  --org <name>          Organization / label for this key. Printed back in
                        audit and response bodies so you can identify callers.

Optional:
  --env live|test       Default "live". Controls key prefix (ogk_live_ vs ogk_test_).
  --scenarios <csv>     Comma-separated allowed_job_types. Default null = all.
                        Allowed values: restaurant,hotel,flight,activity
  --rate-limit-per-day <int>  Occupies the column; not enforced in Week 3.

Examples:
  node scripts/admin/create-api-key.mjs --org "Acme Travel"
  node scripts/admin/create-api-key.mjs --org "Test" --env test --scenarios restaurant,hotel
`.trim());
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help !== undefined || !args.org) {
    help();
    process.exit(args.org ? 0 : 1);
  }

  const org = args.org;
  const env = args.env === "test" ? "test" : "live";
  const scenarios = args.scenarios
    ? args.scenarios.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const rateLimit = args["rate-limit-per-day"]
    ? parseInt(args["rate-limit-per-day"], 10)
    : null;

  if (scenarios) {
    const allowed = new Set(["restaurant", "hotel", "flight", "activity"]);
    const bad = scenarios.filter((s) => !allowed.has(s));
    if (bad.length) {
      console.error(`Unknown scenarios: ${bad.join(", ")}`);
      console.error(`Allowed: ${[...allowed].join(", ")}`);
      process.exit(1);
    }
  }

  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL env var required. Source it from .env.local or Vercel.");
    process.exit(1);
  }

  // Ensure table exists (matches lib/db.ts's ensureApiKeysTable).
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id                   TEXT PRIMARY KEY,
      key_hash             VARCHAR(64) NOT NULL UNIQUE,
      key_prefix           VARCHAR(16) NOT NULL,
      organization_name    TEXT NOT NULL,
      is_active            BOOLEAN NOT NULL DEFAULT TRUE,
      rate_limit_per_day   INTEGER,
      allowed_job_types    TEXT[],
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      last_used_at         TIMESTAMPTZ,
      revoked_at           TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS api_keys_hash_active_idx ON api_keys (key_hash) WHERE is_active = TRUE`;
  await sql`CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (organization_name)`;

  const rand = randomBytes(24).toString("base64url");
  const plaintextKey = `ogk_${env}_${rand}`;
  const keyHash = createHash("sha256").update(plaintextKey).digest("hex");
  const keyPrefix = `ogk_${env}`;
  const id = randomUUID();

  await sql`
    INSERT INTO api_keys (id, key_hash, key_prefix, organization_name, rate_limit_per_day, allowed_job_types)
    VALUES (${id}, ${keyHash}, ${keyPrefix}, ${org}, ${rateLimit}, ${scenarios})
  `;

  console.log("\n✅ API key created. Save this plaintext NOW — it will not be shown again.\n");
  console.log("  id:                " + id);
  console.log("  organization:      " + org);
  console.log("  env:               " + env);
  console.log("  allowed_scenarios: " + (scenarios ? scenarios.join(",") : "(all)"));
  console.log("  rate_limit_per_day:" + (rateLimit ?? "(unlimited / not enforced)"));
  console.log("\n  plaintext key (copy this):\n");
  console.log("    " + plaintextKey);
  console.log("\nTest it:\n");
  console.log(`  curl -H "Authorization: Bearer ${plaintextKey}" http://localhost:3000/api/v1/metrics/providers/opentable-com`);
  console.log();
}

main().catch((err) => {
  console.error("create-api-key failed:", err);
  process.exit(1);
});
