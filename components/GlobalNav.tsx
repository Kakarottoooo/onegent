"use client";

/**
 * GlobalNav - shared top navigation bar used on all pages.
 */

import { useState, useEffect, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLanguage, LANGUAGES } from "@/app/hooks/useLanguage";
import { useAuth } from "@/app/hooks/useAuth";
import { fetchAppBootstrapCached } from "@/components/app-bootstrap-client";

type Page = "home" | "tasks" | "insights" | "metrics" | "rooms" | "calendar" | "contacts" | "other";

interface Props {
  active?: Page;
}

type AccountProfile = {
  user_id: string;
  profile_code: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

const CORE_NAV_PREFETCH_PATHS = ["/tasks", "/calendar", "/rooms", "/contacts", "/insights", "/pricing"];
const ACCOUNT_PROFILE_CACHE_MS = 60000;

let accountProfileCache: { key: string; profile: AccountProfile | null; expiresAt: number } | null = null;
const accountProfileInflight = new Map<string, Promise<AccountProfile | null>>();

const NotificationBell = dynamic(() => import("./NotificationBell"), {
  ssr: false,
  loading: () => (
    <span
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: "1px solid var(--border, #e5e7eb)",
        background: "var(--card, #fff)",
        display: "inline-block",
      }}
    />
  ),
});

function getSessionId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("session_id") ?? "";
}

async function fetchAccountProfileCached(
  cacheKey: string,
  force = false,
): Promise<AccountProfile | null> {
  const now = Date.now();
  if (!force && accountProfileCache?.key === cacheKey && accountProfileCache.expiresAt > now) {
    return accountProfileCache.profile;
  }

  const existing = !force ? accountProfileInflight.get(cacheKey) : null;
  if (existing) return existing;

  const request = fetch("/api/users/me")
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as { profile?: AccountProfile };
      const profile = data.profile ?? null;
      accountProfileCache = {
        key: cacheKey,
        profile,
        expiresAt: Date.now() + ACCOUNT_PROFILE_CACHE_MS,
      };
      return profile;
    })
    .catch(() => null)
    .finally(() => {
      accountProfileInflight.delete(cacheKey);
    });

  accountProfileInflight.set(cacheKey, request);
  return request;
}

