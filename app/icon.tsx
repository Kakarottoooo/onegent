/**
 * Onegent brand mark — finalized 2026-04-26.
 *
 * Design: ring + horizon line through middle (geometric "O" suggesting
 * journey) on a deep ink navy gradient. Cream foreground for hotel-
 * monogram + travel-horizon meaning rolled into one mark.
 *
 * Used for:
 *   - Browser favicon (auto-wired by Next.js app/icon convention)
 *   - npm @onegent/mcp-server display in Claude Desktop config
 *   - ChatGPT Apps marketplace listing (manifest.json icon.url)
 *   - All other surfaces that need a unified brand mark
 *
 * To preview alternate palettes (legacy A/B/D/E + C variants), see git
 * history — the /brand exploration folder was deleted after this pick.
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
          position: "relative",
        }}
      >
        {/* Ring */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 320,
            border: "20px solid #f5e6c8",
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
            background: "#f5e6c8",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
