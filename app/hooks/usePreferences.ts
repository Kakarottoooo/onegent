"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPreferenceProfile, DiscoveredPreference, RecommendationCard, FeedbackRecord, LearnedWeights } from "@/lib/types";
import { useAuthState } from "@/app/contexts/AuthContext";

const STORAGE_KEY = "restaurant-preference-profile";
const FEEDBACK_KEY = "restaurant-feedback";
const LEARNED_WEIGHTS_KEY = "restaurant-learned-weights";

const DEFAULT_LEARNED_WEIGHTS: Omit<LearnedWeights, "updated_at" | "sample_size"> = {
  budget_match: 0.25,
  scene_match: 0.30,
  review_quality: 0.20,
  location_convenience: 0.15,
  preference_match: 0.10,
};

const DEFAULT_PROFILE: UserPreferenceProfile = {
  version: 2,
  updated_at: new Date().toISOString(),
  discovered: [],
  dietary_restrictions: [],
  cuisine_dislikes: [],
  always_exclude_chains: false,
  preferred_occasions: [],
  dislike_tourist_traps: false,
  recent_search_keywords: [],
  favorite_signals: [],
};

function migrateProfile(raw: Record<string, unknown>): UserPreferenceProfile {
  // v1 → v2: add discovered array
  if (!raw.version || raw.version === 1) {
    const discovered: DiscoveredPreference[] = [];
    const now = new Date().toISOString();
    if (raw.noise_preference) {
      discovered.push(makeSignal("dining", "noise_level", String(raw.noise_preference),
        `Prefers ${raw.noise_preference} atmosphere`, "From previous preferences", now));
    }
    if (raw.typical_budget_per_person) {
      discovered.push(makeSignal("dining", "budget_per_person", String(raw.typical_budget_per_person),
        `Dining budget ~$${raw.typical_budget_per_person}/person`, "From previous preferences", now));
    }
    if (raw.always_exclude_chains) {
      discovered.push(makeSignal("dining", "exclude_chains", "true",
        "Avoids chain restaurants", "From previous preferences", now));
    }
    return { ...DEFAULT_PROFILE, ...raw, version: 2, discovered } as UserPreferenceProfile;
  }
  return { ...DEFAULT_PROFILE, ...raw } as UserPreferenceProfile;
}

function loadProfile(): UserPreferenceProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw);
    return migrateProfile(parsed);
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(profile: UserPreferenceProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {}
}

function makeSignal(
  category: DiscoveredPreference["category"],
  key: string,
  value: string,
  label: string,
  source: string,
  now: string,
  seenCount = 1,
): DiscoveredPreference {
  return {
    id: `${key}_${Math.random().toString(36).slice(2, 8)}`,
    category, key, value, label, source,
    seen_count: seenCount,
    discovered_at: now,
    updated_at: now,
  };
}

/**
 * Extract preference signals from any agent response intent.
 * Called after every successful agent response.
 */
