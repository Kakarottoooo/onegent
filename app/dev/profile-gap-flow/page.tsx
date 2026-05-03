"use client";

/**
 * /dev/profile-gap-flow — end-to-end mock integration of the
 * profile_edit pipeline.
 *
 * Why: I shipped contract + tests for `apply_profile_patch` (NLU v2,
 * commit 76e35b9), but nothing actually CONSUMES it yet. The real chat
 * panel hookup has to wait for codex to finish fixing the 17 master TS
 * errors (which cluster in `app/page.tsx`). Until then, this dev route:
 *
 *   1. Simulates a chat panel (left)
 *   2. Routes user input through `runMockTurn()` (the SAME
 *      `coerceIntentState` + `routeIntent` production uses; only the LLM
 *      extractor is stubbed with a pattern matcher)
 *   3. Dispatches the resulting RouterAction:
 *        - apply_profile_patch → mock PATCH /api/v1/users/me/profile
 *        - show_confirm_card   → render a placeholder confirm-card chip
 *        - ask_clarification   → render the assistant's clarification
 *        - continue_chat       → just show the assistant reply
 *   4. Surfaces IntentState + RouterAction + the mock backend profile
 *      in a debug sidebar so you can see the wiring fire turn-by-turn
 *
 * When the real chat panel hookup lands, you replace `runMockTurn()`
 * with a `fetch('/api/chat/parse')` and `mockApplyPatch()` with a real
 * PATCH. Everything else — message rendering, action dispatch shape,
 * profile state management — already proven here.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { CANONICAL_FIELD_IDS } from "@/components/profile-gap";
import type { ProfileFieldId } from "@/components/profile-gap";
import type { IntentState, ProfilePatch, RouterAction } from "@/lib/agent/nlu-v2";
import { runMockTurn } from "./mock-pipeline";

/* ─── Types ──────────────────────────────────────────────────────── */

type ChatRole = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** Render-side metadata: action that produced this assistant turn. */
  actionKind?: RouterAction["type"];
  /** When `actionKind === "show_confirm_card"`, the kind for the chip. */
  confirmKind?: "plan" | "composite_plan" | "room" | "trip";
  /** When `actionKind === "apply_profile_patch"`, the patch fields applied. */
  patchedFields?: string[];
}

interface MockBackendProfile {
  values: Partial<Record<ProfileFieldId, string>>;
  /** Field ids that were just updated (for highlight animation). */
  recentlyUpdated: ProfileFieldId[];
  /** Total successful PATCH calls. */
  patchCount: number;
}

interface PresetChip {
  label: string;
  message: string;
  description: string;
}

const PRESETS: PresetChip[] = [
  {
    label: "Restaurant booking",
    message: "Book Buvette in New York tomorrow 8pm for 2",
    description: "scenario=restaurant → show_confirm_card",
  },
  {
    label: "Profile · DOB",
    message: "save my DOB 1995/05/15",
    description: "intent=profile_edit → apply_profile_patch",
  },
  {
    label: "Profile · multi-field CN",
    message: "把我的护照号 A1234567 和电话 +86 138 0000 0000 都存一下",
    description: "intent=profile_edit, 2 fields",
  },
  {
    label: "Profile · name split",
    message: "save my name as Jane Doe",
    description: "first_name + last_name (NOT full_name)",
  },
  {
    label: "Profile · email",
    message: "update my email is jane@example.com",
    description: "single field email",
  },
  {
    label: "Mid-flow profile patch",
    message: "实际我的 DOB 是 1995/5/15",
    description: "Run AFTER restaurant booking — ambient state preserved",
  },
  {
    label: "Anti-pattern (age fact)",
    message: "Book a flight to Tokyo, I'll be 30 next month",
    description: "Casual age — should NOT be profile_edit",
  },
  {
    label: "Anti-pattern (question)",
    message: "what's my email on file?",
    description: "Question — should NOT trigger PATCH",
  },
  {
    label: "Hi (chitchat)",
    message: "hi",
    description: "intent=chitchat → continue_chat",
  },
];

