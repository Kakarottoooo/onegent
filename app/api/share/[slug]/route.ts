import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getSharedArtifactBySlug,
  incrementSharedArtifactViews,
  getBookingJob,
  getDecisionSession,
  getItinerary,
  listItineraryItems,
  getUserProfile,
  type SharedArtifact,
} from "@/lib/db";

interface OwnerSlim {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_code: string | null;
  username: string | null;
}

async function loadOwnerSlim(userId: string): Promise<OwnerSlim | null> {
  try {
    const p = await getUserProfile(userId);
    if (!p) return null;
    return {
      user_id: p.user_id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      profile_code: p.profile_code,
      username: p.username,
    };
  } catch {
    return null;
  }
}

interface BookingContentStep {
  type: string;
  emoji: string;
  label: string;
  status: string;
  selected_time?: string;
}
interface BookingContent {
  trip_label: string;
  status: string;
  steps: BookingContentStep[];
  completed_at: string | null;
}
interface DrOutcomeContent {
  venue_name: string | null;
  cuisine: string | null;
  price: string | null;
  address: string | null;
  why_recommended: string | null;
  initiator_constraints: string;
  partner_constraints: string | null;
  initiator: OwnerSlim | null;
  invitee: OwnerSlim | null;
  decided_at: string;
  city_id: string;
}

interface TripChild {
  item_kind: "booking_job" | "dr_outcome";
  item_id: string;
  title: string;
  subtitle: string | null;
  emoji: string | null;
}

interface TripContent {
  itinerary_id: string;
  title: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_emoji: string | null;
  children: TripChild[];
}

/**
 * Resolve a booking_job into a privacy-aware shape for /share rendering.
 * Strips raw `body` payloads (which can contain restaurant IDs etc.) and
 * keeps only display-safe fields. The `showTime` option gates per-step
 * `selected_time` exposure.
 */
function resolveBookingContent(
  job: NonNullable<Awaited<ReturnType<typeof getBookingJob>>>,
  artifact: SharedArtifact,
): BookingContent {
  const showTime = artifact.options.showTime !== false;
  const steps: BookingContentStep[] = (job.steps ?? []).map((s) => {
    const out: BookingContentStep = {
      type: s.type,
      emoji: s.emoji,
      label: s.label,
      status: s.status,
    };
    if (showTime && s.selected_time) out.selected_time = s.selected_time;
    return out;
  });
  return {
    trip_label: job.trip_label,
    status: job.status,
    steps,
    completed_at: job.completed_at,
  };
}

/** Resolve a trip artifact: itinerary metadata + display-safe child list. */
async function resolveTripContent(
  itinerary: NonNullable<Awaited<ReturnType<typeof getItinerary>>>,
): Promise<TripContent> {
  const items = await listItineraryItems(itinerary.id);
  const children: TripChild[] = await Promise.all(
    items.map(async (it) => {
      const base: TripChild = {
        item_kind: it.item_kind,
        item_id: it.item_id,
        title: "Removed",
        subtitle: null,
        emoji: null,
      };
      try {
        if (it.item_kind === "booking_job") {
          const job = await getBookingJob(it.item_id);
          if (job) {
            return {
              ...base,
              title: job.trip_label,
              subtitle: job.steps?.[0]?.label ?? null,
              emoji: job.steps?.[0]?.emoji ?? "🧳",
            };
          }
        } else {
          const session = await getDecisionSession(it.item_id);
          if (session) {
            const cards = (session.merged_options ?? []) as Array<{
              restaurant?: { id?: string; name?: string; cuisine?: string };
            }>;
            const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
            return {
              ...base,
              title: decided?.restaurant?.name ?? "Decision Room",
              subtitle: decided?.restaurant?.cuisine ?? null,
              emoji: "🗳️",
            };
          }
        }
      } catch {
        /* leave defaults */
      }
      return base;
    }),
  );
  return {
    itinerary_id: itinerary.id,
    title: itinerary.title,
    city: itinerary.city,
    start_date: itinerary.start_date,
    end_date: itinerary.end_date,
    cover_emoji: itinerary.cover_emoji,
    children,
  };
}

async function resolveDrOutcomeContent(
  session: NonNullable<Awaited<ReturnType<typeof getDecisionSession>>>,
): Promise<DrOutcomeContent | null> {
  const cards = (session.merged_options ?? []) as Array<{
    restaurant?: { id?: string; name?: string; cuisine?: string; price?: string; address?: string };
    why_recommended?: string;
  }>;
  const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
  const [initiator, invitee] = await Promise.all([
    session.initiator_user_id ? loadOwnerSlim(session.initiator_user_id) : Promise.resolve(null),
    session.invitee_user_id ? loadOwnerSlim(session.invitee_user_id) : Promise.resolve(null),
  ]);
  return {
    venue_name: decided?.restaurant?.name ?? null,
    cuisine: decided?.restaurant?.cuisine ?? null,
    price: decided?.restaurant?.price ?? null,
    address: decided?.restaurant?.address ?? null,
    why_recommended: decided?.why_recommended ?? null,
    initiator_constraints: session.initiator_constraints,
    partner_constraints: session.partner_constraints,
    initiator,
    invitee,
    decided_at: session.created_at,
    city_id: session.city_id,
  };
}

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/share/[slug]
 *
 * Resolves a shared artifact and inlines the underlying content. Visibility
 * is enforced here:
 *   - public  → anyone (auth optional)
 *   - private → owner only (everyone else gets 404 to avoid leaking existence)
 *   - contacts/specific → not yet wired (gated on owner-only for now)
 *
 * View count increments for non-owner reads only.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { userId } = await auth();
  const isOwner = !!userId && userId === artifact.owner_id;

  // Visibility gate. Private/contacts/specific all collapse to "owner only"
  // until P3 wires audience resolution; we 404 instead of 403 so the slug's
  // existence isn't leaked.
  if (!isOwner && artifact.visibility !== "public") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const owner = await loadOwnerSlim(artifact.owner_id);

  let content: BookingContent | DrOutcomeContent | TripContent | null = null;
  if (artifact.kind === "booking") {
    const job = await getBookingJob(artifact.ref_id);
    if (!job) {
      // Underlying booking deleted — soft-fail with a stub rather than 404
      // so the share URL still tells the visitor "this trip was removed".
      return NextResponse.json({
        artifact: { ...artifact, deleted_ref: true },
        owner,
        content: null,
      });
    }
    content = resolveBookingContent(job, artifact);
  } else if (artifact.kind === "dr_outcome") {
    const session = await getDecisionSession(artifact.ref_id);
    if (!session || session.status !== "decided") {
      return NextResponse.json({
        artifact: { ...artifact, deleted_ref: true },
        owner,
        content: null,
      });
    }
    content = await resolveDrOutcomeContent(session);
  } else if (artifact.kind === "trip") {
    const itinerary = await getItinerary(artifact.ref_id);
    if (!itinerary) {
      return NextResponse.json({
        artifact: { ...artifact, deleted_ref: true },
        owner,
        content: null,
      });
    }
    content = await resolveTripContent(itinerary);
  }

  // View count: track real reach, not the owner staring at their own page.
  if (!isOwner) {
    void incrementSharedArtifactViews(slug);
  }

  const can_fork = artifact.kind === "dr_outcome";

  return NextResponse.json({
    artifact: {
      slug: artifact.slug,
      kind: artifact.kind,
      visibility: artifact.visibility,
      options: artifact.options,
      view_count: artifact.view_count,
      created_at: artifact.created_at,
      can_fork,
    },
    owner,
    content,
  });
}
