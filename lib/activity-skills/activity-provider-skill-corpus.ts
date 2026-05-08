import type {
  ActivitySkillExecutionMode,
  ActivitySkillPageType,
  ActivitySkillResolvedProvider,
  ActivitySkillSafeNextAction,
} from "./types";

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

export type ActivityProviderSkillFixtureOutcome = "match" | "unknown" | "null";

export interface ActivityProviderSkillResolverExpectation {
  provider: ActivitySkillResolvedProvider;
  pageType: ActivitySkillPageType;
  executionMode: ActivitySkillExecutionMode;
  needsUserChoice: boolean;
  safeNextAction: ActivitySkillSafeNextAction;
  matchedPattern?: string;
  providerPageId?: string;
}

export interface ActivityProviderSkillUrlFixture {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  kind: ActivityProviderSkillFixtureKind;
  label: string;
  url: string;
  outcome: ActivityProviderSkillFixtureOutcome;
  expected: ActivityProviderSkillResolverExpectation;
}

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
    ...[
      ["stubhub-performer-bts", "BTS performer page", "https://www.stubhub.com/bts-tickets/performer/1503185", "1503185"],
      ["stubhub-performer-olivia-rodrigo", "Olivia Rodrigo performer page", "https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867", "101864867"],
      ["stubhub-performer-taylor-swift", "Taylor Swift performer page", "https://www.stubhub.com/taylor-swift-tickets/performer/136034", "136034"],
      ["stubhub-performer-bad-bunny", "Bad Bunny performer page", "https://www.stubhub.com/bad-bunny-tickets/performer/100271157", "100271157"],
      ["stubhub-performer-hamilton", "Hamilton performer page", "https://www.stubhub.com/hamilton-tickets/performer/1498641", "1498641"],
    ].map(([id, label, url, providerPageId]) =>
      providerFixture({
        id,
        provider: "stubhub",
        kind: "performer",
        label,
        url,
        pageType: "artist_or_performer",
        providerPageId,
        matchedPattern: "stubhub_performer",
      }),
    ),
    ...[
      ["stubhub-grouping-nba-playoffs", "NBA Playoffs grouping page", "https://www.stubhub.com/nba-playoffs-tickets/grouping/107517", "107517"],
      ["stubhub-grouping-world-cup", "World Cup grouping page", "https://www.stubhub.com/world-cup-tickets/grouping/45410", "45410"],
      ["stubhub-grouping-broadway", "Broadway grouping page", "https://www.stubhub.com/broadway-tickets/grouping/115", "115"],
      ["stubhub-grouping-mlb-all-star", "MLB All-Star grouping page", "https://www.stubhub.com/mlb-all-star-game-tickets/grouping/609", "609"],
      ["stubhub-grouping-college-football", "College football grouping page", "https://www.stubhub.com/college-football-tickets/grouping/491", "491"],
    ].map(([id, label, url, providerPageId]) =>
      providerFixture({
        id,
        provider: "stubhub",
        kind: "grouping",
        label,
        url,
        pageType: "grouping",
        providerPageId,
        matchedPattern: "stubhub_grouping",
      }),
    ),
    ...[
      ["stubhub-event-olivia-la", "Olivia Rodrigo exact event URL", "https://www.stubhub.com/olivia-rodrigo-los-angeles-tickets-6-12-2026/event/153000001/", "153000001"],
      ["stubhub-event-lakers", "Lakers exact event URL", "https://www.stubhub.com/los-angeles-lakers-los-angeles-tickets-5-1-2026/event/153000002/", "153000002"],
      ["stubhub-event-taylor", "Taylor Swift exact event URL", "https://www.stubhub.com/taylor-swift-nashville-tickets-8-15-2026/event/153000003/", "153000003"],
      ["stubhub-event-nfl", "NFL exact event URL", "https://www.stubhub.com/tennessee-titans-nashville-tickets-9-20-2026/event/153000004/", "153000004"],
      ["stubhub-event-comedy", "Comedy exact event URL", "https://www.stubhub.com/comedy-show-new-york-tickets-7-10-2026/event/153000005/", "153000005"],
    ].map(([id, label, url, providerPageId]) =>
      exactProviderFixture({
        id,
        provider: "stubhub",
        label,
        url,
        providerPageId,
        matchedPattern: "stubhub_event",
      }),
    ),
    providerFixture({
      id: "stubhub-listing-sports",
      provider: "stubhub",
      kind: "listing",
      label: "StubHub sports listing page",
      url: "https://www.stubhub.com/sports-tickets/",
      pageType: "listing",
      providerPageId: "sports-tickets",
      matchedPattern: "stubhub_listing",
    }),
    providerFixture({
      id: "stubhub-search-query",
      provider: "stubhub",
      kind: "listing",
      label: "StubHub search query page",
      url: "https://www.stubhub.com/find/s/?q=olivia%20rodrigo",
      pageType: "listing",
      providerPageId: "find",
      matchedPattern: "stubhub_listing",
    }),
    nullFixture("stubhub-malformed-no-scheme", "stubhub", "StubHub URL without a scheme", "stubhub.com/bts-tickets/performer/1503185"),
    nullFixture("stubhub-malformed-ftp", "stubhub", "StubHub FTP URL is unsupported", "ftp://www.stubhub.com/bts-tickets/performer/1503185"),
    unknownFixture("stubhub-impersonation-suffix", "stubhub", "StubHub suffix impersonation host", "https://stubhub.com.evil.example/bts-tickets/performer/1503185"),
    unknownFixture("stubhub-impersonation-prefix", "stubhub", "StubHub prefix impersonation host", "https://notstubhub.com/bts-tickets/performer/1503185"),
  ];
}

