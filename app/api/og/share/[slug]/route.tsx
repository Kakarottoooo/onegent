/* eslint-disable react/no-unknown-property */
import { ImageResponse } from "next/og";
import {
  getSharedArtifactBySlug,
  getBookingJob,
  getDecisionSession,
  getItinerary,
  listItineraryItems,
  getUserProfile,
} from "@/lib/db";

/**
 * Dynamic Open Graph image for /share/[slug]. Renders a 1200×630 card that
 * iMessage / X / FB / Slack will preview. The card design mirrors the
 * editorial system used in /pricing — gold pill eyebrow, big serif name,
 * Onegent watermark — so a share link in any chat looks like a real product.
 *
 * Uses next/og (built into Next 13+; no extra dep). System fonts only for
 * v1 — Playfair via @vercel/og fetch can come later.
 */

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) {
    return new Response("Not found", { status: 404 });
  }
  if (artifact.visibility !== "public") {
    // Don't leak the existence of private artifacts via OG endpoint.
    return new Response("Not found", { status: 404 });
  }

  // Resolve the headline pieces by kind.
  let eyebrow = "Onegent";
  let title = "Plan it together.";
  let subtitle: string | null = null;
  let priceLabel: string | null = null;
  let cityLabel: string | null = null;

  if (artifact.kind === "booking") {
    const job = await getBookingJob(artifact.ref_id);
    if (job) {
      eyebrow = "Trip booked";
      title = job.trip_label || "A trip on Onegent";
      const firstDoneStep = job.steps?.find((s) => s.status === "done");
      if (firstDoneStep) subtitle = firstDoneStep.label;
    }
  } else if (artifact.kind === "trip") {
    const itinerary = await getItinerary(artifact.ref_id);
    if (itinerary) {
      eyebrow = "Trip";
      title = itinerary.title || "A trip on Onegent";
      try {
        const items = await listItineraryItems(itinerary.id);
        const itemCount = items.length;
        const stopsPart = `${itemCount} ${itemCount === 1 ? "stop" : "stops"}`;
        subtitle = [itinerary.city ?? null, stopsPart].filter(Boolean).join(" · ");
      } catch {
        subtitle = itinerary.city ?? null;
      }
      if (itinerary.city) cityLabel = itinerary.city;
    }
  } else if (artifact.kind === "dr_outcome") {
    const session = await getDecisionSession(artifact.ref_id);
    if (session) {
      eyebrow = "Decision Room";
      const cards = (session.merged_options ?? []) as Array<{
        restaurant?: { id?: string; name?: string; cuisine?: string; price?: string; address?: string };
      }>;
      const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
      title = decided?.restaurant?.name ?? "We agreed on a place.";
      subtitle = decided?.restaurant?.cuisine ?? null;
      if (artifact.options.showPrice !== false && decided?.restaurant?.price) {
        priceLabel = decided.restaurant.price;
      }
      if (decided?.restaurant?.address) {
        cityLabel = decided.restaurant.address.split(",").slice(-2, -1)[0]?.trim() ?? null;
      }
    }
  }

  // Owner attribution — gives the share-receiver a name to anchor on
  // ("Anna decided" feels human; "someone decided" feels spammy).
  let ownerName: string | null = null;
  try {
    const owner = await getUserProfile(artifact.owner_id);
    ownerName = owner?.display_name ?? (owner?.username ? `@${owner.username}` : null);
  } catch {
    /* fine — anonymous attribution */
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #FAFAF9 0%, #F5E9C8 100%)",
          fontFamily: "Georgia, serif",
        }}
      >
        {/* Top: eyebrow pill + Onegent mark */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#5A4416",
              background: "rgba(201,168,76,0.18)",
              padding: "10px 22px",
              borderRadius: 999,
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 22,
              fontWeight: 600,
              color: "#2C2416",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #2C2416 0%, #4A3F2F 100%)",
                display: "flex",
              }}
            />
            Onegent
          </div>
        </div>

        {/* Middle: huge serif title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontSize: title.length > 28 ? 76 : 96,
              fontWeight: 600,
              color: "#0A0A0A",
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              maxWidth: "100%",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 32,
                color: "#4A3F2F",
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontWeight: 400,
              }}
            >
              {subtitle}
              {cityLabel ? ` · ${cityLabel}` : ""}
              {priceLabel ? ` · ${priceLabel}` : ""}
            </div>
          )}
        </div>

        {/* Bottom: attribution + footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ownerName && (
              <div style={{ fontSize: 22, color: "#5A4416", fontWeight: 500 }}>
                {artifact.kind === "dr_outcome"
                  ? `${ownerName} decided`
                  : `${ownerName} booked`}
              </div>
            )}
            <div style={{ fontSize: 18, color: "#888", fontWeight: 400 }}>
              Plan yours at onegent.one
            </div>
          </div>
          {artifact.kind === "dr_outcome" && (
            <div
              style={{
                fontSize: 18,
                color: "#5A4416",
                background: "rgba(201,168,76,0.18)",
                padding: "10px 18px",
                borderRadius: 999,
                fontWeight: 600,
              }}
            >
              Fork as your own DR →
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
