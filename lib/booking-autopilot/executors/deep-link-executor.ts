/**
 * DeepLinkExecutor — produces a handoff URL from constraints + (optional)
 * platform URL. Never drives a browser; never touches network. Always
 * succeeds with status="handoff_ready".
 *
 * Used as the last-resort fallback when StagehandExecutor returns a
 * non-success status. The user clicks the URL and finishes the booking
 * themselves on the platform with date / time / party-size pre-filled.
 */

import {
  generateRestaurantDeepLink,
  type DeepLinkOutput,
} from "./deep-link";
import type {
  BookingExecutor,
  ExecutorCapability,
  ExecutorInput,
  ExecutorResult,
} from "./types";

export const deepLinkExecutor: BookingExecutor = {
  name: "deep_link",

  async canHandle(input: ExecutorInput): Promise<ExecutorCapability> {
    const c = input.constraints;
    if (!c) {
      // We can also derive from browserTask body (legacy jobs without
      // constraints) — if neither is present, we genuinely can't help.
      if (!input.browserTask) {
        return { can: false, reason: "no constraints and no browserTask" };
      }
      // browserTask.task is a free-form NL string; we'd need to parse it.
      // Out of scope for Phase 2. Require constraints.
      return { can: false, reason: "constraints required for deterministic deep-link" };
    }
    if (c.task_type !== "restaurant_booking") {
      return {
        can: false,
        reason: `Phase 2 only supports restaurant_booking, got: ${c.task_type}`,
      };
    }
    return { can: true };
  },

  async run(input: ExecutorInput): Promise<ExecutorResult> {
    const c = input.constraints;
    if (!c || c.task_type !== "restaurant_booking") {
      return { status: "error", reason: "constraints missing or wrong task_type" };
    }

    const link: DeepLinkOutput = generateRestaurantDeepLink({
      restaurant_name: c.restaurant_name,
      city: c.city,
      date: c.date,
      time: c.time,
      party_size: c.party_size,
      restaurant_url: input.browserTask?.startUrl,
    });

    return {
      status: "handoff_ready",
      handoff_url: link.url,
      message:
        link.kind === "detail"
          ? `${link.label} — date / time / party size pre-filled on the booking page.`
          : `${link.label} — opens search results scoped to your date / time / party size.`,
      reason: "deep_link_handoff",
    };
  },
};
