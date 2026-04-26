/**
 * AES-256-GCM symmetric encryption for sensitive user data (card numbers, etc.)
 * Key is stored server-side in BOOKING_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * Never called from the browser — server-only.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const key = process.env.BOOKING_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("BOOKING_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt plaintext → "ivHex:tagHex:cipherHex"
 * Returns empty string if text is empty/null.
 */
export function encrypt(text: string | undefined | null): string {
  if (!text) return "";
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt "ivHex:tagHex:cipherHex" → plaintext.
 * Returns empty string if encoded is empty/null.
 */
export function decrypt(encoded: string | undefined | null): string {
  if (!encoded) return "";
  try {
    const [ivHex, tagHex, encHex] = encoded.split(":");
    if (!ivHex || !tagHex || !encHex) return "";
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}
