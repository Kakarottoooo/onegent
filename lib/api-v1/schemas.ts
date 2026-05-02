/**
 * Zod schemas for /api/v1/* request/response shapes.
 *
 * These mirror the TypeScript types in lib/core/execution/types.ts — the
 * compile-time contract. Runtime validation is needed at the HTTP boundary
 * because B 端 callers are untrusted (unlike C 端 internal calls).
 *
 * Pragmatic rule: if TS says optional, zod says .optional(). If TS narrows
 * by discriminator (scenario: "restaurant" | "hotel" | ...), zod uses
 * discriminatedUnion on the SAME key. Divergence between these schemas
 * and the types in lib/core = bug.
 */

import { z } from "zod";

// ─── Primitives ──────────────────────────────────────────────────────────────

const DATE_YYYY_MM_DD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const TIME_HHMM = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/, "time must be HH:MM 24h");

// ─── Scenario-specific params ────────────────────────────────────────────────

const RestaurantParamsSchema = z.object({
  restaurant_name: z.string().min(1),
  city: z.string().min(1),
  date: DATE_YYYY_MM_DD,
  time: TIME_HHMM,
  covers: z.number().int().positive(),
  cuisine: z.string().optional(),
  neighborhood: z.string().optional(),
  budget_per_person: z.number().positive().optional(),
});

const HotelParamsSchema = z.object({
  hotel_name: z.string().min(1),
  city: z.string().min(1),
  checkin: DATE_YYYY_MM_DD,
  checkout: DATE_YYYY_MM_DD,
  adults: z.number().int().positive(),
  star_rating: z.number().min(1).max(5).optional(),
  neighborhood: z.string().optional(),
  budget_max_per_night: z.number().positive().optional(),
  room_preference: z.string().optional(),
});

const FlightParamsSchema = z.object({
  origin: z.string().min(1),
  dest: z.string().min(1),
  date: DATE_YYYY_MM_DD,
  return_date: DATE_YYYY_MM_DD.optional(),
  passengers: z.number().int().positive(),
  cabin_class: z
    .enum(["economy", "premium_economy", "business", "first"])
    .optional(),
  targetAirline: z.string().optional(),
  targetPrice: z.number().positive().optional(),
  targetDepartureTime: z.string().optional(),
  targetFlightNumber: z.string().optional(),
});

const ActivityParamsSchema = z.object({
  event_name: z.string().min(1),
  city: z.string().min(1),
  event_date: DATE_YYYY_MM_DD,
  num_tickets: z.number().int().positive(),
  seat_type: z.enum(["premium", "standard", "economy"]).optional(),
  budget_max_per_ticket: z.number().positive().optional(),
});

// ─── Discriminated union for request.request ─────────────────────────────────

export const ExecutionParamsSchema = z.discriminatedUnion("scenario", [
  z.object({ scenario: z.literal("restaurant"), params: RestaurantParamsSchema }),
  z.object({ scenario: z.literal("hotel"), params: HotelParamsSchema }),
  z.object({ scenario: z.literal("flight"), params: FlightParamsSchema }),
  z.object({ scenario: z.literal("activity"), params: ActivityParamsSchema }),
]);

// ─── Profile (inline) ────────────────────────────────────────────────────────

const BookingProfileSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  dob: z.string().optional(),
  passport_number: z.string().optional(),
  passport_country: z.string().optional(),
  known_traveler_number: z.string().optional(),
  // Allow extra fields — booking-autopilot reads many optional hints.
}).passthrough();

// ─── Consent ─────────────────────────────────────────────────────────────────

const ConsentPolicySchema = z.object({
  allowTimeAdjustment: z.boolean().optional(),
  maxTimeAdjustmentMinutes: z.number().nonnegative().optional(),
  allowVenueSwitch: z.boolean().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  paymentPolicy: z.enum(["stop_before_cvc"]).optional(),
  allowedProviders: z.array(z.string()).optional(),
  blockedProviders: z.array(z.string()).optional(),
  maxJobDurationSeconds: z.number().positive().optional(),
});

// ─── ClientMetadata ──────────────────────────────────────────────────────────

const ClientMetadataSchema = z.object({
  agentId: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

// ─── Top-level request ───────────────────────────────────────────────────────

export const ExecutionJobRequestSchema = z
  .object({
    request: ExecutionParamsSchema,
    profileId: z.number().int().positive().optional(),
    profile: BookingProfileSchema.optional(),
    consent: ConsentPolicySchema.optional(),
    clientMetadata: ClientMetadataSchema.optional(),
  })
  .refine((v) => v.profileId !== undefined || v.profile !== undefined, {
    message: "Either profileId or profile must be provided",
    path: ["profile"],
  });

export type ExecutionJobRequestInput = z.input<typeof ExecutionJobRequestSchema>;

export const TravelTaskOptionsSchema = z.object({
  title: z.string().min(1).optional(),
  policy: z.record(z.string(), z.unknown()).optional(),
  decisionRoomId: z.string().min(1).optional(),
});

export const TravelTaskCreateEnvelopeSchema = z.object({
  execution: ExecutionJobRequestSchema,
  task: TravelTaskOptionsSchema.optional(),
});

export type TravelTaskCreateEnvelopeInput = z.input<typeof TravelTaskCreateEnvelopeSchema>;
