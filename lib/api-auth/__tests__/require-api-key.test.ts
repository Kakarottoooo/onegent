/**
 * Unit tests for requireApiKey. Mocks lib/db so no Postgres connection needed.
 * Covers: missing header, bad scheme, malformed key, revoked key, happy path,
 * DB outage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/lib/db", () => ({
  findApiKeyByHash: vi.fn(),
  updateApiKeyLastUsed: vi.fn().mockResolvedValue(undefined),
}));

import { requireApiKey } from "../require-api-key";
import { findApiKeyByHash, updateApiKeyLastUsed } from "@/lib/db";

const mockedFind = findApiKeyByHash as unknown as ReturnType<typeof vi.fn>;
const mockedBump = updateApiKeyLastUsed as unknown as ReturnType<typeof vi.fn>;

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/test", { headers });
}

const VALID_PLAINTEXT = "ogk_live_abcdef0123456789abcdef0123456789xx"; // matches regex
const VALID_HASH = createHash("sha256").update(VALID_PLAINTEXT).digest("hex");

describe("requireApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing Authorization header with 401", async () => {
    const result = await requireApiKey(makeReq());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.error.code).toBe("missing_authorization");
    }
  });

  it("rejects non-Bearer scheme with 401", async () => {
    const result = await requireApiKey(makeReq({ authorization: "Basic foo" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("invalid_auth_scheme");
    }
  });

  it("rejects empty key after Bearer with 401", async () => {
    const result = await requireApiKey(makeReq({ authorization: "Bearer   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("empty_api_key");
    }
  });

  it("rejects malformed key format (wrong prefix)", async () => {
    const result = await requireApiKey(
      makeReq({ authorization: "Bearer sk_live_abcdef123" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("malformed_api_key");
    }
  });

  it("rejects unknown/revoked key with invalid_api_key", async () => {
    mockedFind.mockResolvedValueOnce(null);
    const result = await requireApiKey(
      makeReq({ authorization: `Bearer ${VALID_PLAINTEXT}` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("invalid_api_key");
    }
  });

  it("returns 503 when DB throws (fail closed)", async () => {
    mockedFind.mockRejectedValueOnce(new Error("connection refused"));
    const result = await requireApiKey(
      makeReq({ authorization: `Bearer ${VALID_PLAINTEXT}` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it("happy path: returns context + fires last_used_at update", async () => {
    mockedFind.mockResolvedValueOnce({
      id: "key-123",
      key_hash: VALID_HASH,
      key_prefix: "ogk_live",
      organization_name: "Acme Travel",
      is_active: true,
      rate_limit_per_day: null,
      allowed_job_types: ["restaurant", "hotel"],
      created_at: "2026-04-24T00:00:00Z",
      last_used_at: null,
      revoked_at: null,
    });

    const result = await requireApiKey(
      makeReq({ authorization: `Bearer ${VALID_PLAINTEXT}` }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.keyId).toBe("key-123");
      expect(result.context.organizationName).toBe("Acme Travel");
      expect(result.context.allowedJobTypes).toEqual(["restaurant", "hotel"]);
      expect(result.context.keyPrefix).toBe("ogk_live");
    }

    // Verify findApiKeyByHash was called with sha256 of plaintext
    expect(mockedFind).toHaveBeenCalledWith(VALID_HASH);
    // Verify fire-and-forget last_used_at bump was scheduled
    expect(mockedBump).toHaveBeenCalledWith("key-123");
  });

  it("does NOT leak plaintext to DB — only sha256 hash", async () => {
    mockedFind.mockResolvedValueOnce(null);
    await requireApiKey(
      makeReq({ authorization: `Bearer ${VALID_PLAINTEXT}` }),
    );
    const calledArg = mockedFind.mock.calls[0][0];
    expect(calledArg).not.toContain(VALID_PLAINTEXT);
    expect(calledArg).toBe(VALID_HASH);
    expect(calledArg).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });
});
