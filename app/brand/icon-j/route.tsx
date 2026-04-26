/**
 * Option J — Orbit: large ring + offset small ring + connecting dot.
 * Suggests round trip / orbit / departure-return. Coral + cream on black.
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
        {/* Big ring (planet) */}
        <div
          style={{
            position: "absolute",
            top: 96,
            left: 96,
            width: 320,
            height: 320,
            borderRadius: 320,
            border: "16px solid #f5e6c8",
            display: "flex",
          }}
        />
        {/* Small ring (moon orbit) — top-right corner */}
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 326,
            width: 130,
            height: 130,
            borderRadius: 130,
            border: "10px solid #ff6b6b",
            display: "flex",
          }}
        />
        {/* Connection dot — where orbits intersect */}
        <div
          style={{
            position: "absolute",
            top: 180,
            left: 326,
            width: 30,
            height: 30,
            borderRadius: 30,
            background: "#ff6b6b",
            display: "flex",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
