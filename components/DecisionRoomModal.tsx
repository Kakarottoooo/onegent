"use client";

import { useState, useEffect, useRef } from "react";

interface DecisionRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  initiatorQuery: string;
  cityId: string;
  userId?: string | null;
}

export default function DecisionRoomModal({
  isOpen,
  onClose,
  initiatorQuery,
  cityId,
  userId,
}: DecisionRoomModalProps) {
  const [step, setStep] = useState<"share" | "waiting">("share");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"imessage" | "whatsapp" | "copy" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll when on "waiting" step — auto-navigate when partner joins
  useEffect(() => {
    if (step !== "waiting" || !sessionId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/decision-session/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json() as { session: { status: string } };
        if (data.session.status !== "waiting_partner") {
          clearInterval(pollRef.current!);
          window.location.href = `${shareUrl}?role=initiator`;
        }
      } catch { /* ignore network errors */ }
    }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, sessionId, shareUrl]);

  async function createSession() {
    if (shareUrl) return; // Already created
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/decision-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initiatorConstraints: initiatorQuery, cityId }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = (await res.json()) as { sessionId: string; shareUrl: string };
      setSessionId(data.sessionId);
      setShareUrl(data.shareUrl);
    } catch {
      setError("Couldn't create a session. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpen() {
    createSession();
  }

  function handleShare(via: "imessage" | "whatsapp" | "copy") {
    if (!shareUrl) return;
    const text = `Let's decide where to eat tonight — add your preferences: ${shareUrl}`;
    if (via === "imessage") {
      window.location.href = `sms:&body=${encodeURIComponent(text)}`;
    } else if (via === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setCopied("copy");
        setTimeout(() => setCopied(null), 2000);
      });
    }
    setCopied(via);
    setStep("waiting");
  }

  if (!isOpen) return null;

  // Trigger session creation when modal opens
  if (!shareUrl && !loading && !error) {
    handleOpen();
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
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        {step === "share" && (
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontFamily: "var(--font-dm-sans)",
                color: "var(--gold-text, #5A4416)",
                background: "var(--gold-soft, #F5E9C8)",
                padding: "4px 10px",
                borderRadius: 999,
                marginBottom: 10,
              }}
            >
              Decision Room
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
              Plan this together.
            </h2>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">
              Your search:{" "}
              <span className="text-gray-700 font-medium">&ldquo;{initiatorQuery}&rdquo;</span>
              <br />
              Send the link to your partner — they&apos;ll add their constraints, then you&apos;ll
              both vote on options that work for both of you.
            </p>

            {loading && (
              <div className="text-sm text-gray-400 text-center py-4">Creating your session…</div>
            )}
            {error && (
              <div className="text-sm text-red-500 text-center py-2">{error}</div>
            )}

            {shareUrl && (
              <>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleShare("imessage")}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    iMessage
                  </button>
                  <button
                    onClick={() => handleShare("whatsapp")}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    WhatsApp
                  </button>
                </div>
                <button
                  onClick={() => handleShare("copy")}
                  className="w-full py-2.5 rounded-xl border border-gray-900 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                >
                  {copied === "copy" ? "Copied!" : "Copy link"}
                </button>

                <p className="text-xs text-gray-400 text-center mt-4">
                  Link expires in 24 hours · No sign-up needed for your partner
                </p>
              </>
            )}
          </>
        )}

        {step === "waiting" && shareUrl && (
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontFamily: "var(--font-dm-sans)",
                color: "var(--gold-text, #5A4416)",
                background: "var(--gold-soft, #F5E9C8)",
                padding: "4px 10px",
                borderRadius: 999,
                marginBottom: 10,
              }}
            >
              Decision Room
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
              Waiting for your partner.
            </h2>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">
              Once they add their constraints, you&apos;ll both be taken to a voting screen to pick
              something you&apos;ll both like.
            </p>

            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <p className="text-xs text-gray-400 mb-1">Session link</p>
              <p className="text-xs text-gray-700 break-all font-mono">{shareUrl}</p>
            </div>

            <a
              href={`${shareUrl}?role=initiator`}
              className="block w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium text-center hover:bg-gray-800 transition-colors"
            >
              Open voting room →
            </a>

            <button
              onClick={() => { setCopied(null); setStep("share"); }}
              className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 mt-2"
            >
              Send to someone else
            </button>
          </>
        )}
      </div>
    </div>
  );
}
