"use client";

/**
 * ScenarioProposalChatCard — inline card for non-trip multi-party rooms
 * (restaurant / hotel / flight / activity).
 *
 * Mounts when the chat-replay or live synthesize handler sets a
 * `scenario` proposalId. Both members read the same proposal row so the
 * card list is identical (LLM ran once server-side; this row is the
 * single source of truth).
 *
 * Phase 3: per-card "我选这个" vote button + tally badge + winner
 * highlight when the room's approval rule (majority for non-trip rooms)
 * is satisfied.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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

const POLL_INTERVAL_MS = 5000;

export interface ScenarioProposalChatCardProps {
  roomId: string;
  proposalId: string;
  userId: string | null;
}

interface OptionEntry {
  id: string;
  card: unknown;
}

interface ScenarioProposalContent {
  kind: "scenario_search_cards";
  category: "restaurant" | "hotel" | "flight" | "activity";
  options: OptionEntry[];
}

interface VoteRow {
  user_id: string;
  vote: string;
  option_id: string | null;
}

interface ProposalWithVotes {
  id: string;
  status: string;
  content_json: Record<string, unknown>;
  votes: VoteRow[];
}

interface RoomStateResponse {
  proposals?: ProposalWithVotes[];
  members?: Array<{ user_id: string; status: string }>;
}

function isScenarioProposal(content: unknown): content is ScenarioProposalContent {
  if (!content || typeof content !== "object") return false;
  const c = content as Record<string, unknown>;
  return c.kind === "scenario_search_cards" && Array.isArray(c.options);
}

/** Vote tally per option_id — only `approve` votes count. */
function tallyByOption(votes: VoteRow[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const v of votes) {
    if (v.vote !== "approve" || !v.option_id) continue;
    if (!m.has(v.option_id)) m.set(v.option_id, new Set());
    m.get(v.option_id)!.add(v.user_id);
  }
  return m;
}

export default function ScenarioProposalChatCard({
  roomId,
  proposalId,
  userId,
}: ScenarioProposalChatCardProps) {
  const [proposal, setProposal] = useState<ProposalWithVotes | null>(null);
  const [joinedCount, setJoinedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/state`);
      if (!res.ok) {
        setError("无法加载方案");
        setLoading(false);
        return;
      }
      const body = (await res.json()) as RoomStateResponse;
      const p = body.proposals?.find((x) => x.id === proposalId) ?? null;
      if (!p) {
        setError("方案不存在或已过期");
        setLoading(false);
        return;
      }
      setProposal(p);
      const joined = (body.members ?? []).filter((m) => m.status === "joined").length;
      setJoinedCount(joined);
      setError(null);
      setLoading(false);
    } catch {
      setError("网络错误");
      setLoading(false);
    }
  }, [roomId, proposalId]);

  // Initial fetch + lightweight poll so member B sees A's votes appear
  // without manual refresh. 5s is enough for "feel" responsiveness while
  // staying gentle on the server.
  useEffect(() => {
    let cancelled = false;
    refetch();
    const handle = setInterval(() => {
      if (!cancelled) refetch();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [refetch]);

  const content = useMemo<ScenarioProposalContent | null>(() => {
    if (!proposal) return null;
    return isScenarioProposal(proposal.content_json) ? proposal.content_json : null;
  }, [proposal]);

  const tally = useMemo(() => tallyByOption(proposal?.votes ?? []), [proposal]);

  const myVote = useMemo<string | null>(() => {
    if (!proposal || !userId) return null;
    const mine = proposal.votes.find((v) => v.user_id === userId && v.vote === "approve");
    return mine?.option_id ?? null;
  }, [proposal, userId]);

  /** Winner = option whose approver count strictly > N/2 (majority rule).
   *  For 2-member rooms server falls back to unanimous, so this matches
   *  when both members picked the same option (count===2, N===2). */
  const winnerId = useMemo<string | null>(() => {
    if (joinedCount <= 0) return null;
    let best: { id: string; count: number } | null = null;
    for (const [id, voters] of tally.entries()) {
      const count = voters.size;
      if (count * 2 > joinedCount && (!best || count > best.count)) {
        best = { id, count };
      }
    }
    return best?.id ?? null;
  }, [tally, joinedCount]);

  const handleVote = useCallback(
    async (optionId: string) => {
      if (busyOptionId) return;
      setBusyOptionId(optionId);
      try {
        const res = await fetch(`/api/rooms/${roomId}/proposals/${proposalId}/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote: "approve", option_id: optionId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "投票失败");
        }
        await refetch();
      } catch {
        setError("网络错误");
      } finally {
        setBusyOptionId(null);
      }
    },
    [busyOptionId, roomId, proposalId, refetch],
  );

  if (loading) {
    return (
      <div style={{ padding: 12, color: "var(--text-secondary, #666)", fontSize: 13 }}>
        加载方案中...
      </div>
    );
  }

  if (error || !content || content.options.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--text-secondary, #999)", fontSize: 13 }}>
        {error ?? "方案为空"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {content.options.map((opt, i) => {
        const voters = tally.get(opt.id) ?? new Set<string>();
        const voteCount = voters.size;
        const iVoted = myVote === opt.id;
        const isWinner = winnerId === opt.id;
        return (
          <CardOptionWrapper
            key={opt.id}
            voteCount={voteCount}
            iVoted={iVoted}
            isWinner={isWinner}
            busy={busyOptionId === opt.id}
            disabled={!!busyOptionId}
            onVote={() => handleVote(opt.id)}
            joinedCount={joinedCount}
          >
            {renderCardByCategory(content.category, opt.card, i)}
          </CardOptionWrapper>
        );
      })}
    </div>
  );
}

