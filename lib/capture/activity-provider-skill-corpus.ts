import type {
  TravelLinkExecutionMode,
  TravelLinkHardStop,
  TravelLinkPageType,
  TravelLinkProvider,
} from "@/lib/capture/travel-link-resolver";

export type ActivityProviderSkillCorpusProvider = "stubhub" | "eventbrite" | "axs";

export type ActivityProviderSkillFixtureKind =
  | "exact_event"
  | "performer"
  | "artist"
  | "grouping"
  | "listing"
  | "organizer"
  | "search"
  | "malformed"
  | "impersonation";

export interface ActivityProviderSkillResolverExpectation {
  provider: TravelLinkProvider;
  page_type: TravelLinkPageType;
  execution_mode: TravelLinkExecutionMode;
  needs_user_choice: boolean;
  safe_next_action: "start_task" | "review_capture";
  hard_stop: TravelLinkHardStop;
  matched_pattern?: string;
  provider_page_id?: string;
}

export interface ActivityProviderSkillUrlFixture {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  kind: ActivityProviderSkillFixtureKind;
  label: string;
  url: string;
  resolves: boolean;
  expected: ActivityProviderSkillResolverExpectation;
}

const PROVIDER_HARD_STOP: TravelLinkHardStop =
  "seat_selection_login_payment_or_final_confirmation";
const REVIEW_HARD_STOP: TravelLinkHardStop = "review_only_no_execution";

export const ACTIVITY_PROVIDER_SKILL_URL_FIXTURES: ActivityProviderSkillUrlFixture[] = [
  ...stubHubFixtures(),
  ...eventbriteFixtures(),
  ...axsFixtures(),
];

export function activityProviderSkillFixtureCounts(): Record<
  ActivityProviderSkillCorpusProvider,
  number
> {
  return ACTIVITY_PROVIDER_SKILL_URL_FIXTURES.reduce(
    (counts, fixture) => {
      counts[fixture.provider] += 1;
      return counts;
    },
    { stubhub: 0, eventbrite: 0, axs: 0 },
  );
}

