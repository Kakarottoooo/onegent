"use client";

/**
 * TripProposalChatCard — Stage 2 · T11 inline card for multi-party trip rooms.
 *
 * Rendered in the chat stream when a private_message carries
 * meta_json.kind === 'trip_proposal_card'. Fetches the active proposal +
 * per-user selections from /api/rooms/[id]/trip-proposal and lets each
 * member pick their preferred items per category. Each card shows a small
 * "N/M picked" badge so the group sees consensus emerging in real time.
 *
 * Voting semantics (α):
 *   - Any member can Lock in their picks: PUT /api/rooms/[id]/trip-selection
 *   - Payer sees an extra "Book the consensus" button that fires
 *     POST /api/rooms/[id]/book-trip with the computed majority per column
 *
 * Layout mirrors the Solo TripPackageCard (4 cols: 🏨 / ✈ / 🍽 / 🎟) so the
 * interaction is familiar. Breaks out to 95vw to fit 4 columns comfortably.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  TripPackage,
  HotelRecommendationCard,
  FlightRecommendationCard,
  RecommendationCard,
  ActivityRecommendationCard,
} from "@/lib/types";

const MAX_RESTAURANT_PICKS = 3;
const MAX_ACTIVITY_PICKS = 3;
const POLL_INTERVAL_MS = 4000;

export interface TripProposalChatCardProps {
  roomId: string;
  proposalId: string;
  /** Current user id — used to compute isPayer. */
  userId: string | null;
}

interface ApiResponse {
  ok: true;
  proposal: {
    id: string;
    content_json: TripPackage;
    rationale: string | null;
    status: string;
  } | null;
  my_selection: {
    hotel_id: string | null;
    flight_id: string | null;
    restaurant_ids: string[];
    activity_ids: string[];
  } | null;
  aggregate: {
    hotel_counts: Record<string, number>;
    flight_counts: Record<string, number>;
    restaurant_counts: Record<string, number>;
    activity_counts: Record<string, number>;
    total_voters: number;
    joined_members: number;
  };
  room: {
    creator_id: string;
    payer_id: string;
    approval_rule: string;
    status: string;
  };
}

type Selection = NonNullable<ApiResponse["my_selection"]>;

// ─── Styles (copied + adapted from TripPackageCard) ───────────────────────

const WRAPPER: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 16,
  backgroundColor: "var(--card, #fff)",
  marginTop: 8,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  // Fill the chat column — no viewport breakout. The 4 columns reflow to
  // whatever width is available (sidebar collapse makes more room). Media
  // queries below collapse to 2 cols at ≤1023px and 1 col at ≤639px so the
  // cards stay readable at tight widths.
  width: "100%",
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
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 1,
  backgroundColor: "var(--border, #e5e7eb)",
};
const COLUMN: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  backgroundColor: "var(--card, #fff)",
  minHeight: 300,
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
const MINI_CARD_BASE: React.CSSProperties = {
  position: "relative",
  // Long-hand border properties (not shorthand) so the `selected` style can
  // override borderColor/borderWidth without React warning about shorthand +
  // longhand collision during rerender.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border, #e5e7eb)",
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
const CARD_LINK: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  textDecoration: "none",
  color: "inherit",
};
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
const VOTE_BADGE: React.CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  zIndex: 2,
  padding: "3px 9px",
  borderRadius: 999,
  fontFamily: "var(--font-dm-sans)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.3,
  backgroundColor: "rgba(0, 0, 0, 0.72)",
  color: "#fff",
  pointerEvents: "none",
};
const VOTE_BADGE_HOT: React.CSSProperties = {
  ...VOTE_BADGE,
  backgroundColor: "var(--gold, #c9a648)",
  color: "#fff",
};
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
const LOCK_BTN: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  border: "1px solid var(--border, #d0d0d0)",
  backgroundColor: "transparent",
  color: "var(--text-primary, #111)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
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

// ─── Helpers ─────────────────────────────────────────────────────────────

const formatPrice = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
};

// ─── Component ───────────────────────────────────────────────────────────

