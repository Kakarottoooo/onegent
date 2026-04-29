"use client";

/**
 * AddContactPrompt — gentle nudge after a Decision Room reaches "decided".
 *
 * Why "after decided" (Q3 = ii in the design discussion): a successful
 * decision is the highest-trust moment between two people in this product.
 * Asking earlier feels transactional; asking later loses the moment.
 *
 * Behavior:
 * - Self-dismisses after the user clicks Send or X.
 * - Best-effort POST /api/contacts. 409 already_contact / already_pending
 *   collapses the prompt silently (the relationship is fine either way).
 * - Renders nothing if `peerCode` is missing or the user already dismissed.
 */

import { useState } from "react";

interface Props {
  peerDisplayName: string | null;
  peerCode: string | null;
  peerAvatarUrl: string | null;
  /** Whether this peer is already in my contacts (skips render). */
  alreadyContact?: boolean;
}

export default function AddContactPrompt({
  peerDisplayName,
  peerCode,
  peerAvatarUrl,
  alreadyContact = false,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentLabel, setSentLabel] = useState<string | null>(null);

  if (alreadyContact || dismissed || !peerCode) return null;

  const display = peerDisplayName ?? `@${peerCode}`;

  async function send() {
    if (!peerCode) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: peerCode }),
      });
      if (res.ok) {
        setSentLabel("Request sent ✓");
        setTimeout(() => setDismissed(true), 1600);
        return;
      }
      // 409 already_contact / already_pending — quietly hide
      const data = (await res.json().catch(() => null)) as
        | { code?: string }
        | null;
      if (data?.code === "already_contact" || data?.code === "already_pending") {
        setDismissed(true);
        return;
      }
      setSentLabel("Couldn't send — try in /contacts");
    } catch {
      setSentLabel("Network error — try in /contacts");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 p-4 mb-5 rounded-2xl border bg-white shadow-sm"
      style={{ borderColor: "var(--border, #e5e7eb)" }}
    >
      {peerAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={peerAvatarUrl}
          alt=""
          className="w-10 h-10 rounded-full flex-shrink-0"
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={{ background: "var(--gold, #C9A84C)", color: "white" }}
        >
          {display.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          Save {display} to your contacts?
        </p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Faster Decision Rooms next time — pick them from your list.
        </p>
        {sentLabel && (
          <p className="text-[11px] mt-1" style={{ color: "var(--gold-text, #5A4416)" }}>
            {sentLabel}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={send}
          disabled={busy || !!sentLabel}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
          style={{ background: "var(--gold, #C9A84C)" }}
        >
          {busy ? "…" : sentLabel ? "Sent" : "Send request"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="px-3 py-1 rounded-lg text-[11px] text-gray-500 hover:text-gray-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
