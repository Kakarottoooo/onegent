import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  getSharedArtifactBySlug,
  getBookingJob,
  getDecisionSession,
  getUserProfile,
  incrementSharedArtifactViews,
} from "@/lib/db";
import GlobalNav from "@/components/GlobalNav";
import { EditorialHero, EyebrowLabel } from "@/app/_shared/editorial";
import ForkAsDrButton from "./ForkAsDrButton";
import SocialFooter from "./SocialFooter";

type Params = { params: Promise<{ slug: string }> };

// ─── Metadata ────────────────────────────────────────────────────────────────
//
// Generates the OG / Twitter Card so a share link in iMessage / X / Slack
// renders the dynamic 1200×630 we cooked up in /api/og/share/[slug]. We
// pessimistically return a generic "Onegent" card for private/missing
// artifacts — never leak the existence of a private slug via metadata.

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const artifact = await getSharedArtifactBySlug(slug);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!artifact || artifact.visibility !== "public") {
    return {
      title: "Onegent",
      description: "Plan and book trips together.",
    };
  }

  let title = "A trip on Onegent";
  let description = "Plan yours at onegent.one";

  if (artifact.kind === "booking") {
    const job = await getBookingJob(artifact.ref_id);
    if (job) {
      title = job.trip_label;
      description = `${job.trip_label} — booked on Onegent. Plan yours.`;
    }
  } else if (artifact.kind === "dr_outcome") {
    const session = await getDecisionSession(artifact.ref_id);
    if (session) {
      const cards = (session.merged_options ?? []) as Array<{
        restaurant?: { id?: string; name?: string };
      }>;
      const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
      title = decided?.restaurant?.name
        ? `We agreed on ${decided.restaurant.name}`
        : "A Decision Room outcome";
      description = `${session.initiator_constraints} — decided on Onegent.`;
    }
  }

  const ogUrl = `${base}/api/og/share/${slug}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ShareSlugPage({ params }: Params) {
  const { slug } = await params;
  const artifact = await getSharedArtifactBySlug(slug);
  if (!artifact) notFound();

  const { userId } = await auth();
  const isOwner = !!userId && userId === artifact.owner_id;
  if (!isOwner && artifact.visibility !== "public") {
    notFound();
  }

  // Resolve content + owner profile in parallel.
  const [owner, jobOrNull, sessionOrNull] = await Promise.all([
    getUserProfile(artifact.owner_id),
    artifact.kind === "booking" ? getBookingJob(artifact.ref_id) : Promise.resolve(null),
    artifact.kind === "dr_outcome" ? getDecisionSession(artifact.ref_id) : Promise.resolve(null),
  ]);

  // Fire-and-forget view increment for non-owner reads. Done at render time
  // so the count reflects rendered impressions, not just OG hits.
  if (!isOwner) {
    void incrementSharedArtifactViews(slug);
  }

  const showTime = artifact.options.showTime !== false;
  const showPrice = artifact.options.showPrice !== false;

  const ownerName =
    owner?.display_name ??
    (owner?.username ? `@${owner.username}` : owner?.profile_code ? `@${owner.profile_code}` : "Someone");
  const ownerHandle = owner?.username ?? owner?.profile_code ?? null;

  // ── Booking content ───────────────────────────────────────────────────────
  if (artifact.kind === "booking") {
    if (!jobOrNull) {
      return <DeletedRefShell ownerName={ownerName} />;
    }
    const job = jobOrNull;
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
        <GlobalNav active="other" />
        <main style={{ maxWidth: 760, margin: "0 auto", padding: "var(--space-16) var(--space-6) var(--space-24)" }}>
          <EditorialHero
            eyebrow={`${ownerName} booked`}
            title={job.trip_label}
            subtitle={`Booked on Onegent · ${formatDate(job.completed_at ?? job.created_at)}`}
            size="page"
            align="left"
          />

          <OwnerProfileLink handle={ownerHandle} />

          <div
            style={{
              marginTop: 24,
              padding: 24,
              borderRadius: 18,
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 14px",
              }}
            >
              Itinerary
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {job.steps.map((s, i) => (
                <li
                  key={`${s.type}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 0",
                    borderBottom: i === job.steps.length - 1 ? "none" : "1px solid var(--border)",
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{s.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0,
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 15,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {s.label}
                    </p>
                    {showTime && s.selected_time && (
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                        {s.selected_time}
                      </p>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-dm-sans)",
                      color: s.status === "done" ? "var(--gold-text)" : "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                    }}
                  >
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
            {!showPrice && !showTime && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "12px 0 0" }}>
                Price and time hidden by sharer.
              </p>
            )}
          </div>

          {artifact.visibility === "public" && (
            <SocialFooter slug={slug} isSignedIn={!!userId} currentUserId={userId ?? null} />
          )}

          <PlanYoursFooter />
        </main>
      </div>
    );
  }

  // ── DR Outcome content ────────────────────────────────────────────────────
  if (!sessionOrNull) {
    return <DeletedRefShell ownerName={ownerName} />;
  }
  const session = sessionOrNull;
  const cards = (session.merged_options ?? []) as Array<{
    restaurant?: { id?: string; name?: string; cuisine?: string; price?: string; address?: string };
    why_recommended?: string;
  }>;
  const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="other" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "var(--space-16) var(--space-6) var(--space-24)" }}>
        <EditorialHero
          eyebrow={`${ownerName} decided`}
          title={decided?.restaurant?.name ?? "We agreed on a place"}
          subtitle={
            decided?.restaurant?.cuisine
              ? `${decided.restaurant.cuisine}${
                  showPrice && decided.restaurant.price ? ` · ${decided.restaurant.price}` : ""
                }${decided.restaurant.address ? ` · ${decided.restaurant.address.split(",")[0]}` : ""}`
              : undefined
          }
          size="page"
          align="left"
        />

        <OwnerProfileLink handle={ownerHandle} />

        {decided?.why_recommended && (
          <div
            style={{
              marginTop: 24,
              padding: 22,
              borderRadius: 18,
              background: "var(--gold-soft, #F5E9C8)",
              border: "1px solid var(--gold, #C9A84C)",
            }}
          >
            <EyebrowLabel variant="default">Why this</EyebrowLabel>
            <p
              style={{
                margin: "10px 0 0",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 16,
                color: "var(--gold-text, #5A4416)",
                lineHeight: 1.55,
              }}
            >
              {decided.why_recommended}
            </p>
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <ConstraintCard label="Initiator wanted" body={session.initiator_constraints} />
          <ConstraintCard
            label="Partner wanted"
            body={session.partner_constraints ?? "(not recorded)"}
          />
        </div>

        <div style={{ marginTop: 28 }}>
          <ForkAsDrButton slug={slug} isSignedIn={!!userId} />
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 0 0" }}>
            Forking copies their starting constraints into a new room you own — pick your own partner.
          </p>
        </div>

        <PlanYoursFooter />
      </main>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function OwnerProfileLink({ handle }: { handle: string | null }) {
  if (!handle) return null;
  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <Link
        href={`/u/${encodeURIComponent(handle)}`}
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--gold-text, #5A4416)",
          textDecoration: "none",
          borderBottom: "1px solid transparent",
        }}
      >
        View @{handle}&apos;s profile →
      </Link>
    </div>
  );
}

function ConstraintCard({ label, body }: { label: string; body: string }) {
  return (
    <div
      style={{
        padding: 20,
        borderRadius: 18,
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 14,
          color: "var(--text-primary)",
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        “{body}”
      </p>
    </div>
  );
}

function PlanYoursFooter() {
  return (
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
  );
}

function DeletedRefShell({ ownerName }: { ownerName: string }) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="other" />
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "var(--space-16) var(--space-6)" }}>
        <EditorialHero
          eyebrow={`${ownerName} shared this`}
          title="This trip was removed."
          subtitle="The original booking or decision room is no longer available."
          size="page"
          align="left"
        />
        <PlanYoursFooter />
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
