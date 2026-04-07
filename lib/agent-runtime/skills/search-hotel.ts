/**
 * Skill: search_hotel
 *
 * Uses the universal Stagehand browser executor to book a hotel on any site.
 * Handles: primary attempt → area switch (allowAreaSwitch).
 */

import type { Skill, SkillContext, StepOutcome, RecoveryStrategy } from "../types";
import type { BrowserTaskResult } from "@/lib/booking-autopilot/types";
import { buildHotelTask } from "@/lib/booking-autopilot/stagehand-executor";

export interface SearchHotelInput extends Record<string, unknown> {
  destination: string;
  checkIn: string;   // ISO date
  checkOut: string;  // ISO date
  guests: number;
  rooms?: number;
  budget?: string;
  preferredArea?: string;
  hotelName?: string;
  notes?: string;
  roomPreference?: string;      // e.g. "king bed", "double queen", "suite"
  breakfastIncluded?: boolean;  // true = user wants breakfast included
  fallbackCandidates?: Array<{ name: string; area?: string; stars?: number }>;
  bookingProfile?: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    room_preference?: string;
    breakfast_preference?: boolean;
  };
}

export const searchHotelSkill: Skill<SearchHotelInput> = {
  id: "search_hotel",
  label: "Book hotel",
  emoji: "🏨",
  stepType: "hotel",

  async execute(input, ctx: SkillContext): Promise<StepOutcome> {
    const { baseUrl, autonomy, jobId } = ctx;
    const htl = autonomy.hotel;

    ctx.log({
      type: "attempt",
      message: `Booking hotel in ${input.destination} ${input.checkIn}→${input.checkOut}`,
    });

    const profile = input.bookingProfile ?? {
      first_name: "", last_name: "", email: "", phone: "",
    };

    const hotelName = input.hotelName ?? input.destination;

    // Booking.com search URL as starting point
    const startUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName + " " + input.destination)}&checkin=${input.checkIn}&checkout=${input.checkOut}&group_adults=${input.guests}&no_rooms=${input.rooms ?? 1}`;

    const { task } = buildHotelTask({
      hotelName,
      city: input.destination,
      checkin: input.checkIn,
      checkout: input.checkOut,
      adults: input.guests,
      profile,
      roomPreference: input.roomPreference,
      breakfastIncluded: input.breakfastIncluded,
    });

    const taskWithContext = input.preferredArea
      ? `${task} Prefer hotels in ${input.preferredArea}.`
      : task;

    try {
      const res = await fetch(`${baseUrl}/api/booking-autopilot/universal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrl,
          task: taskWithContext,
          profile,
          jobId,
          stepIndex: 0,
        }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        return { status: "failed", reason: `HTTP ${res.status} from universal autopilot` };
      }

      const data = await res.json() as BrowserTaskResult;
      return mapBrowserResult(data, hotelName, input.destination, input.checkIn);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { status: "blocked", reason: "Execution cancelled" };
      }
      return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  },

  getFallbackStrategies(_reason: string, ctx: SkillContext): RecoveryStrategy[] {
    const strategies: RecoveryStrategy[] = [];
    const htl = ctx.autonomy.hotel;

    if (htl.allowAreaSwitch) {
      strategies.push({
        type: "adjust_location",
        priority: 1,
        description: "Try nearby area hotels",
      });
    }

    if ((htl.minStarRating ?? 0) > 0) {
      strategies.push({
        type: "retry_alternative",
        priority: 2,
        params: { relaxStarRating: true },
        description: "Relax star rating and try again",
      });
    }

    strategies.push({
      type: "escalate_to_user",
      priority: 10,
      description: "Ask user to choose hotel manually",
    });

    return strategies;
  },
};

function mapBrowserResult(
  data: BrowserTaskResult,
  hotelName: string,
  destination: string,
  checkIn: string
): StepOutcome {
  const result = {
    summary: data.summary,
    entityLabel: hotelName,
    handoffUrl: data.handoffUrl,
    screenshotBase64: data.screenshotBase64,
    sessionUrl: data.sessionUrl,
    scheduledAt: `${checkIn}T14:00`,
    meta: { destination },
  };

  switch (data.status) {
    case "completed":
    case "paused_payment":
      return { status: "succeeded", result: { ...result, requiresPayment: data.status === "paused_payment" } };
    case "no_availability":
      return { status: "blocked", reason: "No availability", actionItem: `Book in ${destination} manually` };
    case "needs_login":
      return { status: "blocked", reason: "Site requires login", actionItem: "Sign in and book manually" };
    case "captcha":
      return { status: "blocked", reason: "Blocked by anti-bot system", actionItem: "Book manually" };
    default:
      return { status: "failed", reason: data.error ?? data.summary };
  }
}
