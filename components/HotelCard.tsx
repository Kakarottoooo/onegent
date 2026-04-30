"use client";

import { useState } from "react";
import { HotelRecommendationCard } from "@/lib/types";
import { buildBookingComUrl, buildExpediaUrl, buildHotelsComUrl } from "@/lib/agent/planners/booking-links";
import PhotoCarousel from "@/components/PhotoCarousel";
import { getBrowserModelAsLegacy } from "@/lib/agent-model-config";
import "./cards.css";

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
  /** Hide the "Book with Agent" booking CTA. Used inside multi-party
   *  proposal cards where booking has to wait for the vote winner +
   *  payer-only confirmation. Aligns with FlightCard/ActivityCard. */
  hideBookingActions?: boolean;
}

export default function HotelCard({ card, index, checkIn, checkOut, guests, onJobCreated, hideBookingActions = false }: HotelCardProps) {
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
      // apiKey may be empty when using a server-side env key — only require model to be set.
      const savedModel = getBrowserModelAsLegacy();
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
    <div className="hotel-card">
      {/* Image carousel */}
      <PhotoCarousel
        images={
          hotel.images && hotel.images.length > 0
            ? hotel.images
            : hotel.thumbnail
              ? [hotel.thumbnail]
              : []
        }
        alt={hotel.name}
        heightClass="h-[180px]"
        cornerAction={
          hotel.booking_link ? (
            <a
              href={hotel.booking_link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="View hotel details on Booking.com / Google Hotels"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[11px] font-medium ring-1 ring-white/20 shadow-lg transition-colors"
            >
              <span aria-hidden>↗</span>
              <span>View details</span>
            </a>
          ) : undefined
        }
      />

      <div className="hotel-card__body">
        <div className="hotel-card__header">
          <div className="hotel-card__rank">{index + 1}</div>
          <div className="hotel-card__title-wrap">
            <h3 className="hotel-card__name" style={{ marginBottom: "2px" }}>
              {hotel.name}
            </h3>
            <div className="hotel-card__star-row">
              <span className="hotel-card__stars">
                {"★".repeat(starCount)}
                {"☆".repeat(5 - starCount)}
              </span>
              {hotel.rating > 0 && (
                <span className="hotel-card__rating">
                  ⭐ {hotel.rating.toFixed(1)}
                  {hotel.review_count > 0 && (
                    <span className="hotel-card__rating-count">
                      {" "}({hotel.review_count.toLocaleString()})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="hotel-card__location">
          {card.location_summary || hotel.address}
        </p>

        {hotel.price_per_night > 0 && (
          <p className="hotel-card__price">
            ${hotel.price_per_night}/night
            {hotel.total_price > hotel.price_per_night && (
              <span className="hotel-card__price-detail">
                {" "}· {card.price_summary}
              </span>
            )}
          </p>
        )}

        <div className="hotel-card__divider" />

        {card.why_recommended && (
          <div className="hotel-card__tab hotel-card__tab--why">
            <p className="hotel-card__tab-label">Why it fits</p>
            <p className="hotel-card__tab-text">{card.why_recommended}</p>
          </div>
        )}

        {card.watch_out && (
          <div className="hotel-card__tab hotel-card__tab--watchout">
            <p className="hotel-card__tab-label">Watch out</p>
            <p className="hotel-card__tab-text">{card.watch_out}</p>
          </div>
        )}

        {card.not_great_if && (
          <p className="hotel-card__skip-note">Skip if: {card.not_great_if}</p>
        )}

        {hotel.amenities.length > 0 && (
          <div className="hotel-card__amenities">
            {hotel.amenities.slice(0, 6).map((amenity) => (
              <span key={amenity} className="hotel-card__amenity">
                {amenity}
              </span>
            ))}
          </div>
        )}

        {/* Site selector — site.color stays inline because each brand has
            its own accent (Booking.com #003580, Expedia #00355F, Hotels.com
            #D4001A) and we don't want to bake brand colors into globals. */}
        <div className="hotel-card__site-row">
          {SITE_OPTIONS.map((site) => {
            const active = bookingSite === site.id;
            return (
              <button
                key={site.id}
                onClick={() => setBookingSite(site.id)}
                className={`hotel-card__site${active ? " hotel-card__site--active" : ""}`}
                style={
                  active
                    ? {
                        borderColor: site.color,
                        color: site.color,
                        backgroundColor: `${site.color}14`,
                      }
                    : undefined
                }
              >
                {site.label}
              </button>
            );
          })}
        </div>

        <div className="hotel-card__cta-row">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.name + " " + hotel.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hotel-card__cta-secondary"
          >
            Map
          </a>
          {!hideBookingActions && (
            <button
              onClick={handleBook}
              disabled={booking}
              className="hotel-card__cta-primary"
            >
              {booking ? "Starting agent…" : "Book with Agent →"}
            </button>
          )}
        </div>
      </div>
    </div>
    {noProfile && (
      <div style={{ padding: "10px 16px", fontSize: 12, fontFamily: "var(--font-dm-sans)", color: "#b45309", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", marginTop: 4 }}>
        No booking profile found.{" "}
        <a href="/account?tab=profiles" style={{ color: "var(--gold)", fontWeight: 600 }}>Set up your profile →</a>
      </div>
    )}
    </>
  );
}
