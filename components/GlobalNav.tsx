"use client";

/**
 * GlobalNav - shared top navigation bar used on all pages.
 */

import { useState, useEffect } from "react";
import { useLanguage, LANGUAGES } from "@/app/hooks/useLanguage";
import { useAuth } from "@/app/hooks/useAuth";

type Page = "home" | "tasks" | "monitoring" | "insights" | "metrics" | "rooms" | "other";

interface Props {
  active?: Page;
}

function getSessionId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("session_id") ?? "";
}

export default function GlobalNav({ active }: Props) {
  const [actionCount, setActionCount] = useState(0);
  const [monitorCount, setMonitorCount] = useState(0);
  const { lang, setLang, current: currentLang, t } = useLanguage();
  const auth = useAuth();
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
          0
        );
        setActionCount(actions);
      })
      .catch(() => {});

    fetch(`/api/monitors?session_id=${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.monitors) return;
        setMonitorCount(d.monitors.filter((m: { status: string }) => m.status === "active").length);
      })
      .catch(() => {});
  }, []);

  const links: { href: string; label: string; id: Page; badge?: number }[] = [
    { href: "/tasks", label: t.nav.myTrips, id: "tasks", badge: actionCount || undefined },
    { href: "/rooms", label: "Rooms", id: "rooms" },
    { href: "/monitoring", label: t.nav.monitoring, id: "monitoring", badge: monitorCount || undefined },
    { href: "/insights", label: t.nav.insights, id: "insights" },
    { href: "/permissions", label: t.nav.preferences, id: "other" },
  ];

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backgroundColor: "rgba(250,248,244,0.86)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
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
                        backgroundColor:
                          link.id === "monitoring" ? "var(--gold, #C9A84C)" : "rgba(220,38,38,0.85)",
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
                onClick={() => setAccountMenuOpen((o) => !o)}
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
                {auth.userAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={auth.userAvatar} alt="avatar" width={32} height={32} style={{ objectFit: "cover" }} />
                ) : (
                  (auth.userDisplayName?.[0] ?? "U").toUpperCase()
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
                      backgroundColor: "var(--card, #fff)",
                      border: "0.5px solid var(--border, #e5e7eb)",
                      borderRadius: 12,
                      boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
                      minWidth: 180,
                      zIndex: 50,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: "10px 14px",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 12,
                        color: "var(--text-secondary, #666)",
                        borderBottom: "0.5px solid var(--border, #e5e7eb)",
                      }}
                    >
                      {auth.userDisplayName ?? "Signed in"}
                    </div>

                    <button
                      onClick={() => setLangMenuOpen((o) => !o)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "8px 14px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 13,
                        color: "var(--text-primary, #111)",
                      }}
                    >
                      <span>
                        {currentLang.flag} {t.nav.language}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-secondary, #666)" }}>
                        {currentLang.label} {langMenuOpen ? "▴" : "▾"}
                      </span>
                    </button>
                    {langMenuOpen && (
                      <div
                        style={{
                          borderTop: "0.5px solid var(--border, #e5e7eb)",
                          maxHeight: 220,
                          overflowY: "auto",
                        }}
                      >
                        {LANGUAGES.map((l) => (
                          <button
                            key={l.code}
                            onClick={() => {
                              setLang(l.code);
                              setLangMenuOpen(false);
                              setAccountMenuOpen(false);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                              padding: "7px 14px 7px 20px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 12,
                              color: l.code === lang ? "var(--gold, #C9A84C)" : "var(--text-primary, #111)",
                              fontWeight: l.code === lang ? 600 : 400,
                              backgroundColor: l.code === lang ? "rgba(201,168,76,0.07)" : "transparent",
                            }}
                          >
                            <span>{l.flag}</span>
                            <span>{l.label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => {
                        auth.signOut();
                        setAccountMenuOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 14px",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 13,
                        color: "var(--text-secondary, #666)",
                        background: "none",
                        border: "none",
                        borderTop: "0.5px solid var(--border, #e5e7eb)",
                        cursor: "pointer",
                      }}
                    >
                      {t.nav.signOut}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setLangMenuOpen((o) => !o)}
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
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.code}
                          onClick={() => {
                            setLang(l.code);
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
                            color: l.code === lang ? "var(--gold, #C9A84C)" : "var(--text-primary, #111)",
                            fontWeight: l.code === lang ? 600 : 400,
                            backgroundColor: l.code === lang ? "rgba(201,168,76,0.07)" : "transparent",
                          }}
                        >
                          <span>{l.flag}</span>
                          <span>{l.label}</span>
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
