"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionRoomSnapshot } from "@/lib/db";

/**
 * Polls /api/rooms/[id]/state every 3s. Uses `?since=<version>` so unchanged
 * rooms return 304 — cheap on both client and server. Returns the latest
 * snapshot plus a manual `refresh()` for post-action optimistic refetches.
 */
export function useRoomState(roomId: string | null) {
  const [snapshot, setSnapshot] = useState<DecisionRoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef<number | null>(null);

  const fetchSnapshot = useCallback(async (force = false) => {
    if (!roomId) return;
    if (!force && typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const url = force || versionRef.current === null
        ? `/api/rooms/${roomId}/state`
        : `/api/rooms/${roomId}/state?since=${versionRef.current}`;
      const res = await fetch(url);
      if (res.status === 304) return; // no change
      if (res.status === 404) { setError("This room doesn't exist or has been removed."); return; }
      if (res.status === 403) { setError("You're not a member of this room. Ask the creator for an invite."); return; }
      if (!res.ok) { setError("We couldn't open this room. Please refresh."); return; }
      const data = await res.json() as DecisionRoomSnapshot;
      versionRef.current = data.version;
      setSnapshot(data);
      setError(null);
    } catch {
      setError("Connection problem. Check your network and try again.");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    fetchSnapshot(true);
    const interval = setInterval(() => fetchSnapshot(false), 5000);
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        fetchSnapshot(false);
      }
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [roomId, fetchSnapshot]);

  return {
    snapshot,
    loading,
    error,
    refresh: () => fetchSnapshot(true),
  };
}
