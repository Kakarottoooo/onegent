"use client";

import Link from "next/link";

type InlineBookingProfileValues = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

export default function InlineBookingProfileGate({
  open,
  venueName,
  values,
  missingFields,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  venueName: string;
  values: InlineBookingProfileValues;
  missingFields: string[];
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<InlineBookingProfileValues>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 12px",
    borderRadius: 10,
    boxSizing: "border-box",
    border: "0.5px solid var(--border, #3a332a)",
    backgroundColor: "var(--card, #1f1d1a)",
    fontFamily: "var(--font-dm-sans)",
    fontSize: 14,
    color: "var(--text-primary, #f5f1e8)",
    outline: "none",
  };

  const missingLabel =
    missingFields.length > 0
      ? missingFields
          .map((field) => {
            if (field === "first_name") return "first name";
            if (field === "last_name") return "last name";
            return field;
          })
          .join(", ")
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(7, 7, 7, 0.62)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="w-full max-w-lg rounded-3xl"
        style={{
          backgroundColor: "var(--bg-elevated, #1b1815)",
          border: "0.5px solid rgba(255,255,255,0.08)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "22px 22px 10px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontFamily: "var(--font-dm-sans)",
              color: "var(--gold-text, #8b6a2b)",
              background: "var(--gold-soft, rgba(201,168,76,0.14))",
              padding: "5px 10px",
              borderRadius: 999,
              marginBottom: 12,
            }}
          >
            Profile Needed
          </span>
          <h2
            style={{
              fontFamily: "var(--font-playfair)",
              fontSize: 32,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "var(--text-primary, #f5f1e8)",
              marginBottom: 10,
            }}
          >
            I'm ready to book {venueName}.
          </h2>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 14,
              lineHeight: 1.65,
              color: "var(--text-secondary, #b8ac97)",
            }}
          >
            I just need your contact details first. Save them here and I'll continue the booking automatically.
          </p>
          {missingLabel && (
            <p
              style={{
                marginTop: 12,
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--gold-text, #c9a84c)",
              }}
            >
              Missing right now: {missingLabel}
            </p>
          )}
        </div>

        <div style={{ padding: "8px 22px 22px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  color: "var(--text-secondary, #b8ac97)",
                }}
              >
                First name
              </label>
              <input
                autoFocus
                value={values.first_name}
                onChange={(e) => onChange({ first_name: e.target.value })}
                placeholder="Jane"
                style={fieldStyle}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  color: "var(--text-secondary, #b8ac97)",
                }}
              >
                Last name
              </label>
              <input
                value={values.last_name}
                onChange={(e) => onChange({ last_name: e.target.value })}
                placeholder="Smith"
                style={fieldStyle}
              />
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                color: "var(--text-secondary, #b8ac97)",
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={values.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="jane@example.com"
              style={fieldStyle}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                color: "var(--text-secondary, #b8ac97)",
              }}
            >
              Phone
            </label>
            <input
              type="tel"
              value={values.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="+1 555 000 0000"
              style={fieldStyle}
            />
          </div>

          {error && (
            <div
              style={{
                borderRadius: 12,
                border: "0.5px solid rgba(239, 68, 68, 0.28)",
                backgroundColor: "rgba(127, 29, 29, 0.16)",
                padding: "10px 12px",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                type="submit"
                disabled={saving}
                style={{
                  border: "none",
                  cursor: saving ? "default" : "pointer",
                  borderRadius: 999,
                  padding: "12px 18px",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  fontWeight: 700,
                  backgroundColor: "var(--gold, #c9a84c)",
                  color: "#111",
                  minWidth: 170,
                  opacity: saving ? 0.8 : 1,
                }}
              >
                {saving ? "Saving & continuing..." : "Save & continue"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                style={{
                  background: "transparent",
                  border: "0.5px solid var(--border, #3a332a)",
                  color: "var(--text-secondary, #b8ac97)",
                  cursor: saving ? "default" : "pointer",
                  borderRadius: 999,
                  padding: "11px 16px",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                }}
              >
                Not now
              </button>
            </div>
            <Link
              href="/account?tab=profiles"
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12.5,
                color: "var(--text-secondary, #b8ac97)",
                textDecoration: "none",
              }}
            >
              Manage full profile -&gt;
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
