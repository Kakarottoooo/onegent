import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { ExecutionRequest } from "../api-client.js";

/**
 * v2 task-oriented entry point. Equivalent to the four v1 book_* tools but
 * dispatched by a `task_type` discriminator, so a multi-turn LLM session
 * naturally lands on create → modify → continue → status → cancel using a
 * consistent verb set.
 */

const ProfileSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.email(),
  phone: z.string().min(1),
});

const RestaurantParamsSchema = z.object({
  task_type: z.literal("restaurant_booking"),
  restaurant_name: z.string().min(1),
  city: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:MM (24h)"),
  covers: z.number().int().min(1).max(20),
});

const HotelParamsSchema = z.object({
  task_type: z.literal("hotel_booking"),
  destination: z.string().min(1),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1).max(10),
  rooms: z.number().int().min(1).max(5).optional(),
});

const FlightParamsSchema = z.object({
  task_type: z.literal("flight_booking"),
  origin: z.string().min(1),
  destination: z.string().min(1),
  depart_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  passengers: z.number().int().min(1).max(9),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
});

const ActivityParamsSchema = z.object({
  task_type: z.literal("activity_booking"),
  city: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  participants: z.number().int().min(1).max(20),
  activity_name: z.string().min(1).optional(),
});

const InputSchema = z
  .object({
    task: z.discriminatedUnion("task_type", [
      RestaurantParamsSchema,
      HotelParamsSchema,
      FlightParamsSchema,
      ActivityParamsSchema,
    ]),
    profile: ProfileSchema.optional(),
    profileId: z.number().int().positive().optional(),
  })
  .refine((v) => v.profile || v.profileId, {
    message: "Either 'profile' (inline) or 'profileId' (saved) must be provided",
  });

export const createTravelTaskTool: ToolDefinition = {
  name: "create_travel_task",
  description:
    "Create a travel booking task (restaurant / hotel / flight / activity). Returns a jobId " +
    "immediately — the booking runs asynchronously. After creating, use get_task_status to " +
    "poll, modify_task to change parameters mid-flight, continue_task to resume after pauses, " +
    "and cancel_task to abandon. The agent always stops before submitting credit-card CVV.\n\n" +
    "Restaurant: { task_type: 'restaurant_booking', restaurant_name, city, date, time, covers }.\n" +
    "Hotel:      { task_type: 'hotel_booking', destination, check_in, check_out, guests, rooms? }.\n" +
    "Flight:     { task_type: 'flight_booking', origin, destination, depart_date, return_date?, passengers, cabin? }.\n" +
    "Activity:   { task_type: 'activity_booking', city, date, participants, activity_name? }.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "object",
        description: "Task definition keyed by task_type discriminator.",
        oneOf: [
          {
            type: "object",
            required: ["task_type", "restaurant_name", "city", "date", "time", "covers"],
            properties: {
              task_type: { const: "restaurant_booking" },
              restaurant_name: { type: "string" },
              city: { type: "string" },
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              time: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
              covers: { type: "integer", minimum: 1, maximum: 20 },
            },
          },
          {
            type: "object",
            required: ["task_type", "destination", "check_in", "check_out", "guests"],
            properties: {
              task_type: { const: "hotel_booking" },
              destination: { type: "string" },
              check_in: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              check_out: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              guests: { type: "integer", minimum: 1, maximum: 10 },
              rooms: { type: "integer", minimum: 1, maximum: 5 },
            },
          },
          {
            type: "object",
            required: ["task_type", "origin", "destination", "depart_date", "passengers"],
            properties: {
              task_type: { const: "flight_booking" },
              origin: { type: "string" },
              destination: { type: "string" },
              depart_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              return_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              passengers: { type: "integer", minimum: 1, maximum: 9 },
              cabin: { type: "string", enum: ["economy", "premium_economy", "business", "first"] },
            },
          },
          {
            type: "object",
            required: ["task_type", "city", "date", "participants"],
            properties: {
              task_type: { const: "activity_booking" },
              city: { type: "string" },
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              participants: { type: "integer", minimum: 1, maximum: 20 },
              activity_name: { type: "string" },
            },
          },
        ],
      },
      profile: {
        type: "object",
        description: "Inline contact info. Either this or profileId required.",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
        },
        required: ["first_name", "last_name", "email", "phone"],
      },
      profileId: {
        type: "integer",
        description: "ID of a saved BookingProfile. Mutually exclusive with 'profile'.",
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
  annotations: {
    title: "Create a travel task",
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false,
    idempotentHint: false,
  },
  async handler(rawArgs, client) {
    const args = InputSchema.parse(rawArgs);
    const { task, profile, profileId } = args;

    const request: ExecutionRequest = mapTaskToExecutionRequest(task);

    const job = await client.createExecutionJob({
      request,
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile !== undefined ? { profile } : {}),
      clientMetadata: { agentId: "onegent-mcp", protocol: "v2" },
    });

    return [
      `Travel task created (${task.task_type}).`,
      `Task ID: ${job.jobId}`,
      `Status: ${job.status}`,
      ``,
      summariseTask(task),
      ``,
      `Call get_task_status with jobId='${job.jobId}' in 15-30 seconds to check progress.`,
    ].join("\n");
  },
};

function mapTaskToExecutionRequest(task: z.infer<typeof InputSchema>["task"]): ExecutionRequest {
  switch (task.task_type) {
    case "restaurant_booking":
      return {
        scenario: "restaurant",
        params: {
          restaurant_name: task.restaurant_name,
          city: task.city,
          date: task.date,
          time: task.time,
          covers: task.covers,
        },
      };
    case "hotel_booking":
      return {
        scenario: "hotel",
        params: {
          destination: task.destination,
          check_in: task.check_in,
          check_out: task.check_out,
          guests: task.guests,
          ...(task.rooms !== undefined ? { rooms: task.rooms } : {}),
        },
      };
    case "flight_booking":
      return {
        scenario: "flight",
        params: {
          origin: task.origin,
          destination: task.destination,
          depart_date: task.depart_date,
          ...(task.return_date ? { return_date: task.return_date } : {}),
          passengers: task.passengers,
          ...(task.cabin ? { cabin: task.cabin } : {}),
        },
      };
    case "activity_booking":
      return {
        scenario: "activity",
        params: {
          city: task.city,
          date: task.date,
          participants: task.participants,
          ...(task.activity_name ? { activity_name: task.activity_name } : {}),
        },
      };
  }
}

function summariseTask(task: z.infer<typeof InputSchema>["task"]): string {
  switch (task.task_type) {
    case "restaurant_booking":
      return `${task.restaurant_name} (${task.city}) — ${task.date} at ${task.time}, party of ${task.covers}`;
    case "hotel_booking":
      return `Hotel in ${task.destination} — ${task.check_in} → ${task.check_out}, ${task.guests} guest(s)${task.rooms ? `, ${task.rooms} room(s)` : ""}`;
    case "flight_booking":
      return `${task.origin} → ${task.destination} on ${task.depart_date}${task.return_date ? ` (return ${task.return_date})` : ""}, ${task.passengers} passenger(s)${task.cabin ? ` (${task.cabin})` : ""}`;
    case "activity_booking":
      return `${task.activity_name ?? "Activity"} in ${task.city} on ${task.date}, ${task.participants} participant(s)`;
  }
}
