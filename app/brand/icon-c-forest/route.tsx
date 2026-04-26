/**
 * C-forest — C's structure with H's forest emerald palette.
 * Warm gold on deep forest green. Luxury / nature / Aman-resort vibe.
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
          background: "#0a1d14",
          position: "relative",
        }}
      >
        {/* Ring */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 320,
            border: "20px solid #d4a443",
            display: "flex",
          }}
        />
        {/* Horizon line through middle */}
        <div
          style={{
            position: "absolute",
            top: 246,
            left: 56,
            width: 400,
            height: 20,
            background: "#d4a443",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
