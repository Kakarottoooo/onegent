"use client";

/**
 * ContactPicker — single-select contact list with search.
 *
 * Used inside DR Modal (and later inside trip-share / room invites) so the
 * user can pick someone they've already added rather than copy-pasting a
 * link to the same friend every time.
 *
 * Renders:
 * - search input (filters by display_name / nickname / @handle)
 * - scrollable contact list with avatar + name + handle
 * - selected state highlighted in gold
 *
 * Selection model is single by design — DR creation API only takes one
 * inviteeUserId. Multi-select can come later for group-DR.
 */

import { useEffect, useMemo, useState } from "react";
import { INPUT } from "@/app/_ui/tokens";

export interface PickerContact {
  contact_user_id: string;
  nickname: string | null;
  profile_code: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  selectedId: string | null;
  onSelect: (contact: PickerContact | null) => void;
  /** Optional limit/empty-state. If omitted, fetches all contacts. */
  emptyHint?: string;
}

export default function ContactPicker({ selectedId, onSelect, emptyHint }: Props) {
  const [contacts, setContacts] = useState<PickerContact[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contacts")
      .then((res) => (res.ok ? res.json() : { contacts: [] }))
      .then((data: { contacts: PickerContact[] }) => {
        if (!cancelled) setContacts(data.contacts ?? []);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!contacts) return null;
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return contacts;
    return contacts.filter((c) => {
      const hay = [
        c.nickname ?? "",
        c.display_name ?? "",
        c.profile_code,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, query]);

  if (contacts === null) {
    return (
      <div className="text-sm text-[var(--text-muted)] text-center py-6">
        Loading contacts…
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] text-center py-6 px-4">
        {emptyHint ?? "No contacts yet. Switch to “Share link” or add someone in /contacts first."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or @handle"
        className={INPUT}
      />
      <div
        className="flex flex-col gap-1 overflow-y-auto"
        style={{ maxHeight: 260 }}
      >
        {filtered && filtered.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-3">
            No matches.
          </p>
        )}
        {filtered?.map((c) => {
          const label = c.nickname ?? c.display_name ?? `@${c.profile_code}`;
          const selected = c.contact_user_id === selectedId;
          return (
            <button
              key={c.contact_user_id}
              type="button"
              onClick={() => onSelect(selected ? null : c)}
              className={
                "flex items-center gap-3 p-2 rounded-xl text-left transition-colors " +
                (selected
                  ? "border border-[var(--gold)] bg-[var(--gold-soft)]"
                  : "border border-[var(--border)] bg-[var(--card)] hover:border-[var(--gold)]")
              }
            >
              {c.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.avatar_url}
                  alt=""
                  className="w-9 h-9 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[var(--card-2)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-secondary)] flex-shrink-0">
                  {label.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {label}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">
                  @{c.profile_code}
                </p>
              </div>
              {selected && (
                <span className="text-[var(--gold-text)] text-sm font-semibold flex-shrink-0">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
