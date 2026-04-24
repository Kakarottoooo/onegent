"use client";

import { useState } from "react";

interface CreateKeySheetProps {
  onClose: () => void;
  onCreated: (created: { plaintextKey: string; name: string; env: "live" | "test" }) => void;
}

/**
 * Slide-up sheet for the create-key flow. Two steps in one view:
 * label + env picker. Submit hits POST /api/developers/keys; on
 * success the parent flips to RevealSheet so the user copies the
 * plaintext exactly once.
 */
export function CreateKeySheet({ onClose, onCreated }: CreateKeySheetProps) {
  const [name, setName] = useState("");
  const [env, setEnv] = useState<"live" | "test">("test");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/developers/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), env }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? "Could not create key.");
        return;
      }
      onCreated({ plaintextKey: data.plaintextKey, name: data.name, env });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dev-sheet-backdrop" onClick={onClose} />
      <div role="dialog" aria-label="Create API key" className="dev-sheet">
        <div className="dev-sheet-content">
          <header className="dev-sheet-header">
            <span className="dev-eyebrow">Create API key</span>
            <h2 className="dev-sheet-title">Name this key.</h2>
            <p className="dev-sheet-sub">
              Pick a label that tells you where this key is going to live.
              You can revoke it at any time. We&apos;ll show the secret value{" "}
              <strong style={{ color: "var(--ink-900)" }}>once</strong> —
              copy it into your environment immediately.
            </p>
          </header>

          <form className="dev-sheet-form" onSubmit={handleSubmit}>
            <div>
              <label className="dev-field-label" htmlFor="key-name">
                Label
              </label>
              <input
                id="key-name"
                className="dev-field-input"
                type="text"
                placeholder="e.g. Production · MCP server"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                required
              />
              <div className="dev-field-help">
                Up to 80 characters. Visible only to you in this dashboard.
              </div>
            </div>

            <div>
              <div className="dev-field-label">Environment</div>
              <div className="dev-radio-row">
                <button
                  type="button"
                  className="dev-radio-card"
                  data-selected={env === "test"}
                  onClick={() => setEnv("test")}
                >
                  <span className="dev-radio-card-title">Test</span>
                  <span className="dev-radio-card-desc">
                    Sandbox traffic, no real bookings. Free during beta.
                  </span>
                </button>
                <button
                  type="button"
                  className="dev-radio-card"
                  data-selected={env === "live"}
                  onClick={() => setEnv("live")}
                >
                  <span className="dev-radio-card-title">Live</span>
                  <span className="dev-radio-card-desc">
                    Real bookings on real venues. Beta-billed, $0/booking
                    until v0.3.
                  </span>
                </button>
              </div>
            </div>

            {error && <div className="dev-sheet-error">{error}</div>}

            <div className="dev-sheet-actions">
              <button
                type="submit"
                className="dev-keys-add-cta"
                disabled={busy || !name.trim()}
              >
                {busy ? "Creating…" : "Create key →"}
              </button>
              <button
                type="button"
                className="dev-cta-ghost"
                onClick={onClose}
                disabled={busy}
                style={{ color: "var(--ink-500)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
