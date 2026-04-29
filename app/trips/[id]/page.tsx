"use client";

/**
 * /trips/[id] — manage a single itinerary.
 *
 * Owner-only view. Shows the trip metadata, the items added to it, lets
 * the owner remove items, and offers a Share button (kind='trip').
 */

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import GlobalNav from "@/components/GlobalNav";
import { EditorialHero } from "@/app/_shared/editorial";
import { useAuth } from "@/app/hooks/useAuth";
import ShareTripModal from "@/components/ShareTripModal";

interface Itinerary {
  id: string;
  title: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_emoji: string | null;
}

interface Item {
  item_kind: "booking_job" | "dr_outcome";
  item_id: string;
  position: number;
  added_at: string;
  title: string;
  subtitle: string | null;
  href: string | null;
}

export default function TripDetailPage() {
  const auth = useAuth();
  const { id } = useParams<{ id: string }>();
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!auth.isSignedIn) {
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, auth.isSignedIn]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/itineraries/${id}`);
      if (res.status === 404) {
        setError("Trip not found.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't load trip.");
        return;
      }
      const data = (await res.json()) as { itinerary: Itinerary; items: Item[] };
      setItinerary(data.itinerary);
      setItems(data.items ?? []);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function removeItem(it: Item) {
    if (!confirm(`Remove "${it.title}" from this trip?`)) return;
    const res = await fetch(
      `/api/itineraries/${id}/items/${it.item_kind}/${encodeURIComponent(it.item_id)}`,
      { method: "DELETE" },
    );
    if (res.ok) await load();
  }

  if (!auth.isSignedIn) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
        <GlobalNav active="tasks" />
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px" }}>
          <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>Sign in to view this trip.</p>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="tasks" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "var(--space-16) var(--space-6) var(--space-24)" }}>
        <Link
          href="/trips"
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--text-muted)",
            textDecoration: "none",
            marginBottom: 16,
            display: "inline-block",
          }}
        >
          ← All trips
        </Link>

        {loading && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: 40, textAlign: "center" }}>
            Loading…
          </p>
        )}
        {error && !loading && (
          <p style={{ fontSize: 14, color: "#b91c1c", padding: 24 }}>{error}</p>
        )}

        {!loading && !error && itinerary && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <EditorialHero
                eyebrow={[itinerary.cover_emoji ?? "🧳", itinerary.city].filter(Boolean).join(" · ")}
                title={itinerary.title}
                subtitle={fmtRange(itinerary.start_date, itinerary.end_date) || "No dates yet"}
                size="page"
                align="left"
              />
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 14,
                  background: "var(--gold-soft, #F5E9C8)",
                  color: "var(--gold-text, #5A4416)",
                  border: "1px solid var(--gold, #C9A84C)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ↗ Share trip
              </button>
            </div>

            <p
              style={{
                marginTop: 28,
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {items.length === 0 ? "No items yet" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
            </p>

            {items.length === 0 ? (
              <div
                style={{
                  marginTop: 12,
                  padding: "32px 20px",
                  borderRadius: 16,
                  border: "1px dashed var(--border)",
                  background: "var(--card)",
                  textAlign: "center",
                }}
              >
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
                  Empty trip. Go to <Link href="/tasks" style={{ color: "var(--gold)" }}>/tasks</Link> and click
                  <br />
                  <strong>Add to trip</strong> on any completed booking, or back to a Decision Room.
                </p>
              </div>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map((it) => {
                  const inner = (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: 14,
                        borderRadius: 14,
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 14,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {it.title}
                        </p>
                        {it.subtitle && (
                          <p
                            style={{
                              margin: "2px 0 0",
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 12,
                              color: "var(--text-muted)",
                            }}
                          >
                            {it.subtitle}
                          </p>
                        )}
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          color: "var(--gold-text, #5A4416)",
                          background: "var(--gold-soft, #F5E9C8)",
                          padding: "3px 8px",
                          borderRadius: 999,
                        }}
                      >
                        {it.item_kind === "dr_outcome" ? "Decided" : "Booked"}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void removeItem(it);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--text-muted)",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  );
                  return it.href ? (
                    <Link
                      key={`${it.item_kind}:${it.item_id}`}
                      href={it.href}
                      style={{ textDecoration: "none" }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={`${it.item_kind}:${it.item_id}`}>{inner}</div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {itinerary && (
        <ShareTripModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          kind="trip"
          refId={itinerary.id}
          isFutureEvent={false}
        />
      )}
    </div>
  );
}

function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  if (start && end) {
    return `${fmt(start)} — ${fmt(end)}`;
  }
  return fmt(start ?? end ?? "");
}
function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
