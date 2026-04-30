"use client";

/**
 * ScenarioProposalChatCard — inline card for non-trip multi-party rooms
 * (restaurant / hotel / flight / activity).
 *
 * Mounts when the chat-replay or live synthesize handler sets a
 * `scenario` proposalId. Fetches the proposal via /api/rooms/[id]/state,
 * reads content_json.cards, and renders the existing solo-flow card
 * components — so every member sees the SAME card list (LLM ran once
 * server-side; this row is the single source of truth).
 *
 * Phase 2: render-only. Phase 3 will add per-card voting buttons that
 * post to /api/rooms/[id]/proposals/[pid]/vote with optionId=card.id.
 */

import { useEffect, useState } from "react";
import type {
  HotelRecommendationCard,
  FlightRecommendationCard,
  RecommendationCard as RestaurantRecommendationCard,
  ActivityRecommendationCard,
} from "@/lib/types";
import HotelCard from "@/components/HotelCard";
import FlightCard from "@/components/FlightCard";
import ActivityCard from "@/components/ActivityCard";
import RecommendationCard from "@/components/RecommendationCard";

export interface ScenarioProposalChatCardProps {
  roomId: string;
  proposalId: string;
  userId: string | null;
}

interface RoomStateResponse {
  proposals?: Array<{
    id: string;
    content_json: Record<string, unknown>;
    status: string;
  }>;
}

/**
 * Server-side content_json shape (see scenario-synthesis.ts pickCards).
 * cards[] is typed by category — runtime cast at render time.
 */
interface ScenarioProposalContent {
  kind: "scenario_search_cards";
  category: "restaurant" | "hotel" | "flight" | "activity";
  cards: unknown[];
  query?: string;
  output_language?: "en" | "zh";
  contributor_count?: number;
  member_count?: number;
}

function isScenarioProposal(content: unknown): content is ScenarioProposalContent {
  return (
    !!content &&
    typeof content === "object" &&
    (content as Record<string, unknown>).kind === "scenario_search_cards"
  );
}

export default function ScenarioProposalChatCard({
  roomId,
  proposalId,
}: ScenarioProposalChatCardProps) {
  const [content, setContent] = useState<ScenarioProposalContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/state`);
        if (!res.ok) {
          if (!cancelled) {
            setError("无法加载方案");
            setLoading(false);
          }
          return;
        }
        const body = (await res.json()) as RoomStateResponse;
        const proposal = body.proposals?.find((p) => p.id === proposalId) ?? null;
        if (cancelled) return;
        if (!proposal) {
          setError("方案不存在或已过期");
          setLoading(false);
          return;
        }
        if (!isScenarioProposal(proposal.content_json)) {
          setError("方案格式不识别");
          setLoading(false);
          return;
        }
        setContent(proposal.content_json);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("网络错误");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, proposalId]);

  if (loading) {
    return (
      <div
        style={{
          padding: 12,
          color: "var(--text-secondary, #666)",
          fontSize: 13,
        }}
      >
        加载方案中...
      </div>
    );
  }

  if (error || !content) {
    return (
      <div
        style={{
          padding: 12,
          color: "var(--text-secondary, #999)",
          fontSize: 13,
        }}
      >
        {error ?? "方案不可用"}
      </div>
    );
  }

  if (content.cards.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 13, color: "var(--text-secondary)" }}>
        方案为空。
      </div>
    );
  }

  // Phase 3 will wrap each card with a vote button + tally badge.
  if (content.category === "restaurant") {
    const cards = content.cards as RestaurantRecommendationCard[];
    return (
      <div className="flex flex-col gap-3">
        {cards.map((card, i) => (
          <RecommendationCard
            key={card.restaurant?.id ?? `r-${i}`}
            card={card}
            index={i}
            isFavorite={false}
            onToggleFavorite={() => {}}
          />
        ))}
      </div>
    );
  }

  if (content.category === "hotel") {
    const cards = content.cards as HotelRecommendationCard[];
    return (
      <div className="flex flex-col gap-3">
        {cards.map((card, i) => (
          <HotelCard key={card.hotel?.id ?? `h-${i}`} card={card} index={i} />
        ))}
      </div>
    );
  }

  if (content.category === "flight") {
    const cards = content.cards as FlightRecommendationCard[];
    return (
      <div className="flex flex-col gap-3">
        {cards.map((card, i) => (
          <FlightCard
            key={card.flight?.id ?? `f-${i}`}
            card={card}
            index={i}
            hideBookingActions
          />
        ))}
      </div>
    );
  }

  if (content.category === "activity") {
    const cards = content.cards as ActivityRecommendationCard[];
    return (
      <div className="flex flex-col gap-3">
        {cards.map((card, i) => (
          <ActivityCard
            key={`${card.activity?.id ?? i}-${card.group ?? ""}`}
            card={card}
            index={i}
            hideBookingActions
          />
        ))}
      </div>
    );
  }

  return null;
}
