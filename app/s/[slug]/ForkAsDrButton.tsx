"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  slug: string;
  isSignedIn: boolean;
}

/**
 * Fork CTA on /share/[slug] for DR-outcome shares. Two paths:
 *   - signed in   → POST /api/share/[slug]/fork → redirect to /decide/<new>
 *   - signed out  → bounce to /sign-in?redirectUrl=/share/[slug]
 *
 * Q4(i) in the design discussion: "Fork = a starting point, not an answer".
 * The new DR copies *constraints*, not the chosen restaurant.
 */
export default function ForkAsDrButton({ slug, isSignedIn }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fork() {
    if (!isSignedIn) {
      router.push(`/?redirect=/share/${slug}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${slug}/fork`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't fork — try again.");
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      router.push(`/decide/${data.sessionId}?role=initiator`);
    } catch {
      setError("Connection problem. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        onClick={fork}
        disabled={busy}
        style={{
          padding: "14px 22px",
          borderRadius: 14,
          background: "var(--gold, #C9A84C)",
          color: "white",
          fontWeight: 600,
          fontSize: 15,
          border: "none",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          fontFamily: "var(--font-dm-sans)",
        }}
      >
        {busy ? "Setting up your room…" : "Fork as your own Decision Room →"}
      </button>
      {error && (
        <p style={{ fontSize: 12, color: "#b91c1c", margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
