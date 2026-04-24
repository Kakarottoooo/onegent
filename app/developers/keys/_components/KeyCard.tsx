"use client";

import { useState } from "react";

export interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  env: "live" | "test";
}

/**
 * One row in the keys list. Each card carries a per-key gradient
 * derived from the prefix hash so visually no two keys look the same
 * — small touch but adds a Linear-flavored "this key is mine" cue.
 */
export function KeyCard({
  row,
  onRevoke,
}: {
  row: KeyRow;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const handleRevoke = async () => {
    if (!confirm(`Revoke "${row.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await onRevoke(row.id);
    } finally {
      setBusy(false);
    }
  };

  // Hash-derived gradient for visual uniqueness
  const hue = hashToAngle(row.id);
  const gradient = `linear-gradient(${hue}deg, var(--accent), transparent 60%)`;

  return (
    <article
      className="dev-key-card"
      data-revoked={!row.isActive ? "true" : undefined}
      style={{ ["--key-gradient" as string]: gradient }}
    >
      <div className="dev-key-info">
        <div className="dev-key-info-row">
          <span className="dev-key-name">{row.name}</span>
          <span
            className={`dev-badge dev-badge--${row.env === "live" ? "live" : "preview"}`}
          >
            {row.env}
          </span>
          {!row.isActive && (
            <span className="dev-badge dev-badge--beta">revoked</span>
          )}
        </div>
        <div className="dev-key-info-row">
          <span className="dev-key-prefix">{row.keyPrefix}_••••••••</span>
          <span className="dev-key-meta">
            <span>Created {relativeTime(row.createdAt)}</span>
            <span>·</span>
            <span>
              {row.lastUsedAt
                ? `Last used ${relativeTime(row.lastUsedAt)}`
                : "Never used"}
            </span>
          </span>
        </div>
      </div>

      {row.isActive && (
        <div className="dev-key-actions">
          <button
            type="button"
            className="dev-key-revoke"
            onClick={handleRevoke}
            disabled={busy}
          >
            {busy ? "Revoking…" : "Revoke"}
          </button>
        </div>
      )}
    </article>
  );
}

function hashToAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}
