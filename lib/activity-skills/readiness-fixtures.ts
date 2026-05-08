import type {
  ActivitySkillOutcome,
  ActivitySkillPageType,
  ActivitySkillProvider,
  ActivitySkillResolvedProvider,
  ActivitySkillSafeNextAction,
} from "./types";

export type ActivitySkillReadinessPageType =
  | ActivitySkillPageType
  | "malformed_url"
  | "multi_url_review";

export type ActivitySkillReadinessOutcome = ActivitySkillOutcome | "review_required";

export type ActivitySkillFixtureKind =
  | "exact_event"
  | "artist_or_performer"
  | "listing_or_search"
  | "grouping"
  | "unknown_provider_page"
  | "impersonation"
  | "malformed_url"
  | "multi_url_review"
  | "hard_stop_boundary";

export interface ActivitySkillFixtureExpected {
  provider: ActivitySkillResolvedProvider;
  pageType: ActivitySkillReadinessPageType;
  outcome: ActivitySkillReadinessOutcome;
  hostTrusted: boolean;
  needsUserChoice: boolean;
  exactEventReady: boolean;
  safeNextAction?: ActivitySkillSafeNextAction;
  patchProposalCandidate?: boolean;
}

export interface ActivitySkillFixture {
  id: string;
  kind: ActivitySkillFixtureKind;
  provider?: ActivitySkillProvider;
  input: string;
  urls?: readonly string[];
  description: string;
  expected: ActivitySkillFixtureExpected;
}

type ProviderFixtureSeed = {
  id: string;
  url: string;
  pageType: ActivitySkillPageType;
  description: string;
  patchProposalCandidate?: boolean;
};

const exactEventSeeds: Partial<Record<ActivitySkillProvider, readonly ProviderFixtureSeed[]>> = {
  ticketmaster: [
    event("tm-nashville-sc", "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85"),
    event("tm-sabrina", "https://www.ticketmaster.com/sabrina-carpenter-short-n-sweet-tour-los-angeles-california-06-14-2026/event/09006372A2C92144"),
    event("tm-uswnt", "https://www.ticketmaster.com/us-womens-national-team-v-canada-chicago-illinois-07-01-2026/event/04006373B2184A1D"),
    event("tm-hamilton", "https://www.ticketmaster.com/hamilton-new-york-new-york-08-20-2026/event/30006374C9235BC1"),
    event("tm-comedy", "https://www.ticketmaster.com/ali-wong-live-san-francisco-california-09-10-2026/event/1C006375DD774A44"),
    event("tm-nba", "https://www.ticketmaster.com/golden-state-warriors-v-lakers-san-francisco-california-10-12-2026/event/1D006376AA994B10"),
    event("tm-broadway", "https://www.ticketmaster.com/wicked-touring-company-austin-texas-11-19-2026/event/3A0063779CE84CC9"),
    event("tm-festival", "https://www.ticketmaster.com/austin-city-limits-music-festival-austin-texas-10-03-2026/event/0C006378DD884A21"),
  ],
  seatgeek: [
    event("sg-nashville-sc", "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493"),
    event("sg-chris-stapleton", "https://seatgeek.com/chris-stapleton-tickets/nashville-tennessee-nissan-stadium-2026-05-23-6-pm/concert/17990981"),
    event("sg-hamilton", "https://seatgeek.com/hamilton-tickets/new-york-new-york-richard-rodgers-theatre-2026-06-18-7-pm/theater/18222001"),
    event("sg-austin-fc", "https://seatgeek.com/austin-fc-tickets/mls/2026-07-04-7-pm/18333002"),
    event("sg-jazz-festival", "https://seatgeek.com/newport-jazz-festival-tickets/newport-rhode-island-2026-08-02-11-am/festival/18444003"),
    event("sg-standup", "https://seatgeek.com/john-mulaney-tickets/chicago-illinois-2026-09-09-8-pm/comedy/18555004"),
    event("sg-baseball", "https://seatgeek.com/new-york-mets-tickets/mlb/2026-06-12-7-pm/18666005"),
    event("sg-opera", "https://seatgeek.com/the-magic-flute-tickets/san-francisco-california-war-memorial-opera-house-2026-12-01-7-pm/opera/18777006"),
  ],
  eventbrite: [
    event("eb-food-festival", "https://www.eventbrite.com/e/nashville-food-festival-tickets-123456789012"),
    event("eb-tech-meetup", "https://www.eventbrite.com/e/austin-ai-builder-night-tickets-223456789012"),
    event("eb-wine-walk", "https://www.eventbrite.com/e/sonoma-wine-walk-tickets-323456789012"),
    event("eb-museum-after-hours", "https://www.eventbrite.com/e/museum-after-hours-chicago-tickets-423456789012"),
    event("eb-running-club", "https://www.eventbrite.com/e/brooklyn-evening-running-club-tickets-523456789012"),
    event("eb-comedy-open-mic", "https://www.eventbrite.com/e/comedy-open-mic-night-tickets-623456789012"),
    event("eb-kids-workshop", "https://www.eventbrite.com/e/family-art-workshop-tickets-723456789012"),
    event("eb-founder-dinner", "https://www.eventbrite.com/e/founder-dinner-series-tickets-823456789012"),
  ],
  axs: [
    event("axs-red-rocks", "https://www.axs.com/events/901001/red-rocks-summer-night-tickets"),
    event("axs-staples", "https://www.axs.com/events/901002/los-angeles-arena-show-tickets"),
    event("axs-comedy", "https://www.axs.com/events/901003/late-night-comedy-tickets"),
    event("axs-theater", "https://www.axs.com/events/901004/broadway-tour-stop-tickets"),
    event("axs-soccer", "https://www.axs.com/events/901005/international-friendly-tickets"),
    event("axs-edm", "https://www.axs.com/events/901006/dance-festival-afterparty-tickets"),
    event("axs-hockey", "https://www.axs.com/events/901007/hockey-home-opener-tickets"),
    event("axs-classical", "https://www.axs.com/events/901008/philharmonic-evening-tickets"),
  ],
};

