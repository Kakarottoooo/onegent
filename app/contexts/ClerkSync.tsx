"use client";

import { useEffect, useRef, useCallback } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { useAuthUpdater } from "./AuthContext";

/** Read the stable session ID from localStorage (same key used by useChat). */
function getStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("onegent_scenario_session_id");
}

/**
 * Must be rendered INSIDE <ClerkProvider> and <AuthStateProvider>.
 * Bridges Clerk auth state into AuthContext so non-Clerk components can read it safely.
 * On sign-in, merges session preferences into the user account (idempotent).
 */
export function ClerkSync() {
  const { user, isSignedIn } = useUser();
  const clerk = useClerk();
  const updateAuth = useAuthUpdater();
  const mergedUserIdRef = useRef<string | null>(null);

  const signIn = useCallback(() => {
    clerk.openSignIn({});
  }, [clerk]);

  const signOut = useCallback(async () => {
    await clerk.signOut();
  }, [clerk]);

  useEffect(() => {
    updateAuth({
      isSignedIn: isSignedIn ?? false,
      userId: user?.id ?? null,
      userDisplayName: user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? null,
      userAvatar: user?.imageUrl ?? null,
      signIn,
      signOut,
    });
  }, [isSignedIn, user, signIn, signOut, updateAuth]);

  // Merge session preferences into the user account on sign-in (once per user_id).
  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    if (mergedUserIdRef.current === user.id) return; // already merged this session
    mergedUserIdRef.current = user.id;

    // Ensure user_profiles row exists so other users can resolve this person
    // by profile_code or @username. Idempotent; also refreshes display_name /
    // avatar_url / username on every sign-in.
    const displayName = user.fullName ?? user.primaryEmailAddress?.emailAddress ?? null;
    const avatarUrl = user.imageUrl ?? null;
    const username = user.username ?? null;
    fetch("/api/users/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        avatar_url: avatarUrl,
        username,
      }),
    }).catch(() => {}); // fire-and-forget

    const sessionId = getStoredSessionId();
    if (!sessionId) return;

    fetch("/api/user/preferences/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {}); // fire-and-forget — not user-visible
  }, [isSignedIn, user]);

  return null;
}
