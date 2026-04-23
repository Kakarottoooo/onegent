"use client";

/**
 * TripPackageCard — renders a TripPackage (multi-category package) with a
 * single "Book this trip" button. Phase 1 shows the first tier only and just
 * hotel + flight. Phase 2 will add the 3-tier switcher + restaurants + activities.
 *
 * Lifecycle:
 *   - Receives a TripPackage from /api/chat/trip/plan (parent's responsibility).
 *   - Book button POSTs to /api/booking-jobs/create-trip → gets jobId →
 *     router.push("/tasks?focus=<jobId>").
 *   - Parent may listen to onBooking state if it wants to disable other UI.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TripPackage, TripTier } from "@/lib/types";

export interface TripPackageCardProps {
  pkg: TripPackage;
  /** Session id — required for booking job creation. */
  sessionId: string;
  /** Booking profile id. Optional — if unset, backend uses user's default. */
  profileId?: number | null;
  /** Per-category errors surfaced by the planner (e.g. "No hotels returned"). */
  errors?: { hotel?: string | null; flight?: string | null };
  /** Optional callback fired once the booking job is created. */
  onBooked?: (jobId: string) => void;
}

const CARD: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 16,
  padding: 16,
  backgroundColor: "var(--card, #fff)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  marginTop: 8,
};

const HEADER_ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 8,
  flexWrap: "wrap",
};

const HEADER_TITLE: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 16,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
  lineHeight: 1.3,
};

const HEADER_META: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  color: "var(--text-muted, #888)",
};

const TIER_PILL: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontFamily: "var(--font-dm-sans)",
  border: "1px solid var(--gold, #c9a648)",
  color: "var(--gold, #c9a648)",
};

const SUB_CARD: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  backgroundColor: "var(--card-2, #f7f7f7)",
};

const SUB_CARD_TITLE: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
};

const SUB_CARD_META: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  color: "var(--text-secondary, #555)",
  lineHeight: 1.4,
};

const SUB_CARD_EMPTY: React.CSSProperties = {
  ...SUB_CARD,
  borderStyle: "dashed",
  color: "var(--text-muted, #888)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 13,
};

const PRIMARY_BTN: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "none",
  backgroundColor: "var(--gold, #c9a648)",
  color: "#fff",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

function formatDateRange(from: string, to: string): string {
  return `${from} → ${to}`;
}

function formatTravelers(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export default function TripPackageCard(props: TripPackageCardProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Phase 1: a single tier. Phase 2 will promote this into a tab switcher.
  const tier: TripTier | undefined = props.pkg.tiers[0];
  if (!tier) {
    return (
      <div style={CARD}>
        <div style={HEADER_TITLE}>Trip package</div>
        <div style={SUB_CARD_EMPTY}>
          No tiers were produced. Try rephrasing your trip idea with a clearer
          destination and date range.
        </div>
      </div>
    );
  }

  const tierForBooking = tier;

  async function handleBook() {
    if (submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/booking-jobs/create-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: props.sessionId,
          trip_package: props.pkg,
          selected_tier_id: tierForBooking.tier_id,
          profile_id: props.profileId ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        setErr(data.error ?? "Couldn't create booking job.");
        return;
      }
      // Kick off the autopilot in the background. `keepalive: true` prevents
      // the browser from aborting the POST when we router.push() below —
      // without it, navigation cancels the in-flight fetch and /start never
      // reaches the server, leaving the job stuck at status=pending.
      fetch(`/api/booking-jobs/${data.jobId}/start`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
      props.onBooked?.(data.jobId);
      router.push(`/tasks?focus=${encodeURIComponent(data.jobId)}`);
    } catch {
      setErr("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const hotelCard = renderHotelCard(tier, props.errors?.hotel ?? null);
  const flightCard = renderFlightCard(tier, props.errors?.flight ?? null);
  const total = tier.total_cost_estimate;

  return (
    <div style={CARD}>
      <div style={HEADER_ROW}>
        <div>
          <div style={HEADER_TITLE}>
            {props.pkg.destination_city} · {props.pkg.departure_city} ✈
          </div>
          <div style={HEADER_META}>
            {formatDateRange(props.pkg.date_range.from, props.pkg.date_range.to)} ·{" "}
            {formatTravelers(props.pkg.traveler_count)}
          </div>
        </div>
        <span style={TIER_PILL}>{tier.tier_label}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {hotelCard}
        {flightCard}
      </div>

      {total ? (
        <div style={HEADER_META}>
          Estimated total: <strong>{formatPrice(total)}</strong> (hotel + flight
          for {formatTravelers(props.pkg.traveler_count)})
        </div>
      ) : null}

      {err ? (
        <div style={{ color: "#c0392b", fontSize: 12, fontFamily: "var(--font-dm-sans)" }}>
          {err}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleBook}
        disabled={submitting}
        style={{ ...PRIMARY_BTN, opacity: submitting ? 0.7 : 1 }}
      >
        {submitting ? "Creating booking job..." : "Book this trip"}
      </button>
    </div>
  );
}

function renderHotelCard(tier: TripTier, err: string | null) {
  const h = tier.hotel;
  if (!h) {
    return (
      <div style={SUB_CARD_EMPTY}>
        🏨 No hotel picked{err ? ` — ${err}` : ""}
      </div>
    );
  }
  const pricePerNight = h.hotel.price_per_night;
  return (
    <div style={SUB_CARD}>
      <div style={SUB_CARD_TITLE}>🏨 {h.hotel.name}</div>
      <div style={SUB_CARD_META}>
        {h.hotel.star_rating}★ · {formatPrice(pricePerNight)}/night ·{" "}
        ⭐ {h.hotel.rating} ({h.hotel.review_count})
      </div>
      {h.why_recommended ? (
        <div style={{ ...SUB_CARD_META, opacity: 0.85 }}>
          {h.why_recommended.slice(0, 140)}
          {h.why_recommended.length > 140 ? "…" : ""}
        </div>
      ) : null}
    </div>
  );
}

function renderFlightCard(tier: TripTier, err: string | null) {
  const f = tier.flight;
  if (!f) {
    return (
      <div style={SUB_CARD_EMPTY}>
        ✈ No flight picked{err ? ` — ${err}` : ""}
      </div>
    );
  }
  const fl = f.flight;
  return (
    <div style={SUB_CARD}>
      <div style={SUB_CARD_TITLE}>
        ✈ {fl.airline} {fl.departure_airport}→{fl.arrival_airport}
      </div>
      <div style={SUB_CARD_META}>
        {fl.departure_time} → {fl.arrival_time} ·{" "}
        {fl.stops === 0 ? "Nonstop" : `${fl.stops} stop${fl.stops === 1 ? "" : "s"}`} ·{" "}
        {formatPrice(fl.price)}/pax
      </div>
      {f.why_recommended ? (
        <div style={{ ...SUB_CARD_META, opacity: 0.85 }}>
          {f.why_recommended.slice(0, 140)}
          {f.why_recommended.length > 140 ? "…" : ""}
        </div>
      ) : null}
    </div>
  );
}
