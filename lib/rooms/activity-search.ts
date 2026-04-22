/**
 * Activity search adapter for Decision Room.
 *
 * Mirrors hotel-search.ts / flight-search.ts: merge engine outputs a compound
 * natural-language query, this adapter parses it into an ActivityIntent,
 * overrides hard fields with authoritative Room context (event_name,
 * event_date, city, num_tickets), and runs runActivityPipeline (SeatGeek).
 *
 * Event identity + date + city are group-level facts stored in
 * `room.context_json` and must NOT be overridden by per-member constraints —
 * everyone attends the SAME show on the SAME night.
 */

import { CITIES, DEFAULT_CITY } from "@/lib/cities";
import { parseActivityIntent } from "@/lib/agent/parse/activity";
import { runActivityPipeline } from "@/lib/agent/pipelines/activity";
import type {
  ActivityIntent,
  ActivityRecommendationCard,
  ActivityEventType,
} from "@/lib/types";

export interface ActivityRoomContext {
  cityId?: string;
  /** Free-text city, authoritative. */
  city?: string;
  /** Specific show / performer / team — authoritative. */
  eventName?: string;
  /** Event type (concert/theater/sports/...). Authoritative when set. */
  eventType?: ActivityEventType;
  /** YYYY-MM-DD — earliest acceptable date. Authoritative. */
  dateFrom?: string;
  /** YYYY-MM-DD — latest acceptable date. Authoritative. */
  dateTo?: string;
  /** Total tickets for the group. Defaults to member count when caller knows it. */
  numTickets?: number;
  /** Venue hint (e.g. "Broadway", "Madison Square Garden"). */
  venueHint?: string;
}

export interface ActivitySearchResult {
  cards: ActivityRecommendationCard[];
  intent: ActivityIntent;
  missingFields: string[];
}

export async function runAgentForActivity(
  mergedQuery: string,
  context: ActivityRoomContext
): Promise<ActivitySearchResult> {
  const city = CITIES[context.cityId ?? ""] ?? CITIES[DEFAULT_CITY];
  const cityFullName = context.city || city.fullName;

  const parsed = await parseActivityIntent(mergedQuery, cityFullName);

  const intent: ActivityIntent = {
    ...parsed,
    category: "activity",
    city: context.city ?? parsed.city ?? cityFullName,
    event_name: context.eventName ?? parsed.event_name,
    event_type: context.eventType ?? parsed.event_type,
    date_from: context.dateFrom ?? parsed.date_from,
    date_to: context.dateTo ?? parsed.date_to,
    num_tickets: context.numTickets ?? parsed.num_tickets,
  };

  const { activityRecommendations, missing_fields } = await runActivityPipeline(intent);

  return {
    cards: activityRecommendations,
    intent,
    missingFields: missing_fields,
  };
}
