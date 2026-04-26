/**
 * Option I — Polar Compass: ring with vertical + horizontal axes.
 * Cardinal directions / map / orientation. Royal blue + white.
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
          background: "linear-gradient(135deg, #050d1f 0%, #0c1d3f 100%)",
          position: "relative",
        }}
      >
        {/* Ring */}
        <div
          style={{
            width: 340,
            height: 340,
            borderRadius: 340,
            border: "18px solid #ffffff",
            display: "flex",
          }}
        />
        {/* Horizontal axis */}
        <div
          style={{
            position: "absolute",
            top: 248,
            left: 70,
            width: 372,
            height: 16,
            background: "#ffffff",
          }}
        />
        {/* Vertical axis */}
        <div
          style={{
            position: "absolute",
            top: 70,
            left: 248,
            width: 16,
            height: 372,
            background: "#ffffff",
          }}
        />
        {/* Center dot accent */}
        <div
          style={{
            position: "absolute",
            top: 232,
            left: 232,
            width: 48,
            height: 48,
            borderRadius: 48,
            background: "#3b82f6",
            display: "flex",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
