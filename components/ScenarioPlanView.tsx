"use client";

import { useState, useRef } from "react";
import ScenarioBrief from "@/components/ScenarioBrief";
import ActionRail from "@/components/ActionRail";
import ScenarioEvidencePanel from "@/components/ScenarioEvidencePanel";
import { AutopilotRunnerModal } from "@/components/AutopilotRunnerModal";
import type { BookableStep } from "@/components/AutopilotRunnerModal";
import { buildPlanFeedbackCopy, getScenarioUiCopy } from "@/lib/outputCopy";
import { loadAutonomySettings } from "@/lib/autonomy";
import type {
  DecisionPlan,
  PlanAction,
  PlanLinkAction,
  PlanOption,
  ScenarioTelemetryEventType,
} from "@/lib/types";

// ── Component type parsing ──────────────────────────────────────────────────

type ComponentType = "flight" | "hotel" | "restaurant" | "card" | "other";

const COMPONENT_EMOJI: Record<ComponentType, string> = {
  flight: "✈",
  hotel: "🏨",
  restaurant: "🍽",
  card: "💳",
  other: "•",
};

const COMPONENT_LABEL: Record<ComponentType, string> = {
  flight: "Flight",
  hotel: "Hotel",
  restaurant: "Restaurant",
  card: "Card",
  other: "Included",
};

function detectType(text: string): ComponentType {
  const lower = text.toLowerCase();
  if (
    lower.includes("->") ||
    lower.includes("→") ||
    /\b(delta|united|american|southwest|frontier|jetblue|spirit|alaska|lufthansa|emirates|air canada)\b/i.test(text)
  )
    return "flight";
  if (
    lower.includes("/night") ||
    /\b(hotel|inn|suites|resort|hostel|motel|lodge|marriott|hilton|hyatt|westin|sheraton|ritz|four seasons|kimpton|freehand|omni|intercontinental|doubletree)\b/i.test(
      text
    )
  )
    return "hotel";
  if (
    /\b(mastercard|visa|amex|american express|chase|citi|bilt|capital one|discover|card)\b/i.test(
      text
    )
  )
    return "card";
  if (
    /\b(restaurant|dining|chinese|cuisine|bistro|cafe|bar|grill|sushi|ramen|dim sum|bbq|eatery|kitchen)\b/i.test(
      text
    )
  )
    return "restaurant";
  return "other";
}

interface ParsedComponent {
  type: ComponentType;
  text: string;
}

/**
 * Generate adjacent time slots for restaurant bookings.
 * The agent will try these automatically before switching venues.
 * baseTime: "HH:MM" (24h). Returns up to 6 fallbacks within 11:00–22:00.
 */
function generateTimeFallbacks(baseTime: string): string[] {
  const [h, m] = baseTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return [];
  const base = h * 60 + m;
  // Try ±30, ±60, ±90 minutes — ordered by proximity
  const deltas = [30, -30, 60, -60, 90, -90];
  return deltas
    .map((d) => {
      const t = base + d;
      if (t < 11 * 60 || t > 22 * 60) return null;
      const hh = Math.floor(t / 60).toString().padStart(2, "0");
      const mm = (t % 60).toString().padStart(2, "0");
      return `${hh}:${mm}`;
    })
    .filter(Boolean) as string[];
}

/** Extract the venue name from a component text before the first bullet/dash/colon separator. */
function extractVenueName(text: string): string {
  return text.split(/[•·\-–—:|,]/)[0].trim();
}

/**
 * Extract IATA origin and destination from a flight highlight string.
 * Handles formats like:
 *   "Delta BNA -> LAX, 4h 42m, nonstop."
 *   "BNA → LAX nonstop"
 *   "Nashville (BNA) to Los Angeles (LAX)"
 */
