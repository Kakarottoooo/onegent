"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SharedCard {
  name: string;
  rank: number;
  why_recommended: string;
  score: number;
}

export default function SharePage() {
  const params = useParams();
  const token = params?.token as string | undefined;
  const [cards, setCards] = useState<SharedCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("This share link looks invalid. Ask the sender to resend it.");
      setLoading(false);
      return;
    }

    try {
      const decoded = atob(token);
      const data = JSON.parse(decoded);
      setCards(Array.isArray(data) ? data : []);
    } catch {
      setError("This share link looks corrupted. Ask the sender to resend it.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          backgroundColor: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-dm-sans)",
          color: "var(--text-secondary)",
        }}
      >
        Loading...
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        backgroundColor: "var(--bg)",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: "560px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "13px",
              color: "var(--text-muted)",
              marginBottom: "8px",
            }}
          >
            Shared by
          </p>
          <h1
            style={{
              fontFamily: "var(--font-playfair)",
              fontSize: "28px",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            Onegent<span style={{ color: "var(--gold)" }}>.</span>
          </h1>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginTop: "8px",
            }}
          >
            Top restaurant picks
          </p>
        </div>

        {error ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-dm-sans)",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {cards.map((card) => (
              <div
                key={card.rank}
                style={{
                  backgroundColor: "var(--card)",
                  borderRadius: "16px",
                  border: "0.5px solid var(--border)",
                  padding: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      backgroundColor: "var(--text-primary)",
                      color: "var(--bg)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: 600,
                      fontFamily: "var(--font-dm-sans)",
                      flexShrink: 0,
                    }}
                  >
                    {card.rank}
                  </div>
                  <h2
                    style={{
                      fontFamily: "var(--font-playfair)",
                      fontSize: "18px",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    {card.name}
                  </h2>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--gold)",
                    }}
                  >
                    {card.score.toFixed(1)}
                  </span>
                </div>
                <div
                  style={{
                    backgroundColor: "var(--why-bg)",
                    borderLeft: "3px solid var(--gold)",
                    borderRadius: "0 8px 8px 0",
                    padding: "10px 12px",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "13px",
                      color: "var(--why-text)",
                      lineHeight: 1.5,
                    }}
                  >
                    {card.why_recommended}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            textAlign: "center",
            marginTop: "32px",
            fontFamily: "var(--font-dm-sans)",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          <a href="/" style={{ color: "var(--gold)", textDecoration: "none" }}>
            Try Onegent for yourself →
          </a>
        </div>
      </div>
    </main>
  );
}
