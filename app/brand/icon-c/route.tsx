/**
 * Option C — Horizon O: geometric ring with horizon line through it.
 * Modern minimalist (Vercel / Linear vibe). Suggests journey / horizon.
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
          background: "#0a0a0a",
          position: "relative",
        }}
      >
        {/* Ring */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 320,
            border: "20px solid #e8e0d0",
            display: "flex",
          }}
        />
        {/* Horizon line passing through the ring's middle */}
        <div
          style={{
            position: "absolute",
            top: 246,
            left: 56,
            width: 400,
            height: 20,
            background: "#e8e0d0",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
