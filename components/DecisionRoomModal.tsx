"use client";

import { useState, useEffect, useRef } from "react";
import ContactPicker, { type PickerContact } from "./ContactPicker";

interface DecisionRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  initiatorQuery: string;
  cityId: string;
  userId?: string | null;
  /** Optional pre-selected contact (e.g. user clicked a Recent chip on home). */
  preselectedContact?: PickerContact | null;
}

type Step = "tabs" | "waiting";
type Tab = "contacts" | "link";

export default function DecisionRoomModal({
  isOpen,
  onClose,
  initiatorQuery,
  cityId,
  preselectedContact,
}: DecisionRoomModalProps) {
  const [step, setStep] = useState<Step>("tabs");
  const [tab, setTab] = useState<Tab>(preselectedContact ? "contacts" : "contacts");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<PickerContact[]>(
    preselectedContact ? [preselectedContact] : [],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(preselectedContact ? [preselectedContact.contact_user_id] : []),
  );
  const [copied, setCopied] = useState<"imessage" | "whatsapp" | "copy" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep("tabs");
      setShareUrl(null);
      setSessionId(null);
      setSelectedContacts(preselectedContact ? [preselectedContact] : []);
      setSelectedIds(new Set(preselectedContact ? [preselectedContact.contact_user_id] : []));
      setCopied(null);
      setError(null);
      setInviteSent(false);
    }
  }, [isOpen, preselectedContact]);

  // Poll when waiting — auto-navigate when partner joins
  useEffect(() => {
    if (step !== "waiting" || !sessionId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/decision-session/${sessionId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { session: { status: string } };
        if (data.session.status !== "waiting_partner") {
          if (pollRef.current) clearInterval(pollRef.current);
          window.location.href = `${shareUrl}?role=initiator`;
        }
      } catch {
        /* ignore network errors */
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, sessionId, shareUrl]);

  /** Create a DR session lazily — only when user takes an action. */
  async function ensureSession(inviteeUserIds?: string[] | null): Promise<{
    sessionId: string;
    shareUrl: string;
  } | null> {
    if (sessionId && shareUrl) return { sessionId, shareUrl };
    setLoading(true);
    setError(null);
    try {
      const ids = inviteeUserIds ?? [];
      const res = await fetch("/api/decision-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiatorConstraints: initiatorQuery,
          cityId,
          // Pass both shapes for back-compat: server prefers inviteeUserIds[]
          // when present, falls back to inviteeUserId for legacy 2-party.
          inviteeUserIds: ids.length > 0 ? ids : undefined,
          inviteeUserId: ids.length === 1 ? ids[0] : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = (await res.json()) as { sessionId: string; shareUrl: string };
      setSessionId(data.sessionId);
      setShareUrl(data.shareUrl);
      return { sessionId: data.sessionId, shareUrl: data.shareUrl };
    } catch {
      setError("Couldn't create a session. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleSendInviteToContacts() {
    if (selectedContacts.length === 0) return;
    const created = await ensureSession(selectedContacts.map((c) => c.contact_user_id));
    if (!created) return;
    setInviteSent(true);
    setStep("waiting");
  }

  async function handleShareLink(via: "imessage" | "whatsapp" | "copy") {
    const created = await ensureSession([]);
    if (!created) return;
    const text = `Let's decide where to eat tonight — add your preferences: ${created.shareUrl}`;
    if (via === "imessage") {
      window.location.href = `sms:&body=${encodeURIComponent(text)}`;
    } else if (via === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      try {
        await navigator.clipboard.writeText(created.shareUrl);
      } catch {
        /* noop */
      }
    }
    setCopied(via);
    if (via === "copy") setTimeout(() => setCopied(null), 2000);
    setStep("waiting");
  }

  if (!isOpen) return null;

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

        {step === "tabs" && (
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
            </p>

            {/* Tab strip */}
            <div className="flex gap-1 mb-4 p-1 rounded-xl bg-gray-100">
              <button
                type="button"
                onClick={() => setTab("contacts")}
                className={
                  "flex-1 py-2 rounded-lg text-sm font-medium transition-colors " +
                  (tab === "contacts"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700")
                }
              >
                From contacts
              </button>
              <button
                type="button"
                onClick={() => setTab("link")}
                className={
                  "flex-1 py-2 rounded-lg text-sm font-medium transition-colors " +
                  (tab === "link"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700")
                }
              >
                Share link
              </button>
            </div>

            {error && (
              <div className="text-sm text-red-500 text-center py-2 mb-2">{error}</div>
            )}

            {tab === "contacts" && (
              <>
                <ContactPicker
                  mode="multi"
                  selectedIds={selectedIds}
                  maxSelected={7}
                  onChange={(next, contact, isAdding) => {
                    setSelectedIds(next);
                    setSelectedContacts((prev) => {
                      if (isAdding) return [...prev, contact];
                      return prev.filter((c) => c.contact_user_id !== contact.contact_user_id);
                    });
                  }}
                />
                <button
                  type="button"
                  onClick={handleSendInviteToContacts}
                  disabled={selectedContacts.length === 0 || loading}
                  className="w-full mt-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
                >
                  {loading
                    ? "Creating room…"
                    : selectedContacts.length === 0
                      ? "Pick people to invite"
                      : selectedContacts.length === 1
                        ? `Send invite to ${selectedContacts[0].nickname ?? selectedContacts[0].display_name ?? `@${selectedContacts[0].profile_code}`}`
                        : `Start group room with ${selectedContacts.length} people`}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-3">
                  Group rooms wait for everyone to add their constraints before
                  showing options. Up to 8 people total (you + 7).
                </p>
              </>
            )}

            {tab === "link" && (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  Send the link to whoever you&apos;re deciding with — they&apos;ll add their
                  constraints, then you&apos;ll all vote together.
                </p>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleShareLink("imessage")}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    iMessage
                  </button>
                  <button
                    onClick={() => handleShareLink("whatsapp")}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    WhatsApp
                  </button>
                </div>
                <button
                  onClick={() => handleShareLink("copy")}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl border border-gray-900 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  {loading ? "…" : copied === "copy" ? "Copied!" : "Copy link"}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-3">
                  Link expires in 24 hours · 2-party links work without sign-up;
                  group rooms (3+) need everyone signed in.
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
              {selectedContacts.length > 1
                ? "Waiting for your group."
                : "Waiting for your partner."}
            </h2>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">
              {inviteSent && selectedContacts.length > 0
                ? selectedContacts.length === 1
                  ? `${selectedContacts[0].nickname ?? selectedContacts[0].display_name ?? `@${selectedContacts[0].profile_code}`} will be taken straight to the constraints screen when they open it.`
                  : `${selectedContacts.length} people invited. Voting unlocks when everyone has added their constraints.`
                : "Once they add their constraints, you'll all be taken to a voting screen to pick something everyone agrees on."}
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
              onClick={() => {
                setCopied(null);
                setStep("tabs");
              }}
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
