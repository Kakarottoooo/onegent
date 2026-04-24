"use client";

/**
 * ChatGPT-style left sidebar for the homepage. Always visible on desktop,
 * collapses to a drawer on mobile.
 *
 * Sections:
 *   - "+ New chat" button → navigates to `/` (clears URL params, fresh chat)
 *   - Rooms — trip / single-scenario rooms the user is in (joined or
 *     invited). Click routes to /?room_id=<id> (chat-flow) or /rooms/<id>
 *     (classic flow).
 *   - Sessions — solo chat threads that haven't become rooms. Sessions with
 *     upgraded_room_id set get a 🏠 badge and route to the upgraded room
 *     instead of the dead solo URL (single-entry design).
 *
 * Fetches on mount + when `reloadTick` prop bumps. Consumer can bump the
 * tick to refresh after creating a new room / session.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/hooks/useAuth";
import type { DecisionRoomWithMembership } from "@/lib/db";

interface ContextMenuState {
  kind: "room" | "session";
  x: number;
  y: number;
  room?: DecisionRoomWithMembership;
  session?: SessionRow;
}

interface SessionRow {
  id: string;
  title: string;
  upgraded_room_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SidebarProps {
  /** The currently-active session or room id so we can highlight. */
  activeSessionId?: string | null;
  activeRoomId?: string | null;
  /** Bump to trigger a refetch. */
  reloadTick?: number;
}

const SIDEBAR_WIDTH = 260;
const SIDEBAR_COLLAPSED_WIDTH = 44;
const COLLAPSED_STORAGE_KEY = "onegent.sidebar.collapsed";

