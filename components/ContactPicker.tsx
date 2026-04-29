"use client";

/**
 * ContactPicker — single OR multi-select contact list with search.
 *
 * Used inside DR Modal (single for 2-party, multi for 3+-party group DRs)
 * and trip-share / room invite flows.
 *
 * Mode is chosen via discriminated union:
 *   <ContactPicker mode="single" selectedId={...} onSelect={...} />
 *   <ContactPicker mode="multi"  selectedIds={...} onChange={...} maxSelected={7} />
 *
 * Renders:
 * - search input (filters by display_name / nickname / @handle)
 * - scrollable contact list with avatar + name + handle
 * - selected state highlighted in gold; multi mode shows a checkbox-style ✓
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

type SingleProps = {
  mode?: "single";
  selectedId: string | null;
  onSelect: (contact: PickerContact | null) => void;
  emptyHint?: string;
};
type MultiProps = {
  mode: "multi";
  selectedIds: Set<string>;
  onChange: (next: Set<string>, contact: PickerContact, isAdding: boolean) => void;
  /** Hard cap on selection — DR group max is 7 invitees (8 total inc. you). */
  maxSelected?: number;
  emptyHint?: string;
};
type Props = SingleProps | MultiProps;

export default function ContactPicker(props: Props) {
  const isMulti = props.mode === "multi";
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
      const hay = [c.nickname ?? "", c.display_name ?? "", c.profile_code]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, query]);

  function isSelected(id: string): boolean {
    if (isMulti) return (props as MultiProps).selectedIds.has(id);
    return (props as SingleProps).selectedId === id;
  }

  function handleClick(c: PickerContact) {
    if (isMulti) {
      const multi = props as MultiProps;
      const cap = multi.maxSelected ?? 7;
      const next = new Set(multi.selectedIds);
      const willAdd = !next.has(c.contact_user_id);
      if (willAdd) {
        if (next.size >= cap) return; // silently ignore over-cap
        next.add(c.contact_user_id);
      } else {
        next.delete(c.contact_user_id);
      }
      multi.onChange(next, c, willAdd);
    } else {
      const single = props as SingleProps;
      const wasSelected = single.selectedId === c.contact_user_id;
      single.onSelect(wasSelected ? null : c);
    }
  }

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
        {props.emptyHint ?? "No contacts yet. Switch to “Share link” or add someone in /contacts first."}
      </div>
    );
  }

  const overCap =
    isMulti && (props as MultiProps).selectedIds.size >= ((props as MultiProps).maxSelected ?? 7);

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
          const selected = isSelected(c.contact_user_id);
          const disabled = !selected && overCap;
          return (
            <button
              key={c.contact_user_id}
              type="button"
              onClick={() => !disabled && handleClick(c)}
              disabled={disabled}
              className={
                "flex items-center gap-3 p-2 rounded-xl text-left transition-colors " +
                (selected
                  ? "border border-[var(--gold)] bg-[var(--gold-soft)]"
                  : "border border-[var(--border)] bg-[var(--card)] hover:border-[var(--gold)]") +
                (disabled ? " opacity-40 cursor-not-allowed" : "")
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
      {isMulti && (
        <p className="text-[11px] text-[var(--text-muted)] mt-1">
          {(props as MultiProps).selectedIds.size} selected
          {overCap ? ` · max ${(props as MultiProps).maxSelected ?? 7}` : ""}
        </p>
      )}
    </div>
  );
}
