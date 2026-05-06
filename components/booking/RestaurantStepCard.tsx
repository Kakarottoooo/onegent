"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserModelForStagehand } from "@/lib/agent-model-config";

interface RestaurantStepCardProps {
  /** Optional default city pre-filled from trip context */
  defaultCity?: string;
  /** Optional callback after job is created (e.g. to refresh a job list) */
  onCreated?: (jobId: string) => void;
}

// Generate time options from 11:00 to 22:00 in 30-min steps
function buildTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let h = 11; h <= 22; h++) {
    for (const m of [0, 30]) {
      if (h === 22 && m === 30) break;
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = buildTimeOptions();
const today = new Date().toISOString().split("T")[0];

export default function RestaurantStepCard({
  defaultCity = "",
  onCreated,
}: RestaurantStepCardProps) {
  const router = useRouter();
  const [restaurantName, setRestaurantName] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [covers, setCovers] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canSubmit =
    restaurantName.trim().length > 0 && date >= today && !loading;

  async function handleBook() {
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      const profileRes = await fetch("/api/user/booking-profiles?default=true");
      const { profile } = await profileRes.json();
      if (!profile) { setError("Set up your booking profile in Settings first — we need a name, email, and phone to confirm reservations."); return; }
      await proceedWithProfile(profile);
    } finally {
      setLoading(false);
    }
  }

  async function proceedWithProfile(profile: { id: number; first_name: string; last_name: string; email: string; phone: string }) {
    setError("");

    try {
      const sessionId =
        localStorage.getItem("session_id") ?? crypto.randomUUID();
      if (!localStorage.getItem("session_id")) {
        localStorage.setItem("session_id", sessionId);
      }
      const agentModel = getBrowserModelForStagehand() ?? undefined;

      const step = {
        type: "restaurant" as const,
        emoji: "🍽️",
        label: restaurantName.trim(),
        apiEndpoint: "/api/booking-jobs/start",
        body: {
          restaurantName: restaurantName.trim(),
          city: city.trim(),
          date,
          time,
          covers,
          profileId: profile.id,
          profile: {
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
            phone: profile.phone,
          },
          agentModel,
        },
        fallbackUrl: `https://www.opentable.com/s?term=${encodeURIComponent(restaurantName.trim())}&covers=${covers}&dateTime=${date}T${time}:00`,
        status: "pending" as const,
      };

      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          trip_label: restaurantName.trim(),
          steps: [step],
        }),
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create job: ${createRes.status}`);
      }

      const { jobId } = await createRes.json();
      // Kick off the job in background
      fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, { method: "POST" }).catch(
        () => {}
      );

      onCreated?.(jobId);
      if (!onCreated) {
        router.push(`/tasks?view=live&focus=${encodeURIComponent(jobId)}`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "0.5px solid var(--border, #e5e7eb)",
    background: "var(--card, #fff)",
    fontFamily: "var(--font-dm-sans, sans-serif)",
    fontSize: 13,
    boxSizing: "border-box",
    color: "var(--text-primary, #111)",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-dm-sans, sans-serif)",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted, #999)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    marginBottom: 4,
  };

  return (
    <>
      <div
        style={{
          background: "var(--card, #fff)",
          border: "0.5px solid var(--border, #e5e7eb)",
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🍽️</span>
          <span
            style={{
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text-primary, #111)",
            }}
          >
            Book a Restaurant
          </span>
        </div>

        {/* Restaurant name */}
        <div>
          <p style={labelStyle}>Restaurant name</p>
          <input
            type="text"
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            placeholder="e.g. Nobu Fifty Seven"
            style={inputStyle}
          />
        </div>

        {/* City */}
        <div>
          <p style={labelStyle}>City (optional)</p>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. New York"
            style={inputStyle}
          />
        </div>

        {/* Date + Time row */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <p style={labelStyle}>Date</p>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <p style={labelStyle}>Time</p>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              style={inputStyle}
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Party size */}
        <div>
          <p style={labelStyle}>Party size</p>
          <select
            value={covers}
            onChange={(e) => setCovers(Number(e.target.value))}
            style={inputStyle}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "person" : "people"}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p
            style={{
              fontFamily: "var(--font-dm-sans, sans-serif)",
              fontSize: 12,
              color: "#dc2626",
              margin: 0,
            }}
          >
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          onClick={handleBook}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: canSubmit ? "var(--gold, #D4A34B)" : "#e5e7eb",
            color: canSubmit ? "#fff" : "#999",
            fontFamily: "var(--font-dm-sans, sans-serif)",
            fontSize: 13,
            fontWeight: 700,
            cursor: canSubmit ? "pointer" : "not-allowed",
            transition: "background 0.15s",
          }}
        >
          {loading ? "Creating booking job…" : "🤖 Auto-book on OpenTable"}
        </button>
      </div>

    </>
  );
}