export function extractSignalsFromIntent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requirements: Record<string, unknown>,
  userMessage: string,
): DiscoveredPreference[] {
  const signals: DiscoveredPreference[] = [];
  const now = new Date().toISOString();
  const src = `From: "${userMessage.slice(0, 60)}${userMessage.length > 60 ? "…" : ""}"`;

  // ── Dining ──────────────────────────────────────────────────────────────────
  const cat = String(requirements.category ?? "");

  if (requirements.noise_preference) {
    signals.push(makeSignal("dining", "noise_level", String(requirements.noise_preference),
      `Prefers ${requirements.noise_preference} atmosphere`, src, now));
  }
  if (requirements.cuisine && typeof requirements.cuisine === "string") {
    signals.push(makeSignal("dining", `cuisine_${requirements.cuisine.toLowerCase().replace(/\s+/g, "_")}`,
      requirements.cuisine, `Enjoys ${requirements.cuisine} cuisine`, src, now));
  }
  if (requirements.price_range) {
    const priceMap: Record<string, string> = { "$": "Budget-friendly dining", "$$": "Mid-range dining", "$$$": "Upscale dining", "$$$$": "Fine dining" };
    const label = priceMap[String(requirements.price_range)] ?? `${requirements.price_range} dining`;
    signals.push(makeSignal("dining", "price_range", String(requirements.price_range), label, src, now));
  }
  if (requirements.exclude_chains || requirements.always_exclude_chains) {
    signals.push(makeSignal("dining", "exclude_chains", "true", "Avoids chain restaurants", src, now));
  }

  // ── Hotels ──────────────────────────────────────────────────────────────────
  if (cat === "hotel" || requirements.hotel_star_rating || requirements.star_rating) {
    const stars = requirements.hotel_star_rating ?? requirements.star_rating;
    if (stars) {
      signals.push(makeSignal("hotels", "hotel_stars", String(stars),
        `Prefers ${stars}★ hotels`, src, now));
    }
    const hotelBudget = requirements.budget_total ?? requirements.price_per_night_max;
    if (hotelBudget) {
      signals.push(makeSignal("hotels", "hotel_budget", String(hotelBudget),
        `Hotel budget ~$${hotelBudget}/night`, src, now));
    }
    const neighborhood = requirements.neighborhood ?? requirements.hotel_neighborhood;
    if (neighborhood) {
      signals.push(makeSignal("hotels", "hotel_neighborhood", String(neighborhood),
        `Prefers ${neighborhood} area`, src, now));
    }
    const roomType = requirements.room_type ?? requirements.bed_type;
    if (roomType && typeof roomType === "string") {
      signals.push(makeSignal("hotels", "room_type", String(roomType),
        `Prefers ${roomType} room`, src, now));
    }
    const wantsBreakfast = requirements.amenities;
    if (Array.isArray(wantsBreakfast) && wantsBreakfast.includes("breakfast")) {
      signals.push(makeSignal("hotels", "breakfast_included", "true",
        "Prefers breakfast included", src, now));
    }
  }

  // ── Flights / Travel ────────────────────────────────────────────────────────
  if (cat === "flight" || requirements.cabin_class || requirements.departure_city) {
    if (requirements.cabin_class) {
      const cabinLabel: Record<string, string> = {
        economy: "Flies economy class", business: "Flies business class",
        first: "Flies first class", "premium economy": "Flies premium economy",
      };
      signals.push(makeSignal("travel", "cabin_class", String(requirements.cabin_class),
        cabinLabel[String(requirements.cabin_class)] ?? `Flies ${requirements.cabin_class}`, src, now));
    }
    if (requirements.prefer_direct === true) {
      signals.push(makeSignal("travel", "prefer_direct", "true",
        "Prefers direct flights", src, now));
    }
    if (requirements.departure_city && typeof requirements.departure_city === "string") {
      signals.push(makeSignal("travel", "home_city", requirements.departure_city,
        `Home city: ${requirements.departure_city}`, src, now));
    }
  }

  // ── Weekend trip: budget ────────────────────────────────────────────────────
  if (cat === "weekend_trip" || cat === "city_trip") {
    const totalBudget = requirements.budget_total;
    if (totalBudget) {
      signals.push(makeSignal("travel", "trip_budget", String(totalBudget),
        `Trip budget ~$${totalBudget}`, src, now));
    }
    const nights = requirements.nights;
    if (nights && Number(nights) >= 2) {
      signals.push(makeSignal("travel", "trip_length", String(nights),
        `Typically ${nights}-night trips`, src, now));
    }
  }

  // ── Shopping / Laptops / Phones ─────────────────────────────────────────────
  if (cat === "laptop" || cat === "smartphone" || cat === "headphone") {
    const budget = typeof requirements.budget === "number" ? requirements.budget : undefined;
    if (budget) {
      const budgetLabel = budget < 500 ? "Budget electronics" :
        budget < 1200 ? "Mid-range electronics" : "Premium electronics";
      signals.push(makeSignal("shopping", `${cat}_budget`, String(budget),
        budgetLabel, src, now));
    }
    if (requirements.brand_preference) {
      signals.push(makeSignal("shopping", `${cat}_brand`, String(requirements.brand_preference),
        `Prefers ${requirements.brand_preference} for ${cat}`, src, now));
    }
  }

  // ── General budget sensitivity ──────────────────────────────────────────────
  const anyBudget = requirements.budget_per_person ?? requirements.max_budget_per_person;
  if (anyBudget && cat !== "hotel" && cat !== "flight") {
    signals.push(makeSignal("general", "dining_budget_per_person", String(anyBudget),
      `Dining budget ~$${anyBudget}/person`, src, now));
  }

  return signals;
}

/** Merge a new signal into the discovered list. Increments seen_count if key already exists. */
function mergeSignal(
  existing: DiscoveredPreference[],
  signal: DiscoveredPreference,
): DiscoveredPreference[] {
  const idx = existing.findIndex((d) => d.key === signal.key);
  if (idx === -1) {
    return [...existing, signal];
  }
  // Update existing: increment count, update value+label+source if different
  const prev = existing[idx];
  const updated: DiscoveredPreference = {
    ...prev,
    value: signal.value,
    label: signal.label,
    source: signal.source,
    seen_count: prev.seen_count + 1,
    updated_at: signal.updated_at,
    user_confirmed: prev.user_confirmed, // preserve user confirmation
  };
  return [...existing.slice(0, idx), updated, ...existing.slice(idx + 1)];
}

