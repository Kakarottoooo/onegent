"use client";

/**
 * /permissions — Unified Settings hub
 *
 * Two tabs:
 *   Taste Profile  — discovered preferences + dietary restrictions
 *   Permissions    — autopilot level, time/switch/budget/hard limits
 *
 * All settings auto-save to localStorage on every change.
 */

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import GlobalNav from "@/components/GlobalNav";
import { useLanguage } from "@/app/hooks/useLanguage";
import { usePreferences } from "@/app/hooks/usePreferences";
import type { RelationshipProfile, RelationshipType } from "@/lib/memory";
import {
  loadAutonomySettings,
  saveAutonomySettings,
  DEFAULT_AUTONOMY,
  type AgentAutonomySettings,
  type AutopilotLevel,
} from "@/lib/autonomy";

const DIETARY_OPTIONS = ["Vegetarian", "Vegan", "Gluten-free", "Shellfish-free", "Halal", "Kosher"];

function getSessionId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("session_id", id);
  }
  return id;
}

// ── Deep merge helper ──────────────────────────────────────────────────────

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const result = { ...(base as object) } as Record<string, unknown>;
  for (const key of Object.keys(patch as object)) {
    const pv = (patch as Record<string, unknown>)[key];
    const bv = (base as Record<string, unknown>)[key];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && bv && typeof bv === "object")
      result[key] = deepMerge(bv, pv);
    else
      result[key] = pv;
  }
  return result as T;
}

// ── Shared sub-components ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <p style={{
      fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
      color: "var(--text-muted, #aaa)", textTransform: "uppercase",
      letterSpacing: "0.08em", marginBottom: 12, marginTop: 28,
    }}>
      {children}
    </p>
  );
}

function SubLabel({ children }: { children: string }) {
  return (
    <p style={{
      fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 600,
      color: "var(--text-muted, #aaa)", textTransform: "uppercase",
      letterSpacing: "0.06em", marginBottom: 8, marginTop: 16,
    }}>
      {children}
    </p>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary, #666)", marginBottom: 6 }}>
      {children}
    </p>
  );
}

function Seg<T extends number | string>({ options, value, onChange }: {
  options: { v: T; l: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button key={String(o.v)} onClick={() => onChange(o.v)} style={{
            padding: "5px 13px", borderRadius: 20, fontSize: 12, cursor: "pointer",
            fontFamily: "var(--font-dm-sans)", fontWeight: active ? 700 : 400,
            border: "none",
            backgroundColor: active ? "var(--gold, #C9A84C)" : "var(--card, #f5f5f4)",
            color: active ? "#fff" : "var(--text-secondary, #666)",
            transition: "background 0.15s, color 0.15s",
          }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: () => void; label: string; desc?: string }) {
  return (
    <div onClick={onChange} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "11px 14px", borderRadius: 12, cursor: "pointer",
      border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)",
      userSelect: "none",
    }}>
      <div>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-primary, #111)", marginBottom: desc ? 2 : 0 }}>
          {label}
        </p>
        {desc && <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>{desc}</p>}
      </div>
      <div style={{
        width: 36, height: 20, borderRadius: 10, flexShrink: 0, marginLeft: 12,
        backgroundColor: on ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)",
        position: "relative", transition: "background 0.2s",
      }}>
        <div style={{
          position: "absolute", top: 2, left: 2, width: 16, height: 16,
          borderRadius: "50%", backgroundColor: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          transform: on ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.2s",
        }} />
      </div>
    </div>
  );
}

const STAR_VALUES = [0, 3, 3.5, 4, 4.5] as const;

function StarRating({ value, onChange, hint }: { value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        {STAR_VALUES.map((sv, i) => (
          <button key={sv} onClick={() => onChange(sv)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
            fontSize: 24, lineHeight: 1,
            color: value >= sv && value > 0 ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)",
            transition: "color 0.15s",
          }} title={`${sv} stars`}>
            {i === 2 ? "⭑" : "★"}
          </button>
        ))}
      </div>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>{hint}</p>
    </div>
  );
}

function AutopilotCard({ level: _level, selected, onSelect, emoji, title, desc }: {
  level: AutopilotLevel; selected: boolean; onSelect: () => void;
  emoji: string; title: string; desc: string;
}) {
  return (
    <div onClick={onSelect} style={{
      flex: 1, minWidth: 0, borderRadius: 14, padding: "16px 14px", cursor: "pointer",
      border: selected ? "1.5px solid var(--gold, #C9A84C)" : "0.5px solid var(--border, #e5e7eb)",
      backgroundColor: selected ? "rgba(201,168,76,0.06)" : "var(--card, #fff)",
      transition: "border-color 0.15s, background 0.15s",
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{emoji}</div>
      <p style={{
        fontFamily: "var(--font-playfair, serif)", fontSize: 13, fontWeight: 700,
        color: selected ? "var(--gold, #C9A84C)" : "var(--text-primary, #111)", marginBottom: 4,
      }}>{title}</p>
      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11.5, color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
        {desc}
      </p>
    </div>
  );
}

function BehaviorCard({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius: 12, border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)", overflow: "hidden", marginTop: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 14px", background: "none", border: "none", cursor: "pointer",
        fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)",
      }}>
        {title}
        <span style={{ color: "var(--text-muted, #aaa)", fontSize: 12, marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "0.5px solid var(--border, #e5e7eb)" }}>
          <ul style={{ margin: "10px 0 0 0", padding: "0 0 0 16px" }}>
            {items.map((item, i) => (
              <li key={i} style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12.5, color: "var(--text-secondary, #666)", lineHeight: 1.6, marginBottom: 4 }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input type="time" value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: "100%", padding: "8px 10px", borderRadius: 8, boxSizing: "border-box",
        border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)",
        fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-primary, #111)", outline: "none",
      }} />
    </div>
  );
}

// ── Booking Profile helpers ────────────────────────────────────────────────

// ── Booking Profile types ──────────────────────────────────────────────────

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
  card_name?: string;
  card_number_masked?: string;
  card_number?: string;
  card_expiry?: string;
  // Travel documents
  date_of_birth?: string;
  nationality?: string;
  passport_number?: string;
  passport_expiry?: string;
  passport_country?: string;
  known_traveler_number?: string;
  driver_license_number?: string;
  driver_license_state?: string;
}

