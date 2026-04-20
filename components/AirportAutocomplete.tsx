"use client";

import { useEffect, useRef, useState } from "react";
import { searchAirports, type AirportSearchResult } from "@/lib/airports-data";

interface AirportAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}

export default function AirportAutocomplete({
  value,
  onChange,
  placeholder,
  className,
  id,
  disabled,
}: AirportAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep internal query in sync when value changes externally.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const results: AirportSearchResult[] = query.length >= 1 ? searchAirports(query, 8) : [];

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(r: AirportSearchResult) {
    onChange(r.value);
    setQuery(r.value);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === "ArrowDown" && query.length >= 1) {
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[highlight];
      if (r) pick(r);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <input
        ref={inputRef}
        id={id}
        disabled={disabled}
        type="text"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          setHighlight(0);
          // Free-text fallback: commit raw input when no dropdown selection
          onChange(next);
        }}
        onFocus={() => {
          if (query.length >= 1) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full border border-[var(--border)] rounded-xl p-3 text-sm bg-[var(--card)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)]"
      />

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg"
        >
          {results.map((r, i) => {
            const active = i === highlight;
            return (
              <li
                key={`${r.kind}-${r.value}-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus
                  pick(r);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`px-3 py-2 cursor-pointer flex items-center justify-between gap-3 ${
                  active ? "bg-[var(--gold)]/15" : "hover:bg-[var(--card-2)]"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {r.label}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate">
                    {r.sublabel}
                  </div>
                </div>
                {r.kind === "metro" && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--gold)]/20 text-[var(--gold)] whitespace-nowrap">
                    METRO
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