const artistOrPerformerSeeds: Partial<Record<ActivitySkillProvider, readonly ProviderFixtureSeed[]>> = {
  ticketmaster: [
    artist("tm-artist-kacey", "https://www.ticketmaster.com/kacey-musgraves-tickets/artist/1668663"),
    artist("tm-artist-bts", "https://www.ticketmaster.com/bts-tickets/artist/2110227"),
    artist("tm-artist-hamilton", "https://www.ticketmaster.com/hamilton-tickets/artist/2075525"),
    artist("tm-artist-nba", "https://www.ticketmaster.com/nba-playoffs-tickets/artist/805970"),
    artist("tm-artist-disney", "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/805992"),
    artist("tm-artist-comedy", "https://www.ticketmaster.com/ali-wong-tickets/artist/2071438"),
  ],
  stubhub: [
    artist("sh-performer-bts", "https://www.stubhub.com/bts-tickets/performer/1503185"),
    artist("sh-performer-swift", "https://www.stubhub.com/taylor-swift-tickets/performer/136034"),
    artist("sh-performer-yankees", "https://www.stubhub.com/new-york-yankees-tickets/performer/5649"),
    artist("sh-performer-hamilton", "https://www.stubhub.com/hamilton-new-york-tickets/performer/1508579"),
    artist("sh-performer-comedy", "https://www.stubhub.com/john-mulaney-tickets/performer/722517"),
    artist("sh-performer-soccer", "https://www.stubhub.com/uswnt-tickets/performer/1499869"),
    artist("sh-performer-opera", "https://www.stubhub.com/metropolitan-opera-tickets/performer/149437"),
    artist("sh-performer-festival", "https://www.stubhub.com/coachella-tickets/performer/7132"),
  ],
  axs: [
    artist("axs-artist-foo", "https://www.axs.com/artists/110001/foo-fighters-tickets"),
    artist("axs-artist-cure", "https://www.axs.com/artists/110002/the-cure-tickets"),
    artist("axs-artist-comedy", "https://www.axs.com/artists/110003/comedy-collective-tickets"),
    artist("axs-artist-lakers", "https://www.axs.com/artists/110004/los-angeles-basketball-tickets"),
    artist("axs-artist-ballet", "https://www.axs.com/artists/110005/city-ballet-tickets"),
    artist("axs-artist-country", "https://www.axs.com/artists/110006/country-night-tickets"),
  ],
};