function extractFlightRoute(text: string): { origin: string; dest: string } | null {
  // Match explicit IATA arrow format: BNA -> LAX or BNA → LAX
  const arrowMatch = text.match(/\b([A-Z]{3})\s*[-–→>]+\s*([A-Z]{3})\b/);
  if (arrowMatch) return { origin: arrowMatch[1], dest: arrowMatch[2] };
  // Match parenthetical format: (BNA) ... (LAX)
  const parenMatches = [...text.matchAll(/\(([A-Z]{3})\)/g)];
  if (parenMatches.length >= 2) {
    return { origin: parenMatches[0][1], dest: parenMatches[1][1] };
  }
  return null;
}

function parseComponents(highlights: string[]): ParsedComponent[] {
  const seen = new Set<ComponentType>();
  const result: ParsedComponent[] = [];
  for (const text of highlights) {
    const type = detectType(text);
    if (!seen.has(type)) {
      seen.add(type);
      result.push({ type, text });
    } else if (type === "other") {
      result.push({ type, text });
    }
  }
  return result;
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  plan: DecisionPlan;
  planFeedbackMessage: string | null;
  onAction: (action: PlanAction) => void;
  onLinkClick: (action: PlanLinkAction, optionId: string) => void;
  trackDecisionPlanEvent: (params: {
    type: ScenarioTelemetryEventType;
    option_id?: string;
    action_id?: string;
    metadata?: Record<string, unknown>;
    query?: string;
  }) => void;
  swapDecisionPlanOption: (optionId: string) => void;
  setPlanFeedbackMessage: (msg: string | null) => void;
  lastUserQuery: string;
}

// A selection maps component type → { planIndex, text }
type Selection = Record<string, { planIndex: number; text: string } | null>;

function initSelections(primaryPlan: PlanOption): Selection {
  const sel: Selection = {};
  for (const comp of parseComponents(primaryPlan.highlights)) {
    if (!sel[comp.type]) {
      sel[comp.type] = { planIndex: 0, text: comp.text };
    }
  }
  return sel;
}

