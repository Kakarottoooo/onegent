"use client";

import { useState } from "react";
import { HotelRecommendationCard } from "@/lib/types";
import { buildBookingComUrl, buildExpediaUrl, buildHotelsComUrl } from "@/lib/agent/planners/booking-links";

type BookingSite = "booking-com" | "expedia" | "hotels-com";
const SITE_OPTIONS: { id: BookingSite; label: string; color: string }[] = [
  { id: "booking-com", label: "Booking.com", color: "#003580" },
  { id: "expedia",     label: "Expedia",     color: "#00355F" },
  { id: "hotels-com",  label: "Hotels.com",  color: "#D4001A" },
];
interface HotelCardProps {
  card: HotelRecommendationCard;
  index: number;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  /** Called after a booking job is created — inject inline task card */
  onJobCreated?: (jobId: string) => void;
}

export default function HotelCard({ card, index, checkIn, checkOut, guests, onJobCreated }: HotelCardProps) {
  const { hotel } = card;
  const [booking, setBooking] = useState(false);
  const [noProfile, setNoProfile] = useState(false);
  const [bookingSite, setBookingSite] = useState<BookingSite>("booking-com");

  // Validate that dates are present and in the future before booking.
  const today = new Date().toISOString().split("T")[0];
  const datesValid = checkIn && checkOut && checkIn > today;

  function buildBookingLocalityHint(): string {
    const addressParts = (hotel.address ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const addressSuffix =
      addressParts.length >= 2
        ? addressParts.slice(-2).join(", ")
        : addressParts[0] ?? "";

    const candidates = [
      card.location_summary?.trim(),
      hotel.neighborhood?.trim()
        ? `${hotel.neighborhood.trim()}, ${addressSuffix || "New York"}`
        : "",
      hotel.address?.trim(),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const cleaned = candidate
        .replace(/\b\d+(?:\.\d+)?\s*(?:mi|miles?|km)\s+from\s+(?:center|centre|downtown)\b/gi, " ")
        .replace(/\b\d+\s*min(?:ute)?s?\s+walk\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) continue;

      const parts = cleaned
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        return parts.slice(-2).join(", ");
      }

      return cleaned;
    }

    return "New York";
  }

  async function handleBook() {
    if (booking) return;
    if (!datesValid) {
      alert(
        checkIn && checkOut
          ? `The selected dates (${checkIn} → ${checkOut}) are in the past or today. Please mention future dates in the chat (e.g. "April 15–17") and try again.`
          : "Please tell me the check-in and check-out dates in the chat first, then click Book."
      );
      return;
    }
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
    localStorage.setItem("active_profile_id", String(profile.id));
    try {
      const sessionId = localStorage.getItem("session_id") ?? crypto.randomUUID();
      const savedModel = JSON.parse(localStorage.getItem("agent_model_config") ?? "{}");
      // apiKey may be empty when using a server-side env key — only require model to be set.
      const agentModel = savedModel.model ? savedModel : undefined;

      // Build a booking.com search URL for this hotel so the agent uses a
      // consistent, bot-friendly OTA platform instead of the hotel's own site.
      const numAdults = guests ?? 1;

      // Extract a short city hint from location_summary (e.g. "West Village, New York" → "New York")
      const locationHint = buildBookingLocalityHint();

      // Search booking.com by hotel name, while passing city separately.
      // Strip slashes and extra punctuation that confuse booking.com's search.
      const searchTerm = hotel.name.replace(/[/\\|]/g, " ").replace(/\s+/g, " ").trim();

      const urlOpts = { hotelName: searchTerm, city: locationHint, checkin: checkIn, checkout: checkOut, adults: numAdults, rooms: 1 };
      const primaryUrl =
        bookingSite === "expedia"    ? buildExpediaUrl(urlOpts) :
        bookingSite === "hotels-com" ? buildHotelsComUrl(urlOpts) :
                                       buildBookingComUrl(urlOpts);
      const siteName =
        bookingSite === "expedia"    ? "Expedia" :
        bookingSite === "hotels-com" ? "Hotels.com" :
                                       "Booking.com";
      const directFallbackUrl = hotel.booking_link;

      const stayOnSite = (bookingSite === "expedia" || bookingSite === "hotels-com")
        ? `IMPORTANT: Stay within ${siteName} — do NOT click any "Book on hotel website", "Visit hotel site", or external links. Complete the entire booking inside ${siteName}'s own checkout flow.`
        : "";
      const task = [
        `Book "${hotel.name}" for ${numAdults} adult(s).`,
        `Check-in: ${checkIn}. Check-out: ${checkOut}.`,
        `You are starting on ${siteName} — find the listing for "${hotel.name}", select the room, and fill all guest info.`,
        stayOnSite,
        `If ${siteName} fails (no results, error, or blocked), navigate to the hotel's direct site instead: ${directFallbackUrl}`,
        "Fill in all guest information and card details.",
        "Stop before entering CVV or clicking the final payment confirmation button.",
      ].filter(Boolean).join(" ");

      // Include contact info inline so the agent always has it,
      // even if server-side profile lookup fails (no auth session on job).
      // Card number is NOT included here — fetched server-side via profileId.
      const step = {
        type: "universal",
        emoji: "🏨",
        label: hotel.name,
        apiEndpoint: "/api/booking-autopilot/universal",
        body: {
          startUrl: primaryUrl,
          task,
          fallbackUrl: directFallbackUrl,
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
        fallbackUrl: primaryUrl,
        status: "pending",
      };
      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, trip_label: hotel.name, steps: [step] }),
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

  const starCount = Math.min(5, Math.max(1, Math.round(hotel.star_rating)));

  return (
    <>
    <div
      style={{
        backgroundColor: "var(--card)",
        borderRadius: "16px",
        border: "0.5px solid var(--border)",
        overflow: "hidden",
        opacity: 1,
        transform: "translateY(0)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
      }}
    >
      {/* Image */}
      {hotel.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hotel.thumbnail}
          alt={hotel.name}
          style={{
            width: "100%",
            height: "180px",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "180px",
            backgroundColor: "var(--bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="8" y="16" width="32" height="24" rx="2" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="14" y="22" width="6" height="6" rx="1" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="28" y="22" width="6" height="6" rx="1" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="20" y="30" width="8" height="10" rx="1" stroke="var(--border)" strokeWidth="1.5" />
            <path d="M4 16 L24 6 L44 16" stroke="var(--border)" strokeWidth="1.5" />
          </svg>
        </div>
      )}

      <div style={{ padding: "16px" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "6px" }}>
          {/* Rank badge */}
          <div
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              backgroundColor: "var(--text-primary)",
              color: "var(--bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-dm-sans)",
              fontSize: "11px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {index + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              style={{
                fontFamily: "var(--font-playfair)",
                fontSize: "18px",
                fontWeight: 600,
                color: "var(--text-primary)",
                lineHeight: 1.3,
                marginBottom: "2px",
              }}
            >
              {hotel.name}
            </h3>
            {/* Stars + Rating */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "13px", color: "var(--gold)" }}>
                {"★".repeat(starCount)}{"☆".repeat(5 - starCount)}
              </span>
              {hotel.rating > 0 && (
                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "13px", color: "var(--gold)" }}>
                  ⭐ {hotel.rating.toFixed(1)}
                  {hotel.review_count > 0 && (
                    <span style={{ color: "var(--text-secondary)" }}> ({hotel.review_count.toLocaleString()})</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Location */}
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            marginBottom: "8px",
          }}
        >
          {card.location_summary || hotel.address}
        </p>

        {/* Price */}
        {hotel.price_per_night > 0 && (
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: "12px",
            }}
          >
            ${hotel.price_per_night}/night
            {hotel.total_price > hotel.price_per_night && (
              <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--text-secondary)" }}>
                {" "}· {card.price_summary}
              </span>
            )}
          </p>
        )}

        {/* Gold divider */}
        <div
          style={{
            width: "32px",
            height: "2px",
            backgroundColor: "var(--gold)",
            marginBottom: "12px",
          }}
        />

        {/* Why it fits */}
        {card.why_recommended && (
          <div
            style={{
              backgroundColor: "var(--card-2)",
              borderLeft: "3px solid var(--gold)",
              borderRadius: "0 8px 8px 0",
              padding: "10px 12px",
              marginBottom: "8px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--text-secondary)",
                marginBottom: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Why it fits
            </p>
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: "13px",
                color: "var(--text-primary)",
                lineHeight: 1.5,
              }}
            >
              {card.why_recommended}
            </p>
          </div>
        )}

        {/* Watch out */}
        {card.watch_out && (
          <div
            style={{
              backgroundColor: "#FDF6EC",
              borderLeft: "3px solid #E8A020",
              borderRadius: "0 8px 8px 0",
              padding: "10px 12px",
              marginBottom: "8px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: "11px",
                fontWeight: 500,
                color: "#8B5E14",
                marginBottom: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Watch out
            </p>
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: "13px",
                color: "#6B4A1A",
                lineHeight: 1.5,
              }}
            >
              {card.watch_out}
            </p>
          </div>
        )}

        {/* Not great if */}
        {card.not_great_if && (
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "12px",
              color: "var(--text-secondary)",
              marginBottom: "12px",
              fontStyle: "italic",
            }}
          >
            Skip if: {card.not_great_if}
          </p>
        )}

        {/* Amenities */}
        {hotel.amenities.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
            {hotel.amenities.slice(0, 6).map((amenity) => (
              <span
                key={amenity}
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  border: "0.5px solid var(--border)",
                  borderRadius: "12px",
                  padding: "2px 8px",
                }}
              >
                {amenity}
              </span>
            ))}
          </div>
        )}

        {/* Site selector */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          {SITE_OPTIONS.map((site) => {
            const active = bookingSite === site.id;
            return (
              <button
                key={site.id}
                onClick={() => setBookingSite(site.id)}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: "8px",
                  border: active ? `1.5px solid ${site.color}` : "1px solid var(--border)",
                  backgroundColor: active ? `${site.color}14` : "transparent",
                  color: active ? site.color : "var(--text-secondary)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "11px",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {site.label}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: "0.5px solid var(--border)",
            paddingTop: "12px",
            display: "flex",
            gap: "8px",
          }}
        >
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.name + " " + hotel.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1,
              textAlign: "center",
              padding: "8px 0",
              borderRadius: "10px",
              border: "0.5px solid var(--border)",
              fontFamily: "var(--font-dm-sans)",
              fontSize: "13px",
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            Map
          </a>
          <button
            onClick={handleBook}
            disabled={booking}
            style={{
              flex: 2,
              textAlign: "center",
              padding: "8px 0",
              borderRadius: "10px",
              backgroundColor: booking ? "var(--border)" : "var(--gold)",
              fontFamily: "var(--font-dm-sans)",
              fontSize: "13px",
              fontWeight: 500,
              color: "#fff",
              border: "none",
              cursor: booking ? "default" : "pointer",
              transition: "background-color 0.2s",
            }}
          >
            {booking ? "Starting agent…" : "Book with Agent →"}
          </button>
        </div>
      </div>
    </div>
    {noProfile && (
      <div style={{ padding: "10px 16px", fontSize: 12, fontFamily: "var(--font-dm-sans)", color: "#b45309", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", marginTop: 4 }}>
        No booking profile found.{" "}
        <a href="/permissions?tab=profile" style={{ color: "var(--gold)", fontWeight: 600 }}>Set up your profile →</a>
      </div>
    )}
    </>
  );
}
