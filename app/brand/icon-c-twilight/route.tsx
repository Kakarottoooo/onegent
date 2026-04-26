/**
 * C-twilight — C's structure with G's twilight palette.
 * Pink + lavender on deep purple gradient. Romantic / arrival energy.
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
          background: "linear-gradient(135deg, #1a0a2e 0%, #4a1e6e 100%)",
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
        {/* Horizon line through middle */}
        <div
          style={{
            position: "absolute",
            top: 246,
            left: 56,
            width: 400,
            height: 20,
            background: "#c084fc",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
