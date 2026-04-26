/**
 * C-navy — C's structure with A's deep ink + cream palette.
 * Cream ring on navy gradient. Luxury hotel monogram + journey horizon.
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
    { width: 512, height: 512 },
  );
}