export default function TripProposalChatCard(props: TripProposalChatCardProps) {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selection, setSelection] = useState<Selection>({
    hotel_id: null,
    flight_id: null,
    restaurant_ids: [],
    activity_ids: [],
  });
  const [saveInflight, setSaveInflight] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bookInflight, setBookInflight] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  const fetchProposal = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${props.roomId}/trip-proposal`);
      if (!res.ok) {
        setLoadError(`Couldn't load proposal (${res.status}).`);
        return;
      }
      const payload = (await res.json()) as ApiResponse;
      setData(payload);
      setLoadError(null);
      // First load: pre-fill the local selection from the saved one so the
      // user sees their prior picks highlighted. Do NOT overwrite subsequent
      // local edits with server state (the user's live selection is UI-owned
      // until they click "Lock in").
      setSelection((prev) => {
        if (prev.hotel_id || prev.flight_id || prev.restaurant_ids.length || prev.activity_ids.length) {
          return prev;
        }
        return (
          payload.my_selection ?? {
            hotel_id: null,
            flight_id: null,
            restaurant_ids: [],
            activity_ids: [],
          }
        );
      });
    } catch {
      setLoadError("Network error loading proposal.");
    } finally {
      setLoading(false);
    }
  }, [props.roomId]);

  useEffect(() => {
    void fetchProposal();
    const id = setInterval(() => void fetchProposal(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchProposal]);

  const pkg = data?.proposal?.content_json ?? null;
  const isPayer = !!(data && props.userId && data.room.payer_id === props.userId);
  const totalVoters = data?.aggregate.total_voters ?? 0;
  const joinedMembers = data?.aggregate.joined_members ?? 0;

  const totalSelected =
    (selection.hotel_id ? 1 : 0) +
    (selection.flight_id ? 1 : 0) +
    selection.restaurant_ids.length +
    selection.activity_ids.length;

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

  async function handleLockIn() {
    if (saveInflight) return;
    setSaveInflight(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/rooms/${props.roomId}/trip-selection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(body.error ?? "Couldn't save selection.");
        return;
      }
      // Immediately re-fetch so everyone's counts update.
      await fetchProposal();
    } catch {
      setSaveError("Network error — try again.");
    } finally {
      setSaveInflight(false);
    }
  }

  async function handleBook() {
    if (bookInflight) return;
    setBookInflight(true);
    setBookError(null);
    try {
      // Pass the payer's current UI selection as the override — otherwise
      // book-trip would fall back to the payer's saved row or consensus.
      const res = await fetch(`/api/rooms/${props.roomId}/book-trip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        booking_job_id?: string;
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setBookError(body.error ?? "Couldn't start the booking job.");
        return;
      }
      if (body.url) router.push(body.url);
    } catch {
      setBookError("Network error — try again.");
    } finally {
      setBookInflight(false);
    }
  }

  if (loading) {
    return (
      <div style={WRAPPER}>
        <div style={{ padding: 20, fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-muted, #888)" }}>
          Loading proposal…
        </div>
      </div>
    );
  }
  if (loadError || !data || !pkg) {
    return (
      <div style={WRAPPER}>
        <div style={{ padding: 20, fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "#c0392b" }}>
          {loadError ?? "No proposal available yet."}
        </div>
      </div>
    );
  }

  const voteLabel = `${totalVoters}/${joinedMembers} 人已提交选择`;

  return (
    <div style={WRAPPER} data-trip-proposal>
      <style>{`
        @media (max-width: 1023px) {
          [data-trip-proposal] > [data-trip-grid] {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 639px) {
          [data-trip-proposal] > [data-trip-grid] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div style={HEADER}>
        <div>
          <div style={HEADER_TITLE}>
            {pkg.destination_city} · {pkg.departure_city} ✈
          </div>
          <div style={HEADER_META}>
            {pkg.date_range.from} → {pkg.date_range.to} ·{" "}
            {pkg.traveler_count} {pkg.traveler_count === 1 ? "person" : "people"} · {voteLabel}
          </div>
        </div>
      </div>

      <div style={GRID} data-trip-grid>
        <ColumnSection icon="🏨" title="Hotel" helper="choose 1" selectedCount={selection.hotel_id ? 1 : 0} totalCount={pkg.hotel_options.length}>
          {pkg.hotel_options.map((card) => (
            <HotelMiniCard
              key={card.hotel.id}
              card={card}
              selected={selection.hotel_id === card.hotel.id}
              voteCount={data.aggregate.hotel_counts[card.hotel.id] ?? 0}
              totalVoters={totalVoters}
              onToggle={() => toggleHotel(card.hotel.id)}
            />
          ))}
        </ColumnSection>

        <ColumnSection icon="✈" title="Flight" helper="choose 1" selectedCount={selection.flight_id ? 1 : 0} totalCount={pkg.flight_options.length}>
          {pkg.flight_options.map((card) => (
            <FlightMiniCard
              key={card.flight.id}
              card={card}
              selected={selection.flight_id === card.flight.id}
              voteCount={data.aggregate.flight_counts[card.flight.id] ?? 0}
              totalVoters={totalVoters}
              onToggle={() => toggleFlight(card.flight.id)}
            />
          ))}
        </ColumnSection>

        <ColumnSection icon="🍽" title="Food" helper={`pick up to ${MAX_RESTAURANT_PICKS}`} selectedCount={selection.restaurant_ids.length} totalCount={pkg.restaurant_options.length}>
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
                voteCount={data.aggregate.restaurant_counts[card.restaurant.id] ?? 0}
                totalVoters={totalVoters}
                onToggle={() => toggleRestaurant(card.restaurant.id)}
              />
            );
          })}
        </ColumnSection>

        <ColumnSection icon="🎟" title="Shows" helper={`pick up to ${MAX_ACTIVITY_PICKS}`} selectedCount={selection.activity_ids.length} totalCount={pkg.activity_options.length}>
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
                voteCount={data.aggregate.activity_counts[card.activity.id] ?? 0}
                totalVoters={totalVoters}
                onToggle={() => toggleActivity(card.activity.id)}
              />
            );
          })}
        </ColumnSection>
      </div>

      <div style={FOOTER}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)", fontFamily: "var(--font-dm-sans)" }}>
            {totalSelected === 0 ? "Nothing selected yet" : `${totalSelected} selected`}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)", fontFamily: "var(--font-dm-sans)" }}>
            {isPayer ? "You're the payer — click Book when the group's ready." : "Lock in your picks so the payer sees your vote."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saveError ? (
            <div style={{ color: "#c0392b", fontSize: 11, fontFamily: "var(--font-dm-sans)" }}>{saveError}</div>
          ) : null}
          {bookError ? (
            <div style={{ color: "#c0392b", fontSize: 11, fontFamily: "var(--font-dm-sans)" }}>{bookError}</div>
          ) : null}
          <button
            type="button"
            onClick={handleLockIn}
            disabled={saveInflight || totalSelected === 0}
            style={{ ...LOCK_BTN, opacity: saveInflight || totalSelected === 0 ? 0.5 : 1 }}
          >
            {saveInflight ? "Saving…" : "Lock in my picks"}
          </button>
          {isPayer ? (
            <button
              type="button"
              onClick={handleBook}
              disabled={bookInflight || totalSelected === 0}
              style={{ ...BOOK_BTN, opacity: bookInflight || totalSelected === 0 ? 0.5 : 1 }}
            >
              {bookInflight ? "Booking…" : "Book this trip"}
            </button>
          ) : null}
        </div>
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
        {props.selectedCount > 0 ? (
          <span style={{ color: "var(--gold, #c9a648)", fontWeight: 600 }}>
            {props.selectedCount} picked
          </span>
        ) : null}
      </div>
      <div style={COLUMN_BODY}>
        {props.totalCount === 0 ? (
          <div style={EMPTY_STATE}>No matches found.</div>
        ) : (
          props.children
        )}
      </div>
    </div>
  );
}

