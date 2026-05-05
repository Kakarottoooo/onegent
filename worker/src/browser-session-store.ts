/**
 * Global singleton that stores active Playwright page references keyed by jobId.
 * Using globalThis so the same Map survives hot-reload in Next.js dev mode.
 *
 * Supports two modes:
 *  - Static page:  set(jobId, page) — stores a fixed Page reference
 *  - Dynamic getter: setGetter(jobId, fn) — stores a function called on every get()
 *    Use the getter mode when the active page may change (tab navigations, stagehand.act()).
 */
import type { Page } from "playwright";

type PageGetter = () => Page | null | undefined;

interface ActiveSession {
  page?: Page;
  getter?: PageGetter;
  expiresAt: number;
}

declare global {
  var __browserSessionStore: Map<string, ActiveSession> | undefined;
}

// Attach to globalThis to survive Next.js HMR in development.
const store: Map<string, ActiveSession> =
  globalThis.__browserSessionStore ??
  (globalThis.__browserSessionStore = new Map<string, ActiveSession>());

const TTL_MS = 60 * 60 * 1000; // 60 minutes

export const browserSessionStore = {
  /** Store a static Page reference. */
  set(jobId: string, page: Page, ttlMs = TTL_MS): void {
    store.set(jobId, { page, expiresAt: Date.now() + ttlMs });
  },

  /**
   * Store a dynamic getter function.
   * Called on every get() so the stream always receives the current active page
   * even after tab switches or stagehand.act() navigations.
   */
  setGetter(jobId: string, getter: PageGetter, ttlMs = TTL_MS): void {
    store.set(jobId, { getter, expiresAt: Date.now() + ttlMs });
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

    if (s.getter) {
      return s.getter() ?? null;
    }
    return s.page ?? null;
  },

  delete(jobId: string): void {
    store.delete(jobId);
  },

  has(jobId: string): boolean {
    return this.get(jobId) !== null;
  },
};
