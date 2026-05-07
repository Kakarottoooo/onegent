"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/hooks/useAuth";
import type { DecisionRoom } from "@/lib/db";
import type { DecisionRoomListItem } from "@/lib/app-shell-read-model";
import { CARD, CTA, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";

const STATUS_LABEL: Record<DecisionRoom["status"], { text: string; tone: string }> = {
  collecting: { text: "Collecting", tone: "bg-[var(--card-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
  proposing: { text: "Proposing", tone: "bg-blue-500/15 text-blue-600 border border-blue-500/30" },
  approving: { text: "Voting", tone: "bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/40" },
  executing: { text: "Booking", tone: "bg-indigo-500/15 text-indigo-600 border border-indigo-500/30" },
  done: { text: "Done", tone: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30" },
  abandoned: { text: "Abandoned", tone: "bg-[var(--card-2)] text-[var(--text-muted)] border border-[var(--border)]" },
};

const TYPE_LABEL: Record<DecisionRoom["type"], string> = {
  restaurant: "Dining",
  hotel: "Stay",
  flight: "Flight",
  activity: "Activity",
  trip: "Trip",
};

type Tab = "active" | "history";
type RoomContextMenuState = {
  room: DecisionRoomListItem;
  x: number;
  y: number;
} | null;

function TabSwitch({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-[var(--card-2)] border border-[var(--border)]">
      {(["active", "history"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTab(t)}
          className={
            "flex-1 text-xs font-medium py-2 rounded-lg transition-colors " +
            (tab === t
              ? "bg-[var(--card)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]")
          }
        >
          {t === "active" ? "Active" : "History"}
        </button>
      ))}
    </div>
  );
}

export default function RoomsListPage() {
  const { isSignedIn, userId } = useAuth();
  const [tab, setTab] = useState<Tab>("active");
  const [rooms, setRooms] = useState<DecisionRoomListItem[] | null>(null);
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [menu, setMenu] = useState<RoomContextMenuState>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const menuIsCreator = menu?.room.creator_id === userId;
  const menuCanArchive = !!(
    menuIsCreator &&
    menu?.room.status !== "done" &&
    menu?.room.status !== "abandoned" &&
    menu?.room.status !== "executing"
  );
  const menuCanDelete = !!(menuIsCreator && menu?.room.status !== "executing");
  const historyDeletableRooms = (rooms ?? []).filter(
    (room) => room.creator_id === userId && room.status !== "executing"
  );

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    setRooms(null);
    setError(null);
    (async () => {
      try {
        // Stage 2: include_invited=1 surfaces pending trip-room invites so
        // the invitee sees them on the active tab. Archive view ignores it.
        const url =
          tab === "history"
            ? "/api/rooms/compact-list?archived=1"
            : "/api/rooms/compact-list?include_invited=1";
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { rooms: DecisionRoomListItem[] };
        if (!cancelled) setRooms(data.rooms);
      } catch {
        if (!cancelled) setError("We couldn't load your rooms. Please refresh.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, tab, reloadTick]);

  useEffect(() => {
    if (!menu) return;
    function closeMenu() {
      setMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  async function acceptInvite(room: DecisionRoomListItem) {
    setError(null);
    setAcceptBusyId(room.id);
    try {
      const res = await fetch(`/api/rooms/${room.id}/accept-invite`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Couldn't accept the invite.");
      }
      // Navigate based on the room's flow — chat-flow rooms live on the
      // homepage; classic rooms render the legacy form UI.
      if (room.flow === "chat") {
        window.location.href = `/?room_id=${room.id}`;
      } else {
        window.location.href = `/rooms/${room.id}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept the invite.");
      setAcceptBusyId(null);
    }
  }

  async function runRoomAction(room: DecisionRoomListItem, action: "archive" | "delete") {
    setMenu(null);
    setError(null);
    setActionBusyId(room.id);
    try {
      if (action === "archive") {
        const confirmed = confirm(`Move "${room.title}" to History?`);
        if (!confirmed) return;
        const res = await fetch(`/api/rooms/${room.id}/abandon`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Couldn't move room to history." }));
          throw new Error(data.error ?? "Couldn't move room to history.");
        }
      } else {
        const confirmed = confirm(`Delete "${room.title}" permanently? This can't be undone.`);
        if (!confirmed) return;
        const res = await fetch(`/api/rooms/${room.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Couldn't delete room." }));
          throw new Error(data.error ?? "Couldn't delete room.");
        }
      }

      setRooms((prev) => prev?.filter((candidate) => candidate.id !== room.id) ?? prev);
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Room action failed.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function deleteAllHistoryRooms() {
    if (tab !== "history" || historyDeletableRooms.length === 0) return;
    const skippedCount = (rooms?.length ?? 0) - historyDeletableRooms.length;
    const confirmed = confirm(
      skippedCount > 0
        ? `Delete ${historyDeletableRooms.length} archived room(s) you own? ${skippedCount} room(s) will be skipped because you can't delete them.`
        : `Delete all ${historyDeletableRooms.length} archived room(s)? This can't be undone.`
    );
    if (!confirmed) return;

    setError(null);
    setBulkDeleteBusy(true);
    try {
      const failures: string[] = [];
      for (const room of historyDeletableRooms) {
        const res = await fetch(`/api/rooms/${room.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: `Couldn't delete ${room.title}.` }));
          failures.push(data.error ?? `Couldn't delete ${room.title}.`);
        }
      }

      if (failures.length > 0) {
        throw new Error(failures[0]);
      }

      setRooms((prev) =>
        prev?.filter((room) => !(room.creator_id === userId && room.status !== "executing")) ?? prev
      );
      setReloadTick((tick) => tick + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete archived rooms.");
    } finally {
      setBulkDeleteBusy(false);
    }
  }

  if (!isSignedIn) {
    return (
      <div className={PAGE}>
        <GlobalNav active="rooms" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Sign in to see your Decision Rooms.
            </p>
            <Link href="/" className="text-sm font-medium text-[var(--gold)] underline">
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <GlobalNav active="rooms" />
      <div className="mx-auto max-w-[1440px] px-5 md:px-8 py-8">
        <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0)),radial-gradient(circle_at_top_left,rgba(212,163,75,0.08),transparent_26%)] shadow-[0_24px_80px_rgba(0,0,0,0.08)]">
          <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-20 px-7 py-7">
                <span
                  className="inline-flex items-center text-[11px] font-semibold uppercase mb-4 tracking-[0.18em]"
                  style={{
                    color: "var(--gold-text)",
                    background: "var(--gold-soft)",
                    padding: "5px 12px",
                    borderRadius: "var(--radius-pill)",
                  }}
                >
                  Rooms
                </span>
                <h1
                  className="leading-tight"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontSize: "clamp(28px, 3vw, 36px)",
                    fontWeight: 600,
                    color: "var(--ink-9)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                    margin: 0,
                  }}
                >
                  Decision workspace.
                </h1>
                <p
                  className="mt-3 leading-6"
                  style={{
                    fontSize: "15px",
                    color: "var(--ink-6)",
                    maxWidth: "32ch",
                  }}
                >
                  Shared decisions for dining, hotels, flights, and activities.
                </p>

                <div className="mt-6 flex flex-col gap-2">
                  <Link href="/rooms/new" className={`w-full text-center py-2.5 ${CTA}`}>
                    + New room
                  </Link>
                  <Link
                    href="/contacts"
                    className="w-full text-center py-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Contacts
                  </Link>
                </div>

                <div className="mt-6 pt-6 border-t border-[var(--border)]">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)] mb-3">View</p>
                  <TabSwitch tab={tab} setTab={setTab} />
                </div>

                <div className="mt-6 pt-6 border-t border-[var(--border)] space-y-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Visible now</p>
                    <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{rooms?.length ?? "—"}</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between text-[var(--text-secondary)]">
                      <span>Mode</span>
                      <span className="text-[var(--text-primary)] font-medium">{tab === "active" ? "Working" : "Archive"}</span>
                    </div>
                    <div className="flex items-center justify-between text-[var(--text-secondary)]">
                      <span>Surface</span>
                      <span className="text-[var(--text-primary)] font-medium">Workspace</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <main className="min-w-0 border-t border-[var(--border)] lg:border-t-0 lg:border-l px-5 py-6 md:px-7 md:py-7">
            <div className="lg:hidden flex items-baseline justify-between mb-6">
              <h1
                style={{
                  fontFamily: "var(--font-playfair), Georgia, serif",
                  fontSize: "26px",
                  fontWeight: 600,
                  color: "var(--ink-9)",
                  letterSpacing: "-0.02em",
                  margin: 0,
                }}
              >
                Decision Rooms.
              </h1>
              <div className="flex items-center gap-3">
                <Link
                  href="/contacts"
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
                >
                  Contacts
                </Link>
                <Link
                  href="/rooms/new"
                  className="text-sm font-medium text-[var(--text-primary)] underline decoration-[var(--border)] hover:decoration-[var(--gold)]"
                >
                  + New
                </Link>
              </div>
            </div>

            <div className="lg:hidden mb-4">
              <TabSwitch tab={tab} setTab={setTab} />
            </div>

            {tab === "history" && rooms && rooms.length > 0 && (
              <div className="lg:hidden mb-4">
                <button
                  type="button"
                  onClick={deleteAllHistoryRooms}
                  disabled={bulkDeleteBusy || historyDeletableRooms.length === 0}
                  className="w-full rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    historyDeletableRooms.length === 0
                      ? "No archived rooms you can delete"
                      : "Delete all archived rooms you own"
                  }
                >
                  {bulkDeleteBusy ? "Deleting..." : "Delete all history"}
                </button>
              </div>
            )}

            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <span
                  className="inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.18em]"
                  style={{
                    color: "var(--ink-5)",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  Workspace
                </span>
                <p
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    fontSize: "clamp(28px, 3.5vw, 40px)",
                    fontWeight: 600,
                    color: "var(--ink-9)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                    margin: 0,
                  }}
                >
                  Current rooms.
                </p>
                <p
                  className="mt-2"
                  style={{
                    fontSize: "16px",
                    color: "var(--ink-6)",
                    lineHeight: 1.55,
                  }}
                >
                  {rooms === null
                    ? "Refreshing your rooms."
                    : rooms.length
                      ? `${rooms.length} ${tab === "active" ? "active" : "archived"} room${rooms.length === 1 ? "" : "s"} in view.`
                      : tab === "active"
                        ? "No active rooms yet."
                        : "No archived rooms yet."}
                </p>
              </div>

              <div className="hidden lg:flex items-center gap-3">
                {tab === "history" && rooms && rooms.length > 0 && (
                  <button
                    type="button"
                    onClick={deleteAllHistoryRooms}
                    disabled={bulkDeleteBusy || historyDeletableRooms.length === 0}
                    className="rounded-2xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      historyDeletableRooms.length === 0
                        ? "No archived rooms you can delete"
                        : "Delete all archived rooms you own"
                    }
                  >
                    {bulkDeleteBusy ? "Deleting..." : "Delete all"}
                  </button>
                )}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Visible</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {rooms === null ? "Refreshing" : `${rooms.length} room${rooms.length === 1 ? "" : "s"}`}
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-600 mb-4">
                {error}
              </div>
            )}

            {rooms === null && !error && (
              <p className="text-sm text-[var(--text-muted)] text-center py-12">Loading...</p>
            )}

            {rooms && rooms.length === 0 && tab === "active" && (
              <div className={`${CARD} p-8 text-center`}>
                <div className="text-3xl mb-2">Rooms</div>
                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">No rooms yet</p>
                <p className="text-xs text-[var(--text-secondary)] mb-4">
                  Start one to decide something together with a friend or partner.
                </p>
                <Link href="/rooms/new" className={`inline-block py-2 px-4 ${CTA}`}>
                  Start a room
                </Link>
              </div>
            )}

            {rooms && rooms.length === 0 && tab === "history" && (
              <div className={`${CARD} p-8 text-center`}>
                <p className="text-sm text-[var(--text-secondary)]">Nothing in your history yet.</p>
              </div>
            )}

            {rooms && rooms.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {rooms.map((r) => {
                  const status = STATUS_LABEL[r.status];
                  // Stage 2: invited rooms render an Accept card instead of
                  // a Link (the user isn't a joined member yet).
                  if (r.member_status === "invited") {
                    const isBusy = acceptBusyId === r.id;
                    return (
                      <div
                        key={r.id}
                        className={`${CARD} p-4 border-[var(--gold)] block`}
                        style={{ borderColor: "var(--gold)" }}
                      >
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{r.title}</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              {TYPE_LABEL[r.type]} · <span className="font-mono">{r.short_code}</span>
                            </p>
                          </div>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/30">
                            Invited
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mb-3">
                          You&apos;ve been invited to this {TYPE_LABEL[r.type].toLowerCase()} room.
                        </p>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => acceptInvite(r)}
                          className="w-full rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                          style={{ background: "var(--gold)", color: "#fff" }}
                        >
                          {isBusy ? "Accepting…" : "Accept invite →"}
                        </button>
                      </div>
                    );
                  }
                  // Stage 2: chat-flow rooms live on the homepage, not /rooms/<id>.
                  // Following the "right" URL is the only reliable way users get
                  // their chat history back via UX-4 replay.
                  const targetHref = r.flow === "chat" ? `/?room_id=${r.id}` : `/rooms/${r.id}`;
                  return (
                    <Link
                      key={r.id}
                      href={targetHref}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({
                          room: r,
                          x: Math.min(event.clientX, window.innerWidth - 220),
                          y: Math.min(event.clientY, window.innerHeight - 220),
                        });
                      }}
                      className={`${CARD} p-4 hover:border-[var(--gold)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.04)] transition-all block`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{r.title}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {TYPE_LABEL[r.type]} · <span className="font-mono">{r.short_code}</span>
                          </p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${status.tone}`}>
                          {status.text}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-[var(--card-2)] border border-[var(--border)] px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Type</p>
                          <p className="text-xs font-medium text-[var(--text-primary)]">{TYPE_LABEL[r.type]}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--card-2)] border border-[var(--border)] px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Stage</p>
                          <p className="text-xs font-medium text-[var(--text-primary)]">{status.text}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {menu && (
              <div
                className="fixed z-50 min-w-[176px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
                style={{ left: menu.x, top: menu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b border-[var(--border)] px-3 py-2">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{menu.room.title}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {TYPE_LABEL[menu.room.type]} · {STATUS_LABEL[menu.room.status].text}
                  </p>
                </div>
                <div className="p-1.5">
                  {tab === "active" && (
                    <>
                      <button
                        type="button"
                        disabled={!menuCanArchive || actionBusyId === menu.room.id}
                        onClick={() => runRoomAction(menu.room, "archive")}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[15px] text-[var(--text-primary)] hover:bg-[var(--card-2)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          !menuIsCreator
                            ? "Only the creator can move a room to History"
                            : menu.room.status === "executing"
                              ? "Clear the in-progress booking before archiving"
                              : undefined
                        }
                      >
                        <span>Archive</span>
                      </button>

                      <button
                        type="button"
                        disabled={!menuCanDelete || actionBusyId === menu.room.id}
                        onClick={() => runRoomAction(menu.room, "delete")}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[15px] text-red-500 hover:bg-red-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          !menuIsCreator
                            ? "Only the creator can delete a room"
                            : menu.room.status === "executing"
                              ? "Clear the in-progress booking before deleting"
                              : undefined
                        }
                      >
                        <span>Delete</span>
                      </button>
                    </>
                  )}

                  {tab === "history" && (
                    <button
                      type="button"
                      disabled={!menuCanDelete || actionBusyId === menu.room.id}
                      onClick={() => runRoomAction(menu.room, "delete")}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[15px] text-red-500 hover:bg-red-500/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      title={!menuIsCreator ? "Only the creator can delete a room" : undefined}
                    >
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
