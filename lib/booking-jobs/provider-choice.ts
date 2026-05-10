import type { StepActionItem } from "@/lib/db";

const DEFAULT_EVENT_CHOICE_MESSAGE =
  "Which event date, city, and showtime should I use from this provider page?";

const EVENT_CHOICE_MARKERS = [
  "user_event_choice_required",
  "which event date",
  "which visible event",
  "which showtime",
  "which date, city",
  "no target date/time",
  "pausing for user event choice",
];

type ProviderChoiceStepLike = {
  actionItem?: {
    message?: string | null;
    options?: Array<{ label: string; url: string }> | null;
  } | null;
  decisionLog?: Array<{ message?: string | null; outcome?: string | null }> | null;
};

function isEventChoiceText(value: string | null | undefined): value is string {
  const text = value?.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  return EVENT_CHOICE_MARKERS.some((marker) => lower.includes(marker));
}

function isUserFacingChoiceQuestion(value: string | null | undefined): value is string {
  const lower = value?.trim().toLowerCase() ?? "";
  return lower.includes("which event date") ||
    lower.includes("which visible event") ||
    lower.includes("which showtime") ||
    lower.includes("which date, city");
}

export function buildProviderEventChoiceActionItem(
  summary?: string | null,
  options: Array<{ label: string; url?: string }> = [],
): StepActionItem {
  const message = summary?.trim() || DEFAULT_EVENT_CHOICE_MESSAGE;
  return {
    message,
    options: options
      .map((option) => ({
        label: option.label.trim(),
        url: option.url ?? "",
      }))
      .filter((option) => option.label.length > 0)
      .slice(0, 8),
  };
}

export function providerEventChoiceMessage(step: ProviderChoiceStepLike): string | null {
  const candidates = [
    step.actionItem?.message,
    ...(step.decisionLog ?? []).flatMap((entry) => [entry.message, entry.outcome]),
  ];
  const userFacing = candidates.find(isUserFacingChoiceQuestion);
  if (userFacing) return userFacing.trim();
  if (isEventChoiceText(step.actionItem?.message)) return step.actionItem.message.trim();
  for (const entry of step.decisionLog ?? []) {
    if (isEventChoiceText(entry.message)) return entry.message?.trim() ?? null;
    if (isEventChoiceText(entry.outcome)) return entry.outcome?.trim() ?? null;
  }
  return null;
}

export function getProviderEventChoiceActionItem(
  step: ProviderChoiceStepLike,
): StepActionItem | undefined {
  if (step.actionItem?.message) {
    return {
      message: step.actionItem.message,
      options: Array.isArray(step.actionItem.options) ? step.actionItem.options : [],
    };
  }
  const message = providerEventChoiceMessage(step);
  return message ? buildProviderEventChoiceActionItem(message) : undefined;
}

export function stepNeedsProviderEventChoice(step: ProviderChoiceStepLike): boolean {
  return providerEventChoiceMessage(step) !== null;
}