function stubHubFixtures(): ActivityProviderSkillUrlFixture[] {
  return [
    providerFixture({
      id: "stubhub-performer-bts",
      provider: "stubhub",
      kind: "performer",
      label: "BTS performer page",
      url: "https://www.stubhub.com/bts-tickets/performer/1503185",
      pageType: "performer",
      providerPageId: "1503185",
      matchedPattern: "stubhub_performer",
    }),
    providerFixture({
      id: "stubhub-performer-olivia-rodrigo",
      provider: "stubhub",
      kind: "performer",
      label: "Olivia Rodrigo performer page",
      url: "https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867",
      pageType: "performer",
      providerPageId: "101864867",
      matchedPattern: "stubhub_performer",
    }),
    providerFixture({
      id: "stubhub-performer-taylor-swift",
      provider: "stubhub",
      kind: "performer",
      label: "Taylor Swift performer page",
      url: "https://www.stubhub.com/taylor-swift-tickets/performer/136034",
      pageType: "performer",
      providerPageId: "136034",
      matchedPattern: "stubhub_performer",
    }),
    providerFixture({
      id: "stubhub-performer-bad-bunny",
      provider: "stubhub",
      kind: "performer",
      label: "Bad Bunny performer page",
      url: "https://www.stubhub.com/bad-bunny-tickets/performer/100271157",
      pageType: "performer",
      providerPageId: "100271157",
      matchedPattern: "stubhub_performer",
    }),
    providerFixture({
      id: "stubhub-performer-hamilton",
      provider: "stubhub",
      kind: "performer",
      label: "Hamilton performer page",
      url: "https://www.stubhub.com/hamilton-tickets/performer/1498641",
      pageType: "performer",
      providerPageId: "1498641",
      matchedPattern: "stubhub_performer",
    }),
    providerFixture({
      id: "stubhub-grouping-nba-playoffs",
      provider: "stubhub",
      kind: "grouping",
      label: "NBA Playoffs grouping page",
      url: "https://www.stubhub.com/nba-playoffs-tickets/grouping/107517",
      pageType: "grouping",
      providerPageId: "107517",
      matchedPattern: "stubhub_grouping",
    }),
    providerFixture({
      id: "stubhub-grouping-world-cup",
      provider: "stubhub",
      kind: "grouping",
      label: "World Cup grouping page",
      url: "https://www.stubhub.com/world-cup-tickets/grouping/45410",
      pageType: "grouping",
      providerPageId: "45410",
      matchedPattern: "stubhub_grouping",
    }),
    providerFixture({
      id: "stubhub-grouping-broadway",
      provider: "stubhub",
      kind: "grouping",
      label: "Broadway grouping page",
      url: "https://www.stubhub.com/broadway-tickets/grouping/115",
      pageType: "grouping",
      providerPageId: "115",
      matchedPattern: "stubhub_grouping",
    }),
    providerFixture({
      id: "stubhub-grouping-mlb-all-star",
      provider: "stubhub",
      kind: "grouping",
      label: "MLB All-Star grouping page",
      url: "https://www.stubhub.com/mlb-all-star-game-tickets/grouping/609",
      pageType: "grouping",
      providerPageId: "609",
      matchedPattern: "stubhub_grouping",
    }),
    providerFixture({
      id: "stubhub-grouping-college-football",
      provider: "stubhub",
      kind: "grouping",
      label: "College football grouping page",
      url: "https://www.stubhub.com/college-football-tickets/grouping/491",
      pageType: "grouping",
      providerPageId: "491",
      matchedPattern: "stubhub_grouping",
    }),
    exactProviderFixture({
      id: "stubhub-event-olivia-la",
      provider: "stubhub",
      label: "Olivia Rodrigo exact event URL",
      url: "https://www.stubhub.com/olivia-rodrigo-los-angeles-tickets-6-12-2026/event/153000001/",
      providerPageId: "153000001",
      matchedPattern: "stubhub_event",
    }),
    exactProviderFixture({
      id: "stubhub-event-lakers",
      provider: "stubhub",
      label: "Lakers exact event URL",
      url: "https://www.stubhub.com/los-angeles-lakers-los-angeles-tickets-5-1-2026/event/153000002/",
      providerPageId: "153000002",
      matchedPattern: "stubhub_event",
    }),
    exactProviderFixture({
      id: "stubhub-event-taylor",
      provider: "stubhub",
      label: "Taylor Swift exact event URL",
      url: "https://www.stubhub.com/taylor-swift-nashville-tickets-8-15-2026/event/153000003/",
      providerPageId: "153000003",
      matchedPattern: "stubhub_event",
    }),
    exactProviderFixture({
      id: "stubhub-event-nfl",
      provider: "stubhub",
      label: "NFL exact event URL",
      url: "https://www.stubhub.com/tennessee-titans-nashville-tickets-9-20-2026/event/153000004/",
      providerPageId: "153000004",
      matchedPattern: "stubhub_event",
    }),
    exactProviderFixture({
      id: "stubhub-event-comedy",
      provider: "stubhub",
      label: "Comedy exact event URL",
      url: "https://www.stubhub.com/comedy-show-new-york-tickets-7-10-2026/event/153000005/",
      providerPageId: "153000005",
      matchedPattern: "stubhub_event",
    }),
    providerFixture({
      id: "stubhub-listing-sports",
      provider: "stubhub",
      kind: "listing",
      label: "StubHub sports listing page",
      url: "https://www.stubhub.com/sports-tickets/",
      pageType: "provider_listing",
      providerPageId: "sports-tickets",
      matchedPattern: "stubhub_provider_listing",
    }),
    providerFixture({
      id: "stubhub-search-query",
      provider: "stubhub",
      kind: "listing",
      label: "StubHub search query page",
      url: "https://www.stubhub.com/find/s/?q=olivia%20rodrigo",
      pageType: "provider_listing",
      providerPageId: "find",
      matchedPattern: "stubhub_provider_listing",
    }),
    malformedFixture({
      id: "stubhub-malformed-no-scheme",
      provider: "stubhub",
      label: "StubHub URL without a scheme",
      url: "stubhub.com/bts-tickets/performer/1503185",
    }),
    malformedFixture({
      id: "stubhub-malformed-ftp",
      provider: "stubhub",
      label: "StubHub FTP URL is unsupported",
      url: "ftp://www.stubhub.com/bts-tickets/performer/1503185",
    }),
    impersonationFixture({
      id: "stubhub-impersonation-suffix",
      provider: "stubhub",
      label: "StubHub suffix impersonation host",
      url: "https://stubhub.com.evil.example/bts-tickets/performer/1503185",
    }),
    impersonationFixture({
      id: "stubhub-impersonation-prefix",
      provider: "stubhub",
      label: "StubHub prefix impersonation host",
      url: "https://notstubhub.com/bts-tickets/performer/1503185",
    }),
  ];
}