const listingOrSearchSeeds: Record<ActivitySkillProvider, readonly ProviderFixtureSeed[]> = {
  ticketmaster: [
    listing("tm-search-sabrina", "https://www.ticketmaster.com/search?q=sabrina%20carpenter", "search_results"),
    listing("tm-search-soccer", "https://www.ticketmaster.com/search?q=nashville%20sc", "search_results"),
    listing("tm-listing-concerts", "https://www.ticketmaster.com/concerts", "listing"),
    listing("tm-listing-sports", "https://www.ticketmaster.com/sports", "listing"),
    listing("tm-listing-venue", "https://www.ticketmaster.com/bridgestone-arena-tickets-nashville/venue/221997", "listing"),
    listing("tm-listing-broadway", "https://www.ticketmaster.com/broadway", "listing"),
    listing("tm-listing-comedy", "https://www.ticketmaster.com/comedy", "listing"),
    listing("tm-listing-family", "https://www.ticketmaster.com/family", "listing"),
  ],
  seatgeek: [
    listing("sg-listing-hamilton", "https://seatgeek.com/hamilton-tickets", "listing"),
    listing("sg-listing-mets", "https://seatgeek.com/new-york-mets-tickets", "listing"),
    listing("sg-listing-nashville", "https://seatgeek.com/nashville-sc-tickets", "listing"),
    listing("sg-listing-comedy", "https://seatgeek.com/comedy-tickets", "listing"),
    listing("sg-listing-red-rocks", "https://seatgeek.com/red-rocks-amphitheatre-tickets", "listing"),
    listing("sg-listing-broadway", "https://seatgeek.com/broadway-tickets", "listing"),
    listing("sg-listing-festival", "https://seatgeek.com/music-festival-tickets", "listing"),
    listing("sg-listing-theater", "https://seatgeek.com/theater-tickets", "listing"),
  ],
  stubhub: [
    listing("sh-listing-broadway", "https://www.stubhub.com/broadway-tickets/category/136236", "listing"),
    listing("sh-listing-concerts", "https://www.stubhub.com/concert-tickets/category/1", "listing"),
    listing("sh-listing-sports", "https://www.stubhub.com/sports-tickets/category/28", "listing"),
    listing("sh-listing-theater", "https://www.stubhub.com/theater-tickets/category/174", "listing"),
    listing("sh-listing-las-vegas", "https://www.stubhub.com/las-vegas-tickets/geography/681", "listing"),
    listing("sh-listing-paris", "https://www.stubhub.com/paris-tickets/geography/238", "listing"),
    listing("sh-listing-austin", "https://www.stubhub.com/austin-tickets/geography/637", "listing"),
    listing("sh-listing-chicago", "https://www.stubhub.com/chicago-tickets/geography/656", "listing"),
  ],
  eventbrite: [
    listing("eb-listing-nashville", "https://www.eventbrite.com/d/tn--nashville/music--events/", "listing"),
    listing("eb-listing-austin", "https://www.eventbrite.com/d/tx--austin/business--events/", "listing"),
    listing("eb-listing-online", "https://www.eventbrite.com/d/online/workshop--events/", "listing"),
    listing("eb-listing-new-york", "https://www.eventbrite.com/d/ny--new-york/food-and-drink--events/", "listing"),
    listing("eb-listing-san-francisco", "https://www.eventbrite.com/d/ca--san-francisco/tech--events/", "listing"),
    listing("eb-listing-chicago", "https://www.eventbrite.com/d/il--chicago/free--events/", "listing"),
    listing("eb-listing-denver", "https://www.eventbrite.com/d/co--denver/sports-and-fitness--events/", "listing"),
    listing("eb-listing-seattle", "https://www.eventbrite.com/d/wa--seattle/arts--events/", "listing"),
  ],
  axs: [
    listing("axs-search-red-rocks", "https://www.axs.com/search?q=red%20rocks", "search_results"),
    listing("axs-search-comedy", "https://www.axs.com/search?q=comedy", "search_results"),
    listing("axs-listing-music", "https://www.axs.com/music", "listing"),
    listing("axs-listing-sports", "https://www.axs.com/sports", "listing"),
    listing("axs-listing-theater", "https://www.axs.com/theater", "listing"),
    listing("axs-listing-las-vegas", "https://www.axs.com/las-vegas", "listing"),
    listing("axs-listing-denver", "https://www.axs.com/denver", "listing"),
    listing("axs-listing-los-angeles", "https://www.axs.com/los-angeles", "listing"),
  ],
};

