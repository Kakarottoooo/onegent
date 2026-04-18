/**
 * Server-side preference learning hook.
 *
 * When a Decision Room proposal is accepted, we treat every joined member's
 * submitted constraints as reinforced signals and write them back to
 * `preference_profiles.profile_json.discovered` so future booking agents and
 * taste profiles benefit from this group decision.
 *
 * Schema (mirrors `DiscoveredPreference` in lib/types.ts):
 *   { id, category, key, value, label, source, seen_count, discovered_at, updated_at, user_confirmed? }
 *
 * Merge semantics:
 *   - If a signal with the same `key` already exists, increment `seen_count`
 *     and refresh value/label/updated_at (preserves user_confirmed).
 *   - Otherwise append as a new discovered entry.
 */

import { sql } from "@vercel/postgres";
import type {
  DecisionRoomConstraintRow,
  DecisionRoomProposal,
} from "@/lib/db";
import type { RecommendationCard } from "@/lib/types";
import { extractOptions } from "./proposal-shape";

type DiscoveredSignal = {
  id: string;
  category: "dining" | "hotels" | "travel" | "shopping" | "general";
  key: string;
  value: string;
  label: string;
  source: string;
  seen_count: number;
  discovered_at: string;
  updated_at: string;
  user_confirmed?: boolean;
};

function sid(key: string): string {
  return `${key}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Turn a single member's constraints + winning card into signals to persist. */
function buildSignalsForMember(params: {
  constraint: DecisionRoomConstraintRow | null;
  winningCard: RecommendationCard | undefined;
  source: string;
  now: string;
}): DiscoveredSignal[] {
  const { constraint, winningCard, source, now } = params;
  const out: DiscoveredSignal[] = [];
  const d = constraint?.data_json as
    | {
        budget_max?: number;
        cuisines_like?: string[];
        cuisines_dislike?: string[];
        dietary?: string[];
        vibe?: string;
      }
    | undefined;

  if (d) {
    if (typeof d.budget_max === "number" && d.budget_max > 0) {
      out.push({
        id: sid("dining_budget_per_person"),
        category: "dining",
        key: "dining_budget_per_person",
        value: String(d.budget_max),
        label: `Dining budget ~$${d.budget_max}/person`,
        source,
        seen_count: 1,
        discovered_at: now,
        updated_at: now,
      });
    }
    for (const c of d.cuisines_like ?? []) {
      const k = `cuisine_${c.toLowerCase().replace(/\s+/g, "_")}`;
      out.push({
        id: sid(k),
        category: "dining",
        key: k,
        value: "like",
        label: `Likes ${c}`,
        source,
        seen_count: 1,
        discovered_at: now,
        updated_at: now,
      });
    }
    for (const c of d.cuisines_dislike ?? []) {
      const k = `avoid_${c.toLowerCase().replace(/\s+/g, "_")}`;
      out.push({
        id: sid(k),
        category: "dining",
        key: k,
        value: "dislike",
        label: `Avoids ${c}`,
        source,
        seen_count: 1,
        discovered_at: now,
        updated_at: now,
      });
    }
    for (const dr of d.dietary ?? []) {
      const k = `dietary_${dr.toLowerCase().replace(/\s+/g, "_")}`;
      out.push({
        id: sid(k),
        category: "dining",
        key: k,
        value: "required",
        label: `Dietary: ${dr}`,
        source,
        seen_count: 1,
        discovered_at: now,
        updated_at: now,
      });
    }
    if (d.vibe) {
      out.push({
        id: sid("dining_vibe"),
        category: "dining",
        key: "dining_vibe",
        value: d.vibe,
        label: `Prefers ${d.vibe} atmosphere`,
        source,
        seen_count: 1,
        discovered_at: now,
        updated_at: now,
      });
    }
  }

  // The chosen restaurant itself — weak positive signal on its cuisine.
  const cuisine = winningCard?.restaurant?.cuisine;
  if (cuisine) {
    const k = `cuisine_${cuisine.toLowerCase().replace(/\s+/g, "_")}_accepted`;
    out.push({
      id: sid(k),
      category: "dining",
      key: k,
      value: "accepted_via_group",
      label: `Accepted a ${cuisine} restaurant with the group`,
      source,
      seen_count: 1,
      discovered_at: now,
      updated_at: now,
    });
  }

  return out;
}

/** Upsert a user's preference_profiles row, merging new signals into discovered[]. */
async function mergeSignalsIntoProfile(userId: string, signals: DiscoveredSignal[]) {
  if (signals.length === 0) return;
  const now = new Date().toISOString();

  // Read existing row (no-op if missing — we'll create one).
  const existing = await sql<{ profile_json: Record<string, unknown> }>`
    SELECT profile_json FROM preference_profiles WHERE user_id = ${userId} LIMIT 1
  `;
  const base = (existing.rows[0]?.profile_json ?? {}) as Record<string, unknown>;
  const prevDiscovered = Array.isArray(base.discovered)
    ? (base.discovered as DiscoveredSignal[])
    : [];

  // Merge: increment seen_count for matching keys, append the rest.
  const byKey = new Map<string, DiscoveredSignal>();
  for (const sig of prevDiscovered) byKey.set(sig.key, sig);
  for (const sig of signals) {
    const prev = byKey.get(sig.key);
    if (prev) {
      byKey.set(sig.key, {
        ...prev,
        value: sig.value,
        label: sig.label,
        source: sig.source,
        seen_count: prev.seen_count + 1,
        updated_at: now,
      });
    } else {
      byKey.set(sig.key, sig);
    }
  }
  // Cap to 50 most-seen to keep the profile bounded.
  const merged = Array.from(byKey.values())
    .sort((a, b) => b.seen_count - a.seen_count)
    .slice(0, 50);

  const nextProfile = {
    ...base,
    discovered: merged,
    updated_at: now,
  };

  await sql`
    INSERT INTO preference_profiles (user_id, profile_json, updated_at)
    VALUES (${userId}, ${JSON.stringify(nextProfile)}::jsonb, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET profile_json = ${JSON.stringify(nextProfile)}::jsonb, updated_at = NOW()
  `;
}

/**
 * After a proposal is accepted, record each joined member's constraints +
 * the winning option as reinforced discovered preferences. Idempotent in
 * practice because `mergeSignalsIntoProfile` merges by `key`.
 *
 * Designed to be fire-and-forget: any error is logged but never bubbles up
 * and blocks the vote-accept path.
 */
export async function recordRoomAcceptance(params: {
  proposal: DecisionRoomProposal;
  acceptedOptionId: string | null;
  memberIds: string[];
  constraints: DecisionRoomConstraintRow[];
  roomTitle: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const source = `Room: ${params.roomTitle}`.slice(0, 60);

  const options = extractOptions(params.proposal);
  const winningCard = params.acceptedOptionId
    ? (options.find((o) => o.id === params.acceptedOptionId)?.card as
        | RecommendationCard
        | undefined)
    : (options[0]?.card as RecommendationCard | undefined);

  await Promise.all(
    params.memberIds.map(async (uid) => {
      try {
        const constraint = params.constraints.find((c) => c.user_id === uid) ?? null;
        const signals = buildSignalsForMember({ constraint, winningCard, source, now });
        await mergeSignalsIntoProfile(uid, signals);
      } catch (err) {
        // Never block the accept flow — log and continue.
        console.error("recordRoomAcceptance failed for", uid, err);
      }
    })
  );
}
