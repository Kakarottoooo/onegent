"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import GlobalNav from "@/components/GlobalNav";
import { useAuth } from "@/app/hooks/useAuth";
import {
  AgentModelTab,
  BookingProfileTab,
  ControlsSettingsTab,
} from "@/app/permissions/page";

type AccountTab =
  | "identity"
  | "profiles"
  | "controls"
  | "models"
  | "billing";

type UserProfile = {
  user_id: string;
  profile_code: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type IdentityForm = {
  display_name: string;
  username: string;
  avatar_url: string | null;
};

function resolveTab(raw: string | null): AccountTab {
  if (raw === "profiles" || raw === "profile" || raw === "details") return "profiles";
  if (raw === "controls" || raw === "permissions") return "controls";
  if (raw === "identity") return "identity";
  if (raw === "billing") return "billing";
  if (raw === "models") return "models";
  return "identity";
}

function makeInitials(label: string | null | undefined): string {
  const value = (label ?? "").trim();
  if (!value) return "U";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function clampHandle(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32);
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Failed to read image"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

async function compressAvatar(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });

  const maxSide = 320;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas not available");
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.84);
}

export default function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<AccountTab>("identity");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<IdentityForm>({
    display_name: "",
    username: "",
    avatar_url: null,
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "learned" || requestedTab === "taste") {
      router.replace("/insights?tab=overview");
      return;
    }
    setActiveTab(resolveTab(requestedTab));
  }, [router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      setLoadingProfile(true);
      try {
        const response = await fetch("/api/users/me");
        if (!response.ok) throw new Error("Failed to load account");
        const data = (await response.json()) as { profile: UserProfile };
        if (cancelled) return;
        setProfile(data.profile);
        setForm({
          display_name: data.profile.display_name ?? auth.userDisplayName ?? "",
          username: data.profile.username ?? "",
          avatar_url: data.profile.avatar_url ?? auth.userAvatar ?? null,
        });
      } catch (loadError) {
        if (cancelled) return;
        const message =
          loadError instanceof Error ? loadError.message : "Failed to load account";
        setError(message);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }

    if (auth.isSignedIn) {
      void loadProfile();
    } else {
      setLoadingProfile(false);
    }

    return () => {
      cancelled = true;
    };
  }, [auth.isSignedIn, auth.userAvatar, auth.userDisplayName]);

  const tabs: { id: AccountTab; label: string }[] = [
    { id: "identity", label: "Identity" },
    { id: "profiles", label: "Profiles" },
    { id: "controls", label: "Controls" },
    { id: "models", label: "Models" },
    { id: "billing", label: "Billing" },
  ];

  const contactHandle = useMemo(() => {
    if (form.username.trim()) return `@${form.username.trim()}`;
    if (profile?.profile_code) return `@${profile.profile_code}`;
    return "@handle";
  }, [form.username, profile?.profile_code]);

  const summaryIdentity = useMemo(
    () => auth.userEmail ?? profile?.user_id ?? auth.userId ?? "Email unavailable",
    [auth.userEmail, auth.userId, profile?.user_id],
  );

  const isDirty = useMemo(() => {
    if (!profile) return false;
    return (
      form.display_name.trim() !== (profile.display_name ?? "").trim() ||
      form.username.trim() !== (profile.username ?? "").trim() ||
      (form.avatar_url ?? null) !== (profile.avatar_url ?? null)
    );
  }, [form, profile]);

  const avatarLabel = form.display_name.trim() || profile?.display_name || auth.userDisplayName || "User";

  async function onAvatarChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Avatar must be smaller than 5MB.");
      event.target.value = "";
      return;
    }

    setProcessingAvatar(true);
    try {
      const avatarUrl = await compressAvatar(file);
      setForm((current) => ({ ...current, avatar_url: avatarUrl }));
    } catch {
      setError("Failed to process avatar.");
    } finally {
      setProcessingAvatar(false);
      event.target.value = "";
    }
  }

  async function saveIdentity() {
    if (!profile) return;

    setSavingIdentity(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          username: form.username.trim(),
          avatar_url: form.avatar_url,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        profile?: UserProfile;
      };

      if (!response.ok || !data.profile) {
        throw new Error(data.error ?? "Failed to save account");
      }

      setProfile(data.profile);
      setForm({
        display_name: data.profile.display_name ?? "",
        username: data.profile.username ?? "",
        avatar_url: data.profile.avatar_url,
      });
      setSuccess("Account updated.");
      window.dispatchEvent(new Event("onegent-account-updated"));
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Failed to save account";
      setError(message);
    } finally {
      setSavingIdentity(false);
    }
  }

  if (!auth.isSignedIn) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
        <GlobalNav active="other" />
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px" }}>
          <div
            style={{
              borderRadius: 20,
              border: "0.5px solid var(--border, #e5e7eb)",
              background: "var(--card, #fff)",
              padding: 24,
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-playfair, serif)",
                fontSize: 28,
                fontWeight: 700,
                color: "var(--text-primary, #111)",
                marginBottom: 10,
              }}
            >
              Account
            </h1>
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 14,
                color: "var(--text-secondary, #666)",
                lineHeight: 1.7,
              }}
            >
              Sign in to manage your identity, handle, models, and billing settings.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="other" />

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 88px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1
            style={{
              fontFamily: "var(--font-playfair, serif)",
              fontSize: 34,
              fontWeight: 700,
              color: "var(--text-primary, #111)",
              marginBottom: 8,
              letterSpacing: "-0.02em",
            }}
          >
            Account
          </h1>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 14,
              color: "var(--text-secondary, #666)",
              lineHeight: 1.7,
              maxWidth: 640,
            }}
          >
            Identity, personas, control defaults, model routing, and billing live here.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            borderBottom: "0.5px solid var(--border, #e5e7eb)",
            marginBottom: 24,
            gap: 0,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "10px 4px",
                background: "none",
                border: "none",
                borderBottom:
                  activeTab === tab.id
                    ? "2px solid var(--gold, #C9A84C)"
                    : "2px solid transparent",
                fontFamily: "var(--font-dm-sans)",
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 700 : 400,
                color:
                  activeTab === tab.id
                    ? "var(--gold, #C9A84C)"
                    : "var(--text-muted, #aaa)",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "identity" && (
          <section
            style={{
              borderRadius: 24,
              border: "0.5px solid rgba(201,168,76,0.22)",
              background:
                "linear-gradient(180deg, rgba(42,38,33,0.96) 0%, rgba(31,28,25,0.98) 100%)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.16)",
              overflow: "hidden",
              marginBottom: 28,
            }}
          >
          <div
            style={{
              padding: "22px 24px",
              borderBottom: "0.5px solid rgba(201,168,76,0.14)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(244,231,200,0.46)",
                  marginBottom: 8,
                }}
              >
                Identity
              </div>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 24,
                  fontWeight: 700,
                  color: "#F8F2E7",
                  marginBottom: 6,
                }}
              >
                {form.display_name.trim() || auth.userDisplayName || "Set your account name"}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  color: "rgba(244,231,200,0.68)",
                  lineHeight: 1.6,
                }}
              >
                Contacts can find you via <span style={{ color: "var(--gold, #C9A84C)" }}>{contactHandle}</span>.
                {profile?.profile_code && (
                  <>
                    {" "}
                    Backup code: <span style={{ fontFamily: "monospace" }}>@{profile.profile_code}</span>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 16,
                  border: "0.5px solid rgba(201,168,76,0.18)",
                  background: "rgba(255,255,255,0.03)",
                  minWidth: 156,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "rgba(244,231,200,0.42)",
                    marginBottom: 6,
                  }}
                >
                  Signed in as
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#F8F2E7",
                    wordBreak: "break-word",
                  }}
                >
                  {summaryIdentity}
                </div>
              </div>

              <button
                onClick={saveIdentity}
                disabled={!isDirty || savingIdentity || loadingProfile}
                style={{
                  borderRadius: 14,
                  border: "none",
                  padding: "12px 18px",
                  background: !isDirty || savingIdentity || loadingProfile
                    ? "rgba(201,168,76,0.22)"
                    : "var(--gold, #C9A84C)",
                  color: "#1B1712",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: !isDirty || savingIdentity || loadingProfile ? "default" : "pointer",
                }}
              >
                {savingIdentity ? "Saving..." : "Save identity"}
              </button>
            </div>
          </div>

          <div
            style={{
              padding: "24px",
              display: "flex",
              flexWrap: "wrap",
              gap: 24,
            }}
          >
            <div
              style={{
                flex: "0 0 220px",
                width: 220,
                borderRadius: 20,
                border: "0.5px solid rgba(201,168,76,0.16)",
                background: "rgba(255,255,255,0.03)",
                padding: 18,
              }}
            >
              <div
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "1px solid rgba(201,168,76,0.22)",
                  background: "rgba(201,168,76,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#F8F2E7",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 28,
                  fontWeight: 700,
                  marginBottom: 14,
                }}
              >
                {form.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.avatar_url}
                    alt="Account avatar"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  makeInitials(avatarLabel)
                )}
              </div>

              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#F8F2E7",
                  marginBottom: 4,
                }}
              >
                {form.display_name.trim() || auth.userDisplayName || "Unnamed account"}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  color: "rgba(244,231,200,0.58)",
                  marginBottom: 16,
                }}
              >
                {contactHandle}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onAvatarChosen}
                style={{ display: "none" }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={processingAvatar}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "0.5px solid rgba(201,168,76,0.22)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#F8F2E7",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "10px 12px",
                  cursor: processingAvatar ? "default" : "pointer",
                  marginBottom: 10,
                }}
              >
                {processingAvatar ? "Processing..." : "Upload avatar"}
              </button>

              <button
                onClick={() => setForm((current) => ({ ...current, avatar_url: null }))}
                disabled={!form.avatar_url}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "none",
                  background: "transparent",
                  color: form.avatar_url ? "rgba(244,231,200,0.72)" : "rgba(244,231,200,0.28)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  padding: "8px 12px",
                  cursor: form.avatar_url ? "pointer" : "default",
                }}
              >
                Remove avatar
              </button>

              <div
                style={{
                  marginTop: 14,
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 11,
                  color: "rgba(244,231,200,0.46)",
                  lineHeight: 1.6,
                }}
              >
                Upload a square photo if possible. It appears in Contacts, rooms, and your account menu.
              </div>
            </div>

            <div style={{ display: "grid", gap: 16, flex: "1 1 420px", minWidth: 280 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.09em",
                      textTransform: "uppercase",
                      color: "rgba(244,231,200,0.46)",
                      marginBottom: 8,
                    }}
                  >
                    Display name
                  </label>
                  <input
                    value={form.display_name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, display_name: event.target.value }))
                    }
                    placeholder="What people should call you"
                    style={{
                      width: "100%",
                      borderRadius: 14,
                      border: "0.5px solid rgba(201,168,76,0.18)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#F8F2E7",
                      padding: "13px 14px",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.09em",
                      textTransform: "uppercase",
                      color: "rgba(244,231,200,0.46)",
                      marginBottom: 8,
                    }}
                  >
                    Searchable handle
                  </label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      borderRadius: 14,
                      border: "0.5px solid rgba(201,168,76,0.18)",
                      background: "rgba(255,255,255,0.03)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        padding: "13px 0 13px 14px",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 14,
                        color: "rgba(244,231,200,0.52)",
                      }}
                    >
                      @
                    </span>
                    <input
                      value={form.username}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          username: clampHandle(event.target.value),
                        }))
                      }
                      placeholder={profile?.profile_code?.toLowerCase() ?? "handle"}
                      style={{
                        flex: 1,
                        border: "none",
                        background: "transparent",
                        color: "#F8F2E7",
                        padding: "13px 14px 13px 6px",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 14,
                        outline: "none",
                      }}
                    />
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderRadius: 18,
                  border: "0.5px solid rgba(201,168,76,0.16)",
                  background: "rgba(255,255,255,0.025)",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "rgba(244,231,200,0.46)",
                    marginBottom: 10,
                  }}
                >
                  Contact identity
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      borderRadius: 14,
                      border: "0.5px solid rgba(201,168,76,0.14)",
                      background: "rgba(255,255,255,0.02)",
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "rgba(244,231,200,0.42)",
                        marginBottom: 6,
                      }}
                    >
                      Immutable user ID
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 13,
                        color: "#F8F2E7",
                        wordBreak: "break-all",
                      }}
                    >
                      {profile?.user_id ?? auth.userId ?? "Loading..."}
                    </div>
                  </div>

                  <div
                    style={{
                      borderRadius: 14,
                      border: "0.5px solid rgba(201,168,76,0.14)",
                      background: "rgba(255,255,255,0.02)",
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "rgba(244,231,200,0.42)",
                        marginBottom: 6,
                      }}
                    >
                      Backup contact code
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 13,
                        color: "#F8F2E7",
                      }}
                    >
                      {profile?.profile_code ? `@${profile.profile_code}` : "Loading..."}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 12,
                    color: "rgba(244,231,200,0.62)",
                    lineHeight: 1.7,
                  }}
                >
                  People can add you from Contacts using your handle first. If you do not set one,
                  they can still find you with your backup code.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 18,
                  border: "0.5px solid rgba(201,168,76,0.16)",
                  background: "rgba(255,255,255,0.025)",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "rgba(244,231,200,0.46)",
                    marginBottom: 8,
                  }}
                >
                  Account summary
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 13,
                    color: "#F8F2E7",
                    lineHeight: 1.8,
                  }}
                >
                  <div>{auth.userEmail ?? "No email exposed by auth provider"}</div>
                  <div style={{ color: "rgba(244,231,200,0.62)" }}>
                    This page controls how your identity appears across Decision Rooms, Contacts,
                    and collaborative booking flows.
                  </div>
                </div>
              </div>

              {(error || success) && (
                <div
                  style={{
                    borderRadius: 14,
                    padding: "12px 14px",
                    border: error
                      ? "0.5px solid rgba(248,113,113,0.38)"
                      : "0.5px solid rgba(201,168,76,0.24)",
                    background: error
                      ? "rgba(127,29,29,0.14)"
                      : "rgba(201,168,76,0.10)",
                    color: error ? "#FCA5A5" : "#F8F2E7",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 13,
                  }}
                >
                  {error ?? success}
                </div>
              )}
            </div>
          </div>
          </section>
        )}

        {activeTab === "profiles" && <BookingProfileTab />}

        {activeTab === "controls" && <ControlsSettingsTab />}

        {activeTab === "models" && <AgentModelTab />}

        {activeTab === "billing" && (
          <div
            style={{
              borderRadius: 18,
              border: "0.5px solid var(--border, #e5e7eb)",
              background: "var(--card, #fff)",
              padding: "18px 18px 20px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-muted, #aaa)",
                marginBottom: 10,
              }}
            >
              Billing
            </p>
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 13,
                color: "var(--text-primary, #111)",
                lineHeight: 1.7,
                marginBottom: 8,
              }}
            >
              Billing controls are not wired up yet.
            </p>
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                color: "var(--text-secondary, #666)",
                lineHeight: 1.7,
              }}
            >
              This section is reserved for subscription, payment method, and invoice settings.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
