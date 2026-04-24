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

export default function Sidebar({ activeSessionId, activeRoomId, reloadTick }: SidebarProps) {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [rooms, setRooms] = useState<DecisionRoomWithMembership[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

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
  }, [isSignedIn, reloadTick, load]);

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
        width: SIDEBAR_WIDTH,
        height: "100vh",
        background: "var(--card, #1a1714)",
        borderRight: "1px solid var(--border, #2a2622)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Top: New chat button */}
      <div style={{ padding: 12, borderBottom: "1px solid var(--border, #2a2622)" }}>
        <button
          type="button"
          onClick={goNewChat}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "transparent",
            border: "1px solid var(--gold, #C9A84C)",
            borderRadius: 10,
            color: "var(--gold, #C9A84C)",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 16 }}>+</span>
          <span>New chat</span>
        </button>
      </div>

      {/* Scroll area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px" }}>
        {/* Rooms section */}
        <SectionLabel text="Rooms" />
        {rooms === null ? (
          <SidebarSkeleton />
        ) : rooms.length === 0 ? (
          <EmptyHint text="No rooms yet" />
        ) : (
          rooms.map((r) => {
            const isActive = activeRoomId === r.id;
            const isInvited = r.member_status === "invited";
            return (
              <SidebarRow
                key={r.id}
                icon={isInvited ? "✉️" : "🏠"}
                title={r.title}
                subtitle={isInvited ? "Invited · tap to accept" : undefined}
                active={isActive}
                onClick={() => goRoom(r)}
              />
            );
          })
        )}

        {/* Sessions section */}
        <SectionLabel text="Sessions" />
        {sessions === null ? (
          <SidebarSkeleton />
        ) : soloSessions.length === 0 ? (
          <EmptyHint text="Your previous chats will show up here." />
        ) : (
          soloSessions.map((s) => (
            <SidebarRow
              key={s.id}
              icon="💬"
              title={s.title || "Untitled"}
              active={activeSessionId === s.id}
              onClick={() => goSession(s)}
            />
          ))
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
    </>
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
}: {
  icon: string;
  title: string;
  subtitle?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        cursor: "pointer",
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