function eventbriteFixtures(): ActivityProviderSkillUrlFixture[] {
  return [
    ...[
      ["eventbrite-event-nashville-jazz", "Nashville jazz event page", "https://www.eventbrite.com/e/nashville-jazz-night-tickets-123456789001", "123456789001"],
      ["eventbrite-event-food-festival", "Food festival event page", "https://www.eventbrite.com/e/east-nashville-food-festival-tickets-123456789002", "123456789002"],
      ["eventbrite-event-tech-meetup", "Tech meetup event page", "https://www.eventbrite.com/e/austin-ai-founder-meetup-tickets-123456789003", "123456789003"],
      ["eventbrite-event-comedy", "Comedy event page", "https://www.eventbrite.com/e/new-york-comedy-show-tickets-123456789004", "123456789004"],
      ["eventbrite-event-workshop", "Workshop event page", "https://www.eventbrite.com/e/watercolor-workshop-tickets-123456789005", "123456789005"],
      ["eventbrite-event-online-class", "Online class event page", "https://www.eventbrite.com/e/online-cooking-class-tickets-123456789006", "123456789006"],
    ].map(([id, label, url, providerPageId]) =>
      exactProviderFixture({
        id,
        provider: "eventbrite",
        label,
        url,
        providerPageId,
        matchedPattern: "eventbrite_event",
      }),
    ),
    ...[
      ["eventbrite-listing-nashville-music", "Nashville music listing", "https://www.eventbrite.com/d/tn--nashville/music/", "tn--nashville/music"],
      ["eventbrite-listing-la-food", "Los Angeles food listing", "https://www.eventbrite.com/d/ca--los-angeles/food-and-drink/", "ca--los-angeles/food-and-drink"],
      ["eventbrite-listing-nyc-business", "New York business listing", "https://www.eventbrite.com/d/ny--new-york/business/", "ny--new-york/business"],
      ["eventbrite-listing-online-events", "Online events listing", "https://www.eventbrite.com/d/online/events/", "online/events"],
      ["eventbrite-listing-atlanta-nightlife", "Atlanta nightlife listing", "https://www.eventbrite.com/d/ga--atlanta/nightlife/", "ga--atlanta/nightlife"],
    ].map(([id, label, url, providerPageId]) =>
      providerFixture({
        id,
        provider: "eventbrite",
        kind: "listing",
        label,
        url,
        pageType: "listing",
        providerPageId,
        matchedPattern: "eventbrite_city_category_listing",
      }),
    ),
    ...[
      ["eventbrite-organizer-symphony", "Organizer page", "https://www.eventbrite.com/o/nashville-symphony-12345678901", "12345678901"],
      ["eventbrite-organizer-food-hall", "Food hall organizer page", "https://www.eventbrite.com/o/east-side-food-hall-12345678902", "12345678902"],
      ["eventbrite-organizer-startup", "Startup organizer page", "https://www.eventbrite.com/o/founder-night-12345678903", "12345678903"],
    ].map(([id, label, url, providerPageId]) =>
      providerFixture({
        id,
        provider: "eventbrite",
        kind: "organizer",
        label,
        url,
        pageType: "listing",
        providerPageId,
        matchedPattern: "eventbrite_organizer",
      }),
    ),
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
      pageType: "listing",
      providerPageId: "online",
      matchedPattern: "eventbrite_city_category_listing",
    }),
    nullFixture("eventbrite-malformed-no-scheme", "eventbrite", "Eventbrite URL without a scheme", "eventbrite.com/e/nashville-jazz-night-tickets-123456789001"),
    nullFixture("eventbrite-malformed-javascript", "eventbrite", "Eventbrite JavaScript URL is unsupported", "javascript:https://www.eventbrite.com/e/nashville-jazz-night-tickets-123456789001"),
    unknownFixture("eventbrite-impersonation-suffix", "eventbrite", "Eventbrite suffix impersonation host", "https://eventbrite.com.evil.example/e/nashville-jazz-night-tickets-123456789001"),
    unknownFixture("eventbrite-impersonation-prefix", "eventbrite", "Eventbrite prefix impersonation host", "https://noteventbrite.com/e/nashville-jazz-night-tickets-123456789001"),
  ];
}

