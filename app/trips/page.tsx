"use client";

/**
 * /trips — list of the user's curated itineraries (P8 / B4).
 *
 * Itineraries bundle multiple bookings + DR outcomes into one shareable
 * "trip" — addresses the original "互相分享旅游行程" ask that single-
 * booking shares (P2) couldn't fully cover.
 */

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import GlobalNav from "@/components/GlobalNav";
import { EditorialHero } from "@/app/_shared/editorial";
import { useAuth } from "@/app/hooks/useAuth";

interface Itinerary {
  id: string;
  title: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_emoji: string | null;
  created_at: string;
}

export default function TripsListPage() {
  const auth = useAuth();
  const [itineraries, setItineraries] = useState<Itinerary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCity, setDraftCity] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftEmoji, setDraftEmoji] = useState("🧳");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isSignedIn) {
      setItineraries([]);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isSignedIn]);

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

  async function createTrip() {
    if (!draftTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/itineraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim(),
          city: draftCity.trim() || undefined,
          startDate: draftStart || undefined,
          endDate: draftEnd || undefined,
          coverEmoji: draftEmoji || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't create trip.");
        return;
      }
      setShowCreate(false);
      setDraftTitle("");
      setDraftCity("");
      setDraftStart("");
      setDraftEnd("");
      setDraftEmoji("🧳");
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setCreating(false);
    }
  }

  if (!auth.isSignedIn) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
        <GlobalNav active="tasks" />
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px" }}>
          <EditorialHero
            eyebrow="Trips"
            title="Sign in to start a trip."
            subtitle="Bundle bookings and decisions into one shareable plan."
            size="page"
            align="left"
          />
          <div style={{ marginTop: 24 }}>
            <Link
              href="/"
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 14,
                color: "var(--gold, #C9A84C)",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go home →
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="tasks" />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-16) var(--space-6) var(--space-24)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <EditorialHero
            eyebrow="Trips"
            title="Your trips."
            subtitle="Group bookings and decisions into one shareable plan — Tokyo May, Joshua Tree weekend, anything."
            size="page"
            align="left"
          />
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{
              padding: "10px 18px",
              borderRadius: 14,
              background: "var(--gold, #C9A84C)",
              color: "white",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            + New trip
          </button>
        </div>

        {showCreate && (
          <div
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 16,
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 12px",
              }}
            >
              New trip
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value.slice(0, 200))}
                placeholder="Trip name (e.g. Tokyo May 2026)"
                style={inputStyle}
              />
              <input
                value={draftCity}
                onChange={(e) => setDraftCity(e.target.value.slice(0, 80))}
                placeholder="City (optional)"
                style={inputStyle}
              />
              <input
                type="date"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                style={inputStyle}
              />
              <input
                type="date"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                style={inputStyle}
              />
              <input
                value={draftEmoji}
                onChange={(e) => setDraftEmoji(e.target.value.slice(0, 4))}
                placeholder="Emoji"
                style={{ ...inputStyle, textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createTrip}
                disabled={creating || !draftTitle.trim()}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  background:
                    creating || !draftTitle.trim()
                      ? "rgba(201,168,76,0.3)"
                      : "var(--gold, #C9A84C)",
                  border: "none",
                  color: "white",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: creating || !draftTitle.trim() ? "default" : "pointer",
                }}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
            {error && (
              <p style={{ fontSize: 12, color: "#b91c1c", margin: "8px 0 0" }}>{error}</p>
            )}
          </div>
        )}

        <div style={{ marginTop: 28 }}>
          {itineraries === null && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 40 }}>
              Loading…
            </p>
          )}
          {itineraries && itineraries.length === 0 && (
            <div
              style={{
                padding: "40px 24px",
                borderRadius: 16,
                border: "1px dashed var(--border)",
                background: "var(--card)",
                textAlign: "center",
              }}
            >
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
                No trips yet. Click <strong>+ New trip</strong> to start one.
              </p>
            </div>
          )}
          {itineraries && itineraries.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
              {itineraries.map((t) => (
                <Link
                  key={t.id}
                  href={`/trips/${t.id}`}
                  style={{
                    display: "block",
                    padding: 18,
                    borderRadius: 16,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    textDecoration: "none",
                    transition: "border-color 120ms",
                  }}
                >
                  <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 10 }}>
                    {t.cover_emoji ?? "🧳"}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-playfair), Georgia, serif",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {t.title}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    {[t.city, fmtRange(t.start_date, t.end_date)].filter(Boolean).join(" · ") || "No dates yet"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 13,
  outline: "none",
};

function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  if (start && end) {
    return `${fmt(start)} — ${fmt(end)}`;
  }
  return fmt(start ?? end ?? "");
}
function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
