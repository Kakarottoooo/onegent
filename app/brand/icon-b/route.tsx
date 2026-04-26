/**
 * Option B — Inverse: dark serif O on cream.
 * Editorial / book-cover vibe. Premium publication feel.
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
          background: "#f5e6c8",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 380,
            fontWeight: 900,
            color: "#0a0e1a",
            letterSpacing: "-0.04em",
            lineHeight: 1,
            marginBottom: 24,
          }}
        >
          O
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
