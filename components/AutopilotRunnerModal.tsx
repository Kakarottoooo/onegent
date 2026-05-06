"use client";

import { useState, useEffect } from "react";
import { ConnectAccountsModal } from "./ConnectAccountsModal";

import { loadAutonomySettings } from "@/lib/autonomy";
import { buildTaskWorkspaceHref } from "@/lib/booking-jobs/workspace";

export interface BookableFallbackCandidate {
  label: string;
  body: Record<string, unknown>;
  fallbackUrl: string;
}

export interface BookableStep {
  type: "flight" | "hotel" | "restaurant";
  emoji: string;
  label: string;
  apiEndpoint: string;
  body: Record<string, unknown>;
  fallbackUrl: string;
  /** Backup alternatives tried by the recovery engine if the primary fails */
  fallbackCandidates?: BookableFallbackCandidate[];
  /**
   * For restaurants: adjacent time slots the agent will try automatically
   * before giving up (e.g. ["19:30", "18:30", "20:00"]).
   */
  timeFallbacks?: string[];
}

interface Props {
  open: boolean;
  steps: BookableStep[];
  tripLabel?: string;
  onClose: () => void;
}

export function AutopilotRunnerModal({ open, steps, tripLabel, onClose }: Props) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [bgJobId, setBgJobId] = useState<string | null>(null);
  const [bgSent, setBgSent] = useState(false);

  // Send job to background (server-side execution)
  async function sendToBackground() {
    const sessionId = localStorage.getItem("session_id") ?? crypto.randomUUID();
    const autonomySettings = loadAutonomySettings();
    // Create the job — include autonomy settings so the worker knows the boundaries
    const res = await fetch("/api/booking-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        trip_label: tripLabel ?? "My Trip",
        steps,
        autonomy_settings: autonomySettings,
      }),
    });
    const data = await res.json();
    const jobId: string = data.jobId;
    setBgJobId(jobId);
    setBgSent(true);

    // Fire-and-forget the start endpoint — keepalive keeps it alive if page closes
    fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }

  // Send to background immediately when opened
  useEffect(() => {
    if (!open || steps.length === 0) return;
    setBgSent(false);
    setBgJobId(null);
    sendToBackground();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--card, #fff)",
          borderRadius: 20,
          width: "100%",
          maxWidth: 540,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          border: "0.5px solid var(--border, #e5e7eb)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "0.5px solid var(--border, #e5e7eb)",
          }}
        >
          <span style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 15 }}>
            Booking your trip…
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href="/account?tab=controls"
              title="Agent permissions"
              style={{
                background: "none",
                border: "0.5px solid var(--border, #e5e7eb)",
                borderRadius: 8,
                padding: "4px 10px",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                color: "var(--text-secondary, #666)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              ⚙ Permissions
            </a>
            <button
              onClick={() => setConnectOpen(true)}
              style={{
                background: "none",
                border: "0.5px solid var(--border, #e5e7eb)",
                borderRadius: 8,
                padding: "4px 10px",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                color: "var(--text-secondary, #666)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              🔑 Accounts
            </button>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted, #888)", lineHeight: 1, padding: "0 4px" }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Nested modals */}
        <ConnectAccountsModal open={connectOpen} onClose={() => setConnectOpen(false)} />

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

          {/* ── Before action: trust panel ─────────────────────────────────
               Shows what the agent is allowed to change, before it acts.
               Only shown while steps haven't started yet.               */}
          {!bgSent && (() => {
            const a = loadAutonomySettings();
            const signals: string[] = [];
            if (a.restaurant.timeWindowMinutes > 0)
              signals.push(`Shift restaurant time ±${a.restaurant.timeWindowMinutes} min`);
            if (a.restaurant.allowVenueSwitch)
              signals.push("Switch to a backup restaurant if primary is unavailable");
            if (a.hotel.allowAreaSwitch)
              signals.push("Try a nearby area hotel if first choice is full");
            if (a.flight.allowLayover)
              signals.push("Try 1-stop flights when no direct is available");
            if (a.flight.allowAlternateAirport)
              signals.push("Try nearby airports (e.g. JFK ↔ LGA ↔ EWR)");
            if (signals.length === 0) return null;
            return (
              <div style={{
                marginBottom: 16, padding: "12px 14px", borderRadius: 10,
                background: "rgba(74,154,74,0.06)", border: "0.5px solid rgba(74,154,74,0.25)",
              }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
                  color: "rgba(74,154,74,0.9)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  What the agent can do automatically
                </p>
                {signals.map((s) => (
                  <p key={s} style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12,
                    color: "var(--text-secondary, #666)", marginBottom: 3, display: "flex", gap: 6 }}>
                    <span style={{ color: "rgba(74,154,74,0.8)", flexShrink: 0 }}>✓</span>{s}
                  </p>
                ))}
              </div>
            );
          })()}

          {/* Background booking sent */}
          {bgSent && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  borderRadius: 12,
                  backgroundColor: "rgba(212,163,75,0.07)",
                  border: "0.5px solid rgba(212,163,75,0.3)",
                  padding: "16px",
                  textAlign: "center",
                }}
              >
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 22, marginBottom: 8 }}>✈</p>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                  Booking in progress
                </p>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", lineHeight: 1.6 }}>
                  Running in the background — you&apos;ll get a push notification when ready.
                  You can close this window.
                </p>
              </div>
              <button
                onClick={() => {
                  const href = bgJobId
                    ? buildTaskWorkspaceHref(bgJobId, "live", "evidence")
                    : "/tasks";
                  window.location.href = href;
                }}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 10,
                  border: "none",
                  backgroundColor: "var(--gold, #D4A34B)",
                  color: "#fff",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                View My Trips →
              </button>
              <button
                onClick={onClose}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: 10,
                  border: "0.5px solid var(--border, #e5e7eb)",
                  background: "transparent",
                  color: "var(--text-secondary, #666)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
              <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10, color: "var(--text-muted, #aaa)", textAlign: "center" }}>
                Job ID: {bgJobId}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center", height: 18 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--gold, #D4A34B)",
            animation: `apulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes apulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