type ProfileInput = Partial<Omit<ProfileRecord, "id" | "card_number_masked">>;

const EMPTY_INPUT: ProfileInput = {
  label: "Personal", is_default: false,
  first_name: "", last_name: "", email: "", phone: "",
};

// ── Booking Profile tab (multi-profile, DB-backed) ─────────────────────────

function ProfileForm({ data, onChange, showCard, onToggleCard, showDocs, onToggleDocs }: {
  data: ProfileInput;
  onChange: (patch: ProfileInput) => void;
  showCard: boolean;
  onToggleCard: () => void;
  showDocs: boolean;
  onToggleDocs: () => void;
}) {
  const set = (k: keyof ProfileInput, v: string) => onChange({ ...data, [k]: v });
  const inp: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 10, boxSizing: "border-box",
    border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)",
    fontFamily: "var(--font-dm-sans)", fontSize: 14, color: "var(--text-primary, #111)", outline: "none",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <SectionLabel>Profile Name</SectionLabel>
      <input style={inp} value={data.label ?? ""} placeholder="e.g. Personal, Work, Family"
        onChange={(e) => set("label", e.target.value)} />

      <SectionLabel>Name</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <FieldLabel>First name</FieldLabel>
          <input style={inp} value={data.first_name ?? ""} placeholder="Jane"
            onChange={(e) => set("first_name", e.target.value)} />
        </div>
        <div>
          <FieldLabel>Last name</FieldLabel>
          <input style={inp} value={data.last_name ?? ""} placeholder="Smith"
            onChange={(e) => set("last_name", e.target.value)} />
        </div>
      </div>

      <SectionLabel>Contact</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <div>
          <FieldLabel>Email</FieldLabel>
          <input style={inp} type="email" value={data.email ?? ""} placeholder="jane@example.com"
            onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <FieldLabel>Phone</FieldLabel>
          <input style={inp} type="tel" value={data.phone ?? ""} placeholder="+1 555 000 0000"
            onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>

      <SectionLabel>Billing Address</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <div>
          <FieldLabel>Street address</FieldLabel>
          <input style={inp} value={data.address_line1 ?? ""} placeholder="123 Main St"
            onChange={(e) => set("address_line1", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 }}>
          <div><FieldLabel>City</FieldLabel>
            <input style={inp} value={data.city ?? ""} placeholder="Nashville"
              onChange={(e) => set("city", e.target.value)} /></div>
          <div><FieldLabel>State</FieldLabel>
            <input style={inp} value={data.state ?? ""} placeholder="TN"
              onChange={(e) => set("state", e.target.value)} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
          <div><FieldLabel>ZIP</FieldLabel>
            <input style={inp} value={data.zip ?? ""} placeholder="37201"
              onChange={(e) => set("zip", e.target.value)} /></div>
          <div><FieldLabel>Country</FieldLabel>
            <input style={inp} value={data.country ?? ""} placeholder="United States"
              onChange={(e) => set("country", e.target.value)} /></div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Payment Card
        </p>
        <span style={{ fontSize: 10, fontFamily: "var(--font-dm-sans)", padding: "2px 8px", borderRadius: 20, backgroundColor: "rgba(201,168,76,0.1)", color: "var(--gold, #C9A84C)", fontWeight: 600 }}>
          CVV never stored 🔒
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 8 }}>
        <div><FieldLabel>Name on card</FieldLabel>
          <input style={inp} value={data.card_name ?? ""} placeholder="Jane Smith"
            onChange={(e) => set("card_name", e.target.value)} /></div>
        <div><FieldLabel>Card number</FieldLabel>
          <div style={{ position: "relative" }}>
            <input style={{ ...inp, paddingRight: 44 }}
              type={showCard ? "text" : "password"}
              value={data.card_number ?? ""} placeholder="•••• •••• •••• ••••" maxLength={19}
              onChange={(e) => set("card_number", e.target.value)} />
            <button onClick={onToggleCard} style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)",
            }}>{showCard ? "Hide" : "Show"}</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
          <div><FieldLabel>Expiry (MM/YY)</FieldLabel>
            <input style={inp} value={data.card_expiry ?? ""} placeholder="12/27" maxLength={5}
              onChange={(e) => set("card_expiry", e.target.value)} /></div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", lineHeight: 1.6 }}>
              Agent fills number and expiry. You enter CVV and click Pay yourself.
            </p>
          </div>
        </div>
      </div>

      {/* Travel Documents */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, marginTop: 4 }}>
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700, color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          ✈️ Travel Documents
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--font-dm-sans)", padding: "2px 8px", borderRadius: 20, backgroundColor: "rgba(201,168,76,0.1)", color: "var(--gold, #C9A84C)", fontWeight: 600 }}>
            Passport encrypted 🔒
          </span>
          <button onClick={onToggleDocs} style={{
            fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)",
            background: "none", border: "0.5px solid var(--border, #e5e7eb)", borderRadius: 6,
            padding: "2px 8px", cursor: "pointer",
          }}>{showDocs ? "Hide" : "Show"}</button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><FieldLabel>Date of birth</FieldLabel>
            <input style={inp} value={data.date_of_birth ?? ""} placeholder="YYYY-MM-DD"
              onChange={(e) => set("date_of_birth", e.target.value)} /></div>
          <div><FieldLabel>Nationality</FieldLabel>
            <input style={inp} value={data.nationality ?? ""} placeholder="e.g. Chinese"
              onChange={(e) => set("nationality", e.target.value)} /></div>
        </div>
        <div>
          <FieldLabel>Passport number</FieldLabel>
          <div style={{ position: "relative" }}>
            <input style={{ ...inp, paddingRight: 44 }}
              type={showDocs ? "text" : "password"}
              value={data.passport_number ?? ""} placeholder="e.g. E12345678"
              onChange={(e) => set("passport_number", e.target.value)} />
            <button onClick={onToggleDocs} style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)",
            }}>{showDocs ? "Hide" : "Show"}</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><FieldLabel>Passport expiry</FieldLabel>
            <input style={inp} value={data.passport_expiry ?? ""} placeholder="YYYY-MM-DD"
              onChange={(e) => set("passport_expiry", e.target.value)} /></div>
          <div><FieldLabel>Issuing country</FieldLabel>
            <input style={inp} value={data.passport_country ?? ""} placeholder="e.g. CN, US"
              onChange={(e) => set("passport_country", e.target.value)} /></div>
        </div>
        <div><FieldLabel>Known Traveler Number (TSA PreCheck / Global Entry)</FieldLabel>
          <input style={inp} value={data.known_traveler_number ?? ""} placeholder="Optional — speeds up security"
            onChange={(e) => set("known_traveler_number", e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12 }}>
          <div><FieldLabel>Driver&apos;s license number</FieldLabel>
            <input style={{ ...inp }}
              type={showDocs ? "text" : "password"}
              value={data.driver_license_number ?? ""} placeholder="Optional"
              onChange={(e) => set("driver_license_number", e.target.value)} /></div>
          <div><FieldLabel>State / Province</FieldLabel>
            <input style={inp} value={data.driver_license_state ?? ""} placeholder="CA"
              onChange={(e) => set("driver_license_state", e.target.value)} /></div>
        </div>
      </div>
    </div>
  );
}