export default function ScenarioPlanView({
  plan,
  planFeedbackMessage,
  onAction,
  onLinkClick,
  trackDecisionPlanEvent,
  swapDecisionPlanOption,
  setPlanFeedbackMessage,
  lastUserQuery,
}: Props) {
  const scenarioCopy = getScenarioUiCopy(plan.output_language);
  const allPlans = [plan.primary_plan, ...plan.backup_plans];

  const [activeIndex, setActiveIndex] = useState(0);
  const [selections, setSelections] = useState<Selection>(() =>
    initSelections(plan.primary_plan)
  );
  const [myPlanBuilt, setMyPlanBuilt] = useState(false);
  const [autopilotRunnerOpen, setAutopilotRunnerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Scroll helpers ──────────────────────────────────────
  const scrollToCard = (index: number) => {
    setActiveIndex(index);
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) {
      const index = Math.round(el.scrollLeft / el.clientWidth);
      if (index !== activeIndex) setActiveIndex(index);
    }
  };

  // ── Selection helpers ────────────────────────────────────
  const toggleComponent = (
    type: ComponentType,
    planIndex: number,
    text: string
  ) => {
    setMyPlanBuilt(false);
    setSelections((prev) => {
      const cur = prev[type];
      if (cur?.planIndex === planIndex && cur?.text === text) {
        return { ...prev, [type]: null };
      }
      return { ...prev, [type]: { planIndex, text } };
    });
  };

  // ── Assembled trip ──────────────────────────────────────
  const componentOrder: ComponentType[] = [
    "flight",
    "hotel",
    "restaurant",
    "card",
    "other",
  ];

  const assembled = componentOrder
    .map((type) => {
      const sel = selections[type];
      if (!sel) return null;
      return { type, emoji: COMPONENT_EMOJI[type], text: sel.text, planIndex: sel.planIndex };
    })
    .filter(Boolean) as {
    type: ComponentType;
    emoji: string;
    text: string;
    planIndex: number;
  }[];

  const planIndicesUsed = [...new Set(assembled.map((c) => c.planIndex))];
  const isCustomMix = planIndicesUsed.length > 1;
  const isSinglePlan = !isCustomMix && planIndicesUsed.length === 1;

  const handleMakePlan = () => {
    if (isSinglePlan) {
      const usedIndex = planIndicesUsed[0];
      if (usedIndex > 0) {
        trackDecisionPlanEvent({
          type: "backup_promoted",
          option_id: allPlans[usedIndex].id,
          query: lastUserQuery,
        });
        setPlanFeedbackMessage(
          buildPlanFeedbackCopy(
            plan.output_language,
            "promoted",
            allPlans[usedIndex].title
          )
        );
        swapDecisionPlanOption(allPlans[usedIndex].id);
        scrollToCard(0);
      }
    } else {
      // Custom mix — build a summary message
      const lines = assembled.map(
        (c) => `${c.emoji} ${c.text} (from Plan ${c.planIndex + 1})`
      );
      setPlanFeedbackMessage(
        `Your custom mix:\n${lines.join("\n")}`
      );
    }
    setMyPlanBuilt(true);
  };

  // ── Build autopilot steps from assembled components ─────
  const autopilotSteps: BookableStep[] = (() => {
    const ctx = plan.autopilot_context;
    if (!ctx) return [];
    const steps: BookableStep[] = [];

    // Collect all backup-plan alternatives per component type so the recovery
    // engine can try them if the primary fails.
    const backupsByType: Record<string, string[]> = {};
    for (const bp of plan.backup_plans ?? []) {
      for (const bc of parseComponents(bp.highlights)) {
        if (!backupsByType[bc.type]) backupsByType[bc.type] = [];
        backupsByType[bc.type].push(bc.text);
      }
    }

    for (const comp of assembled) {
      if (comp.type === "flight") {
        const route = extractFlightRoute(comp.text);
        if (!route) continue;
        const orig = route.origin.toUpperCase();
        const dest = route.dest.toUpperCase();
        const pax = ctx.travelers ?? 1;
        const kayakUrl = ctx.start_date && ctx.end_date
          ? `https://www.kayak.com/flights/${orig}-${dest}/${ctx.start_date}/${ctx.end_date}/${pax}adults/economy`
          : ctx.start_date
          ? `https://www.kayak.com/flights/${orig}-${dest}/${ctx.start_date}/${pax}adults/economy`
          : `https://www.kayak.com/flights/${orig}-${dest}`;
        steps.push({
          type: "flight",
          emoji: "✈",
          label: `${orig} → ${dest}`,
          apiEndpoint: "/api/booking-autopilot/universal",
          body: {
            origin: route.origin,
            dest: route.dest,
            date: ctx.start_date ?? new Date().toISOString().slice(0, 10),
            returnDate: ctx.end_date,
            passengers: pax,
          },
          fallbackUrl: kayakUrl,
          // Flights rarely have backup alternatives in the same type, skip
        });
      } else if (comp.type === "hotel") {
        const name = extractVenueName(comp.text);
        const backupHotels = (backupsByType["hotel"] ?? [])
          .filter((t) => extractVenueName(t) !== name)
          .slice(0, 2)
          .map((t) => {
            const bName = extractVenueName(t);
            return {
              label: bName,
              body: {
                hotel_name: bName,
                city: ctx.city ?? "",
                checkin: ctx.start_date ?? "",
                checkout: ctx.end_date ?? "",
                adults: ctx.travelers ?? 2,
              },
              fallbackUrl: `https://www.booking.com/search.html?ss=${encodeURIComponent(bName + " " + (ctx.city ?? ""))}`,
            };
          });
        steps.push({
          type: "hotel",
          emoji: "🏨",
          label: name,
          apiEndpoint: "/api/booking-autopilot/universal",
          body: {
            hotel_name: name,
            city: ctx.city ?? "",
            checkin: ctx.start_date ?? "",
            checkout: ctx.end_date ?? "",
            adults: ctx.travelers ?? 2,
          },
          fallbackUrl: `https://www.booking.com/search.html?ss=${encodeURIComponent(ctx.city ?? name)}`,
          fallbackCandidates: backupHotels.length > 0 ? backupHotels : undefined,
        });
      } else if (comp.type === "restaurant") {
        const name = extractVenueName(comp.text);
        const backupRestaurants = (backupsByType["restaurant"] ?? [])
          .filter((t) => extractVenueName(t) !== name)
          .slice(0, 2)
          .map((t) => {
            const bName = extractVenueName(t);
            return {
              label: bName,
              body: {
                restaurant_name: bName,
                city: ctx.city ?? "",
                date: ctx.start_date ?? new Date().toISOString().slice(0, 10),
                time: ctx.time_hint ?? "19:00",
                covers: ctx.travelers ?? 2,
              },
              fallbackUrl: `https://www.opentable.com/s?term=${encodeURIComponent(bName)}`,
            };
          });
        steps.push({
          type: "restaurant",
          emoji: "🍽",
          label: name,
          apiEndpoint: "/api/booking-autopilot/universal",
          body: {
            restaurant_name: name,
            city: ctx.city ?? "",
            date: ctx.start_date ?? new Date().toISOString().slice(0, 10),
            time: ctx.time_hint ?? "19:00",
            covers: ctx.travelers ?? 2,
          },
          fallbackUrl: `https://www.opentable.com/s?term=${encodeURIComponent(name)}`,
          fallbackCandidates: backupRestaurants.length > 0 ? backupRestaurants : undefined,
          timeFallbacks: generateTimeFallbacks(ctx.time_hint ?? "19:00"),
        });
      }
    }
    return steps;
  })();

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <ScenarioBrief plan={plan} />

      {planFeedbackMessage && (
        <div
          style={{
            borderRadius: "14px",
            backgroundColor: "rgba(212,163,75,0.12)",
            border: "0.5px solid rgba(212,163,75,0.25)",
            padding: "12px 14px",
            fontFamily: "var(--font-dm-sans)",
            fontSize: "13px",
            color: "var(--text-primary)",
            whiteSpace: "pre-line",
          }}
        >
          {planFeedbackMessage}
        </div>
      )}

      {/* ── Header row ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          {allPlans.length > 1
            ? `Plan ${activeIndex + 1} of ${allPlans.length} · swipe or pick components`
            : "Your plan"}
        </p>
        {allPlans.length > 1 && (
          <div style={{ display: "flex", gap: "6px" }}>
            {[
              { dir: -1, label: "‹" },
              { dir: 1, label: "›" },
            ].map(({ dir, label }) => {
              const next = activeIndex + dir;
              const disabled = next < 0 || next >= allPlans.length;
              return (
                <button
                  key={label}
                  onClick={() => !disabled && scrollToCard(next)}
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    border: "0.5px solid var(--border)",
                    background: disabled ? "transparent" : "var(--card-2)",
                    color: disabled ? "var(--text-muted)" : "var(--text-primary)",
                    cursor: disabled ? "default" : "pointer",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Swipeable plan cards ────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="hide-scrollbar"
        style={{
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {allPlans.map((option, planIdx) => {
          const components = parseComponents(option.highlights);
          const isRecommended = planIdx === 0 && plan.confidence === "high";

          return (
            <div
              key={option.id}
              style={{
                flex: "0 0 100%",
                minWidth: 0,
                scrollSnapAlign: "start",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background:
                    planIdx === 0
                      ? "linear-gradient(180deg, rgba(212,163,75,0.10) 0%, rgba(255,255,255,0) 100%), var(--card)"
                      : "var(--card)",
                  borderRadius: "20px",
                  border:
                    planIdx === 0
                      ? isRecommended
                        ? "0.5px solid rgba(22,163,74,0.3)"
                        : "0.5px solid rgba(212,163,75,0.35)"
                      : "0.5px solid var(--border)",
                  padding: "18px",
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}
              >
                {/* Card header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "10px",
                    marginBottom: "14px",
                  }}
                >
                  {/* Title area — must shrink when price badge needs space */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: isRecommended
                          ? "rgba(22,163,74,0.9)"
                          : "var(--gold)",
                        marginBottom: "4px",
                      }}
                    >
                      {isRecommended ? "✓ Recommended" : option.label}
                    </p>
                    <h3
                      style={{
                        fontFamily: "var(--font-playfair)",
                        fontSize: "20px",
                        lineHeight: 1.2,
                        color: "var(--text-primary)",
                        marginBottom: "2px",
                        wordBreak: "break-word",
                      }}
                    >
                      {option.title}
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        wordBreak: "break-word",
                      }}
                    >
                      {option.best_for}
                    </p>
                  </div>
                  {/* Price badge — fixed width, never shrinks */}
                  <div
                    style={{
                      borderRadius: "12px",
                      backgroundColor: "var(--card-2)",
                      padding: "8px 10px",
                      textAlign: "right",
                      flexShrink: 0,
                      minWidth: "72px",
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "10px",
                        color: "var(--text-muted)",
                        marginBottom: "2px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      Est.
                    </p>
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {option.estimated_total}
                    </p>
                  </div>
                </div>

                {/* Component selector rows */}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: "8px" }}
                >
                  {components.map((comp, ci) => {
                    const sel = selections[comp.type];
                    const isSelected =
                      sel?.planIndex === planIdx && sel?.text === comp.text;
                    const isOtherPlanSelected =
                      sel && (sel.planIndex !== planIdx || sel.text !== comp.text);

                    return (
                      <div
                        key={`${comp.type}-${ci}`}
                        onClick={() => toggleComponent(comp.type, planIdx, comp.text)}
                        style={{
                          borderRadius: "12px",
                          border: isSelected
                            ? "0.5px solid var(--gold)"
                            : "0.5px solid var(--border)",
                          backgroundColor: isSelected
                            ? "rgba(212,163,75,0.08)"
                            : "var(--card-2)",
                          padding: "10px 12px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          overflow: "hidden",
                          cursor: "pointer",
                          transition: "background-color 0.15s, border-color 0.15s",
                        }}
                      >
                        {/* Selection indicator */}
                        <span
                          style={{
                            flexShrink: 0,
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            border: isSelected ? "none" : "1px solid var(--border)",
                            backgroundColor: isSelected ? "var(--gold)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            color: "#fff",
                            transition: "all 0.15s",
                          }}
                        >
                          {isSelected ? "✓" : ""}
                        </span>

                        {/* Emoji */}
                        <span style={{ flexShrink: 0, fontSize: "14px" }}>
                          {COMPONENT_EMOJI[comp.type]}
                        </span>

                        {/* Label + text */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: "10px",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              color: "var(--text-muted)",
                              marginBottom: "2px",
                            }}
                          >
                            {COMPONENT_LABEL[comp.type]}
                          </p>
                          <p
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: "12px",
                              color: isOtherPlanSelected
                                ? "var(--text-muted)"
                                : "var(--text-primary)",
                              lineHeight: 1.4,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {comp.text}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Primary action link */}
                {option.primary_action && (
                  <a
                    href={option.primary_action.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      trackDecisionPlanEvent({
                        type: "action_clicked",
                        option_id: option.id,
                        query: lastUserQuery,
                      });
                      onLinkClick(option.primary_action!, option.id);
                    }}
                    style={{
                      display: "inline-block",
                      marginTop: "12px",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "12px",
                      color: "var(--gold)",
                      textDecoration: "none",
                    }}
                  >
                    {option.primary_action.label} →
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Dot indicators ─────────────────────────────────── */}
      {allPlans.length > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {allPlans.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollToCard(i)}
              style={{
                width: i === activeIndex ? "24px" : "6px",
                height: "6px",
                borderRadius: "3px",
                backgroundColor:
                  i === activeIndex ? "var(--gold)" : "var(--border)",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s ease",
                padding: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* ── My Trip builder ─────────────────────────────────── */}
      {assembled.length > 0 && (
        <div
          style={{
            borderRadius: "18px",
            border: isCustomMix
              ? "0.5px solid var(--gold)"
              : "0.5px solid var(--border)",
            backgroundColor: isCustomMix
              ? "rgba(212,163,75,0.06)"
              : "var(--card)",
            padding: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: isCustomMix ? "var(--gold)" : "var(--text-muted)",
                  marginBottom: "2px",
                }}
              >
                {isCustomMix ? "✨ Custom mix" : "My Trip"}
              </p>
              {isCustomMix && (
                <p
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "11px",
                    color: "var(--text-secondary)",
                  }}
                >
                  Components from {planIndicesUsed.length} different plans
                </p>
              )}
            </div>
          </div>

          {/* Assembled components list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
            {componentOrder.map((type) => {
              const sel = selections[type];
              const found = assembled.find((a) => a.type === type);
              if (!found && !sel) {
                // Check if any plan has this component type — if not, skip
                const anyPlanHas = allPlans.some((p) =>
                  parseComponents(p.highlights).some((c) => c.type === type)
                );
                if (!anyPlanHas) return null;
              }

              return (
                <div
                  key={type}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "14px",
                      flexShrink: 0,
                      marginTop: "1px",
                    }}
                  >
                    {COMPONENT_EMOJI[type]}
                  </span>
                  <div style={{ flex: 1 }}>
                    {found ? (
                      <>
                        <p
                          style={{
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                            lineHeight: 1.4,
                          }}
                        >
                          {found.text}
                        </p>
                        {isCustomMix && (
                          <p
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: "10px",
                              color: "var(--gold)",
                            }}
                          >
                            Plan {found.planIndex + 1}
                            {found.planIndex === 0 ? " (Recommended)" : found.planIndex === 1 ? " (Cheapest)" : " (Best exp.)"}
                          </p>
                        )}
                      </>
                    ) : (
                      <p
                        style={{
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: "12px",
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        None selected — swipe to add one
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Before action: trust signals ──────────────────────────────
               Shown when the plan has bookable steps, before the user
               approves. Tells them exactly what the agent can change.    */}
          {autopilotSteps.length > 0 && !myPlanBuilt && (() => {
            const a = loadAutonomySettings();
            const signals: string[] = [];
            const hasRestaurant = autopilotSteps.some((s) => s.type === "restaurant");
            const hasHotel      = autopilotSteps.some((s) => s.type === "hotel");
            const hasFlight     = autopilotSteps.some((s) => s.type === "flight");
            if (hasRestaurant && a.restaurant.timeWindowMinutes > 0)
              signals.push(`Shift restaurant time ±${a.restaurant.timeWindowMinutes} min`);
            if (hasRestaurant && a.restaurant.allowVenueSwitch)
              signals.push("Switch to backup restaurants if unavailable");
            if (hasHotel && a.hotel.allowAreaSwitch)
              signals.push("Try nearby area hotels if first choice is full");
            if (hasFlight && a.flight.allowLayover)
              signals.push("Try 1-stop flights when no direct available");
            if (signals.length === 0) return null;
            return (
              <div style={{
                padding: "10px 12px", borderRadius: 10, marginBottom: 8,
                background: "rgba(74,154,74,0.05)", border: "0.5px solid rgba(74,154,74,0.2)",
              }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, fontWeight: 700,
                  color: "rgba(74,154,74,0.8)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>
                  {plan.output_language === "zh" ? "Agent 自动调整范围" : "Agent can adjust automatically"}
                </p>
                {signals.map((s) => (
                  <p key={s} style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11,
                    color: "var(--text-secondary, #666)", marginBottom: 2, display: "flex", gap: 5 }}>
                    <span style={{ color: "rgba(74,154,74,0.7)", flexShrink: 0 }}>✓</span>{s}
                  </p>
                ))}
              </div>
            );
          })()}

          {/* Make this my plan CTA */}
          {!myPlanBuilt ? (
            <button
              onClick={() => {
                handleMakePlan();
                if (autopilotSteps.length > 0) setAutopilotRunnerOpen(true);
              }}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: "12px",
                border: "none",
                backgroundColor: "var(--gold)",
                color: "#fff",
                cursor: "pointer",
                fontFamily: "var(--font-dm-sans)",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              {plan.output_language === "zh"
                ? "确认这个方案 →"
                : autopilotSteps.length > 0
                ? "Make this my plan — book everything →"
                : "Make this my plan →"}
            </button>
          ) : (
            <button
              onClick={() => setAutopilotRunnerOpen(true)}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: "12px",
                border: "0.5px solid var(--gold)",
                backgroundColor: "transparent",
                color: "var(--gold)",
                cursor: "pointer",
                fontFamily: "var(--font-dm-sans)",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              {plan.output_language === "zh" ? "查看预订进度 →" : "View booking progress →"}
            </button>
          )}
        </div>
      )}

      {/* ── Plan-level info for the active card ────────────── */}
      <div
        style={{
          borderRadius: "14px",
          backgroundColor: "var(--card-2)",
          padding: "14px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            marginBottom: "6px",
          }}
        >
          Why Plan {activeIndex + 1}
        </p>
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "13px",
            lineHeight: 1.6,
            color: "var(--text-primary)",
            marginBottom: "6px",
          }}
        >
          {allPlans[activeIndex].summary}
        </p>
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "12px",
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          {allPlans[activeIndex].timing_note}
        </p>
      </div>

      {/* ── Trip card callout ───────────────────────────────── */}
      {plan.trip_card_callout && (
        <div
          style={{
            borderRadius: "12px",
            backgroundColor: "rgba(30, 100, 200, 0.06)",
            border: "0.5px solid rgba(30, 100, 200, 0.18)",
            padding: "10px 14px",
            fontFamily: "var(--font-dm-sans)",
            fontSize: "12px",
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          💳 {plan.trip_card_callout}
        </div>
      )}

      {/* ── Tradeoff summary ────────────────────────────────── */}
      {plan.tradeoff_summary && (
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "13px",
            lineHeight: 1.65,
            color: "var(--text-secondary)",
            padding: "0 2px",
          }}
        >
          {plan.tradeoff_summary}
        </p>
      )}

      {/* ── Risks ───────────────────────────────────────────── */}
      {plan.risks.length > 0 && (
        <div
          style={{
            backgroundColor: "#FDF6EC",
            borderRadius: "18px",
            border: "0.5px solid rgba(232,160,32,0.35)",
            padding: "16px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#8B5E14",
              marginBottom: "10px",
            }}
          >
            {scenarioCopy.planRisks}
          </p>
          <div className="flex flex-col gap-2">
            {plan.risks.map((risk, index) => (
              <p
                key={`${plan.id}-risk-${index}`}
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  color: "#6B4A1A",
                }}
              >
                • {risk}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ── Action rail ─────────────────────────────────────── */}
      <ActionRail
        actions={plan.next_actions}
        language={plan.output_language}
        onAction={onAction}
      />

      {plan.show_more_available && (
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            textAlign: "center",
          }}
        >
          {plan.output_language === "zh"
            ? "还有更多选项可用 — 告诉我你的偏好，我可以为你精选更多方案"
            : "More options available — tell me your preferences and I can surface more"}
        </p>
      )}

      <ScenarioEvidencePanel plan={plan} />

      {/* Autopilot runner modal */}
      <AutopilotRunnerModal
        open={autopilotRunnerOpen}
        steps={autopilotSteps}
        tripLabel={plan.autopilot_context?.city ? `Trip to ${plan.autopilot_context.city}` : "My Trip"}
        onClose={() => setAutopilotRunnerOpen(false)}
      />
    </div>
  );
}
