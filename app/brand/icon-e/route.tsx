/**
 * Option E — Stacked monogram: capital O + small "negent" subscript.
 * Editorial / law-firm crest vibe. Says the full brand at large sizes,
 * collapses to clean O at small sizes.
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
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0e1a",
          fontFamily: "Georgia, 'Times New Roman', serif",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 320,
            fontWeight: 900,
            color: "#f5e6c8",
            letterSpacing: "-0.04em",
            lineHeight: 0.85,
            display: "flex",
          }}
        >
          O
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 400,
            color: "#d4a443",
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            display: "flex",
            marginTop: 24,
          }}
        >
          NEGENT
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
