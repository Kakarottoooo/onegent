"use client";

import { useState } from "react";
import { FlightRecommendationCard } from "@/lib/types";
import { buildExpediaFlightsUrl } from "@/lib/agent/planners/booking-links";
import { getBrowserModelAsLegacy } from "@/lib/agent-model-config";
import "./cards.css";

interface FlightCardProps {
  card: FlightRecommendationCard;
  index: number;
  /** Booking context from the chat intent — date, passengers, etc. */
  bookingContext?: {
    date?: string;
    return_date?: string;
    passengers?: number;
    cabin_class?: string;
    is_round_trip?: boolean;
  } | null;
  sessionId?: string | null;
  /** Called after a booking job is created — inject inline task card */
  onJobCreated?: (jobId: string) => void;
  /**
   * Hide the booking buttons (Search, Book with Autopilot) but keep the
   * price visible. Used by Decision Room proposal cards — the room supplies
   * its own "Pick this option" control + a payer-only execute flow.
   */
  hideBookingActions?: boolean;
}

function PlaneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.45 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.56 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.5a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "—";
  const match = timeStr.match(/(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (match) return match[0];
  const parts = timeStr.split(" ");
  if (parts.length >= 2) return parts[parts.length - 1];
  return timeStr;
}

const GROUP_LABEL: Record<FlightRecommendationCard["group"], string> = {
  direct: "Nonstop",
  one_stop: "1 Stop",
  two_stop: "2 Stops",
  cheapest: "Best Price",
};

const GROUP_COLOR: Record<FlightRecommendationCard["group"], string> = {
  direct: "#2D6A4F",
  one_stop: "#8B5E14",
  two_stop: "#7B3F00",
  cheapest: "#1a5fa8",
};

export default function FlightCard({ card, index, bookingContext, sessionId, onJobCreated, hideBookingActions }: FlightCardProps) {
  const { flight, group, why_recommended } = card;
  const [booking, setBooking] = useState(false);
  const [noProfile, setNoProfile] = useState(false);

  const departureTime = formatTime(flight.departure_time);
  const arrivalTime = formatTime(flight.arrival_time);
  const manualSearchUrl = buildExpediaFlightsUrl({
    origin: flight.departure_airport,
    dest: flight.arrival_airport,
    date: bookingContext?.date,
    returnDate: bookingContext?.is_round_trip ? bookingContext?.return_date : undefined,
    passengers: bookingContext?.passengers ?? 1,
    cabinClass: (bookingContext?.cabin_class ?? "economy") as "economy" | "premium_economy" | "business" | "first",
  });

  const canAutopilot = !!bookingContext?.date;

  async function handleBookWithAutopilot() {
    if (booking) return;
    setNoProfile(false);
    setBooking(true);
    try {
      const profileRes = await fetch("/api/user/booking-profiles?default=true");
      const { profile } = await profileRes.json();
      if (!profile) { setNoProfile(true); return; }
      await proceedWithProfile(profile);
    } finally {
      setBooking(false);
    }
  }

  async function proceedWithProfile(profile: { id: number; first_name: string; last_name: string; email: string; phone: string; address_line1?: string; city?: string; state?: string; zip?: string; country?: string }) {
    try {
      const bookingSessionId = sessionId?.trim() || localStorage.getItem("session_id") || crypto.randomUUID();
      if (!localStorage.getItem("session_id")) localStorage.setItem("session_id", bookingSessionId);
      const savedModel = getBrowserModelAsLegacy();
      const agentModel = savedModel.model ? savedModel : undefined;

      const origin = flight.departure_airport;
      const dest = flight.arrival_airport;
      const date = bookingContext?.date ?? "";
      const returnDate = bookingContext?.return_date;
      const passengers = bookingContext?.passengers ?? 1;
      const cabinClass = bookingContext?.cabin_class ?? "economy";
      const preferNonstop = flight.stops === 0;

      const step = {
        type: "flight",
        emoji: "✈️",
        label: `${flight.airline} ${origin}→${dest} ${date}`,
        apiEndpoint: "/api/booking-autopilot/universal",
        body: {
          origin,
          dest,
          date,
          returnDate,
          passengers,
          cabinClass,
          preferNonstop,
          // Pass card details so the RPA can target the correct flight
          targetAirline: flight.airline,
          targetPrice: flight.price,
          targetDepartureTime: departureTime, // formatTime'd: "2:54pm" not raw timestamp
          targetFlightNumber: flight.flight_number,
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
        fallbackUrl: manualSearchUrl,
        status: "pending",
      };

      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: bookingSessionId,
          trip_label: step.label,
          steps: [step],
        }),
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

  return (
    <>
      <div className="flight-card" style={{ marginBottom: 12 }}>
        {/* Header row */}
        <div
          className="flight-card__header"
          style={{
            padding: "14px 16px 10px",
            borderBottom: "1px solid var(--ink-2)",
            marginBottom: 0,
            alignItems: "center",
            gap: 10,
          }}
        >
          <div className="flight-card__rank">{index + 1}</div>

          {flight.airline_logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={flight.airline_logo}
              alt={flight.airline}
              style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 4, flexShrink: 0 }}
            />
          ) : (
            <div style={{ color: "var(--gold)", flexShrink: 0 }}>
              <PlaneIcon />
            </div>
          )}

          <div className="flight-card__title-wrap">
            <div
              className="flight-card__name"
              style={{
                fontSize: 16,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {flight.airline}
              {flight.flight_number && (
                <span className="flight-card__subtitle" style={{ marginLeft: 6 }}>
                  {flight.flight_number}
                </span>
              )}
            </div>
          </div>

          {/* Group pill (Nonstop / 1 Stop / etc) — color is per-group, kept inline */}
          <div
            style={{
              padding: "3px 9px",
              borderRadius: "var(--radius-pill)",
              border: `1px solid ${GROUP_COLOR[group]}`,
              color: GROUP_COLOR[group],
              fontFamily: "var(--font-dm-sans)",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            {GROUP_LABEL[group]}
          </div>
        </div>

        {/* Time rail — depart → duration → arrive */}
        <div className="flight-card__time-row" style={{ padding: "14px 16px" }}>
          <div style={{ textAlign: "center", minWidth: 64 }}>
            <div className="flight-card__time">{departureTime}</div>
            <div className="flight-card__airport" style={{ color: "var(--gold)" }}>
              {flight.departure_airport}
            </div>
            <div
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                color: "var(--ink-5)",
                marginTop: 1,
                maxWidth: 72,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {flight.departure_city.split("(")[0].trim()}
            </div>
          </div>

          <div className="flight-card__duration">
            <div className="flight-card__duration-text">{flight.duration}</div>
            <div className="flight-card__duration-line" />
            {flight.stops > 0 && flight.layover_city && (
              <div className="flight-card__stops" style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-5)" }}>
                via {flight.layover_city}
                {flight.layover_duration && ` · ${flight.layover_duration}`}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", minWidth: 64 }}>
            <div className="flight-card__time">{arrivalTime}</div>
            <div className="flight-card__airport" style={{ color: "var(--gold)" }}>
              {flight.arrival_airport}
            </div>
            <div
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                color: "var(--ink-5)",
                marginTop: 1,
                maxWidth: 72,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {flight.arrival_city.split("(")[0].trim()}
            </div>
          </div>
        </div>

        {why_recommended && (
          <div
            className="flight-card__tab flight-card__tab--why"
            style={{ margin: "0 16px var(--space-2)" }}
          >
            <p className="flight-card__tab-text">{why_recommended}</p>
          </div>
        )}

        {/* Footer: price + booking actions */}
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
            <span className="flight-card__price" style={{ color: "var(--gold)" }}>
              {flight.price > 0 ? `$${flight.price}` : "—"}
            </span>
            <span className="flight-card__price-meta" style={{ display: "inline", marginLeft: 4 }}>
              /person
            </span>
          </div>

          {!hideBookingActions && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <a
                href={manualSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flight-card__pill"
                style={{
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 12px",
                }}
              >
                Search →
              </a>

              {canAutopilot ? (
                <button
                  onClick={handleBookWithAutopilot}
                  disabled={booking}
                  className="flight-card__cta-primary"
                  style={{ flex: "0 0 auto", padding: "8px 16px", whiteSpace: "nowrap" }}
                >
                  {booking ? "Booking…" : "✈ Book with Autopilot"}
                </button>
              ) : (
                <a
                  href={manualSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flight-card__cta-primary"
                  style={{
                    flex: "0 0 auto",
                    padding: "8px 16px",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Book on Google Flights →
                </a>
              )}
            </div>
          )}
        </div>
      </div>

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