function eventbriteFixtures(): ActivityProviderSkillUrlFixture[] {
  return [
    exactProviderFixture({
      id: "eventbrite-event-nashville-jazz",
      provider: "eventbrite",
      label: "Nashville jazz event page",
      url: "https://www.eventbrite.com/e/nashville-jazz-night-tickets-123456789001",
      providerPageId: "123456789001",
      matchedPattern: "eventbrite_event",
    }),
    exactProviderFixture({
      id: "eventbrite-event-food-festival",
      provider: "eventbrite",
      label: "Food festival event page",
      url: "https://www.eventbrite.com/e/east-nashville-food-festival-tickets-123456789002",
      providerPageId: "123456789002",
      matchedPattern: "eventbrite_event",
    }),
    exactProviderFixture({
      id: "eventbrite-event-tech-meetup",
      provider: "eventbrite",
      label: "Tech meetup event page",
      url: "https://www.eventbrite.com/e/austin-ai-founder-meetup-tickets-123456789003",
      providerPageId: "123456789003",
      matchedPattern: "eventbrite_event",
    }),
    exactProviderFixture({
      id: "eventbrite-event-comedy",
      provider: "eventbrite",
      label: "Comedy event page",
      url: "https://www.eventbrite.com/e/new-york-comedy-show-tickets-123456789004",
      providerPageId: "123456789004",
      matchedPattern: "eventbrite_event",
    }),
    exactProviderFixture({
      id: "eventbrite-event-workshop",
      provider: "eventbrite",
      label: "Workshop event page",
      url: "https://www.eventbrite.com/e/watercolor-workshop-tickets-123456789005",
      providerPageId: "123456789005",
      matchedPattern: "eventbrite_event",
    }),
    exactProviderFixture({
      id: "eventbrite-event-online-class",
      provider: "eventbrite",
      label: "Online class event page",
      url: "https://www.eventbrite.com/e/online-cooking-class-tickets-123456789006",
      providerPageId: "123456789006",
      matchedPattern: "eventbrite_event",
    }),
    providerFixture({
      id: "eventbrite-listing-nashville-music",
      provider: "eventbrite",
      kind: "listing",
      label: "Nashville music listing",
      url: "https://www.eventbrite.com/d/tn--nashville/music/",
      pageType: "provider_listing",
      providerPageId: "tn--nashville/music",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    providerFixture({
      id: "eventbrite-listing-la-food",
      provider: "eventbrite",
      kind: "listing",
      label: "Los Angeles food listing",
      url: "https://www.eventbrite.com/d/ca--los-angeles/food-and-drink/",
      pageType: "provider_listing",
      providerPageId: "ca--los-angeles/food-and-drink",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    providerFixture({
      id: "eventbrite-listing-nyc-business",
      provider: "eventbrite",
      kind: "listing",
      label: "New York business listing",
      url: "https://www.eventbrite.com/d/ny--new-york/business/",
      pageType: "provider_listing",
      providerPageId: "ny--new-york/business",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    providerFixture({
      id: "eventbrite-listing-online-events",
      provider: "eventbrite",
      kind: "listing",
      label: "Online events listing",
      url: "https://www.eventbrite.com/d/online/events/",
      pageType: "provider_listing",
      providerPageId: "online/events",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    providerFixture({
      id: "eventbrite-listing-atlanta-nightlife",
      provider: "eventbrite",
      kind: "listing",
      label: "Atlanta nightlife listing",
      url: "https://www.eventbrite.com/d/ga--atlanta/nightlife/",
      pageType: "provider_listing",
      providerPageId: "ga--atlanta/nightlife",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    providerFixture({
      id: "eventbrite-organizer-symphony",
      provider: "eventbrite",
      kind: "organizer",
      label: "Organizer page",
      url: "https://www.eventbrite.com/o/nashville-symphony-12345678901",
      pageType: "provider_listing",
      providerPageId: "12345678901",
      matchedPattern: "eventbrite_organizer",
    }),
    providerFixture({
      id: "eventbrite-organizer-food-hall",
      provider: "eventbrite",
      kind: "organizer",
      label: "Food hall organizer page",
      url: "https://www.eventbrite.com/o/east-side-food-hall-12345678902",
      pageType: "provider_listing",
      providerPageId: "12345678902",
      matchedPattern: "eventbrite_organizer",
    }),
    providerFixture({
      id: "eventbrite-organizer-startup",
      provider: "eventbrite",
      kind: "organizer",
      label: "Startup organizer page",
      url: "https://www.eventbrite.com/o/founder-night-12345678903",
      pageType: "provider_listing",
      providerPageId: "12345678903",
      matchedPattern: "eventbrite_organizer",
    }),
    providerFixture({
      id: "eventbrite-search-music",
      provider: "eventbrite",
      kind: "search",
      label: "Eventbrite music search",
      url: "https://www.eventbrite.com/search/?q=nashville%20music",
      pageType: "search_results",
      providerPageId: "search",
      matchedPattern: "eventbrite_search",
    }),
    providerFixture({
      id: "eventbrite-search-comedy",
      provider: "eventbrite",
      kind: "search",
      label: "Eventbrite comedy search",
      url: "https://www.eventbrite.com/search/?q=comedy",
      pageType: "search_results",
      providerPageId: "search",
      matchedPattern: "eventbrite_search",
    }),
    providerFixture({
      id: "eventbrite-generic-directory",
      provider: "eventbrite",
      kind: "listing",
      label: "Eventbrite generic directory",
      url: "https://www.eventbrite.com/b/online/",
      pageType: "provider_listing",
      providerPageId: "online",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    malformedFixture({
      id: "eventbrite-malformed-no-scheme",
      provider: "eventbrite",
      label: "Eventbrite URL without a scheme",
      url: "eventbrite.com/e/nashville-jazz-night-tickets-123456789001",
    }),
    malformedFixture({
      id: "eventbrite-malformed-javascript",
      provider: "eventbrite",
      label: "Eventbrite JavaScript URL is unsupported",
      url: "javascript:https://www.eventbrite.com/e/nashville-jazz-night-tickets-123456789001",
    }),
    impersonationFixture({
      id: "eventbrite-impersonation-suffix",
      provider: "eventbrite",
      label: "Eventbrite suffix impersonation host",
      url: "https://eventbrite.com.evil.example/e/nashville-jazz-night-tickets-123456789001",
    }),
    impersonationFixture({
      id: "eventbrite-impersonation-prefix",
      provider: "eventbrite",
      label: "Eventbrite prefix impersonation host",
      url: "https://noteventbrite.com/e/nashville-jazz-night-tickets-123456789001",
    }),
  ];
}

function axsFixtures(): ActivityProviderSkillUrlFixture[] {
  return [
    providerFixture({
      id: "axs-artist-taylor-swift",
      provider: "axs",
      kind: "artist",
      label: "Taylor Swift artist page",
      url: "https://www.axs.com/artists/123456/taylor-swift-tickets",
      pageType: "artist",
      providerPageId: "123456",
      matchedPattern: "axs_artist",
    }),
    providerFixture({
      id: "axs-artist-kacey-musgraves",
      provider: "axs",
      kind: "artist",
      label: "Kacey Musgraves artist page",
      url: "https://www.axs.com/artists/123457/kacey-musgraves-tickets",
      pageType: "artist",
      providerPageId: "123457",
      matchedPattern: "axs_artist",
    }),
    providerFixture({
      id: "axs-artist-billie-eilish",
      provider: "axs",
      kind: "artist",
      label: "Billie Eilish artist page",
      url: "https://www.axs.com/artists/123458/billie-eilish-tickets",
      pageType: "artist",
      providerPageId: "123458",
      matchedPattern: "axs_artist",
    }),
    providerFixture({
      id: "axs-artist-comedy",
      provider: "axs",
      kind: "artist",
      label: "Comedy artist page",
      url: "https://www.axs.com/artists/123459/comedy-night-tickets",
      pageType: "artist",
      providerPageId: "123459",
      matchedPattern: "axs_artist",
    }),
    providerFixture({
      id: "axs-artist-hamilton",
      provider: "axs",
      kind: "artist",
      label: "Hamilton artist page",
      url: "https://www.axs.com/artists/123460/hamilton-tickets",
      pageType: "artist",
      providerPageId: "123460",
      matchedPattern: "axs_artist",
    }),
    providerFixture({
      id: "axs-artist-soccer-club",
      provider: "axs",
      kind: "artist",
      label: "Soccer club artist page",
      url: "https://www.axs.com/artists/123461/nashville-sc-tickets",
      pageType: "artist",
      providerPageId: "123461",
      matchedPattern: "axs_artist",
    }),
    exactProviderFixture({
      id: "axs-event-kacey-nashville",
      provider: "axs",
      label: "Kacey Musgraves exact event",
      url: "https://www.axs.com/events/987650/kacey-musgraves-tickets",
      providerPageId: "987650",
      matchedPattern: "axs_event",
    }),
    exactProviderFixture({
      id: "axs-event-billie-la",
      provider: "axs",
      label: "Billie Eilish exact event",
      url: "https://www.axs.com/events/987651/billie-eilish-los-angeles-tickets",
      providerPageId: "987651",
      matchedPattern: "axs_event",
    }),
    exactProviderFixture({
      id: "axs-event-hamilton",
      provider: "axs",
      label: "Hamilton exact event",
      url: "https://www.axs.com/events/987652/hamilton-new-york-tickets",
      providerPageId: "987652",
      matchedPattern: "axs_event",
    }),
    exactProviderFixture({
      id: "axs-event-comedy",
      provider: "axs",
      label: "Comedy exact event",
      url: "https://www.axs.com/events/987653/comedy-night-tickets",
      providerPageId: "987653",
      matchedPattern: "axs_event",
    }),
    exactProviderFixture({
      id: "axs-event-soccer",
      provider: "axs",
      label: "Soccer exact event",
      url: "https://www.axs.com/events/987654/nashville-sc-tickets",
      providerPageId: "987654",
      matchedPattern: "axs_event",
    }),
    exactProviderFixture({
      id: "axs-event-festival",
      provider: "axs",
      label: "Festival exact event",
      url: "https://www.axs.com/events/987655/summer-festival-tickets",
      providerPageId: "987655",
      matchedPattern: "axs_event",
    }),
    providerFixture({
      id: "axs-listing-music",
      provider: "axs",
      kind: "listing",
      label: "AXS music listing page",
      url: "https://www.axs.com/browse/music",
      pageType: "provider_listing",
      providerPageId: "browse",
      matchedPattern: "axs_provider_listing",
    }),
    providerFixture({
      id: "axs-listing-sports",
      provider: "axs",
      kind: "listing",
      label: "AXS sports listing page",
      url: "https://www.axs.com/browse/sports",
      pageType: "provider_listing",
      providerPageId: "browse",
      matchedPattern: "axs_provider_listing",
    }),
    providerFixture({
      id: "axs-listing-venue",
      provider: "axs",
      kind: "listing",
      label: "AXS venue listing page",
      url: "https://www.axs.com/venues/1234/ryman-auditorium-tickets",
      pageType: "provider_listing",
      providerPageId: "venues",
      matchedPattern: "axs_provider_listing",
    }),
    providerFixture({
      id: "axs-listing-series",
      provider: "axs",
      kind: "listing",
      label: "AXS series listing page",
      url: "https://www.axs.com/series/5678/summer-concert-series-tickets",
      pageType: "provider_listing",
      providerPageId: "series",
      matchedPattern: "axs_provider_listing",
    }),
    providerFixture({
      id: "axs-search-kacey",
      provider: "axs",
      kind: "search",
      label: "AXS search page",
      url: "https://www.axs.com/search?q=kacey%20musgraves",
      pageType: "search_results",
      providerPageId: "search",
      matchedPattern: "axs_search",
    }),
    malformedFixture({
      id: "axs-malformed-no-scheme",
      provider: "axs",
      label: "AXS URL without a scheme",
      url: "axs.com/events/987650/kacey-musgraves-tickets",
    }),
    malformedFixture({
      id: "axs-malformed-mailto",
      provider: "axs",
      label: "AXS mailto URL is unsupported",
      url: "mailto:https://www.axs.com/events/987650/kacey-musgraves-tickets",
    }),
    impersonationFixture({
      id: "axs-impersonation-suffix",
      provider: "axs",
      label: "AXS suffix impersonation host",
      url: "https://axs.com.evil.example/events/987650/kacey-musgraves-tickets",
    }),
    impersonationFixture({
      id: "axs-impersonation-prefix",
      provider: "axs",
      label: "AXS prefix impersonation host",
      url: "https://notaxs.com/events/987650/kacey-musgraves-tickets",
    }),
  ];
}

function exactProviderFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  label: string;
  url: string;
  providerPageId: string;
  matchedPattern: string;
}): ActivityProviderSkillUrlFixture {
  return {
    id: input.id,
    provider: input.provider,
    kind: "exact_event",
    label: input.label,
    url: input.url,
    resolves: true,
    expected: {
      provider: input.provider,
      page_type: "exact_event",
      execution_mode: "direct_execution",
      needs_user_choice: false,
      safe_next_action: "start_task",
      hard_stop: PROVIDER_HARD_STOP,
      provider_page_id: input.providerPageId,
      matched_pattern: input.matchedPattern,
    },
  };
}

function providerFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  kind: Exclude<ActivityProviderSkillFixtureKind, "exact_event" | "malformed" | "impersonation">;
  label: string;
  url: string;
  pageType: Exclude<TravelLinkPageType, "exact_event" | "unknown_provider_page">;
  providerPageId: string;
  matchedPattern: string;
}): ActivityProviderSkillUrlFixture {
  return {
    id: input.id,
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    url: input.url,
    resolves: true,
    expected: {
      provider: input.provider,
      page_type: input.pageType,
      execution_mode: "provider_start",
      needs_user_choice: true,
      safe_next_action: "start_task",
      hard_stop: PROVIDER_HARD_STOP,
      provider_page_id: input.providerPageId,
      matched_pattern: input.matchedPattern,
    },
  };
}

function malformedFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  label: string;
  url: string;
}): ActivityProviderSkillUrlFixture {
  return unresolvedFixture({
    ...input,
    kind: "malformed",
  });
}

function impersonationFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  label: string;
  url: string;
}): ActivityProviderSkillUrlFixture {
  return unresolvedFixture({
    ...input,
    kind: "impersonation",
  });
}

function unresolvedFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  kind: "malformed" | "impersonation";
  label: string;
  url: string;
}): ActivityProviderSkillUrlFixture {
  return {
    id: input.id,
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    url: input.url,
    resolves: false,
    expected: {
      provider: "unknown",
      page_type: "unknown_provider_page",
      execution_mode: "review_capture",
      needs_user_choice: true,
      safe_next_action: "review_capture",
      hard_stop: REVIEW_HARD_STOP,
    },
  };
}
