"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export interface AuthState {
  isSignedIn: boolean;
  userId: string | null;
  userDisplayName: string | null;
  userAvatar: string | null;
  userEmail?: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const DEFAULT_STATE: AuthState = {
  isSignedIn: false,
  userId: null,
  userDisplayName: null,
  userAvatar: null,
  userEmail: null,
  signIn: () => {},
  signOut: async () => {},
};

interface AuthContextInternal extends AuthState {
  /** Called by ClerkSync to override state with real Clerk auth */
  _update: (patch: Partial<AuthState>) => void;
}

const AuthContext = createContext<AuthContextInternal>({
  ...DEFAULT_STATE,
  _update: () => {},
});

export function AuthStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(DEFAULT_STATE);

  const _update = useCallback((patch: Partial<AuthState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, _update }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Read-only hook — safe anywhere, never throws. */
export function useAuthState(): AuthState {
  const { _update: _, ...state } = useContext(AuthContext);
  return state;
}

/** Internal hook for ClerkSync to write auth state into context. */
export function useAuthUpdater() {
  return useContext(AuthContext)._update;
}
