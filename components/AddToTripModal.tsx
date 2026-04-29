"use client";

/**
 * AddToTripModal — pick an existing itinerary or create a new one and add
 * the given booking/DR to it. Used from /tasks JobCard.
 */

import { useEffect, useState } from "react";

interface Itinerary {
  id: string;
  title: string;
  city: string | null;
  cover_emoji: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  itemKind: "booking_job" | "dr_outcome";
  itemId: string;
  /** Optional default title used when "Create new" is chosen with no input. */
  fallbackNewTitle?: string;
}

export default function AddToTripModal({
  isOpen,
  onClose,
  itemKind,
  itemId,
  fallbackNewTitle = "My trip",
}: Props) {
  const [itineraries, setItineraries] = useState<Itinerary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSavedTitle(null);
    setNewTitle("");
    void load();
  }, [isOpen]);

  async function load() {
    try {
      const res = await fetch("/api/itineraries");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { itineraries: Itinerary[] };
      setItineraries(data.itineraries ?? []);
    } catch {
      setItineraries([]);
    }
  }

  async function addToExisting(it: Itinerary) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/itineraries/${it.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_kind: itemKind, item_id: itemId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't add to trip.");
        return;
      }
      setSavedTitle(it.title);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function createAndAdd() {
    const title = newTitle.trim() || fallbackNewTitle;
    setBusy(true);
    setError(null);
    try {
      const createRes = await fetch("/api/itineraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!createRes.ok) {
        const data = (await createRes.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't create trip.");
        return;
      }
      const created = (await createRes.json()) as { itinerary: { id: string; title: string } };
      const addRes = await fetch(`/api/itineraries/${created.itinerary.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_kind: itemKind, item_id: itemId }),
      });
      if (!addRes.ok) {
        setError("Trip created but couldn't add item.");
        return;
      }
      setSavedTitle(created.itinerary.title);
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md mx-0 sm:mx-4 p-6 pb-8"
        style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--gold-text, #5A4416)",
            background: "var(--gold-soft, #F5E9C8)",
            padding: "4px 10px",
            borderRadius: 999,
            marginBottom: 10,
          }}
        >
          Add to trip
        </span>
        <h2
          style={{
            fontFamily: "var(--font-playfair), Georgia, serif",
            fontSize: 22,
            fontWeight: 600,
            color: "#0a0a0a",
            marginBottom: 6,
            letterSpacing: "-0.02em",
          }}
        >
          {savedTitle ? "Added ✓" : "Pick a trip — or start a new one."}
        </h2>
        {savedTitle ? (
          <p className="text-sm text-gray-600 mb-4">
            Added to <strong>{savedTitle}</strong>.{" "}
            <a
              href="/trips"
              className="text-[var(--gold)] underline"
            >
              Open trips
            </a>
          </p>
        ) : (
          <p className="text-sm text-gray-500 mb-4">
            Bundle this with the rest of your booking + decisions for the same
            outing.
          </p>
        )}

        {!savedTitle && itineraries === null && (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        )}

        {!savedTitle && itineraries && itineraries.length > 0 && (
          <div className="flex flex-col gap-2 mb-4 max-h-60 overflow-y-auto">
            {itineraries.map((it) => (
              <button
                key={it.id}
                type="button"
                disabled={busy}
                onClick={() => addToExisting(it)}
                className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:border-gray-900 disabled:opacity-50 transition-colors text-left"
              >
                <span style={{ fontSize: 20 }}>{it.cover_emoji ?? "🧳"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{it.title}</p>
                  {it.city && (
                    <p className="text-[11px] text-gray-500 truncate">{it.city}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400">+ Add</span>
              </button>
            ))}
          </div>
        )}

        {!savedTitle && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-700 mb-2">Or create a new trip</p>
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value.slice(0, 200))}
                placeholder={fallbackNewTitle}
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-gray-400"
              />
              <button
                type="button"
                onClick={createAndAdd}
                disabled={busy}
                className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
              >
                {busy ? "…" : "Create + add"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 mt-3">{error}</p>
        )}
      </div>
    </div>
  );
}