export default function Sidebar({ activeSessionId, activeRoomId, reloadTick }: SidebarProps) {
  const { isSignedIn, userId } = useAuth();
  const router = useRouter();
  const [rooms, setRooms] = useState<DecisionRoomWithMembership[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localReloadTick, setLocalReloadTick] = useState(0);
  // Collapse state persists across reloads. Default expanded; hydrate from
  // localStorage on mount to avoid SSR mismatch.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      // localStorage disabled — stay expanded.
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // non-fatal
      }
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const [roomsRes, sessionsRes] = await Promise.all([
        fetch("/api/rooms?include_invited=1"),
        fetch("/api/chat/sessions"),
      ]);
      if (roomsRes.ok) {
        const data = await roomsRes.json();
        setRooms(data.rooms ?? []);
      }
      if (sessionsRes.ok) {
        const data = await sessionsRes.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      // swallow — sidebar is best-effort UX
    }
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setRooms([]);
      setSessions([]);
      return;
    }
    load();
  }, [isSignedIn, reloadTick, localReloadTick, load]);

  // Keep the sidebar fresh so creator-side deletions, new DMs creating
  // invited rooms, etc. show up without a manual refresh. Polls every 30s
  // while the tab is visible; pauses when hidden to avoid wasted calls.
  useEffect(() => {
    if (!isSignedIn) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      load();
    };
    const interval = setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isSignedIn, load]);

  // Dismiss the context menu on any click / esc / scroll.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function openRoomMenu(room: DecisionRoomWithMembership, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 140);
    setMenu({ kind: "room", x, y, room });
  }

  function openSessionMenu(session: SessionRow, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 140);
    setMenu({ kind: "session", x, y, session });
  }

  async function deleteRoom(room: DecisionRoomWithMembership) {
    setMenu(null);
    if (!confirm(`Delete "${room.title}" permanently? This can't be undone.`)) return;
    setBusyId(room.id);
    try {
      const res = await fetch(`/api/rooms/${room.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Couldn't delete room.");
        return;
      }
      // If the user was in this room's URL, bounce to /.
      if (activeRoomId === room.id) router.push("/");
      setLocalReloadTick((n) => n + 1);
    } finally {
      setBusyId(null);
    }
  }

  async function leaveRoom(room: DecisionRoomWithMembership) {
    setMenu(null);
    const verb = room.member_status === "invited" ? "Decline invite to" : "Leave";
    if (!confirm(`${verb} "${room.title}"?`)) return;
    setBusyId(room.id);
    try {
      const res = await fetch(`/api/rooms/${room.id}/leave`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Couldn't leave room.");
        return;
      }
      if (activeRoomId === room.id) router.push("/");
      setLocalReloadTick((n) => n + 1);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSession(session: SessionRow) {
    setMenu(null);
    if (!confirm(`Delete "${session.title}"? This conversation will be lost.`)) return;
    setBusyId(session.id);
    try {
      const res = await fetch(`/api/chat/sessions/${session.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Couldn't delete session.");
        return;
      }
      if (activeSessionId === session.id) router.push("/");
      setLocalReloadTick((n) => n + 1);
    } finally {
      setBusyId(null);
    }
  }

  // Filter sessions: hide those that were upgraded to rooms — the room list
  // above already shows them, and showing both is the "duplicate entry"
  // anti-pattern the design convo explicitly rejected. A session row that
  // points at a room keeps its title + 🏠 badge via the room card instead.
  const soloSessions = (sessions ?? []).filter((s) => !s.upgraded_room_id);

  function goNewChat() {
    setMobileOpen(false);
    router.push("/");
  }

  function goRoom(room: DecisionRoomWithMembership) {
    setMobileOpen(false);
    if (room.member_status === "invited") {
      // Invited rooms should route through the /rooms list so the user
      // clicks "Accept invite" explicitly — that's where the side effect
      // (joinDecisionRoom) fires.
      router.push("/rooms");
      return;
    }
    if (room.flow === "chat") {
      router.push(`/?room_id=${room.id}`);
    } else {
      router.push(`/rooms/${room.id}`);
    }
  }

  function goSession(session: SessionRow) {
    setMobileOpen(false);
    if (session.upgraded_room_id) {
      router.push(`/?room_id=${session.upgraded_room_id}`);
      return;
    }
    router.push(`/?session_id=${session.id}`);
  }

  const Inner = (
    <div
      style={{
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        height: "100vh",
        background: "var(--card, #1a1714)",
        borderRight: "1px solid var(--border, #2a2622)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 160ms ease",
      }}
    >
      {/* Top: Collapse toggle + New chat button.
          When collapsed, only the chevron button + a compact "+" icon fit. */}
      <div
        style={{
          padding: collapsed ? "8px 4px" : "12px",
          borderBottom: "1px solid var(--border, #2a2622)",
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          gap: 6,
          alignItems: "stretch",
        }}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            width: collapsed ? "100%" : 32,
            height: 32,
            padding: 0,
            background: "transparent",
            border: "1px solid var(--border, #2a2622)",
            borderRadius: 8,
            color: "var(--text-muted, #888)",
            fontSize: 14,
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {collapsed ? "›" : "‹"}
        </button>
        <button
          type="button"
          onClick={goNewChat}
          title="New chat"
          style={{
            flex: 1,
            padding: collapsed ? 0 : "10px 12px",
            width: collapsed ? "100%" : undefined,
            height: collapsed ? 32 : undefined,
            background: "transparent",
            border: "1px solid var(--gold, #C9A84C)",
            borderRadius: 10,
            color: "var(--gold, #C9A84C)",
            fontFamily: "var(--font-dm-sans)",
            fontSize: collapsed ? 16 : 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: collapsed ? "center" : "left",
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16 }}>+</span>
          {collapsed ? null : <span>New chat</span>}
        </button>
      </div>

      {/* Scroll area. Collapsed mode shows icon-only squares for each row;
          expanded mode shows the full title + subtitle + context menu. */}
      <div style={{ flex: 1, overflowY: "auto", padding: collapsed ? "6px 4px" : "8px 4px" }}>
        {/* Rooms section */}
        {collapsed ? null : <SectionLabel text="Rooms" />}
        {rooms === null ? (
          collapsed ? null : <SidebarSkeleton />
        ) : rooms.length === 0 ? (
          collapsed ? null : <EmptyHint text="No rooms yet" />
        ) : (
          rooms.map((r) => {
            const isActive = activeRoomId === r.id;
            const isInvited = r.member_status === "invited";
            const icon = isInvited ? "✉️" : "🏠";
            if (collapsed) {
              return (
                <IconOnlyRow
                  key={r.id}
                  icon={icon}
                  title={r.title}
                  active={isActive}
                  onClick={() => goRoom(r)}
                  dimmed={busyId === r.id}
                />
              );
            }
            return (
              <SidebarRow
                key={r.id}
                icon={icon}
                title={r.title}
                subtitle={isInvited ? "Invited · tap to accept" : undefined}
                active={isActive}
                onClick={() => goRoom(r)}
                onContextMenu={(e) => openRoomMenu(r, e)}
                dimmed={busyId === r.id}
              />
            );
          })
        )}

        {/* Sessions section */}
        {collapsed ? null : <SectionLabel text="Sessions" />}
        {sessions === null ? (
          collapsed ? null : <SidebarSkeleton />
        ) : soloSessions.length === 0 ? (
          collapsed ? null : <EmptyHint text="Your previous chats will show up here." />
        ) : (
          soloSessions.map((s) =>
            collapsed ? (
              <IconOnlyRow
                key={s.id}
                icon="💬"
                title={s.title || "Untitled"}
                active={activeSessionId === s.id}
                onClick={() => goSession(s)}
                dimmed={busyId === s.id}
              />
            ) : (
              <SidebarRow
                key={s.id}
                icon="💬"
                title={s.title || "Untitled"}
                active={activeSessionId === s.id}
                onClick={() => goSession(s)}
                onContextMenu={(e) => openSessionMenu(s, e)}
                dimmed={busyId === s.id}
              />
            ),
          )
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: always visible on the left */}
      <aside
        className="hidden md:block"
        style={{
          position: "sticky",
          top: 0,
          left: 0,
          flexShrink: 0,
        }}
      >
        {Inner}
      </aside>

      {/* Mobile: floating toggle + drawer */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden"
        aria-label="Open chats"
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 30,
          width: 36,
          height: 36,
          borderRadius: 18,
          background: "var(--card, #1a1714)",
          border: "1px solid var(--border, #2a2622)",
          color: "var(--text-primary, #e5e5e5)",
          fontSize: 18,
          cursor: "pointer",
        }}
      >
        ☰
      </button>
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 40,
            }}
          />
          <div
            className="md:hidden"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 41,
            }}
          >
            {Inner}
          </div>
        </>
      )}

      {/* Right-click context menu */}
      {menu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            zIndex: 50,
            minWidth: 180,
            background: "var(--card, #1a1714)",
            border: "1px solid var(--border, #2a2622)",
            borderRadius: 10,
            boxShadow: "0 20px 48px rgba(0,0,0,0.32)",
            overflow: "hidden",
          }}
        >
          {menu.kind === "room" && menu.room && (() => {
            const r = menu.room;
            const isCreator = r.creator_id === userId;
            if (isCreator) {
              return (
                <MenuButton
                  onClick={() => deleteRoom(r)}
                  danger
                  label="Delete room"
                />
              );
            }
            return (
              <MenuButton
                onClick={() => leaveRoom(r)}
                danger
                label={r.member_status === "invited" ? "Decline invite" : "Leave room"}
              />
            );
          })()}
          {menu.kind === "session" && menu.session && (
            <MenuButton
              onClick={() => deleteSession(menu.session!)}
              danger
              label="Delete session"
            />
          )}
        </div>
      )}
    </>
  );
}

function MenuButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "10px 14px",
        background: "transparent",
        border: "none",
        textAlign: "left",
        fontFamily: "var(--font-dm-sans)",
        fontSize: 13,
        color: danger ? "#e85a4f" : "var(--text-primary, #e5e5e5)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "rgba(232,90,79,0.08)" : "rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <p
      style={{
        padding: "12px 12px 6px",
        fontFamily: "var(--font-dm-sans)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "var(--text-muted, #888)",
        margin: 0,
      }}
    >
      {text}
    </p>
  );
}

function SidebarSkeleton() {
  return (
    <div style={{ padding: "4px 10px" }}>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            height: 28,
            borderRadius: 8,
            background: "var(--card-2, #252120)",
            opacity: 0.5,
            marginBottom: 4,
          }}
        />
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p
      style={{
        padding: "4px 12px 10px",
        fontSize: 11,
        color: "var(--text-muted, #888)",
        margin: 0,
        fontStyle: "italic",
      }}
    >
      {text}
    </p>
  );
}

function SidebarRow({
  icon,
  title,
  subtitle,
  active,
  onClick,
  onContextMenu,
  dimmed,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  active?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={dimmed}
      style={{
        width: "calc(100% - 8px)",
        margin: "2px 4px",
        padding: "8px 10px",
        background: active ? "rgba(201,168,76,0.14)" : "transparent",
        border: "1px solid " + (active ? "rgba(201,168,76,0.35)" : "transparent"),
        borderRadius: 8,
        color: active ? "var(--gold, #C9A84C)" : "var(--text-primary, #e5e5e5)",
        fontFamily: "var(--font-dm-sans)",
        fontSize: 12,
        cursor: dimmed ? "wait" : "pointer",
        opacity: dimmed ? 0.5 : 1,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        textAlign: "left",
        lineHeight: 1.3,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            style={{
              display: "block",
              fontSize: 10,
              color: "var(--text-muted, #888)",
              marginTop: 2,
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Compact square tile used when the sidebar is collapsed. Shows just the icon;
 * hovering surfaces the full title as a native tooltip. Context menu is
 * intentionally omitted — users expand the sidebar to delete/leave, which
 * makes the collapsed mode pure navigation (less risk of destructive
 * right-click slips on a tiny target).
 */
function IconOnlyRow({
  icon,
  title,
  active,
  onClick,
  dimmed,
}: {
  icon: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={dimmed}
      style={{
        width: 32,
        height: 32,
        margin: "4px auto",
        padding: 0,
        background: active ? "rgba(201,168,76,0.14)" : "transparent",
        border: "1px solid " + (active ? "rgba(201,168,76,0.35)" : "var(--border, #2a2622)"),
        borderRadius: 8,
        color: active ? "var(--gold, #C9A84C)" : "var(--text-primary, #e5e5e5)",
        fontSize: 14,
        cursor: dimmed ? "wait" : "pointer",
        opacity: dimmed ? 0.5 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span>{icon}</span>
    </button>
  );
}