export function BookingProfileTab() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editData, setEditData] = useState<ProfileInput>(EMPTY_INPUT);
  const [showCard, setShowCard] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/booking-profiles");
      if (res.ok) {
        const { profiles: list } = await res.json();
        setProfiles(list ?? []);
        const def = (list ?? []).find((p: ProfileRecord) => p.is_default);
        if (def) localStorage.setItem("active_profile_id", String(def.id));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  async function openProfile(p: ProfileRecord) {
    if (expandedId === p.id) { setExpandedId(null); return; }
    setAddingNew(false);
    const res = await fetch(`/api/user/booking-profiles?id=${p.id}&card=true`);
    if (res.ok) {
      const { profile: full } = await res.json();
      setEditData({
        label: full.label, is_default: full.is_default,
        first_name: full.first_name, last_name: full.last_name,
        email: full.email, phone: full.phone,
        address_line1: full.address_line1 ?? "",
        city: full.city ?? "", state: full.state ?? "",
        zip: full.zip ?? "", country: full.country ?? "",
        card_name: full.card_name ?? "",
        card_number: full.card_number ?? "",
        card_expiry: full.card_expiry ?? "",
        date_of_birth: full.date_of_birth ?? "",
        nationality: full.nationality ?? "",
        passport_number: full.passport_number ?? "",
        passport_expiry: full.passport_expiry ?? "",
        passport_country: full.passport_country ?? "",
        known_traveler_number: full.known_traveler_number ?? "",
        driver_license_number: full.driver_license_number ?? "",
        driver_license_state: full.driver_license_state ?? "",
      });
    }
    setShowCard(false);
    setShowDocs(false);
    setExpandedId(p.id);
  }

  async function saveExisting() {
    if (!expandedId) return;
    setSaving(true);
    try {
      await fetch(`/api/user/booking-profiles/${expandedId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      await loadProfiles();
      setExpandedId(null);
    } finally { setSaving(false); }
  }

  async function saveNew() {
    setSaving(true);
    try {
      await fetch("/api/user/booking-profiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      await loadProfiles();
      setAddingNew(false);
      setEditData(EMPTY_INPUT);
    } finally { setSaving(false); }
  }

  async function deleteProfile(id: number) {
    if (profiles.length <= 1) return;
    setDeleting(true);
    try {
      await fetch(`/api/user/booking-profiles/${id}`, { method: "DELETE" });
      if (expandedId === id) setExpandedId(null);
      await loadProfiles();
    } finally { setDeleting(false); }
  }

  async function makeDefault(id: number) {
    await fetch(`/api/user/booking-profiles/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    await loadProfiles();
  }

  function startAddNew() {
    setExpandedId(null);
    setEditData({ ...EMPTY_INPUT, is_default: profiles.length === 0 });
    setShowCard(false);
    setAddingNew(true);
  }

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    padding: "9px 18px", borderRadius: 10, fontSize: 13, cursor: "pointer",
    fontFamily: "var(--font-dm-sans)", fontWeight: 600, border: "none",
    backgroundColor: primary ? "var(--gold, #C9A84C)" : "var(--card, #f5f5f4)",
    color: primary ? "#fff" : "var(--text-secondary, #666)",
  });

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted, #aaa)", fontFamily: "var(--font-dm-sans)", fontSize: 13 }}>
        Loading profiles…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "var(--text-primary, #111)" }}>
            My Profiles
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
            Card numbers encrypted on our servers. CVV never stored.
          </p>
        </div>
        {!addingNew && (
          <button onClick={startAddNew} style={btnStyle(true)}>+ Add</button>
        )}
      </div>

      {/* Profile list */}
      {profiles.length === 0 && !addingNew && (
        <div style={{
          textAlign: "center", padding: "32px 20px", borderRadius: 14,
          border: "0.5px dashed var(--border, #e5e7eb)", marginBottom: 20,
        }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)" }}>
            No profiles yet
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 4 }}>
            Add a profile to enable auto-fill during booking
          </p>
        </div>
      )}

      {profiles.map((p) => (
        <div key={p.id} style={{ marginBottom: 12 }}>
          {/* Profile card header */}
          <div
            onClick={() => openProfile(p)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px", borderRadius: expandedId === p.id ? "12px 12px 0 0" : 12,
              cursor: "pointer", userSelect: "none",
              border: `0.5px solid ${p.is_default ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)"}`,
              backgroundColor: p.is_default ? "rgba(201,168,76,0.06)" : "var(--card, #fff)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>👤</span>
              <div>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)" }}>
                  {p.label}
                  {p.is_default && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--gold, #C9A84C)", backgroundColor: "rgba(201,168,76,0.1)", padding: "1px 7px", borderRadius: 20 }}>
                      Default
                    </span>
                  )}
                </p>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
                  {[p.first_name, p.last_name].filter(Boolean).join(" ") || "No name"}
                  {p.card_number_masked && ` · ${p.card_number_masked}`}
                </p>
              </div>
            </div>
            <span style={{ color: "var(--text-muted, #aaa)", fontSize: 12 }}>{expandedId === p.id ? "▲" : "▼"}</span>
          </div>

          {/* Expanded edit form */}
          {expandedId === p.id && (
            <div style={{
              padding: "16px 14px", border: "0.5px solid rgba(255,255,255,0.08)",
              borderTop: "none", borderRadius: "0 0 12px 12px",
              backgroundColor: "#262320",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
            }}>
              <ProfileForm data={editData} onChange={setEditData} showCard={showCard} onToggleCard={() => setShowCard(v => !v)} showDocs={showDocs} onToggleDocs={() => setShowDocs(v => !v)} />
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button onClick={saveExisting} disabled={saving} style={btnStyle(true)}>
                  {saving ? "Saving…" : "Save"}
                </button>
                {!p.is_default && (
                  <button onClick={() => makeDefault(p.id)} style={btnStyle(false)}>
                    Make default
                  </button>
                )}
                <button onClick={() => setExpandedId(null)} style={btnStyle(false)}>Cancel</button>
                {profiles.length > 1 && (
                  <button onClick={() => deleteProfile(p.id)} disabled={deleting}
                    style={{ ...btnStyle(false), marginLeft: "auto", color: "#ef4444" }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add new profile form */}
      {addingNew && (
        <div style={{
          padding: "16px 14px", borderRadius: 12,
          border: "0.5px solid rgba(255,255,255,0.08)",
          backgroundColor: "#262320",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
          marginTop: 4,
        }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700, color: "var(--text-primary, #111)", marginBottom: 16 }}>
            New Profile
          </p>
          <ProfileForm data={editData} onChange={setEditData} showCard={showCard} onToggleCard={() => setShowCard(v => !v)} showDocs={showDocs} onToggleDocs={() => setShowDocs(v => !v)} />
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={saveNew} disabled={saving} style={btnStyle(true)}>
              {saving ? "Saving…" : "Create"}
            </button>
            <button onClick={() => { setAddingNew(false); setEditData(EMPTY_INPUT); }} style={btnStyle(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 20, lineHeight: 1.6 }}>
        🔒 Card numbers are AES-256 encrypted and stored securely. CVV is never saved anywhere. Final payment always requires your action.
      </p>
    </div>
  );
}

// ── AI Model tab ────────────────────────────────────────────────────────────

export interface AgentModelConfig {
  model: string;
  apiKey: string;
}

// Per-provider key storage keys in localStorage
const PROVIDER_KEY_STORAGE: Record<string, string> = {
  OpenAI: "provider_key_openai",
  Anthropic: "provider_key_anthropic",
  Google: "provider_key_google",
};

// Stagehand v3 requires "provider/model" format
const PROVIDER_GROUPS: {
  id: string;
  label: string;
  placeholder: string;
  models: { model: string; label: string; hint: string; badge?: string }[];
}[] = [
  {
    id: "OpenAI",
    label: "OpenAI",
    placeholder: "sk-...",
    models: [
      { model: "openai/gpt-4o-mini", label: "GPT-4o mini", hint: "Recommended — fast & affordable", badge: "★ Best value" },
      { model: "openai/gpt-4o-2024-08-06", label: "GPT-4o", hint: "Higher accuracy, higher cost" },
    ],
  },
  {
    id: "Anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    models: [
      { model: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "Fastest & cheapest Claude" },
      { model: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Best reasoning accuracy" },
    ],
  },
  {
    id: "Google",
    label: "Google / Gemini",
    placeholder: "AIza...",
    models: [
      { model: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Fast, free tier available" },
    ],
  },
];

export function loadAgentModelConfig(): AgentModelConfig {
  try {
    return JSON.parse(localStorage.getItem("agent_model_config") ?? "{}") as AgentModelConfig;
  } catch { return { model: "", apiKey: "" }; }
}

function saveAgentModelConfig(cfg: AgentModelConfig) {
  localStorage.setItem("agent_model_config", JSON.stringify(cfg));
}

export function AgentModelTab() {
  const [activeModel, setActiveModel] = useState("");
  // per-provider keys typed by the user (from localStorage)
  const [localKeys, setLocalKeys] = useState<Record<string, string>>({});
  // which providers have server-side env keys
  const [serverKeys, setServerKeys] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  // Load active model + per-provider keys from localStorage
  useEffect(() => {
    const cfg = loadAgentModelConfig();
    setActiveModel(cfg.model ?? "");
    const loaded: Record<string, string> = {};
    for (const [pid, storageKey] of Object.entries(PROVIDER_KEY_STORAGE)) {
      loaded[pid] = localStorage.getItem(storageKey) ?? "";
    }
    setLocalKeys(loaded);
  }, []);

  // Check server-side env keys
  useEffect(() => {
    fetch("/api/agent-keys-status")
      .then((r) => r.json())
      .then((data: { openai: boolean; anthropic: boolean; google: boolean }) => {
        setServerKeys({ OpenAI: data.openai, Anthropic: data.anthropic, Google: data.google });
      })
      .catch(() => {});
  }, []);

  function providerOfModel(model: string): string {
    return PROVIDER_GROUPS.find((g) => g.models.some((m) => m.model === model))?.id ?? "";
  }

  function resolvedApiKey(providerId: string): string {
    // If user has a local key use that; otherwise empty (server env key will be used)
    return localKeys[providerId] ?? "";
  }

  function selectModel(model: string) {
    const providerId = providerOfModel(model);
    const apiKey = resolvedApiKey(providerId);
    const cfg: AgentModelConfig = { model, apiKey };
    saveAgentModelConfig(cfg);
    setActiveModel(model);
    flash();
  }

  function saveProviderKey(providerId: string, key: string) {
    const trimmed = key.trim();
    setLocalKeys((prev) => ({ ...prev, [providerId]: trimmed }));
    localStorage.setItem(PROVIDER_KEY_STORAGE[providerId], trimmed);
    // If active model belongs to this provider, update its apiKey too
    if (providerOfModel(activeModel) === providerId) {
      saveAgentModelConfig({ model: activeModel, apiKey: trimmed });
    }
    flash();
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const activeLabel = PROVIDER_GROUPS.flatMap((g) => g.models).find((m) => m.model === activeModel)?.label;
  const activeProvider = providerOfModel(activeModel);
  const isReady = !!activeModel && (!!localKeys[activeProvider] || !!serverKeys[activeProvider]);

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: "9px 12px", borderRadius: 10, boxSizing: "border-box",
    border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)",
    fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-primary, #111)",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Status banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 14px", borderRadius: 12, marginBottom: 24,
        backgroundColor: isReady ? "rgba(201,168,76,0.08)" : "var(--card, #fff)",
        border: `0.5px solid ${isReady ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)"}`,
      }}>
        <span style={{ fontSize: 20 }}>{isReady ? "✅" : "🤖"}</span>
        <div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)" }}>
            {isReady ? `Using ${activeLabel} for browser automation` : "Select an AI model to enable booking agent"}
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
            {isReady ? "Click any model below to switch instantly" : "Enter an API key for at least one provider, then select a model"}
          </p>
        </div>
      </div>

      {/* Provider groups */}
      {PROVIDER_GROUPS.map((group) => {
        const hasServerKey = !!serverKeys[group.id];
        const localKey = localKeys[group.id] ?? "";
        const hasKey = hasServerKey || !!localKey;
        const isVisible = showKey[group.id];

        return (
          <div key={group.id} style={{ marginBottom: 24 }}>
            {/* Provider header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            }}>
              <p style={{
                fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
                color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.08em",
              }}>
                {group.label}
              </p>
              {hasServerKey && (
                <span style={{
                  fontSize: 10, fontFamily: "var(--font-dm-sans)", fontWeight: 600,
                  padding: "2px 7px", borderRadius: 20,
                  backgroundColor: "rgba(34,197,94,0.12)", color: "#16a34a",
                }}>
                  ✓ Server key
                </span>
              )}
            </div>

            {/* API key row — hide if server has it */}
            {!hasServerKey && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  style={inputStyle}
                  type={isVisible ? "text" : "password"}
                  value={localKey}
                  placeholder={localKey ? "••••••••••••" : `${group.placeholder} — paste once, saved locally`}
                  onChange={(e) => saveProviderKey(group.id, e.target.value)}
                />
                <button
                  onClick={() => setShowKey((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                  style={{
                    padding: "0 12px", borderRadius: 10, border: "0.5px solid var(--border, #e5e7eb)",
                    background: "var(--card, #fff)", fontFamily: "var(--font-dm-sans)", fontSize: 11,
                    color: "var(--text-muted, #aaa)", cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {isVisible ? "Hide" : "Show"}
                </button>
              </div>
            )}

            {/* Model chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {group.models.map((m) => {
                const active = activeModel === m.model;
                return (
                  <div
                    key={m.model}
                    onClick={() => hasKey && selectModel(m.model)}
                    title={!hasKey ? `Enter a ${group.label} API key first` : m.hint}
                    style={{
                      padding: "10px 14px", borderRadius: 12,
                      cursor: hasKey ? "pointer" : "not-allowed",
                      opacity: hasKey ? 1 : 0.45,
                      border: active ? "1.5px solid var(--gold, #C9A84C)" : "0.5px solid var(--border, #e5e7eb)",
                      backgroundColor: active ? "rgba(201,168,76,0.08)" : "var(--card, #fff)",
                      transition: "border-color 0.15s, background 0.15s",
                      minWidth: 120,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      {active && <span style={{ fontSize: 10, color: "var(--gold, #C9A84C)" }}>●</span>}
                      <p style={{
                        fontFamily: "var(--font-dm-sans)", fontSize: 13, fontWeight: 700,
                        color: active ? "var(--gold, #C9A84C)" : "var(--text-primary, #111)",
                      }}>
                        {m.label}
                      </p>
                      {m.badge && (
                        <span style={{
                          fontSize: 9, fontFamily: "var(--font-dm-sans)", fontWeight: 600,
                          padding: "1px 6px", borderRadius: 20,
                          backgroundColor: active ? "var(--gold, #C9A84C)" : "rgba(201,168,76,0.15)",
                          color: active ? "#fff" : "var(--gold, #C9A84C)",
                        }}>
                          {m.badge}
                        </span>
                      )}
                    </div>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 10.5, color: "var(--text-secondary, #666)" }}>
                      {m.hint}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 4, lineHeight: 1.6 }}>
        API keys are stored locally on your device only.
      </p>

      <p style={{
        fontFamily: "var(--font-dm-sans)", fontSize: 12, textAlign: "center", marginTop: 16,
        color: saved ? "var(--gold, #C9A84C)" : "transparent", transition: "color 0.3s",
      }}>
        ✓ Saved
      </p>
    </div>
  );
}

// ── Taste Profile tab ──────────────────────────────────────────────────────

function TasteProfileTab() {
  const { profile, updateProfile, updateDiscoveredPreference, removeDiscoveredPreference } = usePreferences();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState("");

  const discovered = profile.discovered ?? [];
  const hasSignals = discovered.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>

      {/* Discovered preferences */}
      {!hasSignals && (
        <div style={{
          textAlign: "center", padding: "36px 20px", borderRadius: 14,
          border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)",
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>
            Start chatting — we&apos;ll build your taste profile automatically
          </p>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)", marginTop: 6 }}>
            Ask about restaurants, hotels, flights, gifts...
          </p>
        </div>
      )}

      {(["dining", "travel", "hotels", "shopping", "general"] as const).map((cat) => {
        const items = discovered.filter((p) => p.category === cat);
        if (items.length === 0) return null;
        const meta = CAT_META[cat];
        return (
          <div key={cat} style={{ marginBottom: 20 }}>
            <p style={{
              fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
              color: "var(--text-muted, #aaa)", textTransform: "uppercase",
              letterSpacing: "0.07em", marginBottom: 10,
            }}>
              {meta.emoji} {meta.label}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {items.map((pref) => {
                const isEditing = editingId === pref.id;
                const confColor = pref.seen_count >= 3 ? "#22c55e" : pref.seen_count >= 2 ? "#f59e0b" : "var(--text-muted, #aaa)";
                return (
                  <div key={pref.id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: isEditing ? "5px 8px" : "6px 12px",
                    borderRadius: 24,
                    border: `0.5px solid ${pref.user_confirmed ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)"}`,
                    backgroundColor: pref.user_confirmed ? "rgba(201,168,76,0.08)" : "var(--card, #fff)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    {/* Confidence dot */}
                    <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: confColor, flexShrink: 0 }} />

                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingVal}
                        onChange={(e) => setEditingVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editingVal.trim()) {
                            updateDiscoveredPreference(pref.id, { value: editingVal.trim(), user_confirmed: true });
                            setEditingId(null);
                          } else if (e.key === "Escape") setEditingId(null);
                        }}
                        style={{
                          fontFamily: "var(--font-dm-sans)", fontSize: 12,
                          color: "var(--text-primary, #111)", background: "none",
                          border: "none", outline: "none", width: 120,
                        }}
                      />
                    ) : (
                      <span title={`Seen ${pref.seen_count}x · ${pref.source}`} style={{
                        fontFamily: "var(--font-dm-sans)", fontSize: 12,
                        color: "var(--text-primary, #111)", maxWidth: 180,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {pref.label}: <span style={{ color: "var(--text-secondary, #666)" }}>{pref.value}</span>
                      </span>
                    )}

                    {/* Edit / confirm */}
                    {!isEditing ? (
                      <button onClick={() => { setEditingId(pref.id); setEditingVal(pref.value); }} style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--text-muted, #aaa)", padding: "0 1px", fontSize: 11, lineHeight: 1,
                      }}>✏️</button>
                    ) : (
                      <button onClick={() => {
                        if (editingVal.trim()) updateDiscoveredPreference(pref.id, { value: editingVal.trim(), user_confirmed: true });
                        setEditingId(null);
                      }} style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--gold, #C9A84C)", padding: "0 1px", fontSize: 12, fontWeight: 700,
                      }}>✓</button>
                    )}

                    {/* Remove */}
                    <button onClick={() => removeDiscoveredPreference(pref.id)} style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--text-muted, #aaa)", padding: "0 1px", fontSize: 13, lineHeight: 1,
                    }}>×</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Divider */}
      {hasSignals && <div style={{ height: "0.5px", backgroundColor: "var(--border, #e5e7eb)", margin: "4px 0 20px" }} />}

      {/* Dietary restrictions */}
      <div style={{ marginBottom: 20 }}>
        <p style={{
          fontFamily: "var(--font-dm-sans)", fontSize: 11, fontWeight: 700,
          color: "var(--text-muted, #aaa)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10,
        }}>
          🥗 Dietary restrictions
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DIETARY_OPTIONS.map((d) => {
            const active = profile.dietary_restrictions.includes(d);
            return (
              <button key={d} onClick={() => {
                const next = active
                  ? profile.dietary_restrictions.filter((x) => x !== d)
                  : [...profile.dietary_restrictions, d];
                updateProfile({ dietary_restrictions: next });
              }} style={{
                padding: "6px 14px", borderRadius: 24, cursor: "pointer",
                fontFamily: "var(--font-dm-sans)", fontSize: 12,
                border: `0.5px solid ${active ? "var(--gold, #C9A84C)" : "var(--border, #e5e7eb)"}`,
                backgroundColor: active ? "var(--gold, #C9A84C)" : "var(--card, #fff)",
                color: active ? "#fff" : "var(--text-secondary, #666)",
                transition: "all 0.15s",
              }}>
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* Clear all */}
      {hasSignals && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-muted, #aaa)" }}>
            {discovered.length} signal{discovered.length !== 1 ? "s" : ""} · Updated {new Date(profile.updated_at).toLocaleDateString()}
          </p>
          <button onClick={() => updateProfile({ discovered: [] })} style={{
            fontFamily: "var(--font-dm-sans)", fontSize: 12,
            color: "var(--text-secondary, #666)", background: "none",
            border: "0.5px solid var(--border, #e5e7eb)", borderRadius: 8,
            padding: "5px 12px", cursor: "pointer",
          }}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function RelationshipProfileSection({
  sessionId,
  relationship,
  onSave,
}: {
  sessionId: string;
  relationship: RelationshipProfile | null;
  onSave: (profile: RelationshipProfile) => void;
}) {
  const [form, setForm] = useState({
    name: relationship?.name ?? "",
    type: (relationship?.type ?? "solo") as RelationshipType,
    constraints: relationship?.constraints.join(", ") ?? "",
    avoid_types: relationship?.avoid_types.join(", ") ?? "",
    notes: relationship?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      name: relationship?.name ?? "",
      type: (relationship?.type ?? "solo") as RelationshipType,
      constraints: relationship?.constraints.join(", ") ?? "",
      avoid_types: relationship?.avoid_types.join(", ") ?? "",
      notes: relationship?.notes ?? "",
    });
  }, [relationship]);

  const TYPES: RelationshipType[] = ["solo", "couple", "friends", "family"];
  const TYPE_LABELS: Record<RelationshipType, string> = {
    solo: "Solo",
    couple: "Couple",
    friends: "Friends",
    family: "Family",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    boxSizing: "border-box",
    border: "0.5px solid var(--border, #e5e7eb)",
    background: "var(--card, #fff)",
    fontFamily: "var(--font-dm-sans)",
    fontSize: 13,
    color: "var(--text-primary, #111)",
    outline: "none",
  };

  async function save() {
    if (!sessionId || !form.name.trim()) return;
    setSaving(true);
    const id = relationship?.id ?? crypto.randomUUID();
    const payload: RelationshipProfile = {
      id,
      name: form.name.trim(),
      type: form.type,
      session_ids: [sessionId],
      constraints: form.constraints.split(",").map((s) => s.trim()).filter(Boolean),
      avoid_types: form.avoid_types.split(",").map((s) => s.trim()).filter(Boolean),
      notes: form.notes.trim(),
      created_at: relationship?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const url = relationship ? `/api/relationships/${id}` : "/api/relationships";
    const method = relationship ? "PATCH" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    onSave(payload);
    setSaving(false);
  }

  return (
    <div style={{ marginTop: 28 }}>
      <SectionLabel>Relationship defaults</SectionLabel>
      <div
        style={{
          borderRadius: 14,
          border: "0.5px solid var(--border, #e5e7eb)",
          background: "var(--card, #fff)",
          padding: 16,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            color: "var(--text-secondary, #666)",
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          Persistent context the agent should keep in mind across rooms: who this profile is for, what the group usually needs,
          and what it should avoid by default.
        </p>

        <FieldLabel>Profile name</FieldLabel>
        <input
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Friday night date"
          style={inputStyle}
        />

        <SubLabel>Group type</SubLabel>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TYPES.map((tp) => (
            <button
              key={tp}
              onClick={() => setForm((prev) => ({ ...prev, type: tp }))}
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                fontWeight: form.type === tp ? 700 : 500,
                border: form.type === tp ? "1px solid var(--gold, #C9A84C)" : "0.5px solid var(--border, #e5e7eb)",
                background: form.type === tp ? "rgba(201,168,76,0.12)" : "var(--card, #fff)",
                color: form.type === tp ? "var(--gold, #C9A84C)" : "var(--text-secondary, #666)",
              }}
            >
              {TYPE_LABELS[tp]}
            </button>
          ))}
        </div>

        <FieldLabel>Always needs</FieldLabel>
        <input
          value={form.constraints}
          onChange={(e) => setForm((prev) => ({ ...prev, constraints: e.target.value }))}
          placeholder="window seat, quiet hotel, walkable area"
          style={inputStyle}
        />

        <FieldLabel>Always avoids</FieldLabel>
        <input
          value={form.avoid_types}
          onChange={(e) => setForm((prev) => ({ ...prev, avoid_types: e.target.value }))}
          placeholder="early flights, shellfish, party hotels"
          style={inputStyle}
        />

        <FieldLabel>Notes</FieldLabel>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="Anything the agent should preserve when making tradeoffs."
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />

        <button
          onClick={save}
          disabled={saving || !form.name.trim() || !sessionId}
          style={{
            marginTop: 14,
            padding: "11px 14px",
            borderRadius: 10,
            border: "none",
            cursor: saving ? "wait" : "pointer",
            backgroundColor: "var(--gold, #C9A84C)",
            color: "#fff",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            fontWeight: 700,
            opacity: !form.name.trim() || !sessionId ? 0.55 : 1,
          }}
        >
          {saving ? "Saving..." : relationship ? "Update learned defaults" : "Save learned defaults"}
        </button>
      </div>
    </div>
  );
}

export function LearnedProfileTab({
  sessionId,
  relationship,
  onSaveRelationship,
}: {
  sessionId: string;
  relationship: RelationshipProfile | null;
  onSaveRelationship: (profile: RelationshipProfile) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          borderRadius: 14,
          border: "0.5px solid var(--border, #e5e7eb)",
          background: "rgba(201,168,76,0.06)",
          padding: "14px 16px",
          marginBottom: 22,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 13,
            color: "var(--text-primary, #111)",
            lineHeight: 1.6,
          }}
        >
          This section combines what the agent has inferred from your usage with the longer-lived defaults it should remember for future
          decisions.
        </p>
      </div>

      <TasteProfileTab />
      <RelationshipProfileSection sessionId={sessionId} relationship={relationship} onSave={onSaveRelationship} />
    </div>
  );
}

const CAT_META: Record<string, { emoji: string; label: string }> = {
  dining:   { emoji: "🍽", label: "Dining" },
  travel:   { emoji: "✈️", label: "Travel" },
  hotels:   { emoji: "🏨", label: "Hotels" },
  shopping: { emoji: "🛍", label: "Shopping" },
  general:  { emoji: "⭐", label: "General" },
};

// ── Agent Permissions tab ──────────────────────────────────────────────────

function PermissionsTab({ settings, update, tp }: {
  settings: AgentAutonomySettings;
  update: (patch: unknown) => void;
  tp: ReturnType<typeof useLanguage>["t"]["permissions"];
}) {
  const { restaurant: r, hotel: h, flight: f, activity: a } = settings;

  return (
    <div>
      {/* Autopilot Level */}
      <SectionLabel>{tp.autopilotLabel}</SectionLabel>
      <div style={{ display: "flex", gap: 10 }}>
        {([
          { level: "ask"   as AutopilotLevel, emoji: "🤔", title: tp.autopilotAsk,   desc: tp.autopilotAskDesc },
          { level: "smart" as AutopilotLevel, emoji: "⚡", title: tp.autopilotSmart, desc: tp.autopilotSmartDesc },
          { level: "full"  as AutopilotLevel, emoji: "🚀", title: tp.autopilotFull,  desc: tp.autopilotFullDesc },
        ] as const).map(({ level, emoji, title, desc }) => (
          <AutopilotCard key={level} level={level} emoji={emoji} title={title} desc={desc}
            selected={settings.autopilot === level}
            onSelect={() => update({ autopilot: level })}
          />
        ))}
      </div>

      <BehaviorCard
        title={tp.behaviorTitle}
        items={[tp.behaviorTimeWindow, tp.behaviorVenueSwitch, tp.behaviorBudget, tp.behaviorStarRating]}
      />

      {/* Time Flexibility */}
      <SectionLabel>{tp.sectionTime}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <FieldLabel>{tp.restaurantWindow}</FieldLabel>
          <Seg options={[{v:0,l:tp.off},{v:30,l:tp.s30min},{v:60,l:tp.s60min},{v:90,l:tp.s90min}]}
            value={r.timeWindowMinutes} onChange={(v) => update({ restaurant: { timeWindowMinutes: v } })} />
        </div>
        <div>
          <FieldLabel>{tp.flightWindow}</FieldLabel>
          <Seg options={[{v:0,l:tp.off},{v:60,l:tp.s1h},{v:120,l:tp.s2h},{v:180,l:tp.s3h}]}
            value={f.departureFlexMinutes} onChange={(v) => update({ flight: { departureFlexMinutes: v } })} />
        </div>
        <div>
          <FieldLabel>{tp.activityWindow}</FieldLabel>
          <Seg options={[{v:0,l:tp.off},{v:30,l:tp.s30min},{v:60,l:tp.s60min},{v:90,l:tp.s90min}]}
            value={a.timeWindowMinutes} onChange={(v) => update({ activity: { timeWindowMinutes: v } })} />
        </div>
      </div>

      {/* Option Switching */}
      <SectionLabel>{tp.sectionSwitching}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Toggle on={r.allowVenueSwitch} label={tp.restaurantVenueSwitch}
          onChange={() => update({ restaurant: { allowVenueSwitch: !r.allowVenueSwitch } })} />
        <Toggle on={h.allowAreaSwitch} label={tp.hotelAreaSwitch}
          onChange={() => update({ hotel: { allowAreaSwitch: !h.allowAreaSwitch } })} />
        <Toggle on={h.allowCrossRegion} label={tp.hotelCrossRegion}
          onChange={() => update({ hotel: { allowCrossRegion: !h.allowCrossRegion } })} />
        <Toggle on={f.allowLayover} label={tp.flightLayover}
          onChange={() => update({ flight: { allowLayover: !f.allowLayover } })} />
        <Toggle on={f.allowAlternateAirport} label={tp.flightAltAirport}
          onChange={() => update({ flight: { allowAlternateAirport: !f.allowAlternateAirport } })} />
        <Toggle on={a.allowVenueSwitch} label={tp.activityVenueSwitch}
          onChange={() => update({ activity: { allowVenueSwitch: !a.allowVenueSwitch } })} />
      </div>

      {/* Budget Elasticity */}
      <SectionLabel>{tp.sectionBudget}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <FieldLabel>{tp.restaurant}</FieldLabel>
          <Seg options={[{v:0,l:tp.strict},{v:5,l:tp.p5},{v:10,l:tp.p10},{v:20,l:tp.p20}]}
            value={r.budgetFlexPct} onChange={(v) => update({ restaurant: { budgetFlexPct: v } })} />
        </div>
        <div>
          <FieldLabel>{tp.hotel}</FieldLabel>
          <Seg options={[{v:0,l:tp.strict},{v:5,l:tp.p5},{v:10,l:tp.p10},{v:20,l:tp.p20}]}
            value={h.budgetFlexPct} onChange={(v) => update({ hotel: { budgetFlexPct: v } })} />
        </div>
      </div>

      {/* Hard Limits */}
      <SectionLabel>{tp.sectionHardLimits}</SectionLabel>

      <SubLabel>{tp.restaurant}</SubLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
        <TimeInput label={tp.earliestTime} value={r.earliestTimeHHMM}
          onChange={(v) => update({ restaurant: { earliestTimeHHMM: v } })} />
        <TimeInput label={tp.latestTime} value={r.latestTimeHHMM}
          onChange={(v) => update({ restaurant: { latestTimeHHMM: v } })} />
      </div>
      <Toggle on={r.requireIndoor} label={tp.restaurantIndoor}
        onChange={() => update({ restaurant: { requireIndoor: !r.requireIndoor } })} />

      <SubLabel>{tp.hotel}</SubLabel>
      <div style={{ marginBottom: 10, padding: "12px 14px", borderRadius: 12, border: "0.5px solid var(--border, #e5e7eb)", backgroundColor: "var(--card, #fff)" }}>
        <FieldLabel>{tp.minStarRating}</FieldLabel>
        <StarRating value={h.minStarRating} hint={tp.minStarValue(h.minStarRating)}
          onChange={(v) => update({ hotel: { minStarRating: v } })} />
      </div>
      <Toggle on={h.requireParking} label={tp.hotelParking}
        onChange={() => update({ hotel: { requireParking: !h.requireParking } })} />

      <SubLabel>{tp.activity}</SubLabel>
      <Toggle on={a.requireIndoor} label={tp.activityIndoor}
        onChange={() => update({ activity: { requireIndoor: !a.requireIndoor } })} />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

function PermissionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const resolveTarget = useCallback((raw: string | null): string => {
    if (!raw) return "profiles";
    if (raw === "profile" || raw === "details" || raw === "profiles") return "profiles";
    if (raw === "model" || raw === "models") return "models";
    if (raw === "taste" || raw === "learned") return "learned";
    if (raw === "permissions" || raw === "controls") return "controls";
    if (raw === "billing") return "billing";
    if (raw === "identity") return "identity";
    return "identity";
  }, []);

  useEffect(() => {
    const target = resolveTarget(searchParams.get("tab"));
    if (target === "learned") {
      router.replace("/insights?tab=overview");
      return;
    }
    router.replace(`/account?tab=${encodeURIComponent(target)}`);
  }, [resolveTarget, router, searchParams]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="other" />
      <main style={{ maxWidth: 580, margin: "0 auto", padding: "28px 20px 80px" }}>
        <div style={{ marginBottom: 4 }}>
          <h1 style={{ fontFamily: "var(--font-playfair, serif)", fontSize: 26, fontWeight: 700, color: "var(--text-primary, #111)", marginBottom: 6 }}>
            Redirecting to Account
          </h1>
          <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-secondary, #666)" }}>
            Settings now live under the unified Account workspace.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function PermissionsPage() {
  return (
    <Suspense fallback={null}>
      <PermissionsPageInner />
    </Suspense>
  );
}

export function LearnedSettingsTab() {
  const [relationship, setRelationship] = useState<RelationshipProfile | null>(null);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const sid = getSessionId();
    setSessionId(sid);
    if (!sid) return;
    fetch(`/api/memory?session_id=${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then((data) => setRelationship(data.relationship ?? null))
      .catch(() => {});
  }, []);

  return (
    <LearnedProfileTab
      sessionId={sessionId}
      relationship={relationship}
      onSaveRelationship={setRelationship}
    />
  );
}

export function ControlsSettingsTab() {
  const [settings, setSettings] = useState<AgentAutonomySettings>(DEFAULT_AUTONOMY);
  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState(false);
  const { t } = useLanguage();
  const tp = t.permissions;

  useEffect(() => {
    setSettings(loadAutonomySettings());
    setMounted(true);
  }, []);

  const update = useCallback((patch: unknown) => {
    setSettings((prev) => {
      const next = deepMerge(prev, patch);
      saveAutonomySettings(next);
      return next;
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }, []);

  return (
    <>
      {mounted ? (
        <PermissionsTab settings={settings} update={update} tp={tp} />
      ) : (
        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-muted, #aaa)" }}>
          Loading…
        </p>
      )}
      {saved && (
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--gold, #C9A84C)",
            textAlign: "center",
            marginTop: 36,
            transition: "color 0.3s",
          }}
        >
          ✓ {tp.autoSaved}
        </p>
      )}
    </>
  );
}
