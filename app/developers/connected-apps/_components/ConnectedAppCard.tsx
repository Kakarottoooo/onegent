"use client";

import { useState } from "react";

export interface ConnectedAppRow {
  clientId: string;
  name: string;
  clientUri: string | null;
  dynamicallyRegistered: boolean;
  scopes: string[];
  firstAuthorizedAt: string;
  lastTokenAt: string;
}

/**
 * One row in the connected-apps list. Mirrors KeyCard's visual language so
 * the dashboard feels cohesive across "API keys" and "Connected apps" tabs:
 * gradient-accented card, badge row for source + scopes, "Disconnect" CTA
 * matching the "Revoke" affordance on the keys page.
 */
export function ConnectedAppCard({
  row,
  onDisconnect,
}: {
  row: ConnectedAppRow;
  onDisconnect: (clientId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const handleDisconnect = async () => {
    if (
      !confirm(
        `Disconnect "${row.name}"? Existing access tokens will be revoked immediately. ` +
          `The app can re-request access by walking through OAuth again.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await onDisconnect(row.clientId);
    } finally {
      setBusy(false);
    }
  };

  const hue = hashToAngle(row.clientId);
  const gradient = `linear-gradient(${hue}deg, var(--accent), transparent 60%)`;

  return (
    <article
      className="dev-key-card"
      style={{ ["--key-gradient" as string]: gradient }}
    >
      <div className="dev-key-info">
        <div className="dev-key-info-row">
          <span className="dev-key-name">{row.name}</span>
          <span
            className={`dev-badge dev-badge--${row.dynamicallyRegistered ? "preview" : "live"}`}
          >
            {row.dynamicallyRegistered ? "auto-registered" : "managed"}
          </span>
          {row.scopes.map((scope) => (
            <span
              key={scope}
              className="dev-badge dev-badge--beta"
              style={{ textTransform: "lowercase" }}
            >
              {scope}
            </span>
          ))}
        </div>
        <div className="dev-key-info-row">
          {row.clientUri ? (
            <a
              href={row.clientUri}
              className="dev-key-prefix"
              style={{ textDecoration: "none" }}
              target="_blank"
              rel="noopener noreferrer"
            >
              {hostname(row.clientUri)} ↗
            </a>
          ) : (
            <span className="dev-key-prefix" style={{ opacity: 0.5 }}>
              no client_uri
            </span>
          )}
          <span className="dev-key-meta">
            <span>Connected {relativeTime(row.firstAuthorizedAt)}</span>
            <span>·</span>
            <span>Last token {relativeTime(row.lastTokenAt)}</span>
          </span>
        </div>
      </div>

      <div className="dev-key-actions">
        <button
          type="button"
          className="dev-key-revoke"
          onClick={handleDisconnect}
          disabled={busy}
        >
          {busy ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
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

function hostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return urlStr;
  }
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