export function formatProfileForPrompt(profile: UserPreferenceProfile): string {
  const parts: string[] = [];

  // From discovered preferences (primary)
  const discovered = profile.discovered ?? [];
  for (const d of discovered) {
    if (d.seen_count >= 2 || d.user_confirmed) {
      parts.push(d.label);
    }
  }

  // Legacy fields (fallback)
  if (parts.length === 0) {
    if (profile.noise_preference) parts.push(`prefers ${profile.noise_preference} restaurants`);
    if (profile.typical_budget_per_person) parts.push(`typical budget $${profile.typical_budget_per_person}/person`);
    if (profile.dietary_restrictions?.length > 0) parts.push(profile.dietary_restrictions.join(", "));
    if (profile.always_exclude_chains) parts.push("excludes chains");
  }

  if (profile.dietary_restrictions?.length > 0 && !parts.some(p => p.includes("Dietary"))) {
    parts.push(`Dietary: ${profile.dietary_restrictions.join(", ")}`);
  }

  if (profile.favorite_signals && profile.favorite_signals.length > 0) {
    const recent = profile.favorite_signals.slice(0, 3);
    parts.push(`Saved: ${recent.map((s) => `${s.cuisine} (${s.price})`).join(", ")}`);
  }

  // Hotel-specific preferences — surfaced separately so the booking agent can act on them
  const hotelPrefs = (profile.discovered ?? []).filter(d => d.category === "hotels" && (d.seen_count >= 1 || d.user_confirmed));
  const roomTypePref = hotelPrefs.find(d => d.key === "room_type");
  const breakfastPref = hotelPrefs.find(d => d.key === "breakfast_included");
  if (roomTypePref) parts.push(`Hotel room preference: ${roomTypePref.value}`);
  if (breakfastPref) parts.push("Prefers hotel breakfast included");

  return parts.length > 0
    ? `User preference profile: ${parts.join("; ")}.`
    : "";
}

