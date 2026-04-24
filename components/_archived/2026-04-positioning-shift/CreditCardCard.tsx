"use client";

import { useState } from "react";
import type { CreditCardRecommendationCard } from "@/lib/types";

interface CreditCardCardProps {
  card: CreditCardRecommendationCard;
  index: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  dining: "Dining",
  groceries: "Groceries",
  travel: "Travel",
  gas: "Gas",
  online_shopping: "Online Shopping",
  streaming: "Streaming",
  entertainment: "Entertainment",
  pharmacy: "Pharmacy",
  rent: "Rent",
  other: "Everything Else",
};

const ISSUER_COLORS: Record<string, string> = {
  Chase: "#117ACA",
  "American Express": "#016FD0",
  Citi: "#003B8E",
  "Capital One": "#C8102E",
  Discover: "#F76B20",
  "Wells Fargo": "#CD1409",
  "Bank of America": "#E31837",
  "US Bank": "#003087",
  "Fidelity / Elan": "#00754A",
};

export default function CreditCardCard({ card, index }: CreditCardCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { card: cc, rank, annual_net_benefit, marginal_value, category_breakdown, signup_bonus_value, reward_preference, why_recommended, watch_out } = card;

  const issuerColor = ISSUER_COLORS[cc.issuer] ?? "#C9A84C";
  const gainSign = marginal_value >= 0 ? "+" : "";
  const bonusEstimate = Math.round(signup_bonus_value);
  const annualGain = Math.round(marginal_value);
  const hasSignupBonus = cc.signup_bonus_points > 0;

  return (
    <div
      style={{
        backgroundColor: "var(--card)",
        border: "0.5px solid var(--border)",
        borderRadius: "16px",
        overflow: "hidden",
        fontFamily: "var(--font-dm-sans)",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          background: `linear-gradient(135deg, ${issuerColor}18, ${issuerColor}08)`,
          borderBottom: `0.5px solid ${issuerColor}30`,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
        }}
      >
        {/* Rank badge */}
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            backgroundColor: "var(--bg-secondary)",
            border: "1.5px solid var(--gold)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--gold)",
            flexShrink: 0,
          }}
        >
          {rank}
        </div>

        {/* Card name & issuer */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-playfair)",
              fontSize: "17px",
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.3,
            }}
          >
            {cc.name}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-secondary)",
              marginTop: "2px",
            }}
          >
            {cc.issuer} · {cc.rewards_currency}
          </div>
        </div>

        {/* Annual fee pill */}
        <div
          style={{
            backgroundColor: cc.annual_fee === 0 ? "#2A3D2A" : "var(--card-2)",
            border: `0.5px solid ${cc.annual_fee === 0 ? "#4CAF50" : "var(--border)"}`,
            borderRadius: "20px",
            padding: "3px 10px",
            fontSize: "12px",
            fontWeight: 500,
            color: cc.annual_fee === 0 ? "#4CAF50" : "var(--text-secondary)",
            flexShrink: 0,
          }}
        >
          {cc.annual_fee === 0 ? "No annual fee" : `$${cc.annual_fee}/yr`}
        </div>
      </div>

      {/* Net gain summary */}
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* Annual net gain */}
        <div
          style={{
            flex: "1 1 140px",
            backgroundColor: marginal_value >= 0 ? "#1A2E1A" : "#2E1A1A",
            border: `0.5px solid ${marginal_value >= 0 ? "#4CAF5040" : "#F4433640"}`,
            borderRadius: "10px",
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              marginBottom: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Annual Net Gain
          </div>
          <div
            style={{
              fontSize: "22px",
              fontWeight: 700,
              color: marginal_value >= 0 ? "#4CAF50" : "#F44336",
            }}
          >
            {gainSign}${Math.abs(annualGain)}
            <span
              style={{
                fontSize: "12px",
                fontWeight: 400,
                color: "var(--text-secondary)",
                marginLeft: "4px",
              }}
            >
              /yr
            </span>
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              marginTop: "3px",
            }}
          >
            vs your current cards
          </div>
        </div>

        {/* Signup bonus */}
        {hasSignupBonus && (
          <div
            style={{
              flex: "1 1 140px",
              backgroundColor: "var(--card-2)",
              border: "0.5px solid var(--gold-muted, #C9A84C40)",
              borderRadius: "10px",
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                marginBottom: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Signup Bonus
            </div>
            <div
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "var(--gold)",
              }}
            >
              ≈${bonusEstimate.toLocaleString()}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                marginTop: "3px",
              }}
            >
              {cc.signup_bonus_points.toLocaleString()} pts · one-time
            </div>
          </div>
        )}
      </div>

      {/* Why recommended */}
      <div
        style={{
          margin: "0 20px 14px",
          backgroundColor: "var(--card-2)",
          borderLeft: "3px solid var(--gold)",
          borderRadius: "0 8px 8px 0",
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--gold)",
            marginBottom: "4px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Why it fits
        </div>
        <div
          style={{
            fontSize: "13px",
            color: "var(--text-primary)",
            lineHeight: 1.5,
          }}
        >
          {why_recommended}
        </div>
      </div>

      {/* Category breakdown */}
      {category_breakdown.length > 0 && (
        <div style={{ padding: "0 20px 14px" }}>
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "8px",
            }}
          >
            Category Improvements
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {category_breakdown
              .sort((a, b) => b.annual_gain - a.annual_gain)
              .map((item) => (
                <div
                  key={item.category}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "13px",
                  }}
                >
                  <span
                    style={{
                      flex: "0 0 120px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                    {item.old_rate}x →
                  </span>
                  <span style={{ color: "#4CAF50", fontWeight: 600 }}>
                    {item.new_rate}x
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      color: "#4CAF50",
                      fontWeight: 500,
                      fontSize: "13px",
                    }}
                  >
                    +${Math.round(item.annual_gain)}/yr
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Signup bonus details (expandable) */}
      {hasSignupBonus && (
        <div style={{ padding: "0 20px 14px" }}>
          <div
            style={{
              backgroundColor: "#2A2A1A",
              border: "0.5px solid #C9A84C30",
              borderRadius: "8px",
              padding: "10px 14px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--gold)",
                fontWeight: 500,
                marginBottom: "4px",
              }}
            >
              Signup Bonus Details
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Earn {cc.signup_bonus_points.toLocaleString()} {cc.rewards_currency} points
              {cc.signup_bonus_spend_requirement > 0 &&
                ` after spending $${cc.signup_bonus_spend_requirement.toLocaleString()} in the first ${cc.signup_bonus_timeframe_months} months`}.
              {" "}Estimated value: <strong style={{ color: "var(--text-primary)" }}>≈${bonusEstimate.toLocaleString()}</strong>
              {" "}({cc.rewards_currency === "cash"
                ? "cash"
                : reward_preference === "cash"
                  ? "cash redemption — higher value via transfer partners"
                  : "redeemed for travel"}).
            </div>
          </div>
        </div>
      )}

      {/* Divider + footer */}
      <div
        style={{
          borderTop: "0.5px solid var(--border)",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        {/* Badges */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {!cc.foreign_transaction_fee && (
            <span
              style={{
                fontSize: "11px",
                color: "#4CAF50",
                border: "0.5px solid #4CAF5040",
                borderRadius: "12px",
                padding: "2px 8px",
              }}
            >
              No FTF
            </span>
          )}
          {cc.min_credit_score && (
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                border: "0.5px solid var(--border)",
                borderRadius: "12px",
                padding: "2px 8px",
              }}
            >
              {cc.min_credit_score}+ credit
            </span>
          )}
          <span
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              border: "0.5px solid var(--border)",
              borderRadius: "12px",
              padding: "2px 8px",
            }}
          >
            Verified {cc.last_verified}
          </span>
        </div>

        {/* Watch out toggle */}
        <button
          onClick={() => setExpanded((p) => !p)}
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 0",
          }}
        >
          {expanded ? "Hide notes ↑" : "Watch out ↓"}
        </button>
      </div>

      {/* Watch out expanded */}
      {expanded && (
        <div
          style={{
            borderTop: "0.5px solid var(--border)",
            backgroundColor: "#2A1A0A",
            padding: "12px 20px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color: "#E8A020",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "8px",
            }}
          >
            Watch out
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
            {watch_out.map((note, i) => (
              <li
                key={i}
                style={{
                  fontSize: "12px",
                  color: "#C8956A",
                  lineHeight: 1.5,
                  paddingLeft: "12px",
                  position: "relative",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    color: "#E8A020",
                  }}
                >
                  ·
                </span>
                {note}
              </li>
            ))}
          </ul>
          <div
            style={{
              marginTop: "10px",
              fontSize: "11px",
              color: "var(--text-secondary)",
              fontStyle: "italic",
            }}
          >
            Rewards rates and annual fees subject to change. Confirm terms at the issuer&apos;s website before applying.
          </div>
        </div>
      )}
    </div>
  );
}
