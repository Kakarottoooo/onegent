"use client";

import { useState } from "react";

interface Props {
  initialBio: string | null;
}

/**
 * Inline bio editor — only mounted by the SSR page when the viewer === owner.
 * Click "Edit" → reveal textarea + Save/Cancel. PATCH /api/users/me/bio
 * → reload page state via router.refresh().
 *
 * No floating modal: the bio is small and editing it inline keeps the page
 * grounded.
 */
export default function EditBioInline({ initialBio }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialBio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(initialBio);

  const display = committed?.trim() || null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/bio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: value.trim() ? value.trim() : null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't save.");
        return;
      }
      setCommitted(value.trim() ? value.trim() : null);
      setEditing(false);
    } catch {
      setError("Connection problem. Check your network and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 6 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-dm-sans)",
            fontSize: 15,
            color: display ? "var(--text-primary)" : "var(--text-muted)",
            fontStyle: display ? "normal" : "italic",
            lineHeight: 1.55,
            flex: 1,
          }}
        >
          {display ?? "Add a tagline so visitors know what you're about."}
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setValue(committed ?? "");
          }}
          style={{
            padding: "4px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            color: "var(--text-secondary)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 500))}
        placeholder="A line that shows up on your public profile. e.g. “Mostly chasing dumplings in Brooklyn.”"
        rows={3}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-dm-sans)",
          fontSize: 14,
          resize: "vertical",
          outline: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          {value.length} / 500
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              color: "var(--text-secondary)",
              cursor: saving ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid var(--gold, #C9A84C)",
              background: "var(--gold, #C9A84C)",
              color: "white",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {error && (
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            color: "#b91c1c",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
