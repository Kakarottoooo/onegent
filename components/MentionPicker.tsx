"use client";

/**
 * MentionPicker — wraps a single-line text input with @-mention autocomplete.
 *
 * Behavior:
 * - User types "@" anywhere; we open a dropdown anchored under the input.
 * - Dropdown lists the user's contacts, fuzzy-filtered by the @query.
 * - When the query has no exact match, the dropdown footer offers
 *   "🔍 Look up @<query>..." which calls the parent-supplied lookup handler.
 *   The parent is responsible for the network round-trip (so this stays a
 *   pure UI component) — typically GET /api/users/by-code/<query> →
 *   POST /api/contacts/requests, then add the user_id to mentions.
 * - Picked mentions are tracked as user_ids in `mentionedUserIds` and bubbled
 *   up via onMentionsChange. The text itself shows "@username" verbatim.
 *
 * Why parallel state (text + user_ids) instead of contenteditable chips:
 * contenteditable has IME bugs, caret-position bugs, and ~10x the code.
 * Plain text + a parallel set is good enough — the server uses the user_ids
 * directly for routing, and the text still reads naturally.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface MentionContact {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  profile_code?: string | null;
}

export interface MentionPickerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  contacts: MentionContact[];
  /** Bubbled up whenever the resolved user_ids set changes. */
  onMentionsChange?: (userIds: string[]) => void;
  /** Externally-resolved usernames (from lookup-and-invite). Maps lowercase username → user_id. */
  pendingInvites?: Record<string, string>;
  /**
   * Called when user picks "Look up @<query>" footer. Parent does the lookup
   * + contact-request + adds the user to pendingInvites. Returns the resolved
   * username (so we can splice it back into the text), or null on failure.
   */
  onLookup?: (handle: string) => Promise<{
    user_id: string;
    username: string;
    display_name: string | null;
  } | null>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Style applied to the wrapper div. Use this to slot into flex layouts. */
  wrapperStyle?: React.CSSProperties;
  /** data-* attributes forwarded to the underlying input. */
  inputDataAttributes?: Record<string, string>;
  /** Pass-through composition handlers for IME safety. */
  onCompositionStart?: () => void;
  onCompositionEnd?: (value: string) => void;
  /** Optional paste hook for Capture inputs such as screenshots. */
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>;
}

interface AtToken {
  /** Start index of '@' in the value. */
  start: number;
  /** Caret position (end of token). */
  end: number;
  /** Text after '@', up to caret. */
  query: string;
}

/**
 * Walk backwards from the caret to find an unbroken @<word> token. Returns
 * null if there's no @ before the caret or whitespace breaks the run.
 */
function detectAtToken(value: string, caret: number): AtToken | null {
  if (caret <= 0) return null;
  // Walk back to find '@' or whitespace
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      // Make sure '@' is preceded by start-of-text or whitespace, otherwise
      // it's a stray @ inside a word (like an email — don't trigger).
      const prev = i === 0 ? " " : value[i - 1];
      if (!/\s/.test(prev) && i !== 0) return null;
      const query = value.slice(i + 1, caret);
      // Trigger only on \w-like chars + Chinese letters in handles is unusual
      // for usernames, so restrict to ASCII identifier chars.
      if (!/^[a-zA-Z0-9_]*$/.test(query)) return null;
      return { start: i, end: caret, query };
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

function findAllMentions(value: string): { handle: string }[] {
  const out: { handle: string }[] = [];
  const re = /(?:^|\s)@([a-zA-Z0-9_]{2,32})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    out.push({ handle: m[1] });
  }
  return out;
}

