"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RecommendationCard as CardType, FeedbackRecord } from "@/lib/types";
import PhotoCarousel from "@/components/PhotoCarousel";
import { getBrowserModelForStagehand } from "@/lib/agent-model-config";
import "./cards.css";

interface Props {
  card: CardType;
  index: number;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  nearLocationLabel?: string;
  currentQuery?: string;
  requestId?: string;
  onCompare?: () => void;
  isComparing?: boolean;
  onFeedback?: (record: FeedbackRecord) => void;
  /** Hide the "Reserve with Agent" booking CTA. Used inside multi-party
   *  proposal cards where booking has to wait for the group's vote winner
   *  + payer-only confirmation. Aligns with FlightCard/ActivityCard
   *  which already expose this prop. */
  hideBookingActions?: boolean;
}

const NOISE_ICON: Record<string, string> = {
  quiet: "🤫",
  moderate: "🔉",
  loud: "🔊",
  unknown: "❓",
};

function ScoreBar({ value, max = 10 }: { value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          flex: 1,
          height: "4px",
          backgroundColor: "var(--card-2)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            backgroundColor: "var(--gold)",
            borderRadius: "2px",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: "12px",
          color: "var(--text-secondary)",
          minWidth: "28px",
          textAlign: "right",
        }}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}

export default function RecommendationCard({
  card,
  index,
  isFavorite,
  onToggleFavorite,
  nearLocationLabel,
  currentQuery = "",
  requestId,
  onCompare,
  isComparing,
  onFeedback,
  hideBookingActions = false,
}: Props) {
  const router = useRouter();
  const [booking, setBooking] = useState(false);
  const [showDateForm, setShowDateForm] = useState(false);
  const [noProfile, setNoProfile] = useState(false);

  // Reservation details
  const today = new Date().toISOString().split("T")[0];
  const [resDate, setResDate] = useState("");
  const [resTime, setResTime] = useState("19:00");
  const [resCovers, setResCovers] = useState(2);

  function handleReserve() {
    if (booking) return;
    fireTelemetry("reserve_click");
    setShowDateForm(true);
  }

  async function handleDateFormNext() {
    if (!resDate) return;
    setShowDateForm(false);
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

  async function proceedWithProfile(profile: { id: number; first_name: string; last_name: string; email: string; phone: string }) {
    localStorage.setItem("active_profile_id", String(profile.id));
    try {
      const sessionId = localStorage.getItem("session_id") ?? crypto.randomUUID();
      if (!localStorage.getItem("session_id")) localStorage.setItem("session_id", sessionId);
      const agentModel = getBrowserModelForStagehand() ?? undefined;

      const otUrl = `https://www.opentable.com/s?term=${encodeURIComponent(card.restaurant.name)}&covers=${resCovers}&dateTime=${resDate}T${resTime}:00`;
      const fallbackUrl = card.opentable_url ?? otUrl;

      const step = {
        type: "restaurant" as const,
        emoji: "🍽️",
        label: card.restaurant.name,
        apiEndpoint: "/api/booking-jobs/start",
        body: {
          restaurantName: card.restaurant.name,
          city: card.restaurant.address?.split(",").slice(-2).join(",").trim() ?? "",
          date: resDate,
          time: resTime,
          covers: resCovers,
          profileId: profile.id,
          profile: {
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
            phone: profile.phone,
          },
          agentModel,
        },
        fallbackUrl,
        status: "pending" as const,
      };

      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, trip_label: card.restaurant.name, steps: [step] }),
      });
      if (createRes.ok) {
        const { jobId } = await createRes.json();
        fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, { method: "POST" }).catch(() => {});
        router.push(`/tasks?view=live&focus=${encodeURIComponent(jobId)}`);
      }
    } catch {
      // ignore
    }
  }

  function fireTelemetry(type: "map_click" | "reserve_click") {
    const event = {
      type,
      restaurant_id: card.restaurant.id,
      restaurant_name: card.restaurant.name,
      rank: card.rank,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  }

  const { restaurant: r } = card;
  const [scoringOpen, setScoringOpen] = useState(false);
  const [feedbackState, setFeedbackState] = useState<
    "idle" | "rating" | "issues" | "done"
  >("idle");
  const [feedbackSatisfied, setFeedbackSatisfied] = useState<boolean | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);

  const ISSUE_OPTIONS = [
    "比描述的吵",
    "价格偏高",
    "等位太久",
    "氛围不符",
    "服务差",
    "食物普通",
  ];

  function saveFeedback(satisfied: boolean, issues?: string[]) {
    const record: FeedbackRecord = {
      restaurant_id: r.id,
      restaurant_name: r.name,
      query: currentQuery,
      satisfied,
      issues,
      created_at: new Date().toISOString(),
    };
    try {
      const existing: FeedbackRecord[] = JSON.parse(
        localStorage.getItem("restaurant-feedback") ?? "[]"
      );
      const next = [record, ...existing].slice(0, 50);
      localStorage.setItem("restaurant-feedback", JSON.stringify(next));
    } catch {}
    onFeedback?.(record);
  }

  function handleFeedbackThumb(satisfied: boolean) {
    setFeedbackSatisfied(satisfied);
    if (satisfied) {
      saveFeedback(true);
      setFeedbackState("done");
    } else {
      setFeedbackState("issues");
    }
  }

  function handleIssueToggle(issue: string) {
    setSelectedIssues((prev) =>
      prev.includes(issue) ? prev.filter((i) => i !== issue) : [...prev, issue]
    );
  }

  function submitIssues() {
    saveFeedback(false, selectedIssues);
    setFeedbackState("done");
  }

  // Time options 11:00–22:00 in 30-min steps
  const timeOptions = Array.from({ length: 23 }, (_, i) => {
    const h = 11 + Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    if (h > 22) return null;
    const value = `${String(h).padStart(2, "0")}:${m}`;
    const h12 = h > 12 ? h - 12 : h;
    const ampm = h >= 12 ? "PM" : "AM";
    return { value, label: `${h12}:${m} ${ampm}` };
  }).filter(Boolean) as { value: string; label: string }[];

  return (
    <>
    {/* Date / time / covers form — shown before ProfilePicker */}
    {showDateForm && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: "var(--card, #fff)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 15, margin: 0 }}>
            🍽️ {card.restaurant.name}
          </p>
          <div>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #999)", textTransform: "uppercase", marginBottom: 4 }}>Date</p>
            <input type="date" value={resDate} min={today} onChange={e => setResDate(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid var(--border, #e5e7eb)", fontFamily: "var(--font-dm-sans)", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #999)", textTransform: "uppercase", marginBottom: 4 }}>Time</p>
              <select value={resTime} onChange={e => setResTime(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid var(--border, #e5e7eb)", fontFamily: "var(--font-dm-sans)", fontSize: 13, boxSizing: "border-box" }}>
                {timeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #999)", textTransform: "uppercase", marginBottom: 4 }}>People</p>
              <select value={resCovers} onChange={e => setResCovers(Number(e.target.value))}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid var(--border, #e5e7eb)", fontFamily: "var(--font-dm-sans)", fontSize: 13, boxSizing: "border-box" }}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} {n===1?"person":"people"}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowDateForm(false)} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "0.5px solid var(--border, #e5e7eb)", background: "transparent", fontFamily: "var(--font-dm-sans)", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleDateFormNext} disabled={!resDate || booking}
              style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: resDate ? "var(--gold, #D4A34B)" : "#e5e7eb", color: resDate ? "#fff" : "#999", fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, cursor: resDate ? "pointer" : "not-allowed" }}>
              {booking ? "Starting…" : "Book →"}
            </button>
          </div>
        </div>
      </div>
    )}
    {noProfile && (
      <div style={{ padding: "10px 16px", fontSize: 12, fontFamily: "var(--font-dm-sans)", color: "#b45309", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", margin: "0 0 8px" }}>
        No booking profile found.{" "}
        <a href="/account?tab=profiles" style={{ color: "var(--gold)", fontWeight: 600 }}>Set up your profile →</a>
      </div>
    )}
    <div className="rec-card animate-fadeIn">
      {/* Photo carousel */}
      <PhotoCarousel
        images={
          r.images && r.images.length > 0
            ? r.images
            : r.image_url
              ? [r.image_url]
              : []
        }
        alt={r.name}
        heightClass="h-[180px]"
        emptyEmoji="🍽️"
      />

      <div className="rec-card__body">
        {/* Card Header */}
        <div className="rec-card__header">
          <div className="rec-card__rank">{index + 1}</div>

          <div className="rec-card__title-wrap">
            <h3 className="rec-card__name">{r.name}</h3>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="rec-card__rating">★ {r.rating}</span>
            {onToggleFavorite && (
              <button
                onClick={onToggleFavorite}
                aria-label={isFavorite ? "Remove from favorites" : "Save to favorites"}
                className="rec-card__favorite-btn"
              >
                {isFavorite ? "❤️" : "🤍"}
              </button>
            )}
          </div>
        </div>

        {/* Cuisine + price */}
        <p className="rec-card__meta">
          {r.cuisine} &middot; {r.price}
        </p>

        {/* Address + distance */}
        <div className="rec-card__address-row">
          <p className="rec-card__address truncate">{r.address}</p>
          {r.distance !== undefined && nearLocationLabel && (
            <span className="rec-card__distance">
              {(r.distance * 0.000621371).toFixed(1)} mi from {nearLocationLabel}
            </span>
          )}
        </div>

        {/* Gold divider */}
        <div className="rec-card__divider" />

        {/* Description */}
        {r.description && (
          <p className="rec-card__description">{r.description}</p>
        )}

        {/* Why it fits */}
        <div className="rec-card__tab rec-card__tab--why">
          <p className="rec-card__tab-label">Why it fits</p>
          <p className="rec-card__tab-text">{card.why_recommended}</p>
        </div>

        {/* Watch out */}
        {card.watch_out && (
          <div className="rec-card__tab rec-card__tab--watchout">
            <p className="rec-card__tab-label">Watch out</p>
            <p className="rec-card__tab-text">{card.watch_out}</p>
          </div>
        )}

        {/* Phase 5.1: Real reviews say (with Google review source + quotes) */}
        {r.review_signals && (
          <div
            style={{
              backgroundColor: "var(--card-2)",
              borderLeft: "3px solid var(--text-secondary)",
              borderRadius: "0 8px 8px 0",
              padding: "10px 12px",
              marginBottom: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <p
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  margin: 0,
                }}
              >
                Real reviews say
              </p>
              {r.google_reviews && r.google_reviews.length >= 2 && (
                <span
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "10px",
                    color: "var(--gold, #C9A84C)",
                    backgroundColor: "rgba(201,168,76,0.12)",
                    borderRadius: "4px",
                    padding: "1px 5px",
                  }}
                >
                  Google Maps
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {r.review_signals.noise_level !== "unknown" && (
                <span
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  {NOISE_ICON[r.review_signals.noise_level]} Noise:{" "}
                  {r.review_signals.noise_level}
                </span>
              )}
              {r.review_signals.wait_time && (
                <span
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  ⏱ Wait: {r.review_signals.wait_time}
                </span>
              )}
              {r.review_signals.notable_dishes.length > 0 && (
                <span
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  🍽 Must try: {r.review_signals.notable_dishes.slice(0, 3).join(", ")}
                </span>
              )}
              {r.review_signals.red_flags.length > 0 && (
                <span
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    color: "var(--amber, #E8A020)",
                  }}
                >
                  ⚠ {r.review_signals.red_flags.slice(0, 2).join(" · ")}
                </span>
              )}
              {/* Phase 5.1: Show up to 2 real review quotes */}
              {r.google_reviews && r.google_reviews.length > 0 && (
                <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {r.google_reviews.slice(0, 2).map((review, i) => (
                    <blockquote
                      key={i}
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontStyle: "italic",
                        margin: 0,
                        paddingLeft: "8px",
                        borderLeft: "2px solid var(--border)",
                        lineHeight: 1.5,
                      }}
                    >
                      &ldquo;{review.text.length > 120 ? review.text.slice(0, 120) + "…" : review.text}&rdquo;
                      <span style={{ fontStyle: "normal", fontSize: "10px", marginLeft: "4px", opacity: 0.7 }}>
                        — Google Maps, {review.relative_time_description}
                      </span>
                    </blockquote>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Skip if */}
        {card.not_great_if && (
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "12px",
              color: "var(--text-muted)",
              marginBottom: "10px",
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontWeight: 500 }}>Skip if:</span>{" "}
            {card.not_great_if}
          </p>
        )}

        {/* Phase 3.2: Dimension score toggle */}
        {card.scoring && (
          <div style={{ marginBottom: "10px" }}>
            <button
              onClick={() => setScoringOpen((o) => !o)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontFamily: "var(--font-dm-sans)",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary)",
              }}
            >
              <span>综合评分 {card.scoring.weighted_total.toFixed(1)}</span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  fontWeight: 400,
                }}
              >
                {scoringOpen ? "▲" : "▼"}
              </span>
            </button>
            {scoringOpen && (
              <div
                style={{
                  marginTop: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px 12px",
                  backgroundColor: "var(--card-2)",
                  borderRadius: "8px",
                }}
              >
                {[
                  { label: "场景契合", key: "scene_match" as const },
                  { label: "预算匹配", key: "budget_match" as const },
                  { label: "口碑质量", key: "review_quality" as const },
                  { label: "位置便利", key: "location_convenience" as const },
                  { label: "偏好吻合", key: "preference_match" as const },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "2px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                    <ScoreBar value={card.scoring![key]} />
                  </div>
                ))}
                {card.scoring.red_flag_penalty > 0 && (
                  <p
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "11px",
                      color: "var(--amber, #E8A020)",
                      marginTop: "2px",
                    }}
                  >
                    ⚠ 扣分项 -{card.scoring.red_flag_penalty}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Card footer */}
        <div
          style={{
            borderTop: "0.5px solid var(--border)",
            paddingTop: "12px",
            marginTop: "4px",
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: "10px" }}>
            <span
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary)",
              }}
            >
              Est. {card.estimated_total}
            </span>
            <div className="flex gap-2">
              {onCompare && (
                <button
                  onClick={onCompare}
                  aria-pressed={isComparing}
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "13px",
                    color: isComparing ? "#fff" : "var(--text-secondary)",
                    border: `0.5px solid ${isComparing ? "var(--gold)" : "var(--border)"}`,
                    borderRadius: "8px",
                    padding: "7px 14px",
                    textDecoration: "none",
                    display: "inline-block",
                    backgroundColor: isComparing ? "var(--gold)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  对比
                </button>
              )}
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => fireTelemetry("map_click")}
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    border: "0.5px solid var(--border)",
                    borderRadius: "8px",
                    padding: "7px 14px",
                    textDecoration: "none",
                    display: "inline-block",
                    backgroundColor: "transparent",
                  }}
                >
                  Map
                </a>
              )}
              {!hideBookingActions && (
                <button
                  onClick={handleReserve}
                  disabled={booking}
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "13px",
                    color: "#fff",
                    backgroundColor: booking ? "var(--border)" : "var(--gold)",
                    borderRadius: "8px",
                    padding: "7px 14px",
                    border: "none",
                    cursor: booking ? "default" : "pointer",
                    transition: "background-color 0.2s",
                  }}
                >
                  {booking ? "Starting agent…" : "Reserve with Agent →"}
                </button>
              )}
            </div>
          </div>

          {/* Phase 3.3c: Feedback row */}
          <div>
            {feedbackState === "idle" && (
              <button
                onClick={() => setFeedbackState("rating")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  padding: 0,
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                去了？分享体验
              </button>
            )}
            {feedbackState === "rating" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  实际体验如何？
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => handleFeedbackThumb(true)}
                    style={{
                      flex: 1,
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "0.5px solid var(--border)",
                      backgroundColor: "var(--card-2)",
                      cursor: "pointer",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "12px",
                      color: "var(--text-primary)",
                    }}
                  >
                    👍 符合推荐
                  </button>
                  <button
                    onClick={() => handleFeedbackThumb(false)}
                    style={{
                      flex: 1,
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "0.5px solid var(--border)",
                      backgroundColor: "var(--card-2)",
                      cursor: "pointer",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "12px",
                      color: "var(--text-primary)",
                    }}
                  >
                    👎 不太对
                  </button>
                </div>
              </div>
            )}
            {feedbackState === "issues" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  哪里没达预期？（可多选）
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  {ISSUE_OPTIONS.map((issue) => (
                    <button
                      key={issue}
                      onClick={() => handleIssueToggle(issue)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "20px",
                        border: "0.5px solid var(--border)",
                        backgroundColor: selectedIssues.includes(issue)
                          ? "var(--gold)"
                          : "var(--card-2)",
                        color: selectedIssues.includes(issue)
                          ? "#fff"
                          : "var(--text-secondary)",
                        cursor: "pointer",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "11px",
                      }}
                    >
                      {issue}
                    </button>
                  ))}
                </div>
                <button
                  onClick={submitIssues}
                  style={{
                    alignSelf: "flex-start",
                    padding: "6px 14px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "var(--gold)",
                    color: "#fff",
                    cursor: "pointer",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                  }}
                >
                  提交反馈
                </button>
              </div>
            )}
            {feedbackState === "done" && (
              <p
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                }}
              >
                感谢反馈！将用于优化推荐 ✓
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
