/**
 * Decision Room proposal generator.
 *
 * Flattens each member's structured constraints into a natural-language clause,
 * routes to the right engine, and returns up to 3 options as a multi-choice
 * proposal. Members vote for their preferred option; acceptance follows the
 * room's `approval_rule` (unanimous = everyone picks the same option; majority
 * = one option's supporters exceed N/2).
 *
 *   N = 2 → `runAgentForTwoParty`  (pair-tuned MiniMax prompt)
 *   N ≥ 3 → `runAgentForNParty`    (group-tuned MiniMax prompt, Phase 2 B1)
 */

import { randomUUID } from "crypto";
import { runAgentForTwoParty } from "@/lib/agent/two-party";
import { runAgentForNParty } from "@/lib/agent/n-party";
import type { RecommendationCard } from "@/lib/types";
import type { DecisionRoom, DecisionRoomConstraintRow } from "@/lib/db";

export interface ProposalOption {
  id: string;
  card: RecommendationCard;
}

export interface ProposalGenerationResult {
  options: ProposalOption[];
  rationale: string;
  conflicts: Array<{ field: string; reason: string; affected_users: string[] }>;
}

/** Flatten a structured constraint object into a natural-language clause. */
export function constraintRowToText(row: DecisionRoomConstraintRow): string {
  const d = row.data_json as {
    budget_max?: number;
    cuisines_like?: string[];
    cuisines_dislike?: string[];
    dietary?: string[];
    vibe?: string;
    time_preference?: string;
    notes?: string;
  };
  const parts: string[] = [];
  if (typeof d.budget_max === "number") parts.push(`budget under $${d.budget_max} per person`);
  if (d.cuisines_like?.length) parts.push(`likes ${d.cuisines_like.join(", ")}`);
  if (d.cuisines_dislike?.length) parts.push(`avoids ${d.cuisines_dislike.join(", ")}`);
  if (d.dietary?.length) parts.push(`dietary: ${d.dietary.join(", ")}`);
  if (d.vibe) parts.push(`${d.vibe} vibe`);
  if (d.time_preference) parts.push(`time: ${d.time_preference}`);
  if (d.notes) parts.push(d.notes);
  return parts.join("; ") || "no specific constraints";
}

/**
 * Restaurant proposal. Requires at least 2 submitted constraints.
 * Returns up to 3 option cards for the group to pick from.
 */
export async function generateRestaurantProposal(
  room: DecisionRoom,
  constraints: DecisionRoomConstraintRow[]
): Promise<ProposalGenerationResult | null> {
  if (room.type !== "restaurant") {
    throw new Error(`generateRestaurantProposal: expected type=restaurant, got ${room.type}`);
  }

  const submitted = constraints.filter((c) => c.submitted);
  if (submitted.length < 2) return null;

  const ctx = room.context_json as { city_id?: string; city?: string };
  const cityId = ctx.city_id ?? ctx.city ?? "losangeles";

  let cards: RecommendationCard[] = [];
  let conflict = false;
  let conflictReason: string | undefined;
  let affectedUsers: string[] = [];
  let rationaleTail: string;

  if (submitted.length === 2) {
    const [a, b] = submitted;
    const aText = constraintRowToText(a);
    const bText = constraintRowToText(b);
    const result = await runAgentForTwoParty(aText, bText, cityId);
    cards = result.options;
    conflict = result.conflict;
    conflictReason = result.conflictReason;
    if (conflict) affectedUsers = submitted.map((s) => s.user_id);
    rationaleTail = `${aText} / ${bText}`;
  } else {
    const inputs = submitted.map((c) => ({
      userId: c.user_id,
      text: constraintRowToText(c),
    }));
    const result = await runAgentForNParty(inputs, cityId);
    cards = result.options;
    conflict = result.conflict;
    conflictReason = result.conflictReason;
    affectedUsers = conflict
      ? result.conflictAffectedUsers?.length
        ? result.conflictAffectedUsers
        : submitted.map((s) => s.user_id)
      : [];
    rationaleTail = inputs.map((p) => p.text).join(" | ");
  }

  if (cards.length === 0) {
    throw new Error(
      conflictReason
        ? `No restaurants matched — conflict: ${conflictReason}`
        : "No restaurants matched the combined constraints"
    );
  }

  const options: ProposalOption[] = cards.slice(0, 3).map((card) => ({
    id: randomUUID(),
    card,
  }));

  const rationale = conflict
    ? `Best compromises despite a conflict (${conflictReason ?? "incompatible preferences"}).`
    : `Three options that match everyone's constraints — ${rationaleTail}`.slice(0, 400);

  const conflicts: ProposalGenerationResult["conflicts"] = conflict
    ? [
        {
          field: "general",
          reason: conflictReason ?? "Constraints conflict",
          affected_users: affectedUsers,
        },
      ]
    : [];

  return { options, rationale, conflicts };
}