const groupingSeeds: Partial<Record<ActivitySkillProvider, readonly ProviderFixtureSeed[]>> = {
  stubhub: [
    grouping("sh-grouping-world-cup", "https://www.stubhub.com/world-cup-tickets/grouping/45410"),
    grouping("sh-grouping-nba-playoffs", "https://www.stubhub.com/nba-playoffs-tickets/grouping/107517"),
    grouping("sh-grouping-mlb", "https://www.stubhub.com/mlb-playoffs-tickets/grouping/436"),
    grouping("sh-grouping-wimbledon", "https://www.stubhub.com/wimbledon-tickets/grouping/112"),
    grouping("sh-grouping-olympics", "https://www.stubhub.com/olympic-games-tickets/grouping/88331"),
    grouping("sh-grouping-bowl", "https://www.stubhub.com/college-football-bowl-games-tickets/grouping/4878"),
    grouping("sh-grouping-music-fest", "https://www.stubhub.com/music-festival-tickets/grouping/86155"),
    grouping("sh-grouping-formula-one", "https://www.stubhub.com/formula-1-tickets/grouping/6936"),
  ],
  axs: [
    grouping("axs-series-summer", "https://www.axs.com/series/770001/summer-concert-series"),
    grouping("axs-series-comedy", "https://www.axs.com/series/770002/comedy-residency"),
    grouping("axs-series-hockey", "https://www.axs.com/series/770003/home-game-series"),
    grouping("axs-series-theater", "https://www.axs.com/series/770004/theater-season"),
    grouping("axs-series-dance", "https://www.axs.com/series/770005/dance-weekend"),
    grouping("axs-series-family", "https://www.axs.com/series/770006/family-matinee-series"),
  ],
};

const unknownProviderFixtures: readonly ActivitySkillFixture[] = [
  unknown("unknown-livenation", "https://www.livenation.com/event/G5eVZ9some-event"),
  unknown("unknown-vividseats", "https://www.vividseats.com/hamilton-tickets/performer/148785"),
  unknown("unknown-tixr", "https://www.tixr.com/groups/local/events/night-market-101"),
  unknown("unknown-dice", "https://dice.fm/event/abc123-late-night-show"),
  unknown("unknown-fever", "https://feverup.com/m/123456"),
  unknown("unknown-goldstar", "https://www.goldstar.com/events/chicago-il/comedy-night"),
  unknown("unknown-universe", "https://www.universe.com/events/founder-dinner-tickets"),
  unknown("unknown-venue", "https://events.examplevenue.com/e/summer-night"),
];

const impersonationFixtures: readonly ActivitySkillFixture[] = [
  impersonation("imp-ticketmaster-dot-evil", "https://ticketmaster.com.evil.example/event/abc"),
  impersonation("imp-ticketmaster-hyphen", "https://ticketmaster.com-secure.example/event/1B0063739937BB85"),
  impersonation("imp-seatgeek-dot-evil", "https://seatgeek.com.evil.example/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493"),
  impersonation("imp-seatgeek-login", "https://secure-seatgeek.com.example/hamilton-tickets"),
  impersonation("imp-stubhub-dot-evil", "https://stubhub.com.evil.example/bts-tickets/performer/1503185"),
  impersonation("imp-stubhub-support", "https://support-stubhub.com.example/world-cup-tickets/grouping/45410"),
  impersonation("imp-eventbrite-dot-evil", "https://eventbrite.com.evil.example/e/fake-tickets-123456789012"),
  impersonation("imp-eventbrite-login", "https://login-eventbrite.com.example/e/fake-tickets-123456789012"),
  impersonation("imp-axs-dot-evil", "https://axs.com.evil.example/events/901001/red-rocks"),
  impersonation("imp-axs-secure", "https://secure-axs.com.example/events/901002/fake-show"),
];

