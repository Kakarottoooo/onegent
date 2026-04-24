"use client";

/**
 * Embeddable DM thread with one contact. Used both as the right pane of
 * /contacts (split view) and the full body of /contacts/[userId].
 *
 * role='agent' messages (auto-invites etc.) render with a 🤖 badge so the
 * recipient sees they were sent on someone's behalf, not personally typed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { CARD, INPUT } from "@/app/_ui/tokens";

interface ContactProfile {
  contact_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_code: string;
  nickname: string | null;
}

interface DmRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  role: "user" | "agent";
  content: string;
  meta_json: Record<string, unknown> | null;
  created_at: string;
}

export interface ContactDmPaneProps {
  peerId: string;
  /** Polling cadence while mounted. 0 disables. Defaults to 15000 ms. */
  pollMs?: number;
}

/** First non-empty fallback for display. Never leaks raw Clerk user ids. */
export function prettyContactLabel(contact: ContactProfile | null, peerId: string): string {
  if (contact?.nickname && contact.nickname.trim()) return contact.nickname.trim();
  if (contact?.display_name && contact.display_name.trim()) return contact.display_name.trim();
  if (contact?.profile_code && contact.profile_code.trim()) return `@${contact.profile_code.trim()}`;
  // Clerk user ids look like `user_abc123...`. Don't render them verbatim.
  const short = peerId.replace(/^user_/, "").slice(0, 8);
  return `User ${short}`;
}

export default function ContactDmPane({ peerId, pollMs = 15000 }: ContactDmPaneProps) {
  const { userId: me } = useAuth();
  const [peer, setPeer] = useState<ContactProfile | null>(null);
  const [messages, setMessages] = useState<DmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    if (!peerId) return;
    try {
      const [peerRes, msgRes] = await Promise.all([
        fetch(`/api/contacts/${encodeURIComponent(peerId)}`),
        fetch(`/api/dm/${encodeURIComponent(peerId)}`),
      ]);
      if (peerRes.ok) {
        const data = await peerRes.json();
        if (data?.contact) setPeer(data.contact);
      }
      if (!msgRes.ok) {
        const data = await msgRes.json().catch(() => ({}));
        throw new Error(data?.error ?? "Couldn't load messages.");
      }
      const data = (await msgRes.json()) as { messages: DmRow[] };
      setMessages(data.messages ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the conversation.");
    } finally {
      setLoading(false);
    }
  }, [peerId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setPeer(null);
    loadAll();
  }, [loadAll]);

  // Light polling so messages from the other side show up without refresh.
  useEffect(() => {
    if (!pollMs) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      loadAll();
    };
    const t = setInterval(tick, pollMs);
    return () => clearInterval(t);
  }, [pollMs, loadAll]);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/dm/${encodeURIComponent(peerId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Couldn't send.");
      setMessages((prev) => [...prev, data.message as DmRow]);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }

  const label = prettyContactLabel(peer, peerId);
  const initial = (label[0] ?? "U").toUpperCase();

  return (
    <div className="flex flex-col h-full">
      {/* Peer header */}
      <div className={`${CARD} flex items-center gap-3 p-4 mb-3 flex-shrink-0`}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: peer?.avatar_url ? "transparent" : "var(--gold, #C9A84C)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-dm-sans)",
            fontWeight: 600,
            fontSize: 14,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {peer?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={peer.avatar_url} alt="avatar" width={40} height={40} style={{ objectFit: "cover" }} />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{label}</p>
          {peer?.profile_code ? (
            <p className="text-xs text-[var(--text-muted)] font-mono">@{peer.profile_code}</p>
          ) : null}
        </div>
      </div>

      {/* Thread scrolls */}
      <div className={`${CARD} flex-1 p-4 overflow-y-auto min-h-0`}>
        {loading ? (
          <p className="text-xs text-[var(--text-muted)]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No messages yet — say hi!</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => {
              const mine = m.from_user_id === me;
              const isAgent = m.role === "agent";
              return (
                <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className="max-w-[80%] rounded-2xl px-3 py-2"
                    style={{
                      background: mine ? "var(--gold, #C9A84C)" : "var(--card-2)",
                      color: mine ? "#fff" : "var(--text-primary)",
                      border: mine ? "none" : "1px solid var(--border)",
                    }}
                  >
                    {isAgent ? (
                      <p
                        className="text-[10px] uppercase tracking-wider mb-1"
                        style={{ color: mine ? "rgba(255,255,255,0.75)" : "var(--text-muted)" }}
                      >
                        🤖 via {mine ? "your" : `${label}'s`} agent
                      </p>
                    ) : null}
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  </div>
                </li>
              );
            })}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>

      {error ? <p className="text-xs text-red-500 mt-2">{error}</p> : null}

      {/* Composer */}
      <div className="flex gap-2 mt-3 flex-shrink-0">
        <input
          className={`${INPUT} flex-1`}
          placeholder={`Message ${label}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: "var(--gold, #C9A84C)", color: "#fff" }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
