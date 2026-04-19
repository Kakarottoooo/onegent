"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/hooks/useAuth";
import type { DecisionRoom } from "@/lib/db";
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
};

type Tab = "active" | "history";

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
  const { isSignedIn } = useAuth();
  const [tab, setTab] = useState<Tab>("active");
  const [rooms, setRooms] = useState<DecisionRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    setRooms(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(tab === "history" ? "/api/rooms?archived=1" : "/api/rooms");
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { rooms: DecisionRoom[] };
        if (!cancelled) setRooms(data.rooms);
      } catch {
        if (!cancelled) setError("Couldn't load your rooms.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, tab]);

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
              Go to sign in →
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
        <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-4">
              <div className={`${CARD} p-5`}>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">Rooms</p>
                <h1 className="text-2xl font-semibold text-[var(--text-primary)] leading-tight">Decision Rooms</h1>
                <p className="text-sm text-[var(--text-secondary)] mt-2">
                  Shared decisions live here. The top bar switches modules; this rail only controls the rooms workspace.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Link href="/rooms/new" className={`w-full text-center py-2.5 ${CTA}`}>
                    + New room
                  </Link>
                  <Link
                    href="/contacts"
                    className="w-full text-center py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Contacts
                  </Link>
                </div>
              </div>

              <div className={`${CARD} p-3`}>
                <TabSwitch tab={tab} setTab={setTab} />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Visible</p>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{rooms?.length ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Mode</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{tab === "active" ? "Working" : "Archive"}</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="lg:hidden flex items-baseline justify-between mb-6">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">Decision Rooms</h1>
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

            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Workspace</p>
              <p className="mt-1 text-2xl lg:text-3xl font-semibold text-[var(--text-primary)]">
                {tab === "active" ? "Current rooms" : "Archived rooms"}
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                {rooms === null
                  ? "Refreshing your rooms."
                  : rooms.length
                    ? `${rooms.length} room${rooms.length === 1 ? "" : "s"} in view.`
                    : tab === "active"
                      ? "No active rooms yet."
                      : "No archived rooms yet."}
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-600 mb-4">
                {error}
              </div>
            )}

            {rooms === null && !error && (
              <p className="text-sm text-[var(--text-muted)] text-center py-12">Loading…</p>
            )}

            {rooms && rooms.length === 0 && tab === "active" && (
              <div className={`${CARD} p-8 text-center`}>
                <div className="text-3xl mb-2">🗧️</div>
                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">No rooms yet</p>
                <p className="text-xs text-[var(--text-secondary)] mb-4">
                  Start one to decide something together with a friend or partner.
                </p>
                <Link href="/rooms/new" className={`inline-block py-2 px-4 ${CTA}`}>
                  Start a room →
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
                  return (
                    <Link
                      key={r.id}
                      href={`/rooms/${r.id}`}
                      className={`${CARD} p-4 hover:border-[var(--gold)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.04)] transition-all block`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{r.title}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {TYPE_LABEL[r.type]} • <span className="font-mono">{r.short_code}</span>
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
          </main>
        </div>
      </div>
    </div>
  );
}