function axsFixtures(): ActivityProviderSkillUrlFixture[] {
  return [
    ...[
      ["axs-artist-taylor-swift", "Taylor Swift artist page", "https://www.axs.com/artists/123456/taylor-swift-tickets", "123456"],
      ["axs-artist-kacey-musgraves", "Kacey Musgraves artist page", "https://www.axs.com/artists/123457/kacey-musgraves-tickets", "123457"],
      ["axs-artist-billie-eilish", "Billie Eilish artist page", "https://www.axs.com/artists/123458/billie-eilish-tickets", "123458"],
      ["axs-artist-comedy", "Comedy artist page", "https://www.axs.com/artists/123459/comedy-night-tickets", "123459"],
      ["axs-artist-hamilton", "Hamilton artist page", "https://www.axs.com/artists/123460/hamilton-tickets", "123460"],
      ["axs-artist-soccer-club", "Soccer club artist page", "https://www.axs.com/artists/123461/nashville-sc-tickets", "123461"],
    ].map(([id, label, url, providerPageId]) =>
      providerFixture({
        id,
        provider: "axs",
        kind: "artist",
        label,
        url,
        pageType: "artist_or_performer",
        providerPageId,
        matchedPattern: "axs_artist",
      }),
    ),
    ...[
      ["axs-event-kacey-nashville", "Kacey Musgraves exact event", "https://www.axs.com/events/987650/kacey-musgraves-tickets", "987650"],
      ["axs-event-billie-la", "Billie Eilish exact event", "https://www.axs.com/events/987651/billie-eilish-los-angeles-tickets", "987651"],
      ["axs-event-hamilton", "Hamilton exact event", "https://www.axs.com/events/987652/hamilton-new-york-tickets", "987652"],
      ["axs-event-comedy", "Comedy exact event", "https://www.axs.com/events/987653/comedy-night-tickets", "987653"],
      ["axs-event-soccer", "Soccer exact event", "https://www.axs.com/events/987654/nashville-sc-tickets", "987654"],
      ["axs-event-festival", "Festival exact event", "https://www.axs.com/events/987655/summer-festival-tickets", "987655"],
    ].map(([id, label, url, providerPageId]) =>
      exactProviderFixture({
        id,
        provider: "axs",
        label,
        url,
        providerPageId,
        matchedPattern: "axs_event",
      }),
    ),
    providerFixture({
      id: "axs-listing-music",
      provider: "axs",
      kind: "listing",
      label: "AXS music listing page",
      url: "https://www.axs.com/browse/music",
      pageType: "listing",
      providerPageId: "browse",
      matchedPattern: "axs_listing",
    }),
    providerFixture({
      id: "axs-listing-sports",
      provider: "axs",
      kind: "listing",
      label: "AXS sports listing page",
      url: "https://www.axs.com/browse/sports",
      pageType: "listing",
      providerPageId: "browse",
      matchedPattern: "axs_listing",
    }),
    providerFixture({
      id: "axs-listing-venue",
      provider: "axs",
      kind: "listing",
      label: "AXS venue listing page",
      url: "https://www.axs.com/venues/1234/ryman-auditorium-tickets",
      pageType: "listing",
      providerPageId: "venues",
      matchedPattern: "axs_listing",
    }),
    providerFixture({
      id: "axs-listing-series",
      provider: "axs",
      kind: "grouping",
      label: "AXS series listing page",
      url: "https://www.axs.com/series/5678/summer-concert-series-tickets",
      pageType: "grouping",
      providerPageId: "5678",
      matchedPattern: "axs_series",
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
    nullFixture("axs-malformed-no-scheme", "axs", "AXS URL without a scheme", "axs.com/events/987650/kacey-musgraves-tickets"),
    nullFixture("axs-malformed-mailto", "axs", "AXS mailto URL is unsupported", "mailto:https://www.axs.com/events/987650/kacey-musgraves-tickets"),
    unknownFixture("axs-impersonation-suffix", "axs", "AXS suffix impersonation host", "https://axs.com.evil.example/events/987650/kacey-musgraves-tickets"),
    unknownFixture("axs-impersonation-prefix", "axs", "AXS prefix impersonation host", "https://notaxs.com/events/987650/kacey-musgraves-tickets"),
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
    outcome: "match",
    expected: {
      provider: input.provider,
      pageType: "exact_event",
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
      providerPageId: input.providerPageId,
      matchedPattern: input.matchedPattern,
    },
  };
}

function providerFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  kind: Exclude<ActivityProviderSkillFixtureKind, "exact_event" | "malformed" | "impersonation">;
  label: string;
  url: string;
  pageType: Exclude<ActivitySkillPageType, "exact_event" | "unknown_provider_page">;
  providerPageId: string;
  matchedPattern: string;
}): ActivityProviderSkillUrlFixture {
  return {
    id: input.id,
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    url: input.url,
    outcome: "match",
    expected: {
      provider: input.provider,
      pageType: input.pageType,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      providerPageId: input.providerPageId,
      matchedPattern: input.matchedPattern,
    },
  };
}

function nullFixture(
  id: string,
  provider: ActivityProviderSkillCorpusProvider,
  label: string,
  url: string,
): ActivityProviderSkillUrlFixture {
  return unresolvedFixture({
    id,
    provider,
    kind: "malformed",
    label,
    url,
    outcome: "null",
  });
}

function unknownFixture(
  id: string,
  provider: ActivityProviderSkillCorpusProvider,
  label: string,
  url: string,
): ActivityProviderSkillUrlFixture {
  return unresolvedFixture({
    id,
    provider,
    kind: "impersonation",
    label,
    url,
    outcome: "unknown",
  });
}

function unresolvedFixture(input: {
  id: string;
  provider: ActivityProviderSkillCorpusProvider;
  kind: "malformed" | "impersonation";
  label: string;
  url: string;
  outcome: "null" | "unknown";
}): ActivityProviderSkillUrlFixture {
  return {
    id: input.id,
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    url: input.url,
    outcome: input.outcome,
    expected: {
      provider: "unknown",
      pageType: "unknown_provider_page",
      executionMode: "review_capture",
      needsUserChoice: true,
      safeNextAction: "review_capture",
      matchedPattern: "unknown_host",
    },
  };
}
