import {
  resolveTravelLinkFromUrl,
  type ResolvedTravelLink,
  type TravelLinkPageType,
  type TravelLinkProvider,
} from "@/lib/capture/travel-link-resolver";
import type {
  ActivityProviderSkill,
  ActivitySkillEvidenceContract,
  ActivitySkillHardStop,
  ActivitySkillPageType,
  ActivitySkillProvider,
  ActivitySkillResolvedProvider,
  ActivitySkillSafeNextAction,
  ActivitySkillUrlMatch,
} from "./types";

const COMMON_HARD_STOPS: ActivitySkillHardStop[] = [
  "seat_selection",
  "login",
  "account_verification",
  "captcha",
  "otp",
  "payment",
  "final_purchase",
  "final_confirmation",
];

const ACTIVITY_EVIDENCE_CONTRACT: ActivitySkillEvidenceContract = {
  requiredSources: [
    "provider",
    "page_type",
    "input_url",
    "current_url",
    "visible_title_or_event_name",
    "visible_candidate_facts",
    "screenshot",
    "action_log",
    "final_state",
    "safe_next_action",
  ],
  minimumForLabRun: [
    "provider",
    "page_type",
    "current_url",
    "screenshot",
    "action_log",
    "visible_candidate_facts",
    "safe_next_action",
  ],
};

export const ACTIVITY_PROVIDER_SKILLS: ActivityProviderSkill[] = [
  buildSkill("ticketmaster", ["exact_event", "artist_or_performer", "listing", "search_results"]),
  buildSkill("seatgeek", ["exact_event", "listing"]),
  buildSkill("stubhub", ["exact_event", "artist_or_performer", "grouping", "listing"]),
  buildSkill("eventbrite", ["exact_event", "listing", "search_results"]),
  buildSkill("axs", ["exact_event", "artist_or_performer", "grouping", "listing", "search_results"]),
];

export function resolveActivityProviderSkillUrl(value: unknown): ActivitySkillUrlMatch | null {
  const resolved = resolveTravelLinkFromUrl(value);
  return resolved ? activityMatchFromTravelLink(resolved) : null;
}

export function findActivityProviderSkill(
  provider: ActivitySkillProvider,
): ActivityProviderSkill | null {
  return ACTIVITY_PROVIDER_SKILLS.find((skill) => skill.provider === provider) ?? null;
}

export function isActivitySkillExactEvent(match: ActivitySkillUrlMatch): boolean {
  return match.provider !== "unknown" &&
    match.pageType === "exact_event" &&
    match.executionMode === "direct_execution" &&
    !match.needsUserChoice;
}

function buildSkill(
  provider: ActivitySkillProvider,
  pageTypes: ActivitySkillPageType[],
): ActivityProviderSkill {
  return {
    provider,
    pageTypes,
    requiredInputs: ["input_url"],
    safeActions: [
      "open provider page",
      "inspect visible events and dates",
      "collect candidate evidence",
      "click through only before user-controlled boundaries",
      "stop and ask the user when choices are ambiguous",
    ],
    hardStops: [...COMMON_HARD_STOPS],
    evidenceContract: ACTIVITY_EVIDENCE_CONTRACT,
    canHandleUrl: (url) => {
      const match = resolveActivityProviderSkillUrl(url);
      return match?.provider === provider ? match : null;
    },
  };
}

function activityMatchFromTravelLink(link: ResolvedTravelLink): ActivitySkillUrlMatch {
  return {
    provider: activityProviderFromTravelProvider(link.provider),
    pageType: activityPageTypeFromTravelPageType(link.page_type),
    inputUrl: link.original_url,
    normalizedUrl: link.normalized_url,
    host: link.host,
    ...(link.provider_page_id ? { providerPageId: link.provider_page_id } : {}),
    ...(link.title_hint ? { titleHint: link.title_hint } : {}),
    confidence: link.confidence,
    executionMode: link.execution_mode,
    needsUserChoice: link.needs_user_choice,
    safeNextAction: activitySafeNextActionFromTravelLink(link),
    evidence: {
      source: link.evidence.source,
      matchedPattern: link.evidence.matched_pattern,
      ...(link.evidence.title_source ? { titleSource: link.evidence.title_source } : {}),
    },
  };
}

function activityProviderFromTravelProvider(provider: TravelLinkProvider): ActivitySkillResolvedProvider {
  if (
    provider === "ticketmaster" ||
    provider === "seatgeek" ||
    provider === "stubhub" ||
    provider === "eventbrite" ||
    provider === "axs"
  ) {
    return provider;
  }
  return "unknown";
}

function activityPageTypeFromTravelPageType(pageType: TravelLinkPageType): ActivitySkillPageType {
  if (pageType === "artist" || pageType === "performer") return "artist_or_performer";
  if (pageType === "provider_listing") return "listing";
  return pageType;
}

function activitySafeNextActionFromTravelLink(link: ResolvedTravelLink): ActivitySkillSafeNextAction {
  if (link.execution_mode === "review_capture" || link.safe_next_action === "review_capture") {
    return "review_capture";
  }
  return link.needs_user_choice ? "ask_user_to_choose" : "start_task";
}