function renderCardByCategory(
  category: ScenarioProposalContent["category"],
  card: unknown,
  index: number,
) {
  // Booking actions stay hidden everywhere — DR cards must wait for the
  // vote winner + payer confirm before any booking fires. (Phase 4 will
  // surface a single "为大家预订" button to the payer once the room
  // accepts a winning option.)
  if (category === "restaurant") {
    const c = card as RestaurantRecommendationCard;
    return (
      <RecommendationCard
        card={c}
        index={index}
        isFavorite={false}
        onToggleFavorite={() => {}}
        hideBookingActions
      />
    );
  }
  if (category === "hotel") {
    return (
      <HotelCard
        card={card as HotelRecommendationCard}
        index={index}
        hideBookingActions
      />
    );
  }
  if (category === "flight") {
    return (
      <FlightCard
        card={card as FlightRecommendationCard}
        index={index}
        hideBookingActions
      />
    );
  }
  if (category === "activity") {
    return (
      <ActivityCard
        card={card as ActivityRecommendationCard}
        index={index}
        hideBookingActions
      />
    );
  }
  return null;
}

interface CardOptionWrapperProps {
  voteCount: number;
  iVoted: boolean;
  isWinner: boolean;
  busy: boolean;
  disabled: boolean;
  onVote: () => void;
  joinedCount: number;
  children: React.ReactNode;
}

function CardOptionWrapper({
  voteCount,
  iVoted,
  isWinner,
  busy,
  disabled,
  onVote,
  joinedCount,
  children,
}: CardOptionWrapperProps) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        border: isWinner
          ? "2px solid #c9a84c"
          : iVoted
            ? "2px solid rgba(201,168,76,0.55)"
            : "1px solid transparent",
        boxShadow: isWinner ? "0 0 0 4px rgba(201,168,76,0.18)" : undefined,
        transition: "border-color 200ms ease, box-shadow 200ms ease",
      }}
    >
      {children}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px 12px",
          gap: 12,
          fontSize: 13,
          fontFamily: "var(--font-dm-sans)",
        }}
      >
        <div style={{ color: "var(--text-secondary, #666)" }}>
          {voteCount > 0
            ? `${voteCount} / ${joinedCount} 票${isWinner ? " · 多数派胜出" : ""}`
            : "还没有人投票"}
        </div>
        <button
          type="button"
          onClick={onVote}
          disabled={disabled}
          style={{
            padding: "8px 18px",
            borderRadius: 999,
            border: iVoted ? "1px solid #1a1a1a" : "1px solid #c9a84c",
            background: iVoted ? "#1a1a1a" : "#c9a84c",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.2,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
            transition: "background-color 200ms ease, border-color 200ms ease",
            boxShadow: iVoted
              ? "0 1px 2px rgba(0,0,0,0.18)"
              : "0 1px 2px rgba(201,168,76,0.35)",
          }}
        >
          {iVoted ? "✓ 已选" : "我选这个"}
        </button>
      </div>
    </div>
  );
}
