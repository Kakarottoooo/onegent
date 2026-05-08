import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "@/lib/encryption";
import { sql } from "@/lib/db";

let gmailConnectionsTableReady: Promise<void> | null = null;

export type GmailProvider = "google";

export interface GmailConnectionRow {
  id: string;
  user_id: string;
  provider: GmailProvider;
  external_account_id: string | null;
  external_account_email: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  scope: string | null;
  token_type: string | null;
  access_token_expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailConnectionSecret {
  accessToken: string | null;
  refreshToken: string | null;
}

export async function ensureGmailConnectionsTable(): Promise<void> {
  if (!gmailConnectionsTableReady) {
    gmailConnectionsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS gmail_connections (
          id                       TEXT PRIMARY KEY,
          user_id                  TEXT NOT NULL,
          provider                 TEXT NOT NULL,
          external_account_id      TEXT,
          external_account_email   TEXT,
          access_token_enc         TEXT,
          refresh_token_enc        TEXT,
          scope                    TEXT,
          token_type               TEXT,
          access_token_expires_at  TIMESTAMPTZ,
          last_used_at             TIMESTAMPTZ,
          created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, provider)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS gmail_connections_user_idx ON gmail_connections (user_id)`;
    })().catch((err) => {
      gmailConnectionsTableReady = null;
      throw err;
    });
  }
  await gmailConnectionsTableReady;
}

export async function getGmailConnection(
  userId: string,
  provider: GmailProvider,
): Promise<GmailConnectionRow | null> {
  await ensureGmailConnectionsTable();
  const result = await sql<GmailConnectionRow>`
    SELECT * FROM gmail_connections
    WHERE user_id = ${userId} AND provider = ${provider}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getGmailConnectionWithSecrets(
  userId: string,
  provider: GmailProvider,
): Promise<(GmailConnectionRow & GmailConnectionSecret) | null> {
  const row = await getGmailConnection(userId, provider);
  if (!row) return null;
  return {
    ...row,
    accessToken: row.access_token_enc ? decrypt(row.access_token_enc) || null : null,
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) || null : null,
  };
}

export async function upsertGmailConnection(params: {
  userId: string;
  provider: GmailProvider;
  externalAccountId?: string | null;
  externalAccountEmail?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  accessTokenExpiresAt?: string | null;
}): Promise<GmailConnectionRow> {
  await ensureGmailConnectionsTable();
  const existing = await getGmailConnection(params.userId, params.provider);
  const id = existing?.id ?? randomUUID();
  const accessTokenEnc =
    params.accessToken !== undefined
      ? (params.accessToken ? encrypt(params.accessToken) : null)
      : existing?.access_token_enc ?? null;
  const refreshTokenEnc =
    params.refreshToken !== undefined
      ? (params.refreshToken ? encrypt(params.refreshToken) : null)
      : existing?.refresh_token_enc ?? null;
  const externalAccountId = params.externalAccountId ?? existing?.external_account_id ?? null;
  const externalAccountEmail = params.externalAccountEmail ?? existing?.external_account_email ?? null;
  const scope = params.scope ?? existing?.scope ?? null;
  const tokenType = params.tokenType ?? existing?.token_type ?? null;
  const expiresAt = params.accessTokenExpiresAt ?? existing?.access_token_expires_at ?? null;

  const result = await sql<GmailConnectionRow>`
    INSERT INTO gmail_connections (
      id, user_id, provider, external_account_id, external_account_email,
      access_token_enc, refresh_token_enc, scope, token_type, access_token_expires_at, updated_at
    )
    VALUES (
      ${id}, ${params.userId}, ${params.provider}, ${externalAccountId}, ${externalAccountEmail},
      ${accessTokenEnc}, ${refreshTokenEnc}, ${scope}, ${tokenType}, ${expiresAt}, NOW()
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      external_account_id = EXCLUDED.external_account_id,
      external_account_email = EXCLUDED.external_account_email,
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      scope = EXCLUDED.scope,
      token_type = EXCLUDED.token_type,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

export async function markGmailConnectionUsed(
  userId: string,
  provider: GmailProvider,
): Promise<void> {
  await ensureGmailConnectionsTable();
  await sql`
    UPDATE gmail_connections
    SET last_used_at = NOW(), updated_at = NOW()
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
}

export async function deleteGmailConnection(
  userId: string,
  provider: GmailProvider,
): Promise<void> {
  await ensureGmailConnectionsTable();
  await sql`
    DELETE FROM gmail_connections
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
}
