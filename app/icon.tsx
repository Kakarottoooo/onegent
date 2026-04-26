/**
 * App icon — generated dynamically via Next.js ImageResponse.
 *
 * Rendered to /icon (and used as <link rel="icon"> in layout). Replaces
 * the legacy public/icon-512.png + icon-192.png which were leftover from
 * the pre-rebrand "F" placeholder.
 *
 * For the ChatGPT Apps submission, point the icon URL at:
 *   https://onegent.one/icon
 *
 * Style: serif "O" monogram on deep ink ground — luxury hotel monogram
 * vibe, travel-appropriate, brand-coherent with Playfair-driven typography.
 */
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0e1a 0%, #1a2238 100%)",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 380,
            fontWeight: 900,
            color: "#f5e6c8",
            letterSpacing: "-0.04em",
            lineHeight: 1,
            marginBottom: 24,
          }}
        >
          O
        </div>
      </div>
    ),
    { ...size },
  );
}
