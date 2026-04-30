import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  getUserProfileByUsername,
  getUserProfileByCode,
  listPublicArtifactsByOwner,
  isContact,
  getBookingJob,
  getDecisionSession,
  getItinerary,
  type SharedArtifact,
} from "@/lib/db";
import GlobalNav from "@/components/GlobalNav";
import { EditorialHero } from "@/app/_shared/editorial";
import AddContactCTA from "./AddContactCTA";
import EditBioInline from "./EditBioInline";
import CompareTasteLauncher from "./CompareTasteLauncher";

type Params = { params: Promise<{ username: string }> };

// ─── Metadata ────────────────────────────────────────────────────────────────
//
// Public profile OG card — drives the look of links pasted into iMessage,
// Slack, X. Q4(iii) of the design discussion: profile pages get the same
// dynamic OG treatment as trip cards.

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const decoded = decodeURIComponent(username).replace(/^@/, "");
  const profile = await resolveProfile(decoded);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!profile) {
    return { title: "Onegent" };
  }
  const handle = profile.username ?? profile.profile_code;
  const title = profile.display_name
    ? `${profile.display_name} on Onegent`
    : `@${handle} on Onegent`;
  const description =
    profile.bio?.trim() ||
    "Public trips and decisions, planned with Onegent.";
  const ogUrl = `${base}/api/og/u/${encodeURIComponent(handle)}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

async function resolveProfile(handle: string) {
  // Username takes priority (case-insensitive); profile_code is the fallback
  // so old shareable codes keep resolving when usernames are absent.
  const byUsername = await getUserProfileByUsername(handle);
  if (byUsername) return byUsername;
  return getUserProfileByCode(handle);
}

interface PreviewItem {
  slug: string;
  kind: SharedArtifact["kind"];
  title: string;
  subtitle: string | null;
  view_count: number;
  created_at: string;
  options: SharedArtifact["options"];
}

async function buildPreviews(artifacts: SharedArtifact[]): Promise<PreviewItem[]> {
  return Promise.all(
    artifacts.map(async (a) => {
      let title = "A trip on Onegent";
      let subtitle: string | null = null;
      try {
        if (a.kind === "booking") {
          const job = await getBookingJob(a.ref_id);
          if (job) {
            title = job.trip_label;
            const firstStep = job.steps?.[0];
            subtitle = firstStep ? `${firstStep.emoji} ${firstStep.label}` : null;
          }
        } else if (a.kind === "trip") {
          const itinerary = await getItinerary(a.ref_id);
          if (itinerary) {
            title = itinerary.title;
            subtitle =
              [itinerary.city, formatTripRange(itinerary.start_date, itinerary.end_date)]
                .filter(Boolean)
                .join(" · ") || null;
          }
        } else if (a.kind === "dr_outcome") {
          const session = await getDecisionSession(a.ref_id);
          if (session) {
            const cards = (session.merged_options ?? []) as Array<{
              restaurant?: { id?: string; name?: string; cuisine?: string };
            }>;
            const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
            title = decided?.restaurant?.name ?? "A Decision Room";
            subtitle = decided?.restaurant?.cuisine ?? null;
          }
        }
      } catch {
        /* leave defaults — render still works */
      }
      return {
        slug: a.slug,
        kind: a.kind,
        title,
        subtitle,
        view_count: a.view_count,
        created_at: a.created_at,
        options: a.options,
      };
    }),
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function PublicProfilePage({ params }: Params) {
  const { username } = await params;
  const decoded = decodeURIComponent(username).replace(/^@/, "");
  const profile = await resolveProfile(decoded);
  if (!profile) notFound();

  // Authoritative handle is whatever the URL canonicalizes to: prefer
  // `username` for nice URLs; fallback to `profile_code` for legacy.
  const handle = profile.username ?? profile.profile_code;

  const [tripArtifacts, otherArtifacts, { userId }] = await Promise.all([
    listPublicArtifactsByOwner(profile.user_id, 20, ["trip"]),
    listPublicArtifactsByOwner(profile.user_id, 12, ["booking", "dr_outcome"]),
    auth(),
  ]);

  const isSelf = !!userId && userId === profile.user_id;
  const alreadyContact = !isSelf && !!userId
    ? await isContact(userId, profile.user_id)
    : false;

  const [tripPreviews, otherPreviews] = await Promise.all([
    buildPreviews(tripArtifacts),
    buildPreviews(otherArtifacts),
  ]);
  const tripCount = tripPreviews.length;
  const labelInitial =
    (profile.display_name ?? profile.username ?? profile.profile_code ?? "?")
      .slice(0, 1)
      .toUpperCase();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="other" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "var(--space-16) var(--space-6) var(--space-24)" }}>
        {/* Header: avatar + name + handle + Add CTA */}
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
            marginBottom: 8,
          }}
        >
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              style={{
                width: 88,
                height: 88,
                borderRadius: "50%",
                objectFit: "cover",
                flexShrink: 0,
                border: "2px solid var(--border)",
              }}
            />
          ) : (
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #C9A84C 0%, #5A4416 100%)",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
                fontFamily: "var(--font-playfair), Georgia, serif",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {labelInitial}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <EditorialHero
              eyebrow={`@${handle}`}
              title={profile.display_name ?? `@${handle}`}
              size="page"
              align="left"
            />
          </div>

          {!isSelf && (
            <div style={{ flexShrink: 0, marginTop: 16, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <AddContactCTA
                peerHandle={handle}
                alreadyContact={alreadyContact}
                isSelf={false}
                isSignedIn={!!userId}
              />
              {!!userId && (
                <CompareTasteLauncher
                  peerHandle={handle}
                  peerDisplayName={profile.display_name}
                />
              )}
            </div>
          )}
        </div>

        {/* Bio — owner gets inline editor; others get static text or hidden */}
        <div style={{ marginTop: -12, marginBottom: 32, maxWidth: 580 }}>
          {isSelf ? (
            <EditBioInline initialBio={profile.bio} />
          ) : profile.bio ? (
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 15,
                color: "var(--text-primary)",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {profile.bio}
            </p>
          ) : null}
        </div>

        {/* Public trips section */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {tripCount === 0
              ? "Public trips"
              : `${tripCount} ${tripCount === 1 ? "trip" : "trips"} shared`}
          </p>
        </div>

        {tripCount === 0 ? (
          <EmptyTripsState
            isSelf={isSelf}
            displayName={profile.display_name ?? `@${handle}`}
            hasOtherShares={otherPreviews.length > 0}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {tripPreviews.map((p) => (
              <Link
                key={p.slug}
                href={`/s/${p.slug}`}
                style={{
                  display: "block",
                  padding: 18,
                  borderRadius: 16,
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  textDecoration: "none",
                  transition: "border-color 120ms",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-playfair), Georgia, serif",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {p.title}
                  </p>
                  <span
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "var(--gold-text, #5A4416)",
                      background: "var(--gold-soft, #F5E9C8)",
                      padding: "3px 8px",
                      borderRadius: 999,
                      flexShrink: 0,
                    }}
                  >
                    {p.kind === "trip" ? "Trip" : p.kind === "dr_outcome" ? "Decided" : "Booked"}
                  </span>
                </div>
                {p.subtitle && (
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 13,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {p.subtitle}
                  </p>
                )}
                <p
                  style={{
                    margin: "10px 0 0",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  {formatDate(p.created_at)}
                  {p.view_count > 0 ? ` · ${p.view_count} ${p.view_count === 1 ? "view" : "views"}` : ""}
                </p>
              </Link>
            ))}
          </div>
        )}

        {otherPreviews.length > 0 && (
          <div style={{ marginTop: tripCount > 0 ? 32 : 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
              <p
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                Recent shares
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {otherPreviews.map((p) => (
                <Link
                  key={p.slug}
                  href={`/s/${p.slug}`}
                  style={{
                    display: "block",
                    padding: 18,
                    borderRadius: 16,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    textDecoration: "none",
                    transition: "border-color 120ms",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <p
                      style={{
                        margin: 0,
                        fontFamily: "var(--font-playfair), Georgia, serif",
                        fontSize: 18,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {p.title}
                    </p>
                    <span
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        color: "var(--gold-text, #5A4416)",
                        background: "var(--gold-soft, #F5E9C8)",
                        padding: "3px 8px",
                        borderRadius: 999,
                        flexShrink: 0,
                      }}
                    >
                      {p.kind === "dr_outcome" ? "Decided" : "Booked"}
                    </span>
                  </div>
                  {p.subtitle && (
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 13,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {p.subtitle}
                    </p>
                  )}
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {formatDate(p.created_at)}
                    {p.view_count > 0 ? ` · ${p.view_count} ${p.view_count === 1 ? "view" : "views"}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 36, textAlign: "center", padding: "20px 0" }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 14,
              color: "var(--gold, #C9A84C)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Plan your own trip on Onegent →
          </Link>
        </div>
      </main>
    </div>
  );
}

function EmptyTripsState({
  isSelf,
  displayName,
  hasOtherShares,
}: {
  isSelf: boolean;
  displayName: string;
  hasOtherShares: boolean;
}) {
  return (
    <div
      style={{
        padding: "32px 24px",
        borderRadius: 16,
        border: "1px dashed var(--border)",
        background: "var(--card)",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 14,
          color: "var(--text-secondary)",
          margin: 0,
        }}
      >
        {isSelf
          ? "Share a trip and it will show up here."
          : hasOtherShares
            ? `${displayName} hasn't shared any public trips yet.`
            : `${displayName} hasn't shared any public trips yet.`}
      </p>
      {isSelf && (
        <Link
          href="/tasks"
          style={{
            display: "inline-block",
            marginTop: 12,
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            color: "var(--gold, #C9A84C)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Go to your tasks →
        </Link>
      )}
    </div>
  );
}

function formatTripRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  try {
    const startLabel = start
      ? new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : null;
    const endLabel = end
      ? new Date(end).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : null;
    if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
    return startLabel ?? endLabel;
  } catch {
    return [start, end].filter(Boolean).join(" – ") || null;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
