"use client";

import { useState } from "react";
import { HeadphoneRecommendationCard, HeadphoneSignalBreakdownItem } from "@/lib/types";

interface Props {
  card: HeadphoneRecommendationCard;
  index: number;
}

function ScoreBar({ score, weight }: { score: number; weight: number }) {
  const pct = Math.round((score / 10) * 100);
  const opacity = 0.4 + weight * 3;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          background: "var(--border, #e5e0d8)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: score >= 7 ? "var(--gold, #C9A84C)" : score >= 5 ? "#8a7d60" : "#b87333",
            opacity: Math.min(1, opacity),
            borderRadius: 2,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-dm-sans, sans-serif)",
          color: "var(--text-secondary, #8A8070)",
          minWidth: 24,
          textAlign: "right",
        }}
      >
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function SignalRow({ item }: { item: HeadphoneSignalBreakdownItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasQuote = Boolean(item.raw_quote);

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: hasQuote ? "pointer" : "default",
        }}
        onClick={() => hasQuote && setExpanded(!expanded)}
      >
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-dm-sans, sans-serif)",
            color: "var(--text-secondary, #8A8070)",
            minWidth: 140,
          }}
        >
          {item.label}
        </span>
        <ScoreBar score={item.score} weight={item.weight} />
        {hasQuote && (
          <span style={{ fontSize: 10, color: "var(--gold, #C9A84C)", minWidth: 12 }}>
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </div>
      {expanded && item.raw_quote && (
        <div
          style={{
            marginTop: 4,
            marginLeft: 148,
            padding: "6px 10px",
            background: "var(--card-2, #2A2A2A)",
            borderRadius: 6,
            borderLeft: "2px solid var(--gold, #C9A84C)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              color: "var(--text-secondary, #8A8070)",
              lineHeight: 1.5,
              fontStyle: "italic",
            }}
          >
            &ldquo;{item.raw_quote}&rdquo;
          </p>
          {item.source && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 10,
                fontFamily: "var(--font-dm-sans, sans-serif)",
                color: "var(--gold, #C9A84C)",
              }}
            >
              — {item.source}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function HeadphoneCard({ card, index }: Props) {
  const [showWatchOut, setShowWatchOut] = useState(false);
  const { device, rank, final_score, signal_breakdown, why_recommended, watch_out, data_staleness_warning, use_case_scores } = card;

  const brandColor: Record<string, string> = {
    Sony: "#003087",
    Bose: "#004B87",
    Apple: "#555555",
    Sennheiser: "#00263E",
    Jabra: "#6B1A8A",
    Samsung: "#1428A0",
    "Audio-Technica": "#D40000",
    Beyerdynamic: "#1A1A1A",
    Nothing: "#2A2A2A",
    Soundcore: "#0077B6",
  };

  const issuerBg = brandColor[device.brand] ?? "#5a5047";
  const useCaseEntries = Object.entries(use_case_scores) as [string, number][];
  const formLabel = device.form_factor === "over_ear" ? "Over-ear" : device.form_factor === "in_ear" ? "In-ear" : "On-ear";

  return (
    <div
      style={{
        background: "var(--card, #1C1C1C)",
        borderRadius: 16,
        border: "0.5px solid var(--border, #3a3530)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "0.5px solid var(--border, #3a3530)",
          background: "var(--card-2, #242424)",
        }}
      >
        {/* Rank badge */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--gold, #C9A84C)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontWeight: 700,
              color: "#1C1C1C",
            }}
          >
            {rank}
          </span>
        </div>

        {/* Brand badge */}
        <div
          style={{
            padding: "3px 8px",
            borderRadius: 6,
            background: issuerBg,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontWeight: 600,
              color: "#fff",
              letterSpacing: 0.3,
            }}
          >
            {device.brand.toUpperCase()}
          </span>
        </div>

        {/* Name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              fontFamily: "var(--font-playfair, serif)",
              fontWeight: 600,
              color: "var(--text-primary, #F0EAD6)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {device.name}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              color: "var(--text-secondary, #8A8070)",
            }}
          >
            {formLabel} · {device.wireless ? "Wireless" : "Wired"} · {device.weight_g}g
          </p>
        </div>

        {/* Score */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 20,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontWeight: 700,
              color: "var(--gold, #C9A84C)",
              lineHeight: 1,
            }}
          >
            {final_score.toFixed(1)}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              color: "var(--text-secondary, #8A8070)",
            }}
          >
            /10
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px" }}>

        {/* Price + tags */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontWeight: 700,
              color: "var(--text-primary, #F0EAD6)",
            }}
          >
            From ${device.price_usd.toLocaleString()}
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {data_staleness_warning && (
              <span
                style={{
                  padding: "3px 8px",
                  borderRadius: 20,
                  border: "0.5px solid #E8A020",
                  fontSize: 11,
                  fontFamily: "var(--font-dm-sans, sans-serif)",
                  color: "#E8A020",
                }}
              >
                Data may be dated
              </span>
            )}
          </div>
        </div>

        {/* Use case scores */}
        {useCaseEntries.length > 1 && (
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {useCaseEntries.map(([uc, score]) => (
              <div
                key={uc}
                style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  background: "var(--card-2, #2A2A2A)",
                  border: "0.5px solid var(--border, #3a3530)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-dm-sans, sans-serif)",
                    color: "var(--text-secondary, #8A8070)",
                    textTransform: "capitalize",
                  }}
                >
                  {uc.replace(/_/g, " ")}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: "var(--font-dm-sans, sans-serif)",
                    fontWeight: 600,
                    color: "var(--gold, #C9A84C)",
                  }}
                >
                  {(score as number).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Why recommended */}
        <div
          style={{
            padding: "10px 12px",
            background: "var(--card-2, #2A2A2A)",
            borderRadius: 8,
            borderLeft: "3px solid var(--gold, #C9A84C)",
            marginBottom: 12,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontWeight: 500,
              color: "#8B6914",
              marginBottom: 3,
            }}
          >
            Why it fits
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              color: "var(--text-primary, #F0EAD6)",
              lineHeight: 1.5,
            }}
          >
            {why_recommended}
          </p>
        </div>

        {/* Signal breakdown */}
        <div style={{ marginBottom: 12 }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontWeight: 600,
              color: "var(--text-secondary, #8A8070)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Signal Breakdown
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {signal_breakdown.map((item) => (
              <SignalRow key={item.signal_type} item={item} />
            ))}
          </div>
        </div>

        {/* Watch out */}
        {watch_out.length > 0 && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(232, 160, 32, 0.08)",
              borderRadius: 8,
              borderLeft: "3px solid #E8A020",
              marginBottom: 12,
            }}
          >
            <button
              onClick={() => setShowWatchOut(!showWatchOut)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-dm-sans, sans-serif)",
                  fontWeight: 500,
                  color: "#8B5E14",
                }}
              >
                Watch out ({watch_out.length})
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#E8A020" }}>
                {showWatchOut ? "▲" : "▼"}
              </span>
            </button>
            {showWatchOut && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
                {watch_out.map((note, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 13,
                      fontFamily: "var(--font-dm-sans, sans-serif)",
                      color: "#6B4A1A",
                      lineHeight: 1.5,
                      marginBottom: 4,
                    }}
                  >
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 10,
            borderTop: "0.5px solid var(--border, #3a3530)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-dm-sans, sans-serif)",
              color: "var(--text-secondary, #8A8070)",
            }}
          >
            Verified {device.last_verified} · Prices are MSRP, verify before purchase
          </span>
        </div>
      </div>
    </div>
  );
}
