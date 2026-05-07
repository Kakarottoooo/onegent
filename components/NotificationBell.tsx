"use client";

/**
 * NotificationBell — bell icon + red dot + dropdown panel for the
 * unified inbox introduced in P7.
 *
 * Polls the lightweight /unread-count endpoint every 45s for the badge;
 * fetches the full list lazily on first dropdown open + on each open
 * thereafter. Click an item → mark read + navigate.
 *
 * The 45s cadence is intentional — short enough to feel live, long
 * enough not to burn DB / cache. We're not building a chat app.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/hooks/useAuth";

interface NotifRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
}

const POLL_MS = 45_000;
const UNREAD_COUNT_CACHE_MS = 30000;

let unreadCountCache: { count: number; expiresAt: number } | null = null;
let unreadCountInflight: Promise<number> | null = null;

async function fetchUnreadCountCached(force = false): Promise<number> {
  const now = Date.now();
  if (!force && unreadCountCache && unreadCountCache.expiresAt > now) {
    return unreadCountCache.count;
  }
  if (!force && unreadCountInflight) return unreadCountInflight;

  unreadCountInflight = fetch("/api/notifications/unread-count")
    .then(async (res) => {
      if (!res.ok) return unreadCountCache?.count ?? 0;
      const data = (await res.json()) as { count?: number };
      const count = data.count ?? 0;
      unreadCountCache = {
        count,
        expiresAt: Date.now() + UNREAD_COUNT_CACHE_MS,
      };
      return count;
    })
    .catch(() => unreadCountCache?.count ?? 0)
    .finally(() => {
      unreadCountInflight = null;
    });

  return unreadCountInflight;
}

export default function NotificationBell() {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll unread count while signed in. Fires immediately + every 45s.
  useEffect(() => {
    if (!auth.isSignedIn) {
      setCount(0);
      setItems([]);
      return;
    }
    let cancelled = false;
    async function tick() {
      const nextCount = await fetchUnreadCountCached();
      if (!cancelled) setCount(nextCount);
    }
    void tick();
    pollRef.current = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [auth.isSignedIn]);

  async function loadList() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: NotifRow[] };
      setItems(data.notifications ?? []);
    } finally {
      setLoading(false);
    }
  }

  function toggleOpen() {
    if (!open) void loadList();
    setOpen((prev) => !prev);
  }

  async function clickItem(n: NotifRow) {
    // Optimistic mark-read so the badge drops immediately.
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setCount((prev) => Math.max(0, prev - 1));
      if (unreadCountCache) {
        unreadCountCache = {
          count: Math.max(0, unreadCountCache.count - 1),
          expiresAt: Date.now() + UNREAD_COUNT_CACHE_MS,
        };
      }
      void fetch(`/api/notifications/${n.id}/read`, { method: "PATCH" }).catch(() => {});
    }
    setOpen(false);
    if (n.link_url) router.push(n.link_url);
  }

  async function markAllRead() {
    setCount(0);
    unreadCountCache = {
      count: 0,
      expiresAt: Date.now() + UNREAD_COUNT_CACHE_MS,
    };
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    void fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  if (!auth.isSignedIn) return null;

  const itemBaseStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    width: "100%",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    borderBottom: "0.5px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
    fontFamily: "var(--font-dm-sans)",
    color: "#F4E7C8",
    textAlign: "left",
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notifications"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "1px solid var(--border, #e5e7eb)",
          background: open ? "rgba(201,168,76,0.12)" : "var(--card, #fff)",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          color: "var(--text-primary, #111)",
          position: "relative",
        }}
      >
        🔔
        {count > 0 && (
          <span
            aria-label={`${count} unread`}
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 999,
              background: "rgba(220,38,38,0.92)",
              color: "white",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 8px)",
              minWidth: 320,
              maxWidth: 380,
              maxHeight: 480,
              overflowY: "auto",
              zIndex: 50,
              borderRadius: 16,
              border: "0.5px solid rgba(201,168,76,0.22)",
              background: "linear-gradient(180deg, rgba(34,30,26,0.98) 0%, rgba(25,22,19,0.99) 100%)",
              boxShadow: "0 20px 48px rgba(0,0,0,0.32)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                borderBottom: "0.5px solid rgba(255,255,255,0.06)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(244,231,200,0.5)",
                }}
              >
                Notifications
              </span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--gold, #C9A84C)",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>

            {loading && items.length === 0 && (
              <p
                style={{
                  padding: 24,
                  textAlign: "center",
                  fontSize: 12,
                  color: "rgba(244,231,200,0.5)",
                }}
              >
                Loading…
              </p>
            )}

            {!loading && items.length === 0 && (
              <p
                style={{
                  padding: 24,
                  textAlign: "center",
                  fontSize: 13,
                  color: "rgba(244,231,200,0.55)",
                }}
              >
                You&apos;re all caught up.
              </p>
            )}

            {items.map((n, idx) => (
              <button
                key={n.id}
                type="button"
                onClick={() => clickItem(n)}
                style={{
                  ...itemBaseStyle,
                  background: n.read_at ? "transparent" : "rgba(201,168,76,0.08)",
                  borderBottom:
                    idx === items.length - 1
                      ? "none"
                      : "0.5px solid rgba(255,255,255,0.06)",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: n.read_at ? 500 : 700,
                    color: "#F8F2E7",
                    marginBottom: n.body ? 4 : 2,
                  }}
                >
                  {n.title}
                </span>
                {n.body && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(244,231,200,0.7)",
                      marginBottom: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {n.body}
                  </span>
                )}
                <span style={{ fontSize: 10, color: "rgba(244,231,200,0.42)" }}>
                  {timeAgo(n.created_at)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}
