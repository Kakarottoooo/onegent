/**
 * Option F — Sunrise: ring with horizon lowered (sun cresting horizon).
 * Warm palette — burnt orange + amber on deep brown.
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
          background: "linear-gradient(180deg, #1a0f0a 0%, #2a1810 100%)",
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
        {/* Horizon line lowered — sun cresting */}
        <div
          style={{
            position: "absolute",
            top: 326,
            left: 56,
            width: 400,
            height: 18,
            background: "#d97a2f",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
