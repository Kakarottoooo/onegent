/**
 * Option D — Wordmark "On." in serif on deep ink.
 * Type-as-logo (Stripe / Notion approach). Identity-forward, less abstract.
 * The period adds emphasis (statement / arrival).
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
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            fontSize: 220,
            fontWeight: 900,
            color: "#f5e6c8",
            letterSpacing: "-0.05em",
            lineHeight: 1,
          }}
        >
          On
          <span style={{ color: "#d4a443", marginLeft: -8 }}>.</span>
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