function deriveMentionedUserIds(
  value: string,
  contacts: MentionContact[],
  pendingInvites: Record<string, string>,
): string[] {
  const tokens = findAllMentions(value);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const t of tokens) {
    const lower = t.handle.toLowerCase();
    // Match by username first, then profile_code as fallback. Contacts that
    // were added via /api/contacts/requests with profile_code only (no Clerk
    // username yet) are taggable via @<6-char-code> instead.
    const direct = contacts.find(
      (c) =>
        (c.username ?? "").toLowerCase() === lower ||
        (c.profile_code ?? "").toLowerCase() === lower,
    );
    let id: string | undefined = direct?.user_id;
    if (!id && pendingInvites[lower]) id = pendingInvites[lower];
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function fuzzyMatch(c: MentionContact, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const u = (c.username ?? "").toLowerCase();
  const d = (c.display_name ?? "").toLowerCase();
  const code = (c.profile_code ?? "").toLowerCase();
  if (u.startsWith(q)) return 3;
  if (d.startsWith(q)) return 2;
  if (code.startsWith(q)) return 2;
  if (u.includes(q) || d.includes(q) || code.includes(q)) return 1;
  return 0;
}

const MentionPicker = forwardRef<HTMLInputElement, MentionPickerProps>(
  function MentionPicker(props, externalRef) {
    const {
      value,
      onChange,
      onSubmit,
      contacts,
      onMentionsChange,
      pendingInvites = {},
      onLookup,
      placeholder,
      disabled,
      className,
      ariaLabel,
      wrapperStyle,
      inputDataAttributes,
      onCompositionStart,
      onCompositionEnd,
      onPaste,
    } = props;

    const innerRef = useRef<HTMLInputElement | null>(null);
    const setRef = useCallback(
      (el: HTMLInputElement | null) => {
        innerRef.current = el;
        if (typeof externalRef === "function") externalRef(el);
        else if (externalRef) externalRef.current = el;
      },
      [externalRef],
    );

    const [caret, setCaret] = useState(0);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const [lookingUp, setLookingUp] = useState(false);
    const [lookupError, setLookupError] = useState<string | null>(null);

    // Detect mention token at caret on every value/caret change
    const token = useMemo(() => detectAtToken(value, caret), [value, caret]);

    // Filter contacts against the current @query
    const filtered = useMemo(() => {
      const q = token?.query ?? "";
      const ranked = contacts
        .map((c) => ({ c, score: fuzzyMatch(c, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((x) => x.c);
      return ranked;
    }, [contacts, token]);

    // Open/close dropdown based on whether we have a token
    useEffect(() => {
      if (token) {
        setOpen(true);
        setHighlight(0);
        setLookupError(null);
      } else {
        setOpen(false);
      }
    }, [token]);

    // Bubble up resolved user_ids whenever value or contacts/invites change
    useEffect(() => {
      if (!onMentionsChange) return;
      const ids = deriveMentionedUserIds(value, contacts, pendingInvites);
      onMentionsChange(ids);
    }, [value, contacts, pendingInvites, onMentionsChange]);

    function commitMention(username: string) {
      if (!token) return;
      const before = value.slice(0, token.start);
      const after = value.slice(token.end);
      const insertedNeedsSpace = !after.startsWith(" ");
      const inserted = `@${username}${insertedNeedsSpace ? " " : ""}`;
      const next = before + inserted + after;
      const newCaret = before.length + inserted.length;
      onChange(next);
      setOpen(false);
      // Restore caret next tick (after onChange propagates)
      requestAnimationFrame(() => {
        const el = innerRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCaret, newCaret);
          setCaret(newCaret);
        }
      });
    }

    async function handleLookup() {
      if (!onLookup || !token || !token.query) return;
      setLookingUp(true);
      setLookupError(null);
      try {
        const result = await onLookup(token.query);
        if (!result) {
          setLookupError(`@${token.query} not found`);
          return;
        }
        commitMention(result.username);
      } catch (err) {
        setLookupError(
          err instanceof Error ? err.message : "Lookup failed.",
        );
      } finally {
        setLookingUp(false);
      }
    }

    // Total dropdown row count = filtered + (lookup row if applicable)
    const showLookupRow =
      !!onLookup &&
      !!token &&
      token.query.length >= 2 &&
      !filtered.some(
        (c) => (c.username ?? "").toLowerCase() === token.query.toLowerCase(),
      );
    const rowCount = filtered.length + (showLookupRow ? 1 : 0);

    return (
      <div style={{ position: "relative", width: "100%", ...wrapperStyle }}>
        <input
          ref={setRef}
          type="text"
          {...(inputDataAttributes ?? {})}
          style={{ width: "100%", boxSizing: "border-box" }}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) =>
            setCaret((e.target as HTMLInputElement).selectionStart ?? 0)
          }
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(e) => onCompositionEnd?.(e.currentTarget.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // IME composition: never act on Enter while user is composing
            // (Chinese pinyin etc. — Enter is the commit, not a submit).
            const composing = e.nativeEvent.isComposing;
            if (open && rowCount > 0 && !composing) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % rowCount);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + rowCount) % rowCount);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (highlight < filtered.length) {
                  const c = filtered[highlight];
                  // Prefer username for the @-tag; fall back to profile_code
                  // when the contact has no Clerk username (e.g. added via
                  // request-by-code without a username yet).
                  const handle = c.username || c.profile_code || null;
                  if (handle) commitMention(handle);
                } else if (showLookupRow) {
                  void handleLookup();
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                return;
              }
            }
            if (e.key === "Enter" && !composing && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={className}
          disabled={disabled}
        />

        {open && rowCount > 0 ? (
          <div
            role="listbox"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "calc(100% + 6px)",
              maxHeight: 280,
              overflowY: "auto",
              background: "var(--card, #fff)",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: 14,
              boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
              zIndex: 60,
              padding: 6,
            }}
          >
            {filtered.map((c, idx) => {
              const active = idx === highlight;
              return (
                <button
                  key={c.user_id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const handle = c.username || c.profile_code || null;
                    if (handle) commitMention(handle);
                  }}
                  onMouseEnter={() => setHighlight(idx)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "none",
                    background: active ? "var(--gold-soft, #f7eed8)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    // Active row uses gold-text (dark brown) so it contrasts
                    // with the cream gold-soft background — particularly
                    // important in dark mode where text-primary is light.
                    color: active
                      ? "var(--gold-text, #5A4416)"
                      : "var(--text-primary, #111)",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--gold-soft, #f7eed8)",
                      backgroundImage: c.avatar_url ? `url(${c.avatar_url})` : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontWeight: 600, lineHeight: 1.2 }}>
                      {c.display_name ?? c.username ?? c.profile_code ?? "(no name)"}
                    </span>
                    {(c.username || c.profile_code) ? (
                      <span
                        style={{
                          color: active
                            ? "var(--gold-text, #5A4416)"
                            : "var(--text-secondary, #666)",
                          fontSize: 11,
                          opacity: active ? 0.85 : 1,
                        }}
                      >
                        @{c.username ?? c.profile_code}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
            {showLookupRow ? (
              <button
                type="button"
                role="option"
                aria-selected={highlight === filtered.length}
                disabled={lookingUp}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleLookup();
                }}
                onMouseEnter={() => setHighlight(filtered.length)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  marginTop: filtered.length > 0 ? 4 : 0,
                  borderTop:
                    filtered.length > 0
                      ? "1px solid var(--border, #e5e7eb)"
                      : "none",
                  borderRadius: 10,
                  border: "none",
                  background:
                    highlight === filtered.length
                      ? "var(--gold-soft, #f7eed8)"
                      : "transparent",
                  cursor: lookingUp ? "wait" : "pointer",
                  textAlign: "left",
                  color:
                    highlight === filtered.length
                      ? "var(--gold-text, #5A4416)"
                      : "var(--text-primary, #111)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  opacity: lookingUp ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 16 }}>🔍</span>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {lookingUp
                      ? `Looking up @${token?.query ?? ""}…`
                      : `Look up @${token?.query ?? ""}`}
                  </span>
                  <span
                    style={{
                      color:
                        highlight === filtered.length
                          ? "var(--gold-text, #5A4416)"
                          : "var(--text-secondary, #666)",
                      fontSize: 11,
                      opacity: highlight === filtered.length ? 0.85 : 1,
                    }}
                  >
                    {lookupError ?? "Find them by handle and send a contact request"}
                  </span>
                </div>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);

export default MentionPicker;
