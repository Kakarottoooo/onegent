"use client";

/**
 * GlobalNav - shared top navigation bar used on all pages.
 */

import { useState, useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useLanguage, LANGUAGES } from "@/app/hooks/useLanguage";
import { useAuth } from "@/app/hooks/useAuth";

type Page = "home" | "tasks" | "insights" | "metrics" | "rooms" | "calendar" | "other";

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

function getSessionId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("session_id") ?? "";
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
    const sid = getSessionId();
    if (!sid) return;

    fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.jobs) return;
        const actions = d.jobs.reduce(
          (n: number, j: { steps?: { actionItem?: unknown }[] }) =>
            n + (j.steps?.filter((s) => s.actionItem).length ?? 0),
          0,
        );
        setActionCount(actions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!auth.isSignedIn) {
      setAccountProfile(null);
      return;
    }

    let cancelled = false;

    async function loadAccountProfile() {
      try {
        const response = await fetch("/api/users/me");
        if (!response.ok) return;
        const data = (await response.json()) as { profile?: AccountProfile };
        if (!cancelled) {
          setAccountProfile(data.profile ?? null);
        }
      } catch {
        // ignore
      }
    }

    void loadAccountProfile();

    const refresh = () => {
      void loadAccountProfile();
    };
    window.addEventListener("onegent-account-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("onegent-account-updated", refresh);
    };
  }, [auth.isSignedIn]);

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
    { href: "/insights", label: "Memory", id: "insights" },
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
          <a
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
          </a>

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
                <a
                  key={link.id}
                  href={link.href}
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
                </a>
              );
            })}
          </div>
        </div>

        <div style={{ position: "relative", flexShrink: 0 }}>
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
    </nav>
  );
}
