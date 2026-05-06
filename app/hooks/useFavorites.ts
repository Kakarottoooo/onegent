"use client";

import { useState, useEffect } from "react";
import { RecommendationCard } from "@/lib/types";
import { useAuthState } from "@/app/contexts/AuthContext";

type LearnFromFavorite = (card: RecommendationCard) => void;

function loadLocalFavorites(): Set<string> {
  try {
    const saved = localStorage.getItem("restaurant-favorites");
    return saved ? new Set(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function scheduleIdleWork(callback: () => void, delayMs = 900): () => void {
  if (typeof window === "undefined") return () => {};
  let idleId: number | null = null;
  const timer = window.setTimeout(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(callback, { timeout: 1500 });
    } else {
      callback();
    }
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    if (idleId !== null) {
      const idleWindow = window as Window & { cancelIdleCallback?: (id: number) => void };
      idleWindow.cancelIdleCallback?.(idleId);
    }
  };
}

export function useFavorites(learnFromFavorite?: LearnFromFavorite) {
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set<string>() : loadLocalFavorites()
  );
  const { isSignedIn } = useAuthState();

  useEffect(() => {
    setFavorites(loadLocalFavorites());
    if (isSignedIn) {
      return scheduleIdleWork(() => {
        // Load favorites from cloud after first paint; local cache is enough
        // for initial render.
        fetch("/api/user/favorites")
        .then((r) => r.json())
        .then((data) => {
          if (data.favorites) {
            const ids = new Set<string>(data.favorites.map((f: { restaurant_id: string }) => f.restaurant_id));
            setFavorites(ids);
            // Keep local cache in sync
            localStorage.setItem("restaurant-favorites", JSON.stringify([...ids]));
          }
        })
        .catch(() => {});
      }, 1200);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  function toggleFavorite(restaurantId: string, card?: RecommendationCard) {
    setFavorites((prev) => {
      const next = new Set(prev);
      const isAdding = !next.has(restaurantId);

      if (isAdding) {
        next.add(restaurantId);
        if (card && learnFromFavorite) learnFromFavorite(card);
        // Cloud sync when signed in
        if (isSignedIn && card) {
          fetch("/api/user/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card }),
          }).catch(() => {});
        }
      } else {
        next.delete(restaurantId);
        // Cloud sync when signed in
        if (isSignedIn) {
          fetch("/api/user/favorites", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restaurant_id: restaurantId }),
          }).catch(() => {});
        }
      }

      try {
        localStorage.setItem("restaurant-favorites", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  return { favorites, toggleFavorite };
}
