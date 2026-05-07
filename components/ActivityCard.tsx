"use client";

import { useState } from "react";
import type { ActivityRecommendationCard, ActivitySource } from "@/lib/types";
import { getBrowserModelAsLegacy } from "@/lib/agent-model-config";
import { formatActivityTaskDate } from "@/lib/activity-task-date";
import "./cards.css";

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
  sessionId?: string | null;
  /** Called after a booking job is created — inject inline task card */
  onJobCreated?: (jobId: string) => void;
}

export default function ActivityCard({ card, index, hideBookingActions, sessionId, onJobCreated }: ActivityCardProps) {
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
      const bookingSessionId = sessionId?.trim() || localStorage.getItem("session_id") || crypto.randomUUID();
      if (!localStorage.getItem("session_id")) localStorage.setItem("session_id", bookingSessionId);
      const savedModel = getBrowserModelAsLegacy();
      const agentModel = savedModel.model ? savedModel : undefined;

      const providerLabel = PROVIDER_LABEL[source.provider];
      const datePart = formatActivityTaskDate({
        datetimeLocal: activity.datetime_local,
        datetimeDisplay: activity.datetime_display,
        overrideDate,
      });
      const task = [
        `Book tickets for "${activity.title}"${datePart ? ` on ${datePart}` : ""}.`,
        `You are starting on ${providerLabel} — find the "Find Tickets" / "Buy" button, select seats (prefer cheapest available unless a premium group was picked), and proceed to checkout.`,
        "Fill saved profile fields requested by the page, then continue to the final review area.",
        "Leave the final site action for the user.",
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
        body: JSON.stringify({ session_id: bookingSessionId, trip_label: activity.title, steps: [step] }),
      });
      if (createRes.ok) {
        const { jobId } = await createRes.json();
        fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, { method: "POST" }).catch(() => {});
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
    <div className="activity-card" style={{ marginBottom: 12 }}>
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
        className="activity-card__header"
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid var(--ink-2)",
          marginBottom: 0,
          alignItems: "center",
          gap: 10,
        }}
      >
        <div className="activity-card__rank">{index + 1}</div>

        <div style={{ fontSize: 22, flexShrink: 0 }} aria-hidden>{emoji}</div>

        <div className="activity-card__title-wrap">
          <div
            className="activity-card__name"
            style={{
              fontSize: 16,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {activity.title}
          </div>
          {activity.performers && activity.performers.length > 0 && (
            <div
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                color: "var(--ink-5)",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing: "var(--tracking-tight)",
              }}
            >
              {activity.performers.join(" · ")}
            </div>
          )}
        </div>

        {/* Group badge color is per-group brand color, kept inline */}
        <span
          className="activity-card__group-badge"
          style={{
            backgroundColor: GROUP_COLOR[group],
            color: "#fff",
            border: "none",
          }}
        >
          {GROUP_LABEL[group]}
        </span>
      </div>

      {/* Detail rows */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        {activity.datetime_display && (
          <div className="activity-card__when" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 0 }}>
            <span style={{ color: "var(--gold)" }} aria-hidden>🗓️</span>
            <span>{activity.datetime_display}</span>
          </div>
        )}
        {venueLine && (
          <div className="activity-card__venue" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 0 }}>
            <span style={{ color: "var(--gold)" }} aria-hidden>📍</span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {venueLine}
            </span>
          </div>
        )}
      </div>

      {why_recommended && (
        <div
          className="activity-card__tab activity-card__tab--why"
          style={{ margin: "0 16px var(--space-2)" }}
        >
          <p className="activity-card__tab-text">{why_recommended}</p>
        </div>
      )}

      {/* Footer: price + provider book buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderTop: "1px solid var(--ink-2)",
          marginTop: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--gold)",
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            {priceLabel}
          </span>
          <span
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              color: "var(--ink-5)",
              marginLeft: 4,
            }}
          >
            {activity.listing_count
              ? `· ${activity.listing_count} listings`
              : hasConcretePrice
              ? "/ticket"
              : ""}
          </span>
        </div>

        {!hideBookingActions && canAutopilot && primarySource && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <a
              href={primarySource.booking_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "7px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--ink-3)",
                color: "var(--ink-6)",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                fontWeight: 500,
                textDecoration: "none",
                whiteSpace: "nowrap",
                transition: "all var(--motion-fast) var(--ease-out-expo)",
              }}
            >
              View ↗
            </a>

            {/* One book button per provider source */}
            {sources.map((source) => {
              const isBooking = !!bookingByProvider[source.provider];
              const label = PROVIDER_LABEL[source.provider];
              const priceSuffix = source.price_min > 0 ? ` · $${source.price_min}` : "";
              return (
                <button
                  key={`${source.provider}:${source.provider_event_id}`}
                  onClick={() => handleBookWithAutopilot(source)}
                  disabled={isBooking}
                  className="hotel-card__cta-primary"
                  style={{
                    flex: "0 0 auto",
                    padding: "8px 16px",
                    whiteSpace: "nowrap",
                    fontSize: 13,
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
