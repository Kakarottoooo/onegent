"use client";

import { useEffect, useState, useCallback } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";

import { KeyCard, type KeyRow } from "./_components/KeyCard";
import { CreateKeySheet } from "./_components/CreateKeySheet";
import { RevealKeySheet } from "./_components/RevealKeySheet";

interface RevealState {
  plaintextKey: string;
  name: string;
  env: "live" | "test";
}

const clerkEnabled =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_") &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder";

export default function KeysDashboardPage() {
  if (!clerkEnabled) {
    return <KeysAuthUnavailable />;
  }
  return <KeysDashboardWithClerk />;
}

function KeysDashboardWithClerk() {
  const { isSignedIn, isLoaded } = useUser();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/developers/keys", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(data?.message ?? `Failed to load (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) void loadKeys();
  }, [isSignedIn, loadKeys]);

  const handleRevoke = async (id: string) => {
    const res = await fetch(`/api/developers/keys/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 409) {
      const data = await res.json().catch(() => ({}));
      alert(data?.message ?? `Could not revoke key (HTTP ${res.status})`);
      return;
    }
    await loadKeys();
  };

  // ── Render: not signed in
  if (isLoaded && !isSignedIn) {
    return (
      <section className="dev-dashboard-section">
        <div className="dev-dashboard-header">
          <div className="dev-dashboard-title-block">
            <span className="dev-eyebrow" style={{ color: "var(--accent)" }}>
              Sign in required
            </span>
            <h1 className="dev-dashboard-title">Your API keys live here.</h1>
            <p className="dev-dashboard-subtitle">
              Onegent uses your account to scope keys to a single owner.
              Sign in to mint your first key — it takes about 30 seconds.
            </p>
          </div>
        </div>
        <div className="dev-empty-state">
          <div className="dev-empty-state-glyph">
            <KeyIcon />
          </div>
          <h2 className="dev-empty-state-title">Sign in to continue</h2>
          <p className="dev-empty-state-desc">
            We&apos;ll bring you straight back here. Beta is open — anyone
            with an email address can sign up.
          </p>
          <SignInButton mode="modal">
            <button type="button" className="dev-keys-add-cta">
              Sign in
            </button>
          </SignInButton>
        </div>
      </section>
    );
  }

  // ── Render: loading auth or keys
  if (!isLoaded || keys === null) {
    return (
      <section className="dev-dashboard-section">
        <div className="dev-dashboard-header">
          <div className="dev-dashboard-title-block">
            <h1 className="dev-dashboard-title">Your API keys.</h1>
            <p className="dev-dashboard-subtitle">Loading…</p>
          </div>
        </div>
      </section>
    );
  }

  const activeCount = keys.filter((k) => k.isActive).length;

  return (
    <>
      <section className="dev-dashboard-section">
        <div className="dev-dashboard-header">
          <div className="dev-dashboard-title-block">
            <span
              className="dev-eyebrow"
              style={{ display: "inline-flex", gap: "var(--space-3)", alignItems: "center" }}
            >
              <span style={{ width: 24, height: 1, background: "var(--accent)" }} />
              Dashboard
            </span>
            <h1 className="dev-dashboard-title">Your API keys.</h1>
            <p className="dev-dashboard-subtitle">
              Each key is scoped to your account and can be revoked instantly.
              Keys not used in 30 days are automatically retired during beta.
            </p>
          </div>
          {keys.length > 0 && (
            <button
              type="button"
              className="dev-keys-add-cta"
              onClick={() => setCreating(true)}
            >
              Create new key
            </button>
          )}
        </div>

        {loadError && (
          <div className="dev-sheet-error" style={{ marginBottom: "var(--space-6)" }}>
            {loadError}
          </div>
        )}

        {keys.length === 0 ? (
          <div className="dev-empty-state">
            <div className="dev-empty-state-glyph">
              <KeyIcon />
            </div>
            <h2 className="dev-empty-state-title">Mint your first key</h2>
            <p className="dev-empty-state-desc">
              You haven&apos;t created any keys yet. New keys ship as test
              keys by default — flip to live when you&apos;re ready to
              execute real bookings.
            </p>
            <button
              type="button"
              className="dev-keys-add-cta"
              onClick={() => setCreating(true)}
            >
              Create API key
            </button>
          </div>
        ) : (
          <>
            <div className="dev-keys-list">
              {keys.map((row) => (
                <KeyCard key={row.id} row={row} onRevoke={handleRevoke} />
              ))}
            </div>
            <div className="dev-keys-add-bar">
              <span className="dev-keys-policy">
                {activeCount} active · {keys.length - activeCount} revoked.
                Limit 10 active keys per account during beta.
              </span>
            </div>
          </>
        )}
      </section>

      {creating && (
        <CreateKeySheet
          onClose={() => setCreating(false)}
          onCreated={(payload) => {
            setCreating(false);
            setReveal(payload);
            void loadKeys();
          }}
        />
      )}

      {reveal && (
        <RevealKeySheet
          plaintextKey={reveal.plaintextKey}
          name={reveal.name}
          env={reveal.env}
          onClose={() => setReveal(null)}
        />
      )}
    </>
  );
}

function KeysAuthUnavailable() {
  return (
    <section className="dev-dashboard-section">
      <div className="dev-dashboard-header">
        <div className="dev-dashboard-title-block">
          <span className="dev-eyebrow" style={{ color: "var(--accent)" }}>
            Auth not configured
          </span>
          <h1 className="dev-dashboard-title">Your API keys live here.</h1>
          <p className="dev-dashboard-subtitle">
            Configure Clerk publishable keys to mint and manage account-scoped API keys.
          </p>
        </div>
      </div>
      <div className="dev-empty-state">
        <div className="dev-empty-state-glyph">
          <KeyIcon />
        </div>
        <h2 className="dev-empty-state-title">API keys are unavailable here</h2>
        <p className="dev-empty-state-desc">
          This build is running without Clerk, so developer account controls are disabled.
        </p>
      </div>
    </section>
  );
}

function KeyIcon() {
  return (
    <svg
      width="28"
      height="28"
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
