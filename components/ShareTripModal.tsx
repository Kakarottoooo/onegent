"use client";

/**
 * ShareTripModal — used on /tasks (kind=booking) and /decide decided
 * (kind=dr_outcome) to mint a shareable artifact.
 *
 * Two-step UX:
 *   Step 1 — choose visibility + toggles → Save
 *   Step 2 — show the generated URL with copy + send buttons
 *
 * Defaults follow the design discussion:
 *   - visibility = private  (Q2 = i)
 *   - showPrice  = ON       (Q1 — both default ON now)
 *   - showTime   = ON for past bookings, OFF for future bookings
 *     (safety valve agreed in the toggle discussion: future-time default
 *     hides exact time so we don't leak "I'll be at X at 8pm Sat".)
 */

import { useState } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  kind: "booking" | "dr_outcome" | "trip";
  refId: string;
  /** When the underlying booking/DR is in the future. Flips showTime default. */
  isFutureEvent?: boolean;
}

type Visibility = "private" | "public";

export default function ShareTripModal({
  isOpen,
  onClose,
  kind,
  refId,
  isFutureEvent = false,
}: Props) {
  const [showPrice, setShowPrice] = useState(true);
  const [showTime, setShowTime] = useState(!isFutureEvent);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          refId,
          visibility,
          options: { showPrice, showTime },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn't create share. Try again.");
        return;
      }
      const data = (await res.json()) as { url: string };
      setShareUrl(data.url);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can long-press to copy manually */
    }
  }

  function shareVia(channel: "imessage" | "whatsapp" | "x") {
    if (!shareUrl) return;
    const text =
      kind === "dr_outcome"
        ? `Just decided on this with Onegent — fork it for yourself: ${shareUrl}`
        : kind === "trip"
          ? `Here's my trip on Onegent: ${shareUrl}`
          : `Just booked this trip with Onegent — see it here: ${shareUrl}`;
    if (channel === "imessage") {
      window.location.href = `sms:&body=${encodeURIComponent(text)}`;
    } else if (channel === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
        "_blank",
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md mx-0 sm:mx-4 p-6 pb-8"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "var(--font-dm-sans, system-ui)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--gold-text, #5A4416)",
            background: "var(--gold-soft, #F5E9C8)",
            padding: "4px 10px",
            borderRadius: 999,
            marginBottom: 10,
          }}
        >
          Share
        </span>
        <h2
          style={{
            fontFamily: "var(--font-playfair), Georgia, serif",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#0a0a0a",
            marginBottom: 6,
            lineHeight: 1.15,
          }}
        >
          {shareUrl
            ? "Your share link is ready."
            : kind === "dr_outcome"
              ? "Save & share this decision."
              : kind === "trip"
                ? "Share this trip."
                : "Save & share this booking."}
        </h2>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          {shareUrl
            ? kind === "dr_outcome"
              ? "Friends who open it can fork it as their own Decision Room."
              : "Friends will see your itinerary — no Onegent account needed to view."
            : "You control what gets shown and who can open the link."}
        </p>

        {!shareUrl && (
          <>
            {/* Visibility */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-700 mb-2">Who can see it</p>
              <div className="flex gap-2">
                {(["private", "public"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={
                      "flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors " +
                      (visibility === v
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50")
                    }
                  >
                    {v === "private" ? "Private link" : "Public"}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                {visibility === "private"
                  ? "Only you (signed in) can open the link. Useful for previewing first."
                  : "Anyone with the link can open it. Indexable by search engines once your profile is public."}
              </p>
            </div>

            {/* Toggles */}
            <div className="mb-5 flex flex-col gap-2">
              <ToggleRow
                label="Show price"
                hint="Cuisine + price band always shown; turning this off hides exact $."
                value={showPrice}
                onChange={setShowPrice}
              />
              <ToggleRow
                label="Show time"
                hint={
                  isFutureEvent
                    ? "Off by default — hides the exact time of your upcoming plans."
                    : "On for past trips — shows when you went."
                }
                value={showTime}
                onChange={setShowTime}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 mb-3" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium disabled:opacity-50 hover:bg-gray-800 transition-colors"
            >
              {busy ? "Creating link…" : "Create share link"}
            </button>
          </>
        )}

        {shareUrl && (
          <>
            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <p className="text-xs text-gray-400 mb-1">Share link</p>
              <p className="text-xs text-gray-700 break-all font-mono">{shareUrl}</p>
            </div>

            <button
              type="button"
              onClick={copy}
              className="w-full py-2.5 rounded-xl border border-gray-900 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors mb-3"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>

            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => shareVia("imessage")}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                iMessage
              </button>
              <button
                type="button"
                onClick={() => shareVia("whatsapp")}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => shareVia("x")}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                X
              </button>
            </div>

            <p className="text-[11px] text-gray-400 text-center mt-3">
              {visibility === "private"
                ? "Private — only you can open it. Switch to Public anytime in /account."
                : "Public — anyone with the link can open it."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={
          "relative w-10 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5 " +
          (value ? "bg-gray-900" : "bg-gray-300")
        }
        aria-pressed={value}
        aria-label={label}
      >
        <span
          className={
            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all " +
            (value ? "left-[18px]" : "left-0.5")
          }
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{hint}</p>
      </div>
    </div>
  );
}
