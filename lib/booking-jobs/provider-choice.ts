import type { StepActionItem } from "@/lib/db";

const DEFAULT_EVENT_CHOICE_MESSAGE =
  "Which event date, city, and showtime should I use from this provider page?";

export function buildProviderEventChoiceActionItem(summary?: string | null): StepActionItem {
  const message = summary?.trim() || DEFAULT_EVENT_CHOICE_MESSAGE;
  return {
    message,
    options: [],
  };
}
