"use client";

import { useState } from "react";

interface RevealKeySheetProps {
  plaintextKey: string;
  name: string;
  env: "live" | "test";
  onClose: () => void;
}

/**
 * One-time reveal of a freshly minted API key. Users see this exactly
 * once — once they close the sheet, the plaintext is gone forever
 * (we only stored sha256(plaintext)). Copy button is the primary CTA.
 */
export function RevealKeySheet({
  plaintextKey,
  name,
  env,
  onClose,
}: RevealKeySheetProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plaintextKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // ignore — user can manually select
    }
  };

  return (
    <>
      <div className="dev-sheet-backdrop" />
      <div role="dialog" aria-label="Your new API key" className="dev-sheet">
        <div className="dev-sheet-content">
          <header className="dev-sheet-header">
            <span className="dev-eyebrow" style={{ color: "var(--accent)" }}>
              {name} · {env}
            </span>
            <h2 className="dev-sheet-title">Your key is ready.</h2>
            <p className="dev-sheet-sub">
              Copy it into a secret manager{" "}
              <strong style={{ color: "var(--ink-900)" }}>now</strong>. Once
              you close this sheet you cannot view it again — only its
              prefix and metadata. Lost keys must be revoked and replaced.
            </p>
          </header>

          <div className="dev-reveal-card">
            <div className="dev-reveal-warning">
              <KeyIcon />
              <span>
                Treat this like a password. Anyone with this string can act
                under your Onegent account up to its scope and quota.
              </span>
            </div>

            <div
              className="dev-reveal-key"
              onClick={handleCopy}
              style={{ cursor: "pointer" }}
              title="Click to copy"
            >
              {plaintextKey}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="dev-keys-add-cta"
              style={{ alignSelf: "flex-start" }}
            >
              {copied ? "Copied ✓" : "Copy key"}
            </button>
          </div>

          <div className="dev-sheet-actions">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: 14,
                color: "var(--ink-500)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              I&apos;ve copied this key into a safe place.
            </label>
            <button
              type="button"
              className="dev-keys-add-cta"
              onClick={onClose}
              disabled={!acknowledged}
              style={{ marginLeft: "auto" }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function KeyIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="12" r="4" />
      <path d="M13 12h8M17 12v3M19 12v2" />
    </svg>
  );
}
