"use client";

/**
 * TripPackageCard — Phase 2 per-category selection UI.
 *
 * Renders 4 responsive columns (hotel / flight / restaurant / activity) each
 * listing up to 5 option cards. User picks:
 *   - exactly 1 hotel (or skip)
 *   - exactly 1 flight (or skip)
 *   - 0-3 restaurants
 *   - 0-3 activities
 *
 * A sticky footer shows the running selection count and "Book this trip"
 * button (disabled until ≥1 item selected). On click, POSTs selection to
 * /api/booking-jobs/create-trip → routes to /tasks?focus=<jobId>.
 *
 * Layout:
 *   desktop ≥1024px → 4 columns, each 240px min, internal scroll at height 560px
 *   tablet 640-1023px → 2×2 grid
 *   mobile <640px → stacked, one section at a time
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  TripPackage,
  TripSelection,
  HotelRecommendationCard,
  FlightRecommendationCard,
  RecommendationCard,
  ActivityRecommendationCard,
  TripPackageErrors,
} from "@/lib/types";

const MAX_RESTAURANT_PICKS = 3;
const MAX_ACTIVITY_PICKS = 3;

export interface TripPackageCardProps {
  pkg: TripPackage;
  sessionId: string;
  profileId?: number | null;
  errors?: TripPackageErrors;
  /** Fired once the booking job is created + started; parent can clear trip state. */
  onBooked?: (jobId: string) => void;
}

// ─── Styles ──────────────────────────────────────────────────────────────

const WRAPPER: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 16,
  backgroundColor: "var(--card, #fff)",
  marginTop: 8,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  // Break out of the narrow chat container so 4 columns fit comfortably.
  // `left: 50% + translateX(-50%)` horizontally centers relative to the
  // VIEWPORT rather than the parent, and `width: 95vw` stretches past the
  // parent's max-width. Cap at 1600px to avoid absurd card widths on
  // ultrawide monitors.
  position: "relative",
  width: "min(95vw, 1600px)",
  left: "50%",
  transform: "translateX(-50%)",
};

const HEADER: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 12,
  flexWrap: "wrap",
};

const HEADER_TITLE: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 16,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
};

const HEADER_META: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  color: "var(--text-muted, #888)",
};

const GRID: React.CSSProperties = {
  display: "grid",
  // Force 4 equal columns on wide screens (the wrapper breaks out to 95vw so
  // there's room). Mobile / tablet fallback is handled below via a media
  // query embedded inline — see the <style> tag in the render body.
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 1,
  backgroundColor: "var(--border, #e5e7eb)",
};

const COLUMN: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  backgroundColor: "var(--card, #fff)",
  minHeight: 300,
  // No maxHeight: let each column grow to fit all 5 cards naturally. The grid
  // will expand to the tallest column's height so no inner scroll is needed.
};

const COLUMN_HEADER: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  backgroundColor: "var(--card-2, #f7f7f7)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const COLUMN_BODY: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  flex: 1,
};

const SKIP_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border, #d0d0d0)",
  color: "var(--text-muted, #888)",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 10,
  fontFamily: "var(--font-dm-sans)",
  cursor: "pointer",
};

const MINI_CARD_BASE: React.CSSProperties = {
  position: "relative",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 10,
  padding: 0,
  backgroundColor: "var(--card, #fff)",
  display: "flex",
  flexDirection: "column",
  gap: 0,
  transition: "border-color 120ms ease, background-color 120ms ease",
  textAlign: "left",
  fontFamily: "var(--font-dm-sans)",
  overflow: "hidden",
  minHeight: 280,
};

// Card body acts as an <a> link — clicking anywhere outside the Select badge
// opens the partner detail page in a new tab so the user can inspect before
// committing. The anchor fills the card and preserves the flex column layout.
const CARD_LINK: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  textDecoration: "none",
  color: "inherit",
};

