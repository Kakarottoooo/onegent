"use client";

/**
 * ProfilePicker — bottom sheet shown before any booking starts.
 *
 * Behavior:
 *   0 profiles → prompt to set one up
 *   1 profile  → confirm card, tap to proceed
 *   2+ profiles → tap a card to select and proceed
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileRecord {
  id: number;
  label: string;
  is_default: boolean;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  card_number_masked?: string;
  card_expiry?: string;
}

export interface PickedProfile {
  profileId: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface ProfilePickerProps {
  /** Called with the chosen profile data when user confirms. */
  onSelect: (picked: PickedProfile) => void;
  /** Called when user dismisses without selecting. */
  onCancel: () => void;
}

export default function ProfilePicker({ onSelect, onCancel }: ProfilePickerProps) {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/user/booking-profiles")
      .then((r) => r.json())
      .then(({ profiles: list }) => setProfiles(list ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const s = {
    overlay: {
      position: "fixed" as const,
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.45)",
      zIndex: 1000,
      display: "flex",
      alignItems: "flex-end",
    },
    sheet: {
      width: "100%",
      maxWidth: 520,
      margin: "0 auto",
      backgroundColor: "var(--background, #fafaf9)",
      borderRadius: "20px 20px 0 0",
      padding: "0 0 env(safe-area-inset-bottom, 16px)",
      boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
      maxHeight: "80vh",
      overflowY: "auto" as const,
    },
    handle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: "var(--border, #e5e7eb)",
      margin: "12px auto 16px",
    },
    title: {
      fontFamily: "var(--font-dm-sans)", fontSize: 15, fontWeight: 700,
      color: "var(--text-primary, #111)", textAlign: "center" as const,
      marginBottom: 4,
    },
    subtitle: {
      fontFamily: "var(--font-dm-sans)", fontSize: 12,
      color: "var(--text-muted, #aaa)", textAlign: "center" as const,
      marginBottom: 20,
    },
    profileCard: (selected: boolean) => ({
      display: "flex", alignItems: "center", gap: 12,
      padding: "14px 16px", borderRadius: 14, cursor: "pointer",
      border: `1.5px solid ${selected ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)"}`,
      backgroundColor: selected ? "rgba(201,168,76,0.06)" : "var(--card, #fff)",
      marginBottom: 10, transition: "border-color 0.15s, background 0.15s",
    }),
    cancelBtn: {
      display: "block", width: "100%", padding: "12px 0",
      fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600,
      color: "var(--text-secondary, #666)", background: "none", border: "none",
      cursor: "pointer", marginTop: 4,
    },
    setupBtn: {
      display: "block", width: "100%", padding: "12px 0",
      fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600,
      color: "#fff", backgroundColor: "var(--gold, #C9A84C)", border: "none",
      borderRadius: 12, cursor: "pointer", marginBottom: 10,
    },
  };

  return (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={s.sheet}>
        <div style={s.handle} />

        <div style={{ padding: "0 20px 20px" }}>
          {loading ? (
            <p style={{ ...s.subtitle, marginTop: 20 }}>Loading profiles…</p>
          ) : profiles.length === 0 ? (
            /* ── No profile set up ─────────────────────────────────────── */
            <>
              <p style={s.title}>Set up a profile first</p>
              <p style={s.subtitle}>Add your name, email, and phone so the agent can fill booking forms.</p>
              <button style={s.setupBtn} onClick={() => router.push("/account?tab=profiles")}>
                Go to My Profiles →
              </button>
              <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
            </>
          ) : profiles.length === 1 ? (
            /* ── Single profile — confirm to proceed ───────────────────── */
            <>
              <p style={s.title}>Book with this profile?</p>
              <p style={s.subtitle}>The agent will use this identity to fill booking forms.</p>
              <div style={s.profileCard(true)} onClick={() => onSelect({ profileId: profiles[0].id, first_name: profiles[0].first_name, last_name: profiles[0].last_name, email: profiles[0].email, phone: profiles[0].phone, address_line1: profiles[0].address_line1, city: profiles[0].city, state: profiles[0].state, zip: profiles[0].zip, country: profiles[0].country })}>
                <span style={{ fontSize: 22 }}>👤</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "var(--text-primary, #111)" }}>
                    {profiles[0].label}
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--gold, #C9A84C)", backgroundColor: "rgba(201,168,76,0.1)", padding: "1px 7px", borderRadius: 20 }}>
                      Default
                    </span>
                  </p>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-muted, #aaa)" }}>
                    {[profiles[0].first_name, profiles[0].last_name].filter(Boolean).join(" ")}
                    {profiles[0].email && ` · ${profiles[0].email}`}
                  </p>
                  {profiles[0].card_number_masked && (
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 2 }}>
                      💳 {profiles[0].card_number_masked}
                      {profiles[0].card_expiry && ` · ${profiles[0].card_expiry}`}
                    </p>
                  )}
                </div>
                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 700, color: "var(--gold, #C9A84C)" }}>
                  Book →
                </span>
              </div>
              <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
            </>
          ) : (
            /* ── Multiple profiles — tap to select ─────────────────────── */
            <>
              <p style={s.title}>Which profile should book?</p>
              <p style={s.subtitle}>Tap a profile to use it for this booking.</p>
              {profiles.map((p) => (
                <div key={p.id} style={s.profileCard(p.is_default)} onClick={() => onSelect({ profileId: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email, phone: p.phone, address_line1: p.address_line1, city: p.city, state: p.state, zip: p.zip, country: p.country })}>
                  <span style={{ fontSize: 22 }}>👤</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "var(--text-primary, #111)" }}>
                      {p.label}
                      {p.is_default && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--gold, #C9A84C)", backgroundColor: "rgba(201,168,76,0.1)", padding: "1px 7px", borderRadius: 20 }}>
                          Default
                        </span>
                      )}
                    </p>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-muted, #aaa)" }}>
                      {[p.first_name, p.last_name].filter(Boolean).join(" ")}
                      {p.email && ` · ${p.email}`}
                    </p>
                    {p.card_number_masked && (
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 2 }}>
                        💳 {p.card_number_masked}
                        {p.card_expiry && ` · ${p.card_expiry}`}
                      </p>
                    )}
                  </div>
                  <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 18, color: "var(--text-muted, #ccc)" }}>›</span>
                </div>
              ))}
              <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
