"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useUser, SignInButton } from "@clerk/nextjs";

import {
  ConnectedAppCard,
  type ConnectedAppRow,
} from "./_components/ConnectedAppCard";

const clerkEnabled =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_") &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder";

export default function ConnectedAppsDashboardPage() {
  if (!clerkEnabled) {
    return <ConnectedAppsAuthUnavailable />;
  }
  return <ConnectedAppsDashboardWithClerk />;
}

function ConnectedAppsDashboardWithClerk() {
  const { isSignedIn, isLoaded } = useUser();
  const [apps, setApps] = useState<ConnectedAppRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/developers/connected-apps", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(data?.message ?? `Failed to load (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      setApps(data.apps ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) void loadApps();
  }, [isSignedIn, loadApps]);

  const handleDisconnect = async (clientId: string) => {
    const res = await fetch(
      `/api/developers/connected-apps/${encodeURIComponent(clientId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data?.message ?? `Could not disconnect (HTTP ${res.status})`);
      return;
    }
    await loadApps();
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
            <h1 className="dev-dashboard-title">Apps with access to your account.</h1>
            <p className="dev-dashboard-subtitle">
              Connected apps let Claude.ai, ChatGPT, and other AI clients book
              on your behalf via OAuth — no API key copy-paste. Sign in to
              review and disconnect them.
            </p>
          </div>
        </div>
        <div className="dev-empty-state">
          <div className="dev-empty-state-glyph">
            <PlugIcon />
          </div>
          <h2 className="dev-empty-state-title">Sign in to continue</h2>
          <p className="dev-empty-state-desc">
            We&apos;ll bring you straight back here.
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

  // ── Render: loading
  if (!isLoaded || apps === null) {
    return (
      <section className="dev-dashboard-section">
        <div className="dev-dashboard-header">
          <div className="dev-dashboard-title-block">
            <h1 className="dev-dashboard-title">Connected apps.</h1>
            <p className="dev-dashboard-subtitle">Loading…</p>
          </div>
        </div>
      </section>
    );
  }

  return (
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
          <h1 className="dev-dashboard-title">Connected apps.</h1>
          <p className="dev-dashboard-subtitle">
            Apps you&apos;ve authorized to act on your behalf via OAuth — Claude.ai,
            ChatGPT, and any third-party agent that connects to Onegent. Disconnect
            any of them and their tokens are revoked instantly.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="dev-sheet-error" style={{ marginBottom: "var(--space-6)" }}>
          {loadError}
        </div>
      )}

      {apps.length === 0 ? (
        <div className="dev-empty-state">
          <div className="dev-empty-state-glyph">
            <PlugIcon />
          </div>
          <h2 className="dev-empty-state-title">No connected apps yet</h2>
          <p className="dev-empty-state-desc">
            When you connect Onegent inside Claude.ai, ChatGPT, or any other
            MCP-aware agent, it shows up here. Read the{" "}
            <Link
              href="/developers/docs/integrations/claude-mcp"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              Claude integration guide
            </Link>{" "}
            to add the first one.
          </p>
        </div>
      ) : (
        <>
          <div className="dev-keys-list">
            {apps.map((row) => (
              <ConnectedAppCard
                key={row.clientId}
                row={row}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
          <div className="dev-keys-add-bar">
            <span className="dev-keys-policy">
              {apps.length} connected · revoking re-issues nothing — the app must
              walk through OAuth again to regain access.
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function ConnectedAppsAuthUnavailable() {
  return (
    <section className="dev-dashboard-section">
      <div className="dev-dashboard-header">
        <div className="dev-dashboard-title-block">
          <span className="dev-eyebrow" style={{ color: "var(--accent)" }}>
            Auth not configured
          </span>
          <h1 className="dev-dashboard-title">Apps with access to your account.</h1>
          <p className="dev-dashboard-subtitle">
            Configure Clerk publishable keys to manage connected apps in this environment.
          </p>
        </div>
      </div>
      <div className="dev-empty-state">
        <div className="dev-empty-state-glyph">
          <PlugIcon />
        </div>
        <h2 className="dev-empty-state-title">Connected apps are unavailable here</h2>
        <p className="dev-empty-state-desc">
          This build is running without Clerk, so account-scoped OAuth controls are disabled.
        </p>
      </div>
    </section>
  );
}

function PlugIcon() {
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
      <path d="M9 2v4M15 2v4M7 6h10v6a5 5 0 0 1-10 0z" />
      <path d="M12 17v5" />
    </svg>
  );
}
