"use client";

import { useState } from "react";

interface Props {
  /** profile_code or username — passed to /api/contacts as `code`. */
  peerHandle: string;
  /** Pre-checked from the SSR layer. When true the CTA collapses to a label. */
  alreadyContact?: boolean;
  /** Hide the whole CTA when viewing your own profile. */
  isSelf?: boolean;
  /** Server already knows whether the viewer is signed in. */
  isSignedIn: boolean;
}

/**
 * "Add @ziwei" CTA on the public profile page.
 *
 * - signed in + already a contact   → static "Already in your contacts" pill
 * - signed in + not a contact       → POST /api/contacts (sends a request)
 * - signed out                      → bounce to homepage with redirect hint
 * - viewing own profile             → hidden
 */
export default function AddContactCTA({
  peerHandle,
  alreadyContact = false,
  isSelf = false,
  isSignedIn,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) return null;

  if (alreadyContact || sent) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontFamily: "var(--font-dm-sans)",
          fontSize: 13,
          color: "var(--gold-text, #5A4416)",
          background: "var(--gold-soft, #F5E9C8)",
          border: "1px solid var(--gold, #C9A84C)",
          padding: "6px 14px",
          borderRadius: 999,
          fontWeight: 500,
        }}
      >
        {sent ? "Request sent ✓" : "Already in your contacts"}
      </span>
    );
  }

  async function add() {
    if (!isSignedIn) {
      window.location.href = `/?redirect=/u/${encodeURIComponent(peerHandle)}`;
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: peerHandle }),
      });
      if (res.ok) {
        setSent(true);
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null;
      // Quietly collapse if they're already contacts or a pending request exists.
      if (data?.code === "already_contact" || data?.code === "already_pending") {
        setSent(true);
        return;
      }
      setError(data?.error ?? "Couldn't send request.");
    } catch {
      setError("Connection problem. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        onClick={add}
        disabled={busy}
        style={{
          padding: "10px 18px",
          borderRadius: 999,
          background: "var(--gold, #C9A84C)",
          color: "white",
          fontWeight: 600,
          fontSize: 13,
          border: "none",
          fontFamily: "var(--font-dm-sans)",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Sending…" : `Add @${peerHandle}`}
      </button>
      {error && (
        <p style={{ fontSize: 11, color: "#b91c1c", margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
