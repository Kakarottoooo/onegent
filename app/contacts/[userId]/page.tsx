"use client";

/**
 * DM thread with a single contact. Consumed by /api/dm/[userId]:
 *   GET  → message history (both directions, chronological)
 *   POST → new message from caller (role='user')
 *
 * role='agent' messages (auto-invites, etc.) are server-inserted by other
 * routes; here we render them with a distinct badge so the recipient knows
 * they were sent on the user's behalf and not personally typed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/app/hooks/useAuth";
import { CARD, INPUT, PAGE } from "@/app/_ui/tokens";
import GlobalNav from "@/components/GlobalNav";

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

export default function DmThreadPage() {
  const { isSignedIn, userId: me } = useAuth();
  const params = useParams<{ userId: string }>();
  const peerId = (params?.userId ?? "").toString();

  const [peer, setPeer] = useState<ContactProfile | null>(null);
  const [messages, setMessages] = useState<DmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(async () => {
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
    if (!isSignedIn) return;
    loadThread();
  }, [isSignedIn, loadThread]);

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

  if (!isSignedIn) {
    return (
      <div className={PAGE}>
        <GlobalNav active="contacts" />
        <div className="flex items-center justify-center p-6">
          <div className={`${CARD} p-6 max-w-sm text-center`}>
            <p className="text-sm text-[var(--text-secondary)] mb-3">Sign in to message contacts.</p>
            <Link href="/" className="text-sm font-medium text-[var(--gold)] underline">Go to sign in →</Link>
          </div>
        </div>
      </div>
    );
  }

  const headerLabel = peer?.nickname || peer?.display_name || peer?.profile_code || peerId;
  const headerInitial = (headerLabel[0] ?? "U").toUpperCase();

  return (
    <div className={PAGE}>
      <GlobalNav active="contacts" />
      <div className="max-w-md md:max-w-2xl lg:max-w-3xl mx-auto px-5 md:px-6 py-6 flex flex-col" style={{ minHeight: "calc(100vh - 80px)" }}>
        <Link
          href="/contacts"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4 inline-block"
        >
          ← All contacts
        </Link>

        {/* Header: peer avatar + name */}
        <div className={`${CARD} flex items-center gap-3 p-4 mb-3`}>
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
              headerInitial
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{headerLabel}</p>
            {peer?.profile_code ? (
              <p className="text-xs text-[var(--text-muted)] font-mono">@{peer.profile_code}</p>
            ) : null}
          </div>
        </div>

        {/* Thread */}
        <div className={`${CARD} flex-1 p-4 overflow-y-auto`} style={{ minHeight: 320, maxHeight: "60vh" }}>
          {loading ? (
            <p className="text-xs text-[var(--text-muted)]">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No messages yet — say hi to {headerLabel}!
            </p>
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
                          🤖 via {mine ? "your" : `${headerLabel}'s`} agent
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

        {error ? (
          <p className="text-xs text-red-500 mt-3">{error}</p>
        ) : null}

        {/* Composer */}
        <div className="flex gap-2 mt-3">
          <input
            className={`${INPUT} flex-1`}
            placeholder={`Message ${headerLabel}…`}
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
    </div>
  );
}
