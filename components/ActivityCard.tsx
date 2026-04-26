"use client";

import { useState } from "react";
import type { ActivityRecommendationCard, ActivitySource } from "@/lib/types";
import { getBrowserModelAsLegacy } from "@/lib/agent-model-config";

const PROVIDER_LABEL: Record<ActivitySource["provider"], string> = {
  seatgeek: "SeatGeek",
  ticketmaster: "Ticketmaster",
};

const GROUP_LABEL: Record<ActivityRecommendationCard["group"], string> = {
  best_match: "Best Match",
  cheapest: "Lowest Price",
  premium_seats: "Premium Seats",
};

const GROUP_COLOR: Record<ActivityRecommendationCard["group"], string> = {
  best_match: "#2D6A4F",
  cheapest: "#1a5fa8",
  premium_seats: "#8B5E14",
};

const EVENT_EMOJI: Record<string, string> = {
  concert: "🎤",
  theater: "🎭",
  sports: "🏟️",
  exhibition: "🖼️",
  comedy: "🎙️",
  festival: "🎪",
  other: "🎟️",
};

interface ActivityCardProps {
  card: ActivityRecommendationCard;
  index: number;
  hideBookingActions?: boolean;
  /** Called after a booking job is created — inject inline task card */
  onJobCreated?: (jobId: string) => void;
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatOverrideDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${FULL_MONTHS[m - 1]} ${d}, ${y}`;
}

export default function ActivityCard({ card, index, hideBookingActions, onJobCreated }: ActivityCardProps) {
  const { activity, group, why_recommended } = card;
  // Per-source loading state keyed by provider so clicking one button doesn't freeze another.
  const [bookingByProvider, setBookingByProvider] = useState<Record<string, boolean>>({});
  const [noProfile, setNoProfile] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  // Remember which source the user wanted when we had to pop the date picker.
  const [pendingSource, setPendingSource] = useState<ActivitySource | null>(null);
  const emoji = EVENT_EMOJI[activity.event_type] ?? EVENT_EMOJI.other;

  const activityHasDate = Boolean(activity.datetime_display ?? activity.datetime_local);

  const sources = activity.sources ?? [];
  const hasConcretePrice = activity.price_min > 0;
  const priceLabel = (() => {
    if (typeof activity.price_max === "number" && activity.price_max > activity.price_min) {
      return `from $${activity.price_min}`;
    }
    if (hasConcretePrice) return `from $${activity.price_min}`;
    // No aggregate price and no sources: dim em-dash. With sources but no price:
    // lean on the button labels to say where to buy.
    return "—";
  })();

  const venueLine = [activity.venue_name, activity.venue_city].filter(Boolean).join(" · ");

  async function handleBookWithAutopilot(source: ActivitySource) {
    if (bookingByProvider[source.provider]) return;
    if (!activityHasDate && !overrideDate) {
      setPendingSource(source);
      setShowDatePicker(true);
      return;
    }
    setNoProfile(false);
    setBookingByProvider((s) => ({ ...s, [source.provider]: true }));
    try {
      const profileRes = await fetch("/api/user/booking-profiles?default=true");
      const { profile } = await profileRes.json();
      if (!profile) { setNoProfile(true); return; }
      await proceedWithProfile(profile, source);
    } finally {
      setBookingByProvider((s) => ({ ...s, [source.provider]: false }));
    }
  }

  async function proceedWithProfile(
    profile: { id: number; first_name: string; last_name: string; email: string; phone: string; address_line1?: string; city?: string; state?: string; zip?: string; country?: string },
    source: ActivitySource,
  ) {
    localStorage.setItem("active_profile_id", String(profile.id));
    try {
      const sessionId = localStorage.getItem("session_id") ?? crypto.randomUUID();
      const savedModel = getBrowserModelAsLegacy();
      const agentModel = savedModel.model ? savedModel : undefined;

      const providerLabel = PROVIDER_LABEL[source.provider];
      const datePart = activity.datetime_display
        ?? activity.datetime_local?.slice(0, 10)
        ?? (overrideDate ? formatOverrideDate(overrideDate) : "");
      const task = [
        `Book tickets for "${activity.title}"${datePart ? ` on ${datePart}` : ""}.`,
        `You are starting on ${providerLabel} — find the "Find Tickets" / "Buy" button, select seats (prefer cheapest available unless a premium group was picked), and proceed to checkout.`,
        "Fill in all guest information (first/last name, email, phone, address, zip) and card details.",
        "Stop before entering CVV or clicking the final payment confirmation button.",
      ].join(" ");

      // event_date defaults to the override (date picker) when the activity
      // itself didn't ship a datetime — Stagehand needs *some* date so the
      // event-page selector can disambiguate multiple performances.
      const eventDateLocal =
        activity.datetime_local ??
        (overrideDate ? `${overrideDate}T00:00:00` : "");

      const step = {
        type: "activity",
        emoji: EVENT_EMOJI[activity.event_type] ?? EVENT_EMOJI.other,
        label: `${activity.title} (${providerLabel})`,
        apiEndpoint: "/api/booking-autopilot/universal",
        body: {
          // Standardized activity fields — match create-trip + rooms-execute
          // body shape so cend-adapter can convert all three uniformly into
          // ActivityBookingParams when USE_CORE_EXECUTOR_FOR_CEND is on.
          activity_name: activity.title,
          activity_id: activity.id,
          venue_name: activity.venue_name,
          city: activity.venue_city,
          event_date: eventDateLocal,
          num_tickets: 1,
          provider: source.provider,
          // Stagehand entry fields (and lib/core ActivityBookingParams)
          startUrl: source.booking_link,
          task,
          fallbackUrl: source.booking_link,
          profileId: profile.id,
          profile: {
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
            phone: profile.phone,
            address_line1: profile.address_line1,
            city: profile.city,
            state: profile.state,
            zip: profile.zip,
            country: profile.country,
          },
          agentModel,
        },
        fallbackUrl: source.booking_link,
        status: "pending",
      };
      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, trip_label: activity.title, steps: [step] }),
      });
      if (createRes.ok) {
        const { jobId } = await createRes.json();
        fetch(`/api/booking-jobs/${jobId}/start`, { method: "POST" }).catch(() => {});
        onJobCreated?.(jobId);
      }
    } catch {
      // ignore
    }
  }

  const canAutopilot = sources.length > 0;
  // Primary source for the "View" fallback link — first source (SG-first after merge).
  const primarySource = sources[0];

  return (
    <>
    <div
      style={{
        background: "var(--card)",
        borderRadius: 16,
        border: "0.5px solid var(--border)",
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      {activity.image_url ? (
        <div style={{ position: "relative", width: "100%", height: 160, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activity.image_url}
            alt={activity.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ) : null}

      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 10px",
          borderBottom: "0.5px solid var(--border)",
        }}
      >
        <div
          style={{
            width: 26, height: 26, borderRadius: "50%",
            background: "var(--text-primary)", color: "var(--bg)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, flexShrink: 0,
          }}
        >
          {index + 1}
        </div>

        <div style={{ fontSize: 22, flexShrink: 0 }} aria-hidden>{emoji}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 600,
            color: "var(--text-primary)", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {activity.title}
          </div>
          {activity.performers && activity.performers.length > 0 && (
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: 11,
              color: "var(--text-secondary)", marginTop: 2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {activity.performers.join(" · ")}
            </div>
          )}
        </div>

        <div style={{
          padding: "3px 9px", borderRadius: 20,
          border: `1px solid ${GROUP_COLOR[group]}`, color: GROUP_COLOR[group],
          fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, flexShrink: 0,
        }}>
          {GROUP_LABEL[group]}
        </div>
      </div>

      {/* Detail rows */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        {activity.datetime_display && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-primary)",
          }}>
            <span style={{ color: "var(--gold)" }} aria-hidden>🗓️</span>
            <span>{activity.datetime_display}</span>
          </div>
        )}
        {venueLine && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-secondary)",
          }}>
            <span style={{ color: "var(--gold)" }} aria-hidden>📍</span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {venueLine}
            </span>
          </div>
        )}
      </div>

      {/* Why recommended */}
      {why_recommended && (
        <div style={{
          margin: "0 16px", padding: "8px 12px",
          background: "var(--card-2)", borderLeft: "3px solid var(--gold)",
          borderRadius: "0 6px 6px 0", fontFamily: "var(--font-sans)",
          fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5,
        }}>
          {why_recommended}
        </div>
      )}

      {/* Footer: price + manual link + autopilot book button */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderTop: "0.5px solid var(--border)", marginTop: 12,
        gap: 12, flexWrap: "wrap",
      }}>
        <div>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 700, color: "var(--gold)" }}>
            {priceLabel}
          </span>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)", marginLeft: 4 }}>
            {activity.listing_count
              ? `· ${activity.listing_count} listings`
              : hasConcretePrice
              ? "/ticket"
              : ""}
          </span>
        </div>

        {!hideBookingActions && canAutopilot && primarySource && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Manual fallback link — uses the primary (first-ranked) source. */}
            <a
              href={primarySource.booking_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "7px 12px", borderRadius: 8,
                border: "0.5px solid var(--border)", color: "var(--text-secondary)",
                fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 400,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              View ↗
            </a>

            {/* One autopilot button per source — user picks which platform to book through. */}
            {sources.map((source) => {
              const isBooking = !!bookingByProvider[source.provider];
              const label = PROVIDER_LABEL[source.provider];
              const priceSuffix = source.price_min > 0 ? ` · $${source.price_min}` : "";
              return (
                <button
                  key={`${source.provider}:${source.provider_event_id}`}
                  onClick={() => handleBookWithAutopilot(source)}
                  disabled={isBooking}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "8px 16px", background: isBooking ? "var(--border)" : "var(--gold)",
                    color: "#fff", borderRadius: 8, border: "none",
                    cursor: isBooking ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
                    whiteSpace: "nowrap", transition: "background 0.15s",
                  }}
                >
                  {isBooking ? "Booking…" : `🎟 Book on ${label}${priceSuffix}`}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>

    {/* Date picker overlay — for activities without a fixed datetime (e.g. resident shows like Wicked) */}
    {showDatePicker && (
      <div style={{
        padding: "12px 16px",
        background: "var(--card-2)",
        border: "1px solid var(--gold)",
        borderRadius: 8,
        marginTop: 8,
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5,
        }}>
          Which date? <strong>{activity.title}</strong> runs on multiple dates — pick the one you want the autopilot to book.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={overrideDate}
            onChange={(e) => setOverrideDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            style={{
              padding: "7px 10px", borderRadius: 6,
              border: "0.5px solid var(--border)", background: "var(--card)",
              color: "var(--text-primary)", fontFamily: "var(--font-sans)", fontSize: 13,
            }}
          />
          <button
            disabled={!overrideDate || !pendingSource}
            onClick={() => {
              if (!overrideDate || !pendingSource) return;
              const src = pendingSource;
              setShowDatePicker(false);
              setPendingSource(null);
              handleBookWithAutopilot(src);
            }}
            style={{
              padding: "7px 14px", borderRadius: 6, border: "none",
              background: overrideDate ? "var(--gold)" : "var(--border)",
              color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
              cursor: overrideDate ? "pointer" : "not-allowed",
            }}
          >
            Continue →
          </button>
          <button
            onClick={() => { setShowDatePicker(false); setPendingSource(null); setOverrideDate(""); }}
            style={{
              padding: "7px 12px", borderRadius: 6,
              border: "0.5px solid var(--border)", background: "transparent",
              color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )}

    {/* No profile warning */}
    {noProfile && (
      <div style={{ padding: "10px 16px", fontSize: 12, fontFamily: "var(--font-sans)", color: "#b45309", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", marginTop: 4 }}>
        No booking profile found.{" "}
        <a href="/account?tab=profiles" style={{ color: "var(--gold)", fontWeight: 600 }}>Set up your profile →</a>
      </div>
    )}
    </>
  );
}
