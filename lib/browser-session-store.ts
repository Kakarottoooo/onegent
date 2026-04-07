/**
 * Global singleton that stores active Playwright page references keyed by jobId.
 * Using globalThis so the same Map survives hot-reload in Next.js dev mode.
 */
import type { Page } from "playwright";

interface ActiveSession {
  page: Page;
  expiresAt: number;
}

declare global {
  var __browserSessionStore: Map<string, ActiveSession> | undefined;
}

// Attach to globalThis to survive Next.js HMR in development.
const store: Map<string, ActiveSession> =
  globalThis.__browserSessionStore ??
  (globalThis.__browserSessionStore = new Map<string, ActiveSession>());

const TTL_MS = 15 * 60 * 1000; // 15 minutes

export const browserSessionStore = {
  set(jobId: string, page: Page, ttlMs = TTL_MS): void {
    store.set(jobId, { page, expiresAt: Date.now() + ttlMs });
  },

  get(jobId: string): Page | null {
    const s = store.get(jobId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      store.delete(jobId);
      return null;
    }
    // Keep active live-browser sessions alive while they're being used.
    s.expiresAt = Date.now() + TTL_MS;
    return s.page;
  },

  delete(jobId: string): void {
    store.delete(jobId);
  },

  has(jobId: string): boolean {
    return this.get(jobId) !== null;
  },
};
