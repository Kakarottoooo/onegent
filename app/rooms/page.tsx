"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/hooks/useAuth";
import type { DecisionRoom } from "@/lib/db";
import { CARD, CTA, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";

// Status pill tones — colored backgrounds survive in both light and dark modes.
const STATUS_LABEL: Record<DecisionRoom["status"], { text: string; tone: string }> = {
  collecting: { text: "Collecting",  tone: "bg-[var(--card-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
  proposing:  { text: "Proposing",   tone: "bg-blue-500/15 text-blue-600 border border-blue-500/30" },
  approving:  { text: "Voting",      tone: "bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/40" },
  executing:  { text: "Booking",     tone: "bg-indigo-500/15 text-indigo-600 border border-indigo-500/30" },
  done:       { text: "Done",        tone: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30" },
  abandoned:  { text: "Abandoned",   tone: "bg-[var(--card-2)] text-[var(--text-muted)] border border-[var(--border)]" },
};

const TYPE_EMOJI: Record<DecisionRoom["type"], string> = {
  restaurant: "🍽️",
  hotel: "🏨",
  flight: "✈️",
  activity: "🎟️",
};

type Tab = "active" | "history";

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
        const data = await res.json() as { rooms: DecisionRoom[] };
        if (!cancelled) setRooms(data.rooms);
      } catch {
        if (!cancelled) setError("Couldn't load your rooms.");
      }
    })();
    return () => { cancelled = true; };
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
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-baseline justify-between mb-6">
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

        {/* Active / History tabs */}
        <div className="flex gap-1 mb-4 p-1 rounded-xl bg-[var(--card-2)] border border-[var(--border)]">
          {(["active", "history"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors " +
                (tab === t
                  ? "bg-[var(--card)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]")
              }
            >
              {t === "active" ? "Active" : "History"}
            </button>
          ))}
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
          <div className={`${CARD} p-6 text-center`}>
            <div className="text-3xl mb-2">🗣️</div>
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
          <div className={`${CARD} p-6 text-center`}>
            <p className="text-sm text-[var(--text-secondary)]">
              Nothing in your history yet.
            </p>
          </div>
        )}

        {rooms && rooms.length > 0 && (
          <div className="flex flex-col gap-2">
            {rooms.map((r) => {
              const status = STATUS_LABEL[r.status];
              return (
                <Link
                  key={r.id}
                  href={`/rooms/${r.id}`}
                  className={`${CARD} p-4 hover:border-[var(--gold)] transition-colors block`}
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        <span className="mr-1.5">{TYPE_EMOJI[r.type]}</span>
                        {r.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Code: <span className="font-mono">{r.short_code}</span>
                      </p>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${status.tone}`}>
                      {status.text}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
