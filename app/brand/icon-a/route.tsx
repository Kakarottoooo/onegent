/**
 * Option A — Serif O on deep ink (current shipped icon).
 * Luxury hotel monogram vibe. Brand-coherent with Playfair typography.
 */
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export async function GET(): Promise<ImageResponse> {
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
    { width: 512, height: 512 },
  );
}
