/* eslint-disable react/no-unknown-property */
import { ImageResponse } from "next/og";
import {
  getUserProfileByUsername,
  getUserProfileByCode,
  listPublicArtifactsByOwner,
} from "@/lib/db";

/**
 * Dynamic Open Graph image for /u/[username].
 *
 * Why a separate OG endpoint per kind: profile cards lead with a name and
 * a tagline; trip cards lead with a venue. Cramming both into one template
 * would compromise both. Same fallback fonts (system) as /api/og/share.
 */

// Was edge runtime, but lib/db.ts imports node:crypto — Node.js runtime
// is required. Cached aggressively at the CDN so the slight cold-start
// cost is paid once per profile.
export const runtime = "nodejs";
const imageSize = { width: 1200, height: 630 };

type Params = { params: Promise<{ username: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { username } = await params;
  const decoded = decodeURIComponent(username).replace(/^@/, "");

  const profile =
    (await getUserProfileByUsername(decoded)) ??
    (await getUserProfileByCode(decoded));
  if (!profile) {
    return new Response("Not found", { status: 404 });
  }

  // Public-trip count makes the card feel substantive — "3 trips shared"
  // is more interesting than just a name.
  let tripCount = 0;
  try {
    const artifacts = await listPublicArtifactsByOwner(profile.user_id, 100, ["trip"]);
    tripCount = artifacts.length;
  } catch {
    /* fine — we can render without the count */
  }

  const handle = profile.username ?? profile.profile_code;
  const display = profile.display_name ?? `@${handle}`;
  const tagline =
    profile.bio?.trim() ||
    (tripCount === 0
      ? "On Onegent."
      : `${tripCount} ${tripCount === 1 ? "trip" : "trips"} shared on Onegent.`);
  const initial = display.slice(0, 1).toUpperCase();

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
        {/* Top bar — eyebrow handle pill + Onegent mark */}
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
            @{handle}
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

        {/* Center: avatar + display name + tagline */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              width={140}
              height={140}
              style={{
                borderRadius: "50%",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #C9A84C 0%, #5A4416 100%)",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 64,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initial}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <div
              style={{
                fontSize: display.length > 24 ? 64 : 80,
                fontWeight: 600,
                color: "#0A0A0A",
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
              }}
            >
              {display}
            </div>
            <div
              style={{
                fontSize: 26,
                color: "#4A3F2F",
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontWeight: 400,
                lineHeight: 1.35,
                maxWidth: 740,
              }}
            >
              {tagline.length > 140 ? `${tagline.slice(0, 137)}…` : tagline}
            </div>
          </div>
        </div>

        {/* Bottom: footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ fontSize: 18, color: "#888", fontWeight: 400 }}>
            onegent.one/u/{handle}
          </div>
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
            Plan a trip on Onegent →
          </div>
        </div>
      </div>
    ),
    { ...imageSize },
  );
}