function syncProfileToCloud(profile: UserPreferenceProfile) {
  fetch("/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  }).catch(() => {});
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

export function usePreferences() {
  const [profile, setProfile] = useState<UserPreferenceProfile>(() =>
    typeof window === "undefined" ? DEFAULT_PROFILE : loadProfile()
  );
  const [learnedWeights, setLearnedWeights] = useState<LearnedWeights | null>(null);
  const { isSignedIn } = useAuthState();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEARNED_WEIGHTS_KEY);
      if (raw) {
        const parsed: LearnedWeights = JSON.parse(raw);
        setLearnedWeights(parsed);
      }
    } catch {}

    if (isSignedIn) {
      const cancelIdle = scheduleIdleWork(() => {
        fetch("/api/user/profile")
          .then((r) => r.json())
          .then((data) => {
            if (data.profile) {
              const merged = migrateProfile({ ...DEFAULT_PROFILE, ...data.profile });
              setProfile(merged);
              saveProfile(merged);
            } else {
              setProfile(loadProfile());
            }
          })
          .catch(() => setProfile(loadProfile()));
      }, 1000);
      return cancelIdle;
    }
    setProfile(loadProfile());
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const updateProfile = useCallback((patch: Partial<UserPreferenceProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
      saveProfile(next);
      if (isSignedIn) syncProfileToCloud(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  /** Called after every agent response — learns from the parsed intent. */
  const learnFromAgentResponse = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requirements: Record<string, unknown>,
    userMessage: string,
  ) => {
    const newSignals = extractSignalsFromIntent(requirements, userMessage);
    if (newSignals.length === 0) return;

    setProfile((prev) => {
      let discovered = [...(prev.discovered ?? [])];
      for (const sig of newSignals) {
        discovered = mergeSignal(discovered, sig);
      }
      // Cap at 50 preferences, keep highest seen_count
      discovered.sort((a, b) => b.seen_count - a.seen_count);
      discovered = discovered.slice(0, 50);
      const next: UserPreferenceProfile = { ...prev, discovered, updated_at: new Date().toISOString() };
      saveProfile(next);
      if (isSignedIn) syncProfileToCloud(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  /** User manually edits a discovered preference chip. */
  const updateDiscoveredPreference = useCallback((id: string, patch: Partial<DiscoveredPreference>) => {
    setProfile((prev) => {
      const discovered = (prev.discovered ?? []).map((d) =>
        d.id === id ? { ...d, ...patch, user_confirmed: true, updated_at: new Date().toISOString() } : d
      );
      const next = { ...prev, discovered, updated_at: new Date().toISOString() };
      saveProfile(next);
      if (isSignedIn) syncProfileToCloud(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  /** User removes a discovered preference chip. */
  const removeDiscoveredPreference = useCallback((id: string) => {
    setProfile((prev) => {
      const discovered = (prev.discovered ?? []).filter((d) => d.id !== id);
      const next = { ...prev, discovered, updated_at: new Date().toISOString() };
      saveProfile(next);
      if (isSignedIn) syncProfileToCloud(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const learnFromFavorite = useCallback((card: RecommendationCard) => {
    setProfile((prev) => {
      const signal = {
        cuisine: card.restaurant.cuisine,
        price: card.restaurant.price,
        purpose: card.best_for,
        saved_at: new Date().toISOString(),
      };
      const next: UserPreferenceProfile = {
        ...prev,
        updated_at: new Date().toISOString(),
        favorite_signals: [signal, ...prev.favorite_signals].slice(0, 20),
      };
      saveProfile(next);
      if (isSignedIn) syncProfileToCloud(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const learnFromSearch = useCallback((query: string) => {
    setProfile((prev) => {
      const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const next: UserPreferenceProfile = {
        ...prev,
        updated_at: new Date().toISOString(),
        recent_search_keywords: [...keywords, ...prev.recent_search_keywords].slice(0, 20),
      };
      saveProfile(next);
      return next;
    });
  }, []);

  const learnFromFeedback = useCallback((feedback: FeedbackRecord) => {
    if (feedback.satisfied) return;
    setProfile((prev) => {
      const patch: Partial<UserPreferenceProfile> = {};
      const issues = feedback.issues ?? [];
      if (issues.includes("Too noisy") || issues.includes("比描述的吵")) {
        patch.noise_preference = "quiet";
      }
      if ((issues.includes("Too expensive") || issues.includes("价格偏高")) && prev.typical_budget_per_person) {
        patch.typical_budget_per_person = Math.round(prev.typical_budget_per_person * 0.7);
      }
      const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
      saveProfile(next);
      return next;
    });
  }, []);

  const resetProfile = useCallback(() => {
    const fresh = { ...DEFAULT_PROFILE, updated_at: new Date().toISOString() };
    saveProfile(fresh);
    setProfile(fresh);
  }, []);

  const learnWeightsFromFeedback = useCallback(() => {
    try {
      const raw = localStorage.getItem(FEEDBACK_KEY);
      if (!raw) return;
      const records: FeedbackRecord[] = JSON.parse(raw);
      if (records.length < 10) return;

      const unsatisfied = records.filter((r) => !r.satisfied && r.issues?.length);
      const issueCounts: Record<string, number> = {};
      for (const rec of unsatisfied) {
        for (const issue of rec.issues ?? []) {
          issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
        }
      }

      const weights = { ...DEFAULT_LEARNED_WEIGHTS };
      if (issueCounts["氛围不符"] || issueCounts["Wrong vibe"]) weights.scene_match += 0.05;
      if (issueCounts["价格偏高"] || issueCounts["Too expensive"]) weights.budget_match += 0.05;
      if (issueCounts["等位太久"] || issueCounts["Long wait"]) weights.review_quality += 0.05;

      const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
      const normalized = {
        budget_match: weights.budget_match / total,
        scene_match: weights.scene_match / total,
        review_quality: weights.review_quality / total,
        location_convenience: weights.location_convenience / total,
        preference_match: weights.preference_match / total,
      };

      const newLearnedWeights: LearnedWeights = {
        ...normalized,
        updated_at: new Date().toISOString(),
        sample_size: records.length,
      };

      localStorage.setItem(LEARNED_WEIGHTS_KEY, JSON.stringify(newLearnedWeights));
      setLearnedWeights(newLearnedWeights);
    } catch {}
  }, []);

  useEffect(() => {
    return scheduleIdleWork(() => {
      try {
        const raw = localStorage.getItem(FEEDBACK_KEY);
        if (!raw) return;
        const records: FeedbackRecord[] = JSON.parse(raw);
        const unsatisfied = records.filter((r) => !r.satisfied && r.issues?.length);
        if (unsatisfied.length >= 3) {
          for (const rec of unsatisfied.slice(0, 5)) {
            learnFromFeedback(rec);
          }
        }
      } catch {}
    }, 1600);
  }, [learnFromFeedback]);

  return {
    profile,
    updateProfile,
    learnFromFavorite,
    learnFromSearch,
    learnFromFeedback,
    learnFromAgentResponse,
    updateDiscoveredPreference,
    removeDiscoveredPreference,
    resetProfile,
    learnedWeights,
    learnWeightsFromFeedback,
  };
}
