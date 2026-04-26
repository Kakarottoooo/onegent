/**
 * C-warm — C's structure (ring + horizon line) with F's warm palette.
 * Burnt orange + amber on deep brown gradient. Sunrise / departure energy.
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
          background: "linear-gradient(135deg, #1a0f0a 0%, #2a1810 100%)",
          position: "relative",
        }}
      >
        {/* Ring */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 320,
            border: "20px solid #f4c04b",
            display: "flex",
          }}
        />
        {/* Horizon line through middle (C's signature position) */}
        <div
          style={{
            position: "absolute",
            top: 246,
            left: 56,
            width: 400,
            height: 20,
            background: "#d97a2f",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