/* ─── Page ───────────────────────────────────────────────────────── */

export default function ProfileGapFlowPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "seed",
      role: "assistant",
      text: "Hi — try one of the preset chips below, or type a message. Watch the right panel to see the IntentState + RouterAction the production NLU pipeline produces.",
    },
  ]);
  const [input, setInput] = useState("");
  const [prevState, setPrevState] = useState<IntentState | null>(null);
  const [lastAction, setLastAction] = useState<RouterAction | null>(null);
  const [lastRawJson, setLastRawJson] = useState<Record<string, unknown> | null>(null);
  const [profile, setProfile] = useState<MockBackendProfile>({
    values: {},
    recentlyUpdated: [],
    patchCount: 0,
  });
  const [toast, setToast] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const newId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  /** Mock backend PATCH. Real call would be:
   *
   *    await fetch('/api/v1/users/me/profile', {
   *      method: 'PATCH',
   *      headers: { 'Content-Type': 'application/json' },
   *      body: JSON.stringify({ profile: patch }),
   *    });
   */
  const mockApplyPatch = useCallback(
    async (patch: ProfilePatch): Promise<{ ok: true }> => {
      await new Promise((r) => setTimeout(r, 220));
      const updatedKeys = Object.keys(patch) as ProfileFieldId[];
      setProfile((prev) => ({
        values: { ...prev.values, ...patch },
        recentlyUpdated: updatedKeys,
        patchCount: prev.patchCount + 1,
      }));
      // Clear "recently updated" highlight after a beat
      window.setTimeout(() => {
        setProfile((prev) => ({ ...prev, recentlyUpdated: [] }));
      }, 1600);
      return { ok: true };
    },
    [],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // 1. Push user message immediately
      const userMsg: ChatMessage = { id: newId(), role: "user", text: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      // 2. Run mock NLU pipeline (real coerceIntentState + routeIntent under the hood)
      const result = runMockTurn({ userText: trimmed, prevState });
      setPrevState(result.state);
      setLastAction(result.action);
      setLastRawJson(result.rawExtractorJson);

      // 3. Dispatch the action — this is the wiring shape the real chat
      //    panel will use once codex's hot files unfreeze.
      const assistantBase: ChatMessage = {
        id: newId(),
        role: "assistant",
        text: result.assistantReply,
        actionKind: result.action.type,
      };

      // Capture narrowed fields BEFORE the closure body to keep TS happy —
      // discriminated-union narrowing doesn't survive into setMessages's
      // callback (the union widens back to RouterAction inside the closure).
      const action = result.action;
      switch (action.type) {
        case "apply_profile_patch": {
          const { patch } = action;
          const patchedFields = Object.keys(patch);
          await mockApplyPatch(patch);
          showToast(`Profile patched · ${patchedFields.length} field(s)`);
          setMessages((prev) => [
            ...prev,
            { ...assistantBase, patchedFields },
          ]);
          break;
        }
        case "show_confirm_card": {
          const { kind } = action;
          setMessages((prev) => [
            ...prev,
            { ...assistantBase, confirmKind: kind },
          ]);
          break;
        }
        case "ask_clarification":
        case "continue_chat":
          setMessages((prev) => [...prev, assistantBase]);
          break;
      }

      // 4. Auto-scroll
      window.requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    },
    [prevState, newId, mockApplyPatch, showToast],
  );

  const handleReset = useCallback(() => {
    setMessages([
      {
        id: "seed",
        role: "assistant",
        text: "Reset. Try a preset or type a message.",
      },
    ]);
    setPrevState(null);
    setLastAction(null);
    setLastRawJson(null);
    setProfile({ values: {}, recentlyUpdated: [], patchCount: 0 });
    setToast(null);
  }, []);

  const stateSnapshot = useMemo(() => {
    if (!prevState) return null;
    // Trim noise — only show the fields that actually changed from defaults
    const out: Record<string, unknown> = {
      intent: prevState.intent,
      scenario: prevState.scenario,
      categories: prevState.categories,
      party_type: prevState.party_type,
    };
    if (prevState.member_names.length) out.member_names = prevState.member_names;
    if (prevState.restaurant) out.restaurant = prevState.restaurant;
    if (prevState.hotel) out.hotel = prevState.hotel;
    if (prevState.flight) out.flight = prevState.flight;
    if (prevState.activity) out.activity = prevState.activity;
    if (prevState.profile_patch) out.profile_patch = prevState.profile_patch;
    return out;
  }, [prevState]);

  return (
    <div className="flow-page">
      <header className="flow-page__top">
        <h1 className="flow-page__title">/dev/profile-gap-flow</h1>
        <span className="flow-page__sub">
          End-to-end mock of NLU v2 · profile_edit pipeline ·{" "}
          <code>runMockTurn</code> uses production{" "}
          <code>coerceIntentState</code> + <code>routeIntent</code>
        </span>
        <button type="button" className="flow-page__reset" onClick={handleReset}>
          Reset session
        </button>
      </header>

      <main className="flow-page__body">
        {/* ─── Chat column ───────────────────────────────────── */}
        <section className="flow-chat" aria-label="Mock chat">
          <div className="flow-chat__messages" role="log">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="flow-chat__presets">
            <p className="flow-chat__presets-label">Try one →</p>
            <div className="flow-chat__presets-row">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="flow-chat__preset"
                  onClick={() => handleSend(p.message)}
                  title={`${p.message}\n\n${p.description}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <form
            className="flow-chat__input-row"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
          >
            <input
              className="flow-chat__input"
              type="text"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              autoFocus
            />
            <button type="submit" className="flow-chat__send" disabled={!input.trim()}>
              Send
            </button>
          </form>
        </section>

        {/* ─── Inspector column ──────────────────────────────── */}
        <aside className="flow-inspect" aria-label="Wire inspector">
          {/* Last action */}
          <section className="flow-section">
            <h3 className="flow-section__title">Last RouterAction</h3>
            {lastAction ? (
              <ActionCard action={lastAction} />
            ) : (
              <p className="flow-muted">No turns yet.</p>
            )}
          </section>

          {/* Mock backend profile */}
          <section className="flow-section">
            <header className="flow-section__head">
              <h3 className="flow-section__title">Mock backend profile</h3>
              <span className="flow-section__sub">
                {profile.patchCount} PATCH{profile.patchCount === 1 ? "" : "es"}
              </span>
            </header>
            <ProfileCard profile={profile} />
          </section>

          {/* IntentState (collapsible) */}
          <section className="flow-section">
            <h3 className="flow-section__title">IntentState (after coerce)</h3>
            {stateSnapshot ? (
              <pre className="flow-pre">
                <code>{JSON.stringify(stateSnapshot, null, 2)}</code>
              </pre>
            ) : (
              <p className="flow-muted">No state yet.</p>
            )}
          </section>

          {/* Raw extractor JSON */}
          <section className="flow-section">
            <h3 className="flow-section__title">
              Stub extractor output <span className="flow-section__sub">(pre-coerce)</span>
            </h3>
            {lastRawJson ? (
              <pre className="flow-pre flow-pre--mute">
                <code>{JSON.stringify(lastRawJson, null, 2)}</code>
              </pre>
            ) : (
              <p className="flow-muted">No turns yet.</p>
            )}
          </section>
        </aside>
      </main>

      {toast && (
        <div className="flow-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      <style jsx>{`
        .flow-page {
          min-height: 100vh;
          background: var(--bg);
          font-family: var(--font-dm-sans);
          padding-bottom: 80px;
          --tone-good: #16a34a;
          --tone-good-bg: rgba(22, 163, 74, 0.10);
          --tone-good-border: rgba(22, 163, 74, 0.30);
          --tone-ok: #0284c7;
          --tone-ok-bg: rgba(14, 165, 233, 0.10);
          --tone-ok-border: rgba(14, 165, 233, 0.30);
          --tone-warn: #d97706;
          --tone-warn-bg: rgba(245, 158, 11, 0.10);
          --tone-warn-border: rgba(245, 158, 11, 0.40);
          --tone-bad: #dc2626;
          --tone-bad-bg: rgba(239, 68, 68, 0.10);
          --tone-bad-border: rgba(239, 68, 68, 0.30);
        }

        .flow-page__top {
          position: sticky;
          top: 0;
          z-index: 10;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--ink-3);
          padding: 14px 24px;
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .flow-page__title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: var(--ink-8);
          letter-spacing: -0.01em;
          font-family: ui-monospace, monospace;
        }

        .flow-page__sub {
          font-size: 11.5px;
          color: var(--ink-6);
          flex: 1;
          min-width: 200px;
        }

        .flow-page__sub code {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          padding: 1px 6px;
          background: var(--card-2);
          border-radius: 4px;
          color: var(--ink-7, var(--ink-6));
        }

        .flow-page__reset {
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid var(--ink-3);
          background: var(--card);
          color: var(--ink-7, var(--ink-6));
          cursor: pointer;
        }

        .flow-page__reset:hover {
          border-color: var(--ink-4, var(--ink-3));
          background: var(--card-2);
        }

        .flow-page__body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
          gap: 24px;
          padding: 24px;
          max-width: 1320px;
          margin: 0 auto;
        }

        @media (max-width: 1024px) {
          .flow-page__body {
            grid-template-columns: 1fr;
          }
        }

        /* ─── Chat ─────────────────────────────────────────── */
        .flow-chat {
          background: var(--card);
          border: 1px solid var(--ink-3);
          border-radius: 14px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          min-height: 70vh;
          gap: 14px;
        }

        .flow-chat__messages {
          flex: 1;
          overflow-y: auto;
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .flow-chat__presets {
          border-top: 1px dashed var(--ink-3);
          padding-top: 12px;
        }

        .flow-chat__presets-label {
          margin: 0 0 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-5);
        }

        .flow-chat__presets-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .flow-chat__preset {
          font-family: inherit;
          font-size: 11.5px;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--ink-3);
          background: var(--card-2);
          color: var(--ink-8);
          cursor: pointer;
          transition: background 100ms ease, border-color 100ms ease;
        }

        .flow-chat__preset:hover {
          background: var(--card);
          border-color: var(--ink-4, var(--ink-3));
        }

        .flow-chat__input-row {
          display: flex;
          gap: 8px;
        }

        .flow-chat__input {
          flex: 1;
          font-family: inherit;
          font-size: 13.5px;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid var(--ink-3);
          background: var(--card);
          color: var(--ink-8);
        }

        .flow-chat__input:focus {
          outline: 2px solid var(--tone-ok);
          outline-offset: -1px;
        }

        .flow-chat__send {
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 16px;
          border-radius: 8px;
          border: 0;
          background: var(--ink-8);
          color: var(--bg);
          cursor: pointer;
        }

        .flow-chat__send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ─── Inspector ────────────────────────────────────── */
        .flow-inspect {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .flow-section {
          background: var(--card);
          border: 1px solid var(--ink-3);
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .flow-section__head {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .flow-section__title {
          margin: 0;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-7, var(--ink-6));
        }

        .flow-section__sub {
          font-size: 11px;
          color: var(--ink-5);
          font-weight: 500;
          letter-spacing: 0.02em;
          text-transform: none;
        }

        .flow-muted {
          margin: 0;
          font-size: 12px;
          color: var(--ink-5);
          font-style: italic;
        }

        .flow-pre {
          margin: 0;
          padding: 10px 12px;
          background: var(--card-2);
          border: 1px solid var(--ink-3);
          border-radius: 6px;
          font-family: ui-monospace, monospace;
          font-size: 11px;
          line-height: 1.5;
          color: var(--ink-8);
          overflow: auto;
          max-height: 220px;
        }

        .flow-pre--mute {
          opacity: 0.78;
        }

        /* ─── Toast ────────────────────────────────────────── */
        .flow-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          padding: 10px 16px;
          background: var(--tone-good);
          color: white;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 8px 24px rgba(22, 163, 74, 0.30);
          z-index: 100;
          animation: flowToastIn 220ms ease-out;
        }

        @keyframes flowToastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ─── Chat bubble ────────────────────────────────────────────────── */

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flow-bubble flow-bubble--user">
        <p>{message.text}</p>
        <style jsx>{`
          .flow-bubble {
            align-self: flex-end;
            max-width: 78%;
            padding: 8px 12px;
            border-radius: 12px;
            background: var(--ink-8);
            color: var(--bg);
            font-size: 13.5px;
            line-height: 1.4;
          }
          .flow-bubble p { margin: 0; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flow-bubble flow-bubble--asst">
      <header>
        <span className="flow-bubble__byline">Onegent</span>
        {message.actionKind && (
          <span
            className={[
              "flow-bubble__pill",
              `flow-bubble__pill--${tonePerAction(message.actionKind)}`,
            ].join(" ")}
          >
            {message.actionKind}
          </span>
        )}
      </header>
      <p>{message.text}</p>
      {message.confirmKind && (
        <div className="flow-bubble__confirm">
          [Mock confirm card · kind={message.confirmKind} — would render real
          ConfirmCard here]
        </div>
      )}
      {message.patchedFields && message.patchedFields.length > 0 && (
        <div className="flow-bubble__patch">
          PATCHED:{" "}
          {message.patchedFields.map((f) => (
            <code key={f}>{f}</code>
          ))}
        </div>
      )}
      <style jsx>{`
        .flow-bubble {
          align-self: flex-start;
          max-width: 84%;
          padding: 10px 14px;
          border-radius: 12px;
          background: var(--card-2);
          border: 1px solid var(--ink-3);
          font-size: 13.5px;
          line-height: 1.5;
        }
        .flow-bubble header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        .flow-bubble__byline {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-5);
        }
        .flow-bubble__pill {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 1px 6px;
          border-radius: 4px;
          font-family: ui-monospace, monospace;
        }
        .flow-bubble__pill--good {
          color: var(--tone-good);
          background: var(--tone-good-bg);
          border: 1px solid var(--tone-good-border);
        }
        .flow-bubble__pill--ok {
          color: var(--tone-ok);
          background: var(--tone-ok-bg);
          border: 1px solid var(--tone-ok-border);
        }
        .flow-bubble__pill--warn {
          color: var(--tone-warn);
          background: var(--tone-warn-bg);
          border: 1px solid var(--tone-warn-border);
        }
        .flow-bubble__pill--neutral {
          color: var(--ink-6);
          background: var(--card);
          border: 1px solid var(--ink-3);
        }
        .flow-bubble p {
          margin: 0;
          color: var(--ink-8);
        }
        .flow-bubble__confirm {
          margin-top: 8px;
          padding: 6px 10px;
          border-radius: 6px;
          background: var(--tone-ok-bg);
          border: 1px dashed var(--tone-ok-border);
          font-size: 11.5px;
          color: var(--tone-ok);
          font-style: italic;
        }
        .flow-bubble__patch {
          margin-top: 8px;
          padding: 6px 10px;
          border-radius: 6px;
          background: var(--tone-good-bg);
          border: 1px solid var(--tone-good-border);
          font-size: 11px;
          color: var(--tone-good);
          font-weight: 600;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
        }
        .flow-bubble__patch code {
          font-family: ui-monospace, monospace;
          font-size: 10.5px;
          padding: 1px 6px;
          background: rgba(255, 255, 255, 0.6);
          border-radius: 3px;
          color: var(--tone-good);
        }
      `}</style>
    </div>
  );
}

function tonePerAction(kind: RouterAction["type"]): string {
  switch (kind) {
    case "apply_profile_patch": return "good";
    case "show_confirm_card": return "ok";
    case "ask_clarification": return "warn";
    case "continue_chat": return "neutral";
  }
}

/* ─── ActionCard ─────────────────────────────────────────────────── */

function ActionCard({ action }: { action: RouterAction }) {
  return (
    <div className="action-card">
      <span
        className={[
          "action-card__pill",
          `action-card__pill--${tonePerAction(action.type)}`,
        ].join(" ")}
      >
        {action.type}
      </span>
      {action.type === "apply_profile_patch" && (
        <pre>
          <code>{JSON.stringify(action.patch, null, 2)}</code>
        </pre>
      )}
      {action.type === "ask_clarification" && (
        <pre>
          <code>{JSON.stringify({ missing: action.missing }, null, 2)}</code>
        </pre>
      )}
      {action.type === "show_confirm_card" && (
        <pre>
          <code>{JSON.stringify({ kind: action.kind, directBooking: action.directBooking }, null, 2)}</code>
        </pre>
      )}
      <style jsx>{`
        .action-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .action-card__pill {
          align-self: flex-start;
          padding: 3px 9px;
          border-radius: 999px;
          font-family: ui-monospace, monospace;
          font-size: 11px;
          font-weight: 700;
          border: 1px solid;
        }
        .action-card__pill--good {
          color: var(--tone-good);
          background: var(--tone-good-bg);
          border-color: var(--tone-good-border);
        }
        .action-card__pill--ok {
          color: var(--tone-ok);
          background: var(--tone-ok-bg);
          border-color: var(--tone-ok-border);
        }
        .action-card__pill--warn {
          color: var(--tone-warn);
          background: var(--tone-warn-bg);
          border-color: var(--tone-warn-border);
        }
        .action-card__pill--neutral {
          color: var(--ink-6);
          background: var(--card-2);
          border-color: var(--ink-3);
        }
        pre {
          margin: 0;
          padding: 8px 10px;
          background: var(--card-2);
          border: 1px solid var(--ink-3);
          border-radius: 6px;
          font-family: ui-monospace, monospace;
          font-size: 11px;
          line-height: 1.5;
          color: var(--ink-8);
          overflow: auto;
        }
      `}</style>
    </div>
  );
}

/* ─── Profile card ────────────────────────────────────────────────── */

function ProfileCard({ profile }: { profile: MockBackendProfile }) {
  const filledKeys = (Object.keys(profile.values) as ProfileFieldId[]).filter(
    (k) => typeof profile.values[k] === "string" && (profile.values[k] as string).length > 0,
  );

  if (filledKeys.length === 0) {
    return (
      <p className="profile-card-empty">
        Empty. Send a profile_edit message to populate fields.
      </p>
    );
  }

  // Sort by canonical order
  const ordered = [...CANONICAL_FIELD_IDS].filter((id) =>
    filledKeys.includes(id),
  ) as ProfileFieldId[];

  return (
    <>
      <ul className="profile-card">
        {ordered.map((k) => (
          <li
            key={k}
            className={[
              "profile-card__row",
              profile.recentlyUpdated.includes(k) ? "profile-card__row--fresh" : "",
            ].join(" ")}
          >
            <code className="profile-card__key">{k}</code>
            <span className="profile-card__val">{profile.values[k]}</span>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .profile-card-empty {
          margin: 0;
          font-size: 12px;
          color: var(--ink-5);
          font-style: italic;
        }
        .profile-card {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .profile-card__row {
          display: grid;
          grid-template-columns: minmax(110px, max-content) 1fr;
          gap: 12px;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          transition: background 220ms ease;
        }
        .profile-card__row--fresh {
          background: var(--tone-good-bg);
          animation: profileCardPulse 1.6s ease-out;
        }
        @keyframes profileCardPulse {
          0%   { background: rgba(22, 163, 74, 0.30); }
          100% { background: var(--tone-good-bg); }
        }
        .profile-card__key {
          font-family: ui-monospace, monospace;
          font-size: 11px;
          color: var(--ink-6);
        }
        .profile-card__val {
          color: var(--ink-8);
          word-break: break-word;
        }
      `}</style>
    </>
  );
}