export default function GlobalNav({ active }: Props) {
  const router = useRouter();
  const [actionCount, setActionCount] = useState(0);
  const { lang, setLang, current: currentLang, t } = useLanguage();
  const auth = useAuth();
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    const win = window as typeof window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const prefetchRoutes = () => {
      for (const href of CORE_NAV_PREFETCH_PATHS) {
        router.prefetch(href);
      }
    };
    const idleHandle =
      win.requestIdleCallback?.(prefetchRoutes, { timeout: 1800 }) ??
      window.setTimeout(prefetchRoutes, 1200);
    return () => {
      if (win.cancelIdleCallback) {
        win.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, [router]);

  useEffect(() => {
    const sid = getSessionId();

    let cancelled = false;
    void fetchAppBootstrapCached(sid || null).then((data) => {
      if (!cancelled) {
        setActionCount(data.booking_jobs_summary.action_count ?? 0);
        if (data.account_profile) setAccountProfile(data.account_profile);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!auth.isSignedIn) {
      setAccountProfile(null);
      return;
    }

    let cancelled = false;

    async function loadAccountProfile(force = false) {
      const profile = await fetchAccountProfileCached(auth.userId ?? "signed-in", force);
      if (!cancelled) {
        setAccountProfile(profile);
      }
    }

    const refresh = () => {
      void loadAccountProfile(true);
    };
    window.addEventListener("onegent-account-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("onegent-account-updated", refresh);
    };
  }, [auth.isSignedIn, auth.userId]);

  const displayName =
    accountProfile?.display_name ?? auth.userDisplayName ?? "Signed in";
  const avatarUrl =
    accountProfile?.avatar_url ?? auth.userAvatar ?? null;
  const accountHandle = accountProfile?.username
    ? `@${accountProfile.username}`
    : accountProfile?.profile_code
      ? `@${accountProfile.profile_code}`
      : null;
  const immutableId = accountProfile?.user_id ?? auth.userId ?? null;

  const links: { href: string; label: string; id: Page; badge?: number }[] = [
    { href: "/tasks", label: t.nav.myTrips, id: "tasks", badge: actionCount || undefined },
    { href: "/calendar", label: "Calendar", id: "calendar" },
    { href: "/rooms", label: "Rooms", id: "rooms" },
    { href: "/contacts", label: "Contacts", id: "contacts" },
    { href: "/insights", label: "Memory", id: "insights" },
    { href: "/pricing", label: "Pricing", id: "other" },
  ];

  const accountSections: { label: string; tab: string }[] = [
    { label: "Identity", tab: "identity" },
    { label: "Profiles", tab: "profiles" },
    { label: "Controls", tab: "controls" },
  ];

  function closeAccountMenus() {
    setLangMenuOpen(false);
    setAccountMenuOpen(false);
  }

  function openAccountTab(tab?: string) {
    router.push(tab ? `/account?tab=${encodeURIComponent(tab)}` : "/account?tab=identity");
    closeAccountMenus();
  }

  const accountItemStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "9px 14px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-dm-sans)",
    fontSize: 13,
    color: "#F4E7C8",
    textAlign: "left",
  };

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backgroundColor: "var(--bg, #fafaf9)",
        borderBottom: "0.5px solid var(--border, #e5e7eb)",
        padding: "0 16px",
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          width: "100%",
          margin: "0 auto",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {/* Brand link — Next.js <Link> for SPA navigation + auto prefetch.
              Was a plain <a href> which forced a full page reload (slowest
              possible nav). */}
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-playfair, serif)",
              fontSize: 17,
              fontWeight: 700,
              color: "var(--text-primary, #111)",
              textDecoration: "none",
              letterSpacing: "-0.01em",
              flexShrink: 0,
              marginRight: 12,
            }}
          >
            Onegent<span style={{ color: "var(--gold, #C9A84C)" }}>.</span>
          </Link>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minWidth: 0,
              overflowX: "auto",
              scrollbarWidth: "none",
            }}
          >
            {links.map((link) => {
              const isActive = active === link.id;
              return (
                // Next.js <Link> auto-prefetches viewport links → bundle is
                // already in the browser when user clicks → ~600-1200ms
                // saved per nav vs the previous plain <a href>.
                <Link
                  key={link.id}
                  href={link.href}
                  onFocus={() => router.prefetch(link.href)}
                  onMouseEnter={() => router.prefetch(link.href)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "6px 11px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "var(--text-primary, #111)" : "var(--text-secondary, #666)",
                    textDecoration: "none",
                    backgroundColor: isActive ? "rgba(255,255,255,0.74)" : "transparent",
                    boxShadow: isActive ? "inset 0 0 0 0.5px rgba(0,0,0,0.04)" : "none",
                    transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
                    whiteSpace: "nowrap",
                  }}
                >
                  {link.label}
                  {link.badge != null && link.badge > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#fff",
                        backgroundColor: "rgba(220,38,38,0.85)",
                        borderRadius: 20,
                        padding: "1px 5px",
                        lineHeight: 1.5,
                      }}
                    >
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {auth.isSignedIn && <NotificationBell />}
          <div style={{ position: "relative" }}>
          {auth.isSignedIn ? (
            <>
              <button
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-label="Account menu"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "1.5px solid #C9A84C",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: auth.userAvatar ? "transparent" : "#C9A84C",
                  color: "#fff",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  overflow: "hidden",
                  boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="avatar" width={32} height={32} style={{ objectFit: "cover" }} />
                ) : (
                  (displayName[0] ?? "U").toUpperCase()
                )}
              </button>

              {accountMenuOpen && (
                <>
                  <div onClick={() => setAccountMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 8px)",
                      minWidth: 252,
                      zIndex: 50,
                      overflow: "hidden",
                      borderRadius: 16,
                      border: "0.5px solid rgba(201,168,76,0.22)",
                      background: "linear-gradient(180deg, rgba(34,30,26,0.98) 0%, rgba(25,22,19,0.99) 100%)",
                      boxShadow: "0 20px 48px rgba(0,0,0,0.32)",
                    }}
                  >
                      <button
                        type="button"
                        onClick={() => {
                          openAccountTab();
                        }}
                      style={{
                        width: "100%",
                        padding: 14,
                        border: "none",
                        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.02)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: "50%",
                            border: "1px solid rgba(201,168,76,0.28)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            background: avatarUrl ? "transparent" : "rgba(201,168,76,0.18)",
                            color: "#F8F2E7",
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarUrl} alt="avatar" width={34} height={34} style={{ objectFit: "cover" }} />
                          ) : (
                            (displayName[0] ?? "U").toUpperCase()
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.09em",
                              color: "rgba(244,231,200,0.5)",
                              marginBottom: 4,
                            }}
                          >
                            Account
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 13,
                              fontWeight: 700,
                              color: "#F8F2E7",
                              marginBottom: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {displayName}
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 11,
                              color: "rgba(244,231,200,0.6)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {accountHandle ?? auth.userEmail ?? immutableId ?? "Email unavailable"}
                          </div>
                          {immutableId && (
                            <div
                              style={{
                                fontFamily: "var(--font-dm-sans)",
                                fontSize: 10,
                                color: "rgba(244,231,200,0.38)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                marginTop: 2,
                              }}
                            >
                              {immutableId}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>

                    <div style={{ padding: "8px 0" }}>
                      <div
                        style={{
                          padding: "0 14px 6px",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.09em",
                          color: "rgba(244,231,200,0.42)",
                        }}
                      >
                        Account
                      </div>

                      {accountSections.map((item) => (
                        <button
                          key={item.tab}
                          onClick={() => openAccountTab(item.tab)}
                          style={accountItemStyle}
                        >
                          <span>{item.label}</span>
                          <span style={{ fontSize: 11, color: "rgba(244,231,200,0.42)" }}>↗</span>
                        </button>
                      ))}
                    </div>

                    <div style={{ padding: "8px 0", borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>
                      <div
                        style={{
                          padding: "0 14px 6px",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.09em",
                          color: "rgba(244,231,200,0.42)",
                        }}
                      >
                        Settings
                      </div>

                      <button onClick={() => setLangMenuOpen((open) => !open)} style={accountItemStyle}>
                        <span>
                          {currentLang.flag} {t.nav.language}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(244,231,200,0.58)" }}>
                          {currentLang.label} {langMenuOpen ? "▴" : "▾"}
                        </span>
                      </button>

                      {langMenuOpen && (
                        <div
                          style={{
                            margin: "2px 10px 8px",
                            border: "0.5px solid rgba(255,255,255,0.06)",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.02)",
                            maxHeight: 220,
                            overflowY: "auto",
                          }}
                        >
                          {LANGUAGES.map((language) => (
                            <button
                              key={language.code}
                              onClick={() => {
                                setLang(language.code);
                                closeAccountMenus();
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                width: "100%",
                                padding: "8px 12px",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                fontFamily: "var(--font-dm-sans)",
                                fontSize: 12,
                                color: language.code === lang ? "var(--gold, #C9A84C)" : "#F4E7C8",
                                fontWeight: language.code === lang ? 600 : 400,
                                backgroundColor: language.code === lang ? "rgba(201,168,76,0.12)" : "transparent",
                              }}
                            >
                              <span>{language.flag}</span>
                              <span>{language.label}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => {
                          openAccountTab("models");
                        }}
                        style={accountItemStyle}
                      >
                        <span>Models</span>
                        <span style={{ fontSize: 11, color: "rgba(244,231,200,0.42)" }}>↗</span>
                      </button>

                      <button
                        onClick={() => {
                          openAccountTab("billing");
                        }}
                        style={accountItemStyle}
                      >
                        <span>Billing</span>
                        <span style={{ fontSize: 11, color: "rgba(244,231,200,0.42)" }}>↗</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          router.push("/developers");
                          closeAccountMenus();
                        }}
                        style={accountItemStyle}
                      >
                        <span>For developers</span>
                        <span style={{ fontSize: 11, color: "rgba(201,168,76,0.7)" }}>↗</span>
                      </button>
                    </div>

                    <div style={{ padding: "8px 0", borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>
                      <div
                        style={{
                          padding: "0 14px 6px",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.09em",
                          color: "rgba(244,231,200,0.42)",
                        }}
                      >
                        Session
                      </div>
                      <button
                        onClick={() => {
                          auth.signOut();
                          setAccountMenuOpen(false);
                        }}
                        style={{
                          ...accountItemStyle,
                          color: "rgba(244,231,200,0.72)",
                        }}
                      >
                        {t.nav.signOut}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => auth.signIn()}
                style={{
                  background: "var(--gold, #C9A84C)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 999,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                {t.nav.signIn ?? "Sign in"}
              </button>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setLangMenuOpen((open) => !open)}
                  title="Language"
                  style={{
                    background: "rgba(255,255,255,0.7)",
                    border: "0.5px solid var(--border, #e5e7eb)",
                    borderRadius: 999,
                    padding: "6px 9px",
                    cursor: "pointer",
                    fontSize: 15,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {currentLang.flag}
                </button>
                {langMenuOpen && (
                  <>
                    <div onClick={() => setLangMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 8px)",
                        backgroundColor: "var(--card, #fff)",
                        border: "0.5px solid var(--border, #e5e7eb)",
                        borderRadius: 12,
                        boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                        minWidth: 190,
                        zIndex: 50,
                        overflow: "hidden",
                      }}
                    >
                      {LANGUAGES.map((language) => (
                        <button
                          key={language.code}
                          onClick={() => {
                            setLang(language.code);
                            setLangMenuOpen(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            padding: "8px 14px",
                            background: "none",
                            border: "none",
                            borderBottom: "0.5px solid var(--border, #e5e7eb)",
                            cursor: "pointer",
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: 13,
                            color: language.code === lang ? "var(--gold, #C9A84C)" : "var(--text-primary, #111)",
                            fontWeight: language.code === lang ? 600 : 400,
                            backgroundColor: language.code === lang ? "rgba(201,168,76,0.07)" : "transparent",
                          }}
                        >
                          <span>{language.flag}</span>
                          <span>{language.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </nav>
  );
}