const malformedFixtures: readonly ActivitySkillFixture[] = [
  malformed("bad-empty", ""),
  malformed("bad-words", "ticketmaster event 1B0063739937BB85"),
  malformed("bad-relative", "/events/901001/red-rocks"),
  malformed("bad-protocol", "ftp://ticketmaster.com/event/1B0063739937BB85"),
  malformed("bad-space", "https://www.ticketmaster .com/event/abc"),
  malformed("bad-json", "{\"url\":\"https://www.axs.com/events/901001\"}"),
  malformed("bad-mailto", "mailto:tickets@example.com"),
  malformed("bad-local-file", "file:///tmp/provider.html"),
];

const multiUrlFixtures: readonly ActivitySkillFixture[] = [
  multi("multi-ticketmaster-two-events", [
    "https://www.ticketmaster.com/event/1B0063739937BB85",
    "https://www.ticketmaster.com/event/1B0063739937BB86",
  ]),
  multi("multi-ticketmaster-seatgeek", [
    "https://www.ticketmaster.com/event/1B0063739937BB85",
    "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
  ]),
  multi("multi-stubhub-performer-grouping", [
    "https://www.stubhub.com/bts-tickets/performer/1503185",
    "https://www.stubhub.com/world-cup-tickets/grouping/45410",
  ]),
  multi("multi-eventbrite-two", [
    "https://www.eventbrite.com/e/nashville-food-festival-tickets-123456789012",
    "https://www.eventbrite.com/d/tn--nashville/music--events/",
  ]),
  multi("multi-axs-event-artist", [
    "https://www.axs.com/events/901001/red-rocks-summer-night-tickets",
    "https://www.axs.com/artists/110001/foo-fighters-tickets",
  ]),
  multi("multi-known-unknown", [
    "https://www.ticketmaster.com/event/1B0063739937BB85",
    "https://events.examplevenue.com/e/summer-night",
  ]),
  multi("multi-three-providers", [
    "https://www.axs.com/events/901004/broadway-tour-stop-tickets",
    "https://seatgeek.com/hamilton-tickets",
    "https://www.stubhub.com/hamilton-new-york-tickets/performer/1508579",
  ]),
  multi("multi-listing-review", [
    "https://www.eventbrite.com/d/tx--austin/business--events/",
    "https://www.ticketmaster.com/search?q=austin%20events",
  ]),
];

const hardStopBoundaryFixtures: readonly ActivitySkillFixture[] = [
  hardStop("hard-stop-ticketmaster-checkout", "ticketmaster", "https://www.ticketmaster.com/checkout"),
  hardStop("hard-stop-seatgeek-account", "seatgeek", "https://seatgeek.com/account"),
  hardStop("hard-stop-stubhub-login", "stubhub", "https://www.stubhub.com/login"),
  hardStop("hard-stop-eventbrite-signin", "eventbrite", "https://www.eventbrite.com/signin"),
  hardStop("hard-stop-axs-account", "axs", "https://www.axs.com/account"),
];

export const ACTIVITY_SKILL_READINESS_FIXTURES: readonly ActivitySkillFixture[] = [
  ...providerFixtures("exact_event", exactEventSeeds, "exact_event_ready", false, true),
  ...providerFixtures("artist_or_performer", artistOrPerformerSeeds, "provider_listing_needs_choice", true, false),
  ...providerFixtures("listing_or_search", listingOrSearchSeeds, "provider_listing_needs_choice", true, false),
  ...providerFixtures("grouping", groupingSeeds, "provider_listing_needs_choice", true, false),
  ...unknownProviderFixtures,
  ...impersonationFixtures,
  ...malformedFixtures,
  ...multiUrlFixtures,
  ...hardStopBoundaryFixtures,
];

