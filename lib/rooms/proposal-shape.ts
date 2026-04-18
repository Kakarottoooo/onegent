/**
 * Normalization + tally helpers for multi-option proposals.
 *
 * Old proposals (Phase 1/2) stored a single RecommendationCard as content_json.
 * Phase 3 proposals store { options: [{id, card}] }. `extractOptions` always
 * returns the array form so downstream code can ignore the difference.
 */

import type { ApprovalRule, DecisionRoomVote } from "@/lib/db";
import type { RecommendationCard } from "@/lib/types";

export interface ProposalOptionView {
  id: string;
  card: RecommendationCard;
}

/**
 * Coerce any stored proposal.content_json into a canonical list of options.
 * - New shape: `{ options: [{id, card}, ...] }`
 * - Legacy shape: one card at the root (pre-Phase-3)
 */
export function extractOptions(proposal: { content_json: unknown }): ProposalOptionView[] {
  const c = proposal.content_json as
    | { options?: Array<{ id?: unknown; card?: unknown }> }
    | RecommendationCard
    | null
    | undefined;

  if (c && typeof c === "object" && "options" in c && Array.isArray((c as { options: unknown }).options)) {
    const list = (c as { options: Array<{ id?: unknown; card?: unknown }> }).options;
    const normalized: ProposalOptionView[] = [];
    for (const o of list) {
      if (o && typeof o === "object" && typeof o.id === "string" && o.card && typeof o.card === "object") {
        normalized.push({ id: o.id, card: o.card as RecommendationCard });
      }
    }
    return normalized;
  }

  // Legacy: treat the root object as a single option.
  if (c && typeof c === "object") {
    return [{ id: "legacy", card: c as RecommendationCard }];
  }
  return [];
}

export interface OptionTally {
  option_id: string;
  approved_by: string[]; // user_ids that picked this option with vote=approve
}

/**
 * Bucket votes by option_id. Only `approve` votes count toward an option.
 * Votes with null option_id and vote=approve are counted against the first
 * option (legacy fallback — keeps old single-option proposals working).
 */
export function tallyVotes(
  options: ProposalOptionView[],
  votes: DecisionRoomVote[]
): OptionTally[] {
  const byId = new Map<string, Set<string>>();
  for (const o of options) byId.set(o.id, new Set());
  for (const v of votes) {
    if (v.vote !== "approve") continue;
    const oid = v.option_id ?? options[0]?.id;
    if (!oid) continue;
    byId.get(oid)?.add(v.user_id);
  }
  return Array.from(byId.entries()).map(([option_id, set]) => ({
    option_id,
    approved_by: Array.from(set),
  }));
}

/**
 * Given room rule + joined member count + tallies, decide whether any option
 * has reached acceptance. Returns the winning option_id, or null if none.
 *
 * - unanimous: every joined member approved the SAME option
 * - majority:  an option's approvers > N/2 (ties do not pass)
 */
export function resolveAcceptedOption(
  rule: ApprovalRule,
  memberCount: number,
  tallies: OptionTally[]
): string | null {
  if (memberCount <= 0) return null;
  if (rule === "unanimous") {
    for (const t of tallies) {
      if (t.approved_by.length === memberCount) return t.option_id;
    }
    return null;
  }
  // majority — must strictly exceed half
  let winner: OptionTally | null = null;
  for (const t of tallies) {
    if (t.approved_by.length * 2 > memberCount) {
      if (!winner || t.approved_by.length > winner.approved_by.length) winner = t;
    }
  }
  return winner?.option_id ?? null;
}
