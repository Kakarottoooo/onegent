"use client";

/**
 * ConversationalChat — homepage agent entry (Phase 1).
 *
 * Owns its own bubble history + input box. Every user message goes to
 * /api/chat/parse; the NLU result drives the next render:
 *   • assistant_reply → assistant bubble
 *   • suggested_quick_picks → inline buttons under the bubble
 *   • confirm_ready + intent=create_room → ConfirmCard (creates Room)
 *   • confirm_ready + intent=create_plan → ConfirmCard (hands off to
 *     existing homepage search via `onPlanHandoff`)
 *
 * On Room creation the panel calls router.push("/rooms/{id}").
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmCard, { type CommitResponse } from "@/components/ConfirmCard";
import type {
  ConversationalNLUResult,
  QuickPick,
} from "@/lib/conversational-nlu";
import { loadAgentModelConfig } from "@/lib/agent-model-config";

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  quickPicks?: QuickPick[] | null;
  /** When present, the assistant bubble renders a ConfirmCard below it. */
  nlu?: ConversationalNLUResult | null;
  /** True once the confirm card has been acted on — suppresses the card. */
  resolved?: boolean;
  /** Attached message used when committing a plan — carries the user's raw query. */
  messageForCommit?: string;
}

interface ConversationalChatProps {
  /**
   * Called when the NLU resolves a create_plan intent and the user confirms.
   * The parent kicks off the existing homepage search pipeline with `query`.
   * When undefined, the panel shows an error (plan path not wired).
   */
  onPlanHandoff?: (query: string, constraints: Record<string, unknown>, scenario: string | null) => void;
  /** Optional placeholder for the textarea. */
  placeholder?: string;
  /** Optional initial assistant greeting. */
  greeting?: string;
}

const PANEL: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 16,
  backgroundColor: "var(--card, #fff)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const BUBBLE_BASE: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 14,
  fontSize: 14,
  lineHeight: 1.5,
  fontFamily: "var(--font-dm-sans)",
  maxWidth: "88%",
  whiteSpace: "pre-wrap",
};

const USER_BUBBLE: React.CSSProperties = {
  ...BUBBLE_BASE,
  alignSelf: "flex-end",
  backgroundColor: "var(--gold, #c9a648)",
  color: "#fff",
};

const ASSISTANT_BUBBLE: React.CSSProperties = {
  ...BUBBLE_BASE,
  alignSelf: "flex-start",
  backgroundColor: "var(--card-2, #f7f7f7)",
  color: "var(--text-primary, #111)",
};

const QUICK_PICK: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--card, #fff)",
  color: "var(--text-primary, #111)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  cursor: "pointer",
};

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--border, #e5e7eb)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 14,
  outline: "none",
  resize: "none",
  minHeight: 44,
  maxHeight: 120,
};

const SUBMIT_BTN: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  backgroundColor: "var(--text-primary, #111)",
  color: "#fff",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

function freshId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ConversationalChat(props: ConversationalChatProps) {
  const router = useRouter();
  const [bubbles, setBubbles] = useState<Bubble[]>(() =>
    props.greeting
      ? [{ id: freshId(), role: "assistant", content: props.greeting }]
      : []
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the history to the bottom on new bubbles.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  const focusInput = useCallback(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  const runParse = useCallback(
    async (userText: string, history: Bubble[]) => {
      setPending(true);
      setError(null);
      try {
        const cfg = loadAgentModelConfig();
        const apiHistory = history
          .filter((b) => !b.resolved || b.role === "assistant")
          .map((b) => ({ role: b.role, content: b.content }));
        const res = await fetch("/api/chat/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userText,
            history: apiHistory,
            userModel: cfg.conversational,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok: boolean; result: ConversationalNLUResult; user_id: string | null }
          | null;
        if (!data || !data.ok) {
          setError("Couldn't understand that — please rephrase.");
          return;
        }
        const nlu = data.result;
        setBubbles((prev) => [
          ...prev,
          {
            id: freshId(),
            role: "assistant",
            content: nlu.assistant_reply ?? "...",
            quickPicks: nlu.suggested_quick_picks,
            nlu,
            messageForCommit: userText,
          },
        ]);
      } catch {
        setError("Network error. Try again.");
      } finally {
        setPending(false);
      }
    },
    []
  );

  const sendUserMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending) return;
      const userBubble: Bubble = {
        id: freshId(),
        role: "user",
        content: trimmed,
      };
      setBubbles((prev) => {
        const next = [...prev, userBubble];
        void runParse(trimmed, next);
        return next;
      });
      setInput("");
    },
    [pending, runParse]
  );

  function handleQuickPick(value: string) {
    void sendUserMessage(value);
  }

  function handleEdit() {
    // Mark the most recent confirm card as resolved so it hides, then refocus.
    setBubbles((prev) => {
      const idx = [...prev].reverse().findIndex((b) => b.nlu?.confirm_ready && !b.resolved);
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[realIdx] = { ...next[realIdx], resolved: true };
      return next;
    });
    focusInput();
  }

  function handleCommitted(bubbleId: string, payload: CommitResponse) {
    setBubbles((prev) =>
      prev.map((b) => (b.id === bubbleId ? { ...b, resolved: true } : b))
    );
    if (payload.kind === "room" && payload.url) {
      router.push(payload.url);
      return;
    }
    if (payload.kind === "plan") {
      if (props.onPlanHandoff) {
        props.onPlanHandoff(
          payload.search_query ?? "",
          (payload.constraints ?? {}) as Record<string, unknown>,
          payload.scenario ?? null
        );
        setBubbles((prev) => [
          ...prev,
          {
            id: freshId(),
            role: "assistant",
            content: "Kicking off the search — scroll down to see results.",
          },
        ]);
      } else {
        setBubbles((prev) => [
          ...prev,
          {
            id: freshId(),
            role: "assistant",
            content:
              "Plan hand-off isn't wired here yet — try using the search box below directly.",
          },
        ]);
      }
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendUserMessage(input);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendUserMessage(input);
    }
  }

  return (
    <div style={PANEL}>
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 380,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {bubbles.map((b) => (
          <div key={b.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={b.role === "user" ? USER_BUBBLE : ASSISTANT_BUBBLE}>{b.content}</div>

            {b.role === "assistant" && b.quickPicks && b.quickPicks.length > 0 && !b.resolved ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {b.quickPicks.map((pick) => (
                  <button
                    key={`${b.id}-${pick.value}`}
                    type="button"
                    style={QUICK_PICK}
                    onClick={() => handleQuickPick(pick.value)}
                    disabled={pending}
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
            ) : null}

            {b.role === "assistant" && b.nlu && b.nlu.confirm_ready && !b.resolved ? (
              <ConfirmCard
                kind={b.nlu.intent === "create_room" ? "room" : "plan"}
                nlu={b.nlu}
                message={b.messageForCommit ?? ""}
                onConfirmed={(payload) => handleCommitted(b.id, payload)}
                onEdit={handleEdit}
              />
            ) : null}
          </div>
        ))}
        {pending ? (
          <div style={{ ...ASSISTANT_BUBBLE, fontStyle: "italic", opacity: 0.7 }}>
            Thinking...
          </div>
        ) : null}
      </div>

      {error ? (
        <div style={{ color: "#c0392b", fontSize: 12, fontFamily: "var(--font-dm-sans)" }}>
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.placeholder ?? "Tell me what you want — I'll figure out the rest."}
          rows={1}
          style={INPUT_STYLE}
          disabled={pending}
        />
        <button type="submit" style={SUBMIT_BTN} disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
