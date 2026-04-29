import { NextResponse } from "next/server";
import {
  getUserProfileByUsername,
  getUserProfileByCode,
  listPublicArtifactsByOwner,
  getDecisionSession,
  getBookingJob,
} from "@/lib/db";

/**
 * GET /api/users/[handle]/taste-snapshot
 *
 * Public, anonymous-readable summary of a user's taste — derived only from
 * artifacts they have explicitly published (`visibility = 'public'`). We
 * intentionally do NOT touch their raw user_preference_profile or any
 * private signal.
 *
 * Used by the "Are we a match?" comparison on /u/[username]: client fetches
 * BOTH users' snapshots and computes overlap client-side.
 *
 * Snapshot shape:
 *   {
 *     handle,
 *     display_name,
 *     totals: { decisions, bookings, public_artifacts },
 *     cuisines: [{ name, count }],
 *     price_bands: [{ band, count }],
 *     cities: [{ name, count }]
 *   }
 */

interface Tally {
  cuisines: Map<string, number>;
  prices: Map<string, number>;
  cities: Map<string, number>;
  decisions: number;
  bookings: number;
}

function bumpKey(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  const trimmed = key.trim();
  if (!trimmed) return;
  map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
}

function mapToSorted(map: Map<string, number>, top = 6): { name: string; count: number }[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([name, count]) => ({ name, count }));
}

type Params = { params: Promise<{ handle: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { handle: rawHandle } = await params;
  const handle = decodeURIComponent(rawHandle).replace(/^@/, "");
  const profile =
    (await getUserProfileByUsername(handle)) ??
    (await getUserProfileByCode(handle));
  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const artifacts = await listPublicArtifactsByOwner(profile.user_id, 100);
  const tally: Tally = {
    cuisines: new Map(),
    prices: new Map(),
    cities: new Map(),
    decisions: 0,
    bookings: 0,
  };

  await Promise.all(
    artifacts.map(async (a) => {
      try {
        if (a.kind === "dr_outcome") {
          const session = await getDecisionSession(a.ref_id);
          if (!session) return;
          tally.decisions += 1;
          const cards = (session.merged_options ?? []) as Array<{
            restaurant?: { id?: string; cuisine?: string; price?: string; address?: string };
          }>;
          const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
          if (decided?.restaurant) {
            bumpKey(tally.cuisines, decided.restaurant.cuisine);
            bumpKey(tally.prices, decided.restaurant.price);
            const cityGuess = decided.restaurant.address?.split(",").slice(-2, -1)[0]?.trim();
            bumpKey(tally.cities, cityGuess);
          }
        } else if (a.kind === "booking") {
          const job = await getBookingJob(a.ref_id);
          if (!job) return;
          tally.bookings += 1;
          // booking_jobs don't carry structured cuisine/price, so the only
          // signal we have is trip_label — too noisy to keyword-extract for
          // taste. We still surface the job so the totals reflect activity.
          // Future: when bookings carry typed venue metadata, harvest here.
        }
      } catch {
        /* swallow per-artifact errors so one bad row doesn't kill the whole snapshot */
      }
    }),
  );

  return NextResponse.json({
    handle: profile.username ?? profile.profile_code,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    totals: {
      decisions: tally.decisions,
      bookings: tally.bookings,
      public_artifacts: artifacts.length,
    },
    cuisines: mapToSorted(tally.cuisines),
    price_bands: mapToSorted(tally.prices),
    cities: mapToSorted(tally.cities),
  });
}