// Absolute-positioned Select / ✓ Selected pill in the bottom-right corner.
// Has its own onClick with stopPropagation so selecting doesn't trigger the
// card's navigation. Hard-coded black-on-white / gold-on-white palette
// (theme-agnostic) — previously the pill used var(--text-primary) which
// resolved to light text on the dark theme, making it disappear against its
// own near-white background.
const SELECT_PILL: React.CSSProperties = {
  position: "absolute",
  bottom: 10,
  right: 10,
  zIndex: 2,
  padding: "7px 14px",
  borderRadius: 999,
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.2,
  border: "1.5px solid #111",
  backgroundColor: "#fff",
  color: "#111",
  cursor: "pointer",
  boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
};

const SELECT_PILL_ACTIVE: React.CSSProperties = {
  ...SELECT_PILL,
  backgroundColor: "var(--gold, #c9a648)",
  color: "#fff",
  borderColor: "var(--gold, #c9a648)",
};

const SELECT_PILL_DISABLED: React.CSSProperties = {
  ...SELECT_PILL,
  opacity: 0.35,
  cursor: "not-allowed",
};

// Wrapper around <img> with a fixed height so the image can't grow past 100px
// and crowd out the body text. Setting height on a bare <img> relies on the
// browser honoring `object-fit: cover`, which was unreliable across a
// card-in-button flex context — wrapping in a div with overflow:hidden is
// the sturdier pattern.
const CARD_IMAGE_BOX: React.CSSProperties = {
  width: "100%",
  height: 100,
  flexShrink: 0,
  overflow: "hidden",
  backgroundColor: "var(--card-2, #f0f0f0)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const CARD_IMAGE_IMG: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const CARD_IMAGE_PLACEHOLDER: React.CSSProperties = {
  color: "var(--text-muted, #aaa)",
  fontSize: 32,
};

const CARD_BODY: React.CSSProperties = {
  padding: 10,
  // Extra bottom padding keeps the "why_recommended" text from being covered
  // by the absolute-positioned Select pill in the bottom-right corner.
  paddingBottom: 46,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
  minHeight: 150,
};

const CARD_TITLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
  lineHeight: 1.3,
};

const CARD_META: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary, #555)",
  lineHeight: 1.4,
};

const CARD_WHY: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted, #888)",
  lineHeight: 1.4,
  marginTop: 2,
};

const EMPTY_STATE: React.CSSProperties = {
  padding: 12,
  fontSize: 12,
  color: "var(--text-muted, #888)",
  fontFamily: "var(--font-dm-sans)",
  textAlign: "center",
  lineHeight: 1.5,
};

const FOOTER: React.CSSProperties = {
  padding: "12px 16px",
  borderTop: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  backgroundColor: "var(--card-2, #f7f7f7)",
  position: "sticky",
  bottom: 0,
};

const BOOK_BTN: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 12,
  border: "none",
  backgroundColor: "var(--gold, #c9a648)",
  color: "#fff",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

// ─── Formatters ──────────────────────────────────────────────────────────

const formatPrice = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
};

// ─── Component ───────────────────────────────────────────────────────────

