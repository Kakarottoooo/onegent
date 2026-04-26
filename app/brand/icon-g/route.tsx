/**
 * Option G — Twilight: ring with horizon raised (sun setting).
 * Cool palette — pink + lavender on deep purple.
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
          background: "linear-gradient(180deg, #1a0a2e 0%, #4a1e6e 100%)",
          position: "relative",
        }}
      >
        {/* Ring */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 320,
            border: "20px solid #ff8b9a",
            display: "flex",
          }}
        />
        {/* Horizon line raised — sun setting */}
        <div
          style={{
            position: "absolute",
            top: 168,
            left: 56,
            width: 400,
            height: 18,
            background: "#c084fc",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
