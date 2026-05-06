import { z } from "zod";

// ─── API Request Schema ────────────────────────────────────────────────────────

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(500).trim(),
  session_id: z.string().max(128).optional(),
  user_id: z.string().max(128).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      })
    )
    .max(20)
    .default([]),
  city: z.string().max(50).nullable().optional(),
  gpsCoords: z
    .object({ lat: z.number(), lng: z.number() })
    .nullable()
    .optional(),
  nearLocation: z.string().max(200).optional(),
  sessionPreferences: z.any().optional(),
  profileContext: z.string().max(1000).optional(),
  customWeights: z.object({
    budget_match: z.number().min(0).max(1),
    scene_match: z.number().min(0).max(1),
    review_quality: z.number().min(0).max(1),
    location_convenience: z.number().min(0).max(1),
    preference_match: z.number().min(0).max(1),
  }).optional(),
  /** G-3: plan ID to use as reference when doing module-level refine */
  pinned_plan_id: z.string().max(128).optional(),
  /**
   * Homepage NLU category override. When the chat NLU has already classified
   * the intent (e.g. "activity"/"hotel"), the client passes it through so the
   * legacy search pipeline skips its own keyword detection and routes
   * deterministically.
   */
  category_hint: z.enum(["restaurant", "hotel", "flight", "activity"]).optional(),
  /**
   * Structured fields from the confirm card. The legacy /api/chat search path
   * can use these to avoid reparsing a confirmed hotel/flight/activity request.
   */
  confirmed_constraints: z.record(z.string(), z.unknown()).optional(),
});

// ─── AI Response Schemas ───────────────────────────────────────────────────────

export const UserRequirementsSchema = z
  .object({
    cuisine: z.string().nullable().optional(),
    purpose: z
      .enum(["date", "business", "family", "friends", "solo", "group"])
      .nullable()
      .optional(),
    budget_per_person: z.number().nullable().optional(),
    budget_total: z.number().nullable().optional(),
    atmosphere: z.array(z.string()).optional(),
    noise_level: z.enum(["quiet", "moderate", "lively", "any"]).optional(),
    location: z.string().optional(),
    neighborhood: z.string().nullable().optional(),
    near_location: z.string().nullable().optional(),
    party_size: z.number().nullable().optional(),
    constraints: z.array(z.string()).optional(),
    priorities: z.array(z.string()).optional(),
  })
  .passthrough();

export const ReviewSignalsSchema = z.object({
  noise_level: z.enum(["quiet", "moderate", "loud", "unknown"]),
  wait_time: z.string(),
  date_suitability: z.number().min(1).max(10),
  service_pace: z.string(),
  notable_dishes: z.array(z.string()),
  red_flags: z.array(z.string()),
  best_for: z.array(z.string()),
  review_confidence: z.enum(["high", "medium", "low"]),
});

export const ScoringDimensionsSchema = z.object({
  budget_match: z.number().min(0).max(10),
  scene_match: z.number().min(0).max(10),
  review_quality: z.number().min(0).max(10),
  location_convenience: z.number().min(0).max(10),
  preference_match: z.number().min(0).max(10),
  red_flag_penalty: z.number().min(0).max(5),
});

export const RankedItemSchema = z.object({
  rank: z.number(),
  restaurant_index: z.number().int().min(0),
  score: z.number().optional().default(5),
  scoring: ScoringDimensionsSchema.optional(),
  why_recommended: z.string(),
  best_for: z.string(),
  watch_out: z.string(),
  not_great_if: z.string(),
  estimated_total: z.string(),
  suggested_refinements: z.array(z.string()).optional().default([]),
});

export const RankedItemArraySchema = z.array(RankedItemSchema);