export default function TripPackageCard(props: TripPackageCardProps) {
  const router = useRouter();
  const { pkg, errors } = props;

  const [selection, setSelection] = useState<TripSelection>({
    hotel_id: null,
    flight_id: null,
    restaurant_ids: [],
    activity_ids: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const totalSelected =
    (selection.hotel_id ? 1 : 0) +
    (selection.flight_id ? 1 : 0) +
    selection.restaurant_ids.length +
    selection.activity_ids.length;

  const estimatedTotal = useMemo(
    () => computeEstimatedTotal(pkg, selection),
    [pkg, selection]
  );

  function toggleHotel(id: string) {
    setSelection((s) => ({ ...s, hotel_id: s.hotel_id === id ? null : id }));
  }
  function toggleFlight(id: string) {
    setSelection((s) => ({ ...s, flight_id: s.flight_id === id ? null : id }));
  }
  function toggleRestaurant(id: string) {
    setSelection((s) => {
      const has = s.restaurant_ids.includes(id);
      if (has) return { ...s, restaurant_ids: s.restaurant_ids.filter((x) => x !== id) };
      if (s.restaurant_ids.length >= MAX_RESTAURANT_PICKS) return s;
      return { ...s, restaurant_ids: [...s.restaurant_ids, id] };
    });
  }
  function toggleActivity(id: string) {
    setSelection((s) => {
      const has = s.activity_ids.includes(id);
      if (has) return { ...s, activity_ids: s.activity_ids.filter((x) => x !== id) };
      if (s.activity_ids.length >= MAX_ACTIVITY_PICKS) return s;
      return { ...s, activity_ids: [...s.activity_ids, id] };
    });
  }

  function skipHotel() { setSelection((s) => ({ ...s, hotel_id: null })); }
  function skipFlight() { setSelection((s) => ({ ...s, flight_id: null })); }
  function skipRestaurants() { setSelection((s) => ({ ...s, restaurant_ids: [] })); }
  function skipActivities() { setSelection((s) => ({ ...s, activity_ids: [] })); }

  async function handleBook() {
    if (submitting || totalSelected === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/booking-jobs/create-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: props.sessionId,
          trip_package: pkg,
          selection,
          profile_id: props.profileId ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        setSubmitError(data.error ?? "Couldn't create booking job.");
        return;
      }
      // Fire-and-forget /start with keepalive so navigation doesn't abort.
      fetch(`/api/booking-jobs/${data.jobId}/start?executor=inline`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
      props.onBooked?.(data.jobId);
      if (!props.onBooked) {
        router.push(`/tasks?focus=${encodeURIComponent(data.jobId)}&view=live`);
      }
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={WRAPPER} data-trip-package>
      {/* Responsive grid collapse: tablet 2×2, mobile single column.
          Inlined here because the CSS Grid `repeat(4, ...)` in the style
          object doesn't respond to viewport width without a media query. */}
      <style>{`
        @media (max-width: 1023px) {
          [data-trip-package] > [data-trip-grid] {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 639px) {
          [data-trip-package] > [data-trip-grid] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      {/* Header: trip summary */}
      <div style={HEADER}>
        <div>
          <div style={HEADER_TITLE}>
            {pkg.destination_city} · {pkg.departure_city} ✈
          </div>
          <div style={HEADER_META}>
            {pkg.date_range.from} → {pkg.date_range.to} ·{" "}
            {pkg.traveler_count} {pkg.traveler_count === 1 ? "person" : "people"}
          </div>
        </div>
      </div>

      {pkg.planning_assumptions && pkg.planning_assumptions.length > 0 ? (
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border, #e5e7eb)",
            background: "rgba(201, 168, 76, 0.08)",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--text-secondary, #555)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {pkg.planning_assumptions.map((item, idx) => (
            <div key={`${item}-${idx}`}>• {item}</div>
          ))}
        </div>
      ) : null}

      {/* 4-column grid (collapses via <style> above on narrow screens) */}
      <div style={GRID} data-trip-grid>
        {/* Hotel column */}
        <ColumnSection
          icon="🏨"
          title="Hotel"
          helper="choose 1"
          selectedCount={selection.hotel_id ? 1 : 0}
          totalCount={pkg.hotel_options.length}
          error={errors?.hotel ?? null}
          onSkip={skipHotel}
        >
          {pkg.hotel_options.map((card) => (
            <HotelMiniCard
              key={card.hotel.id}
              card={card}
              selected={selection.hotel_id === card.hotel.id}
              onToggle={() => toggleHotel(card.hotel.id)}
            />
          ))}
        </ColumnSection>

        {/* Flight column */}
        <ColumnSection
          icon="✈"
          title="Flight"
          helper="choose 1"
          selectedCount={selection.flight_id ? 1 : 0}
          totalCount={pkg.flight_options.length}
          error={errors?.flight ?? null}
          onSkip={skipFlight}
        >
          {pkg.flight_options.map((card) => (
            <FlightMiniCard
              key={card.flight.id}
              card={card}
              selected={selection.flight_id === card.flight.id}
              onToggle={() => toggleFlight(card.flight.id)}
            />
          ))}
        </ColumnSection>

        {/* Restaurant column */}
        <ColumnSection
          icon="🍽"
          title="Food"
          helper={`pick up to ${MAX_RESTAURANT_PICKS}`}
          selectedCount={selection.restaurant_ids.length}
          totalCount={pkg.restaurant_options.length}
          error={errors?.restaurant ?? null}
          onSkip={skipRestaurants}
        >
          {pkg.restaurant_options.map((card) => {
            const selected = selection.restaurant_ids.includes(card.restaurant.id);
            const atMax = selection.restaurant_ids.length >= MAX_RESTAURANT_PICKS;
            const disabled = !selected && atMax;
            return (
              <RestaurantMiniCard
                key={card.restaurant.id}
                card={card}
                selected={selected}
                disabled={disabled}
                onToggle={() => toggleRestaurant(card.restaurant.id)}
              />
            );
          })}
        </ColumnSection>

        {/* Activity column */}
        <ColumnSection
          icon="🎟"
          title="Shows"
          helper={`pick up to ${MAX_ACTIVITY_PICKS}`}
          selectedCount={selection.activity_ids.length}
          totalCount={pkg.activity_options.length}
          error={errors?.activity ?? null}
          onSkip={skipActivities}
        >
          {pkg.activity_options.map((card) => {
            const selected = selection.activity_ids.includes(card.activity.id);
            const atMax = selection.activity_ids.length >= MAX_ACTIVITY_PICKS;
            const disabled = !selected && atMax;
            return (
              <ActivityMiniCard
                key={card.activity.id}
                card={card}
                selected={selected}
                disabled={disabled}
                onToggle={() => toggleActivity(card.activity.id)}
              />
            );
          })}
        </ColumnSection>
      </div>

      {/* Sticky footer: count + total + Book */}
      <div style={FOOTER}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)", fontFamily: "var(--font-dm-sans)" }}>
            {totalSelected === 0
              ? "Nothing selected yet"
              : `${totalSelected} selected · est ${formatPrice(estimatedTotal)}`}
          </div>
          {totalSelected > 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted, #888)", fontFamily: "var(--font-dm-sans)" }}>
              {selectionSummary(selection)}
            </div>
          ) : null}
        </div>
        {submitError ? (
          <div style={{ color: "#c0392b", fontSize: 12, fontFamily: "var(--font-dm-sans)" }}>
            {submitError}
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleBook}
          disabled={submitting || totalSelected === 0}
          style={{
            ...BOOK_BTN,
            opacity: submitting || totalSelected === 0 ? 0.5 : 1,
            cursor: submitting || totalSelected === 0 ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Creating job..." : "Book this trip"}
        </button>
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────

interface ColumnSectionProps {
  icon: string;
  title: string;
  helper: string;
  selectedCount: number;
  totalCount: number;
  error: string | null;
  onSkip: () => void;
  children: React.ReactNode;
}

function ColumnSection(props: ColumnSectionProps) {
  return (
    <div style={COLUMN}>
      <div style={COLUMN_HEADER}>
        <div style={{ color: "var(--text-primary, #111)", fontWeight: 600 }}>
          {props.icon} {props.title}{" "}
          <span style={{ color: "var(--text-muted, #888)", fontWeight: 400 }}>
            ({props.helper})
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {props.selectedCount > 0 ? (
            <span style={{ color: "var(--gold, #c9a648)", fontWeight: 600 }}>
              {props.selectedCount} picked
            </span>
          ) : null}
          <button
            type="button"
            onClick={props.onSkip}
            style={SKIP_BTN}
            disabled={props.selectedCount === 0}
            title="Clear selection in this category"
          >
            Skip
          </button>
        </div>
      </div>
      <div style={COLUMN_BODY}>
        {props.totalCount === 0 ? (
          <div style={EMPTY_STATE}>
            {props.error ?? "No matches found."}
          </div>
        ) : (
          props.children
        )}
      </div>
    </div>
  );
}

/**
 * Fixed-height image slot. Wraps an <img> in a 100px-tall box so the image
 * can never push the card body out of sight. On load error (404, CORS) the
 * <img> is swapped for the emoji fallback inside the same box.
 */
function CardImage({ src, fallback }: { src?: string | null; fallback: string }) {
  const [errored, setErrored] = useState(false);
  const hasImage = !!src && !errored;
  return (
    <div style={CARD_IMAGE_BOX}>
      {hasImage ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          style={CARD_IMAGE_IMG}
          onError={() => setErrored(true)}
        />
      ) : (
        <span style={CARD_IMAGE_PLACEHOLDER}>{fallback}</span>
      )}
    </div>
  );
}

/**
 * Standard card shell: the whole tile is an anchor that opens `deepLink` in
 * a new tab, and an absolutely-positioned "Select" pill handles the toggle.
 * Stopping propagation on the pill is what prevents a select-click from also
 * triggering the link navigation.
 */
function SelectableCard({
  deepLink,
  selected,
  disabled,
  onToggle,
  children,
}: {
  deepLink: string | null | undefined;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const cardStyle = selected
    ? { ...MINI_CARD_BASE, borderColor: "var(--gold, #c9a648)", borderWidth: 2, backgroundColor: "rgba(201, 166, 72, 0.06)" }
    : MINI_CARD_BASE;

  const pillStyle = disabled
    ? SELECT_PILL_DISABLED
    : selected
    ? SELECT_PILL_ACTIVE
    : SELECT_PILL;

  const handlePillClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!disabled) onToggle();
  };

  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={handlePillClick}
        disabled={disabled}
        style={pillStyle}
        title={disabled ? "Max 3 selected — unselect another first" : selected ? "Click to unselect" : "Click to add to trip"}
      >
        {selected ? "✓ Selected" : "+ Select"}
      </button>
      {deepLink ? (
        <a href={deepLink} target="_blank" rel="noreferrer" style={CARD_LINK}>
          {children}
        </a>
      ) : (
        <div style={CARD_LINK}>{children}</div>
      )}
    </div>
  );
}

function HotelMiniCard({
  card,
  selected,
  onToggle,
}: {
  card: HotelRecommendationCard;
  selected: boolean;
  onToggle: () => void;
}) {
  const h = card.hotel;
  const img = h.thumbnail ?? h.images?.[0];
  return (
    <SelectableCard deepLink={h.booking_link} selected={selected} onToggle={onToggle}>
      <CardImage src={img} fallback="🏨" />
      <div style={CARD_BODY}>
        <div style={CARD_TITLE}>{h.name}</div>
        <div style={CARD_META}>
          {h.star_rating}★ · {formatPrice(h.price_per_night)}/night · ⭐ {h.rating} ({h.review_count})
        </div>
        {card.why_recommended ? (
          <div style={CARD_WHY}>
            {card.why_recommended.slice(0, 110)}
            {card.why_recommended.length > 110 ? "…" : ""}
          </div>
        ) : null}
      </div>
    </SelectableCard>
  );
}

function FlightMiniCard({
  card,
  selected,
  onToggle,
}: {
  card: FlightRecommendationCard;
  selected: boolean;
  onToggle: () => void;
}) {
  const f = card.flight;
  const stopsLabel = f.stops === 0 ? "Nonstop" : `${f.stops} stop${f.stops === 1 ? "" : "s"}`;
  return (
    <SelectableCard deepLink={f.booking_link} selected={selected} onToggle={onToggle}>
      <CardImage src={f.airline_logo} fallback="✈" />
      <div style={CARD_BODY}>
        <div style={CARD_TITLE}>
          {f.airline} {f.departure_airport}→{f.arrival_airport}
        </div>
        <div style={CARD_META}>
          {f.departure_time} → {f.arrival_time} · {stopsLabel} · {formatPrice(f.price)}/pax
        </div>
        {card.why_recommended ? (
          <div style={CARD_WHY}>
            {card.why_recommended.slice(0, 110)}
            {card.why_recommended.length > 110 ? "…" : ""}
          </div>
        ) : null}
      </div>
    </SelectableCard>
  );
}

function RestaurantMiniCard({
  card,
  selected,
  disabled,
  onToggle,
}: {
  card: RecommendationCard;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const r = card.restaurant;
  const img = r.image_url ?? r.images?.[0];
  // Prefer OpenTable link (live availability), else Yelp / official site.
  const deepLink = card.opentable_url ?? r.url ?? null;
  return (
    <SelectableCard
      deepLink={deepLink}
      selected={selected}
      disabled={disabled}
      onToggle={onToggle}
    >
      <CardImage src={img} fallback="🍽" />
      <div style={CARD_BODY}>
        <div style={CARD_TITLE}>{r.name}</div>
        <div style={CARD_META}>
          {r.cuisine} · {r.price} · ⭐ {r.rating} ({r.review_count})
        </div>
        {card.why_recommended ? (
          <div style={CARD_WHY}>
            {card.why_recommended.slice(0, 110)}
            {card.why_recommended.length > 110 ? "…" : ""}
          </div>
        ) : null}
      </div>
    </SelectableCard>
  );
}

function ActivityMiniCard({
  card,
  selected,
  disabled,
  onToggle,
}: {
  card: ActivityRecommendationCard;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const a = card.activity;
  const deepLink = a.sources[0]?.booking_link ?? a.booking_link ?? null;
  return (
    <SelectableCard
      deepLink={deepLink}
      selected={selected}
      disabled={disabled}
      onToggle={onToggle}
    >
      <CardImage src={a.image_url} fallback="🎟" />
      <div style={CARD_BODY}>
        <div style={CARD_TITLE}>{a.short_title ?? a.title}</div>
        <div style={CARD_META}>
          {a.datetime_display ?? a.datetime_local.slice(0, 10)} · {a.venue_name}
        </div>
        <div style={CARD_META}>
          {formatPrice(a.price_min)}{a.price_max && a.price_max !== a.price_min ? `-${formatPrice(a.price_max)}` : ""}
        </div>
        {card.why_recommended ? (
          <div style={CARD_WHY}>
            {card.why_recommended.slice(0, 110)}
            {card.why_recommended.length > 110 ? "…" : ""}
          </div>
        ) : null}
      </div>
    </SelectableCard>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function selectionSummary(s: TripSelection): string {
  const parts: string[] = [];
  if (s.hotel_id) parts.push("1 hotel");
  if (s.flight_id) parts.push("1 flight");
  if (s.restaurant_ids.length) parts.push(`${s.restaurant_ids.length} restaurant${s.restaurant_ids.length === 1 ? "" : "s"}`);
  if (s.activity_ids.length) parts.push(`${s.activity_ids.length} show${s.activity_ids.length === 1 ? "" : "s"}`);
  return parts.join(" + ");
}

function computeEstimatedTotal(pkg: TripPackage, s: TripSelection): number {
  let total = 0;
  if (s.hotel_id) {
    const h = pkg.hotel_options.find((c) => c.hotel.id === s.hotel_id);
    if (h) total += h.hotel.total_price || h.hotel.price_per_night; // fallback = single night if total_price missing
  }
  if (s.flight_id) {
    const f = pkg.flight_options.find((c) => c.flight.id === s.flight_id);
    if (f) total += f.flight.price * pkg.traveler_count;
  }
  for (const id of s.restaurant_ids) {
    const r = pkg.restaurant_options.find((c) => c.restaurant.id === id);
    if (r) {
      // Rough per-person budget from price level ($ = 20, $$ = 40, $$$ = 80, $$$$ = 150).
      const level = r.restaurant.price?.length ?? 2;
      const perPerson = [0, 20, 40, 80, 150][level] ?? 40;
      total += perPerson * pkg.traveler_count;
    }
  }
  for (const id of s.activity_ids) {
    const a = pkg.activity_options.find((c) => c.activity.id === id);
    if (a) total += a.activity.price_min * pkg.traveler_count;
  }
  return total;
}