function providerFixtures(
  kind: ActivitySkillFixtureKind,
  seedsByProvider: Partial<Record<ActivitySkillProvider, readonly ProviderFixtureSeed[]>>,
  outcome: ActivitySkillReadinessOutcome,
  needsUserChoice: boolean,
  exactEventReady: boolean,
): ActivitySkillFixture[] {
  return Object.entries(seedsByProvider).flatMap(([provider, seeds]) =>
    (seeds ?? []).map((seed) => ({
      id: seed.id,
      kind,
      provider: provider as ActivitySkillProvider,
      input: seed.url,
      description: seed.description,
      expected: {
        provider: provider as ActivitySkillProvider,
        pageType: seed.pageType,
        outcome,
        hostTrusted: true,
        needsUserChoice,
        exactEventReady,
        ...(seed.patchProposalCandidate ? { patchProposalCandidate: true } : {}),
      },
    })),
  );
}

function event(id: string, url: string): ProviderFixtureSeed {
  return {
    id,
    url,
    description: "Exact event URL should be ready only when the provider pattern uniquely identifies one event.",
    pageType: "exact_event",
  };
}

function artist(id: string, url: string): ProviderFixtureSeed {
  return {
    id,
    url,
    description: "Artist or performer URL aggregates candidate events and must ask the user to choose.",
    pageType: "artist_or_performer",
    patchProposalCandidate: true,
  };
}

function listing(
  id: string,
  url: string,
  pageType: Extract<ActivitySkillPageType, "listing" | "search_results">,
): ProviderFixtureSeed {
  return {
    id,
    url,
    description: "Listing or search URL must not be promoted to exact event evidence without visible single-candidate proof.",
    pageType,
    patchProposalCandidate: true,
  };
}

function grouping(id: string, url: string): ProviderFixtureSeed {
  return {
    id,
    url,
    description: "Grouping URL aggregates dates or cities and must pause for user choice.",
    pageType: "grouping",
    patchProposalCandidate: true,
  };
}

function unknown(id: string, input: string): ActivitySkillFixture {
  return reviewFixture(id, "unknown_provider_page", input, "unknown_provider_page", "Unknown activity provider host must route to review.");
}

function impersonation(id: string, input: string): ActivitySkillFixture {
  return reviewFixture(id, "impersonation", input, "unknown_provider_page", "Provider host impersonation must not escape into trusted skill handling.");
}

function malformed(id: string, input: string): ActivitySkillFixture {
  return reviewFixture(id, "malformed_url", input, "malformed_url", "Malformed or unsupported URL input must route to review.");
}

function multi(id: string, urls: readonly string[]): ActivitySkillFixture {
  return {
    id,
    kind: "multi_url_review",
    input: urls.join("\n"),
    urls,
    description: "Multi-URL submissions require review before one provider target is selected.",
    expected: {
      provider: "unknown",
      pageType: "multi_url_review",
      outcome: "review_required",
      hostTrusted: false,
      needsUserChoice: true,
      exactEventReady: false,
    },
  };
}

function hardStop(
  id: string,
  provider: ActivitySkillProvider,
  input: string,
): ActivitySkillFixture {
  return {
    id,
    kind: "hard_stop_boundary",
    provider,
    input,
    description: "Account, checkout, or login-like provider paths must keep hard stops declared and stay non-exact.",
    expected: {
      provider,
      pageType: "listing",
      outcome: "provider_listing_needs_choice",
      hostTrusted: true,
      needsUserChoice: true,
      exactEventReady: false,
      patchProposalCandidate: true,
    },
  };
}

function reviewFixture(
  id: string,
  kind: Extract<ActivitySkillFixtureKind, "unknown_provider_page" | "impersonation" | "malformed_url">,
  input: string,
  pageType: Extract<ActivitySkillReadinessPageType, "unknown_provider_page" | "malformed_url">,
  description: string,
): ActivitySkillFixture {
  return {
    id,
    kind,
    input,
    description,
    expected: {
      provider: "unknown",
      pageType,
      outcome: "review_required",
      hostTrusted: false,
      needsUserChoice: true,
      exactEventReady: false,
      patchProposalCandidate: pageType === "unknown_provider_page",
    },
  };
}
