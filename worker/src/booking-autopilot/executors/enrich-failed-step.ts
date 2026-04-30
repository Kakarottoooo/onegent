/**
 * Failure-path adapter: takes a BookingJobStep that's about to be returned
 * with status="error" (or similar non-success), enriches the handoff_url
 * + actionItem with a deep-link generated from current step.body fields.
 *
 * Why a separate module: keeps deep-link.ts (pure URL generator) decoupled
 * from BookingJobStep. The runner imports this one function; everything
 * downstream stays clean.
 *
 * Decision A (from Phase 2 plan): deep-link generated AT FAILURE TIME, so
 * Phase 1 modify changes (which mirror constraints into step.body) are
 * picked up automatically.
 */

import { generateRestaurantDeepLink } from "./deep-link";
import type { BookingJobStep, StepActionItem } from "../../db";

export interface DeepLinkEnrichment {
  handoff_url: string;
  actionItem: StepActionItem;
}

/**
 * Try to build a deep-link override for a failing restaurant step.
 *
 * Returns null when the step isn't a restaurant or required fields are
 * missing — caller should fall back to its existing actionItem behaviour.
 *
 * @param step               The step about to be returned with a non-success status.
 * @param fallbackMessage    Lead text for the actionItem; the deep-link label
 *                           is inserted as the option label.
 */
export function buildDeepLinkEnrichmentForStep(
  step: BookingJobStep,
  fallbackMessage: string,
): DeepLinkEnrichment | null {
  if (step.type !== "restaurant") return null;

  const body = (step.body ?? {}) as Record<string, unknown>;
  const restaurant_name = typeof body.restaurantName === "string" ? body.restaurantName : "";
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  if (!restaurant_name || !date || !time) return null;

  const party_size = typeof body.covers === "number" ? body.covers : 2;
  const city = typeof body.city === "string" ? body.city : "";
  const restaurant_url = typeof body.startUrl === "string" ? body.startUrl : undefined;

  const link = generateRestaurantDeepLink({
    restaurant_name,
    city,
    date,
    time,
    party_size,
    restaurant_url,
  });

  return {
    handoff_url: link.url,
    actionItem: {
      message: fallbackMessage,
      options: [{ label: link.label, url: link.url }],
    },
  };
}
