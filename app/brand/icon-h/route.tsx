/**
 * Option H — Aperture: three nested concentric rings.
 * Camera iris / target / lens. Forest emerald + warm gold.
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
        {/* Outer ring */}
        <div
          style={{
            width: 380,
            height: 380,
            borderRadius: 380,
            border: "14px solid #d4a443",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Middle ring */}
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: 240,
              border: "10px solid #d4a443",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Inner solid dot */}
            <div
              style={{
                width: 110,
                height: 110,
                borderRadius: 110,
                background: "#d4a443",
                display: "flex",
              }}
            />
          </div>
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
