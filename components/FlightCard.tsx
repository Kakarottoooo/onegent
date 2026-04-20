"use client";

import { useState } from "react";
import { FlightRecommendationCard } from "@/lib/types";
import { buildExpediaFlightsUrl } from "@/lib/agent/planners/booking-links";

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

export default function FlightCard({ card, index, bookingContext, onJobCreated, hideBookingActions }: FlightCardProps) {
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
      const sessionId = localStorage.getItem("session_id") ?? crypto.randomUUID();
      const savedModel = JSON.parse(localStorage.getItem("agent_model_config") ?? "{}");
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
          session_id: sessionId,
          trip_label: step.label,
          steps: [step],
        }),
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

          {flight.airline_logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flight.airline_logo} alt={flight.airline}
              style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 4 }} />
          ) : (
            <div style={{ color: "var(--gold)", flexShrink: 0 }}><PlaneIcon /></div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 600,
              color: "var(--text-primary)", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {flight.airline}
              {flight.flight_number && (
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 400,
                  color: "var(--text-secondary)", marginLeft: 6,
                }}>
                  {flight.flight_number}
                </span>
              )}
            </div>
          </div>

          <div style={{
            padding: "3px 9px", borderRadius: 20,
            border: `1px solid ${GROUP_COLOR[group]}`, color: GROUP_COLOR[group],
            fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, flexShrink: 0,
          }}>
            {GROUP_LABEL[group]}
          </div>
        </div>

        {/* Route row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px" }}>
          <div style={{ textAlign: "center", minWidth: 64 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>
              {departureTime}
            </div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: "var(--gold)", marginTop: 2 }}>
              {flight.departure_airport}
            </div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--text-secondary)", marginTop: 1, maxWidth: 72, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {flight.departure_city.split("(")[0].trim()}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--text-secondary)" }}>
              {flight.duration}
            </div>
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)">
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
              </svg>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            {flight.stops > 0 && flight.layover_city && (
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, color: "var(--text-secondary)", textAlign: "center" }}>
                via {flight.layover_city}
                {flight.layover_duration && ` · ${flight.layover_duration}`}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", minWidth: 64 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>
              {arrivalTime}
            </div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: "var(--gold)", marginTop: 2 }}>
              {flight.arrival_airport}
            </div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--text-secondary)", marginTop: 1, maxWidth: 72, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {flight.arrival_city.split("(")[0].trim()}
            </div>
          </div>
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

        {/* Footer: price (always visible) + book buttons (hidden in Decision Room) */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderTop: "0.5px solid var(--border)", marginTop: 12,
          gap: 12, flexWrap: "wrap",
        }}>
          <div>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 700, color: "var(--gold)" }}>
              {flight.price > 0 ? `$${flight.price}` : "—"}
            </span>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)", marginLeft: 4 }}>
              /person
            </span>
          </div>

          {!hideBookingActions && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Manual fallback link */}
              <a
                href={manualSearchUrl}
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
                Search →
              </a>

              {/* Autopilot book button */}
              {canAutopilot ? (
                <button
                  onClick={handleBookWithAutopilot}
                  disabled={booking}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "8px 16px", background: booking ? "var(--border)" : "var(--gold)",
                    color: "#fff", borderRadius: 8, border: "none", cursor: booking ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
                    whiteSpace: "nowrap", transition: "background 0.15s",
                  }}
                >
                  {booking ? "Booking…" : "✈ Book with Autopilot"}
                </button>
              ) : (
                <a
                  href={manualSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "8px 16px", background: "var(--gold)",
                    color: "#fff", borderRadius: 8,
                    fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500,
                    textDecoration: "none", whiteSpace: "nowrap",
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
          <a href="/permissions?tab=profile" style={{ color: "var(--gold)", fontWeight: 600 }}>Set up your profile →</a>
        </div>
      )}
    </>
  );
}