function CardImage({ src, fallback }: { src?: string | null; fallback: string }) {
  const [errored, setErrored] = useState(false);
  const hasImage = !!src && !errored;
  return (
    <div style={CARD_IMAGE_BOX}>
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
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

function VoteBadge({ count, totalVoters }: { count: number; totalVoters: number }) {
  if (count === 0) return null;
  // "Hot" when a majority of voters picked this item.
  const isHot = totalVoters > 0 && count / totalVoters >= 0.5;
  return (
    <div style={isHot ? VOTE_BADGE_HOT : VOTE_BADGE}>
      {count}/{totalVoters} picked
    </div>
  );
}

function SelectableCard({
  deepLink,
  selected,
  disabled,
  voteCount,
  totalVoters,
  onToggle,
  children,
}: {
  deepLink: string | null | undefined;
  selected: boolean;
  disabled?: boolean;
  voteCount: number;
  totalVoters: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const cardStyle = selected
    ? { ...MINI_CARD_BASE, borderColor: "var(--gold, #c9a648)", borderWidth: 2, backgroundColor: "rgba(201, 166, 72, 0.06)" }
    : MINI_CARD_BASE;

  const pillStyle = disabled ? SELECT_PILL_DISABLED : selected ? SELECT_PILL_ACTIVE : SELECT_PILL;

  const handlePillClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!disabled) onToggle();
  };

  return (
    <div style={cardStyle}>
      <VoteBadge count={voteCount} totalVoters={totalVoters} />
      <button type="button" onClick={handlePillClick} disabled={disabled} style={pillStyle}>
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
  voteCount,
  totalVoters,
  onToggle,
}: {
  card: HotelRecommendationCard;
  selected: boolean;
  voteCount: number;
  totalVoters: number;
  onToggle: () => void;
}) {
  const h = card.hotel;
  const img = h.thumbnail ?? h.images?.[0];
  return (
    <SelectableCard
      deepLink={h.booking_link}
      selected={selected}
      voteCount={voteCount}
      totalVoters={totalVoters}
      onToggle={onToggle}
    >
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
  voteCount,
  totalVoters,
  onToggle,
}: {
  card: FlightRecommendationCard;
  selected: boolean;
  voteCount: number;
  totalVoters: number;
  onToggle: () => void;
}) {
  const f = card.flight;
  const stopsLabel = f.stops === 0 ? "Nonstop" : `${f.stops} stop${f.stops === 1 ? "" : "s"}`;
  return (
    <SelectableCard
      deepLink={f.booking_link}
      selected={selected}
      voteCount={voteCount}
      totalVoters={totalVoters}
      onToggle={onToggle}
    >
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
  voteCount,
  totalVoters,
  onToggle,
}: {
  card: RecommendationCard;
  selected: boolean;
  disabled: boolean;
  voteCount: number;
  totalVoters: number;
  onToggle: () => void;
}) {
  const r = card.restaurant;
  const img = r.image_url ?? r.images?.[0];
  const deepLink = card.opentable_url ?? r.url ?? null;
  return (
    <SelectableCard
      deepLink={deepLink}
      selected={selected}
      disabled={disabled}
      voteCount={voteCount}
      totalVoters={totalVoters}
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
  voteCount,
  totalVoters,
  onToggle,
}: {
  card: ActivityRecommendationCard;
  selected: boolean;
  disabled: boolean;
  voteCount: number;
  totalVoters: number;
  onToggle: () => void;
}) {
  const a = card.activity;
  const deepLink = a.sources[0]?.booking_link ?? a.booking_link ?? null;
  return (
    <SelectableCard
      deepLink={deepLink}
      selected={selected}
      disabled={disabled}
      voteCount={voteCount}
      totalVoters={totalVoters}
      onToggle={onToggle}
    >
      <CardImage src={a.image_url} fallback="🎟" />
      <div style={CARD_BODY}>
        <div style={CARD_TITLE}>{a.short_title ?? a.title}</div>
        <div style={CARD_META}>
          {a.datetime_display ?? a.datetime_local.slice(0, 10)} · {a.venue_name}
        </div>
        <div style={CARD_META}>
          {formatPrice(a.price_min)}
          {a.price_max && a.price_max !== a.price_min ? `-${formatPrice(a.price_max)}` : ""}
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
