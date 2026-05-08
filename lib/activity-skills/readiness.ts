import {
  ACTIVITY_PROVIDER_SKILLS,
  findActivityProviderSkill,
  isActivitySkillExactEvent,
  resolveActivityProviderSkillUrl,
} from "./registry";
import {
  ACTIVITY_SKILL_READINESS_FIXTURES,
  type ActivitySkillFixture,
  type ActivitySkillFixtureKind,
  type ActivitySkillReadinessOutcome,
  type ActivitySkillReadinessPageType,
} from "./readiness-fixtures";
import type {
  ActivityProviderSkill,
  ActivitySkillHardStop,
  ActivitySkillProvider,
  ActivitySkillResolvedProvider,
  ActivitySkillSafeNextAction,
} from "./types";

export type ActivitySkillReadiness = "green" | "yellow" | "red";

export type ActivitySkillReadinessMatch = {
  provider: ActivitySkillResolvedProvider;
  inputUrl: string;
  normalizedUrl?: string;
  host: string;
  hostTrusted: boolean;
  pageType: ActivitySkillReadinessPageType;
  confidence: number;
  needsUserChoice: boolean;
  outcome: ActivitySkillReadinessOutcome;
  safeNextAction: ActivitySkillSafeNextAction;
  hardStops: ActivitySkillHardStop[];
  patchProposalCandidate: boolean;
  exactEventReady: boolean;
  unsafeBoundaryViolation: boolean;
  wrongTargetRisk: boolean;
  evidence: {
    source: "url_pattern" | "review_gate";
    matchedPattern: string;
  };
};

export type ActivitySkillFixtureResult = {
  fixture: ActivitySkillFixture;
  match: ActivitySkillReadinessMatch;
  pass: boolean;
  failures: string[];
};

export type ActivitySkillProviderSummary = {
  provider: ActivitySkillProvider;
  registered: boolean;
  fixtureCount: number;
  exactEventReadyCount: number;
  listingNeedsChoiceCount: number;
  patchProposalCandidateCount: number;
  pageTypes: ActivitySkillReadinessPageType[];
  hardStops: ActivitySkillHardStop[];
};

export type ActivitySkillProviderCoverage = {
  requiredProviders: ActivitySkillProvider[];
  registeredProviders: ActivitySkillProvider[];
  providersWithFixtures: ActivitySkillProvider[];
  providersWithExactEventReady: ActivitySkillProvider[];
  missingProviders: ActivitySkillProvider[];
};

export type ActivitySkillReadinessSummary = {
  readiness: ActivitySkillReadiness;
  noLiveGatePass: boolean;
  totalFixtures: number;
  passedFixtures: number;
  failedFixtures: number;
  providerCoverage: {
    registered: number;
    required: number;
  };
  exactEventReadyCount: number;
  listingNeedsChoiceCount: number;
  unsafeBoundaryCount: number;
  wrongTargetCount: number;
  hostImpersonationEscapeCount: number;
  patchProposalCandidateCount: number;
  controlledLabRuns: number;
  byProvider: Record<ActivitySkillProvider, number>;
  byKind: Record<ActivitySkillFixtureKind, number>;
  gateErrors: string[];
};

export type ActivitySkillReadinessReport = {
  generatedAt: string;
  summary: ActivitySkillReadinessSummary;
  providerCoverage: ActivitySkillProviderCoverage;
  providerSummaries: ActivitySkillProviderSummary[];
  results: ActivitySkillFixtureResult[];
  notes: string[];
};

const GENERATED_AT = "2026-05-07T12:00:00.000Z";
const REQUIRED_PROVIDERS: ActivitySkillProvider[] = [
  "ticketmaster",
  "seatgeek",
  "stubhub",
  "eventbrite",
  "axs",
];
const REQUIRED_FIXTURE_COUNT = 100;
const REQUIRED_PATCH_PROPOSAL_CANDIDATES = 5;
const CONTROLLED_LAB_TARGET = 20;

export function buildActivitySkillReadinessReport(input: {
  fixtures?: ActivitySkillFixture[];
  skills?: ActivityProviderSkill[];
  controlledLabRuns?: number;
} = {}): ActivitySkillReadinessReport {
  const fixtures = input.fixtures ?? ACTIVITY_SKILL_READINESS_FIXTURES;
  const skills = input.skills ?? ACTIVITY_PROVIDER_SKILLS;
  const controlledLabRuns = input.controlledLabRuns ?? 0;
  const results = fixtures.map(evaluateActivitySkillFixture);
  const registeredProviders = skills.map((skill) => skill.provider);
  const providersWithFixtures = providerSet(
    fixtures.flatMap((fixture) => fixture.expected.provider === "unknown" ? [] : [fixture.expected.provider]),
  );
  const providersWithExactEventReady = providerSet(
    results.flatMap((result) =>
      result.match.exactEventReady && result.match.provider !== "unknown"
        ? [result.match.provider]
        : [],
    ),
  );
  const providerCoverage: ActivitySkillProviderCoverage = {
    requiredProviders: REQUIRED_PROVIDERS,
    registeredProviders: providerSet(registeredProviders),
    providersWithFixtures,
    providersWithExactEventReady,
    missingProviders: REQUIRED_PROVIDERS.filter((provider) => !registeredProviders.includes(provider)),
  };
  const summary = summarizeReadiness(results, providerCoverage, controlledLabRuns);
  return {
    generatedAt: GENERATED_AT,
    summary,
    providerCoverage,
    providerSummaries: summarizeProviders(results, skills),
    results,
    notes: [
      "Activity Skill Runtime readiness is no-live: it validates provider URL classification, safe next actions, and patch-proposal lanes only.",
      "A yellow readiness verdict is expected until controlled Browser Harness lab runs produce evidence artifacts.",
      "Listing, artist, performer, grouping, and search pages remain user-choice tasks; they must not be silently treated as exact events.",
      "Hard-stop boundaries are represented as contracts and must still be enforced by the controlled lab wrapper before production runtime wiring.",
    ],
  };
}

export function evaluateActivitySkillFixture(fixture: ActivitySkillFixture): ActivitySkillFixtureResult {
  const match = classifyActivitySkillReadinessInput(fixture.input, fixture.urls);
  const failures: string[] = [];
  const expected = fixture.expected;
  if (match.provider !== expected.provider) failures.push(`provider expected ${expected.provider}, got ${match.provider}`);
  if (match.pageType !== expected.pageType) failures.push(`page type expected ${expected.pageType}, got ${match.pageType}`);
  if (match.outcome !== expected.outcome) failures.push(`outcome expected ${expected.outcome}, got ${match.outcome}`);
  if (expected.safeNextAction !== undefined && match.safeNextAction !== expected.safeNextAction) {
    failures.push(`safe next action expected ${expected.safeNextAction}, got ${match.safeNextAction}`);
  }
  if (expected.needsUserChoice !== undefined && match.needsUserChoice !== expected.needsUserChoice) {
    failures.push(`needs user choice expected ${expected.needsUserChoice}, got ${match.needsUserChoice}`);
  }
  if (expected.exactEventReady !== undefined && match.exactEventReady !== expected.exactEventReady) {
    failures.push(`exact event ready expected ${expected.exactEventReady}, got ${match.exactEventReady}`);
  }
  if (expected.hostTrusted !== undefined && match.hostTrusted !== expected.hostTrusted) {
    failures.push(`host trusted expected ${expected.hostTrusted}, got ${match.hostTrusted}`);
  }
  if (expected.patchProposalCandidate !== undefined && match.patchProposalCandidate !== expected.patchProposalCandidate) {
    failures.push(
      `patch proposal candidate expected ${expected.patchProposalCandidate}, got ${match.patchProposalCandidate}`,
    );
  }
  if (fixture.kind === "impersonation" && match.hostTrusted) {
    failures.push("impersonation fixture escaped as trusted host");
  }
  if (match.provider !== "unknown" && match.hardStops.length < 8) {
    failures.push("registered provider match must carry all hard-stop boundaries");
  }
  return {
    fixture,
    match,
    pass: failures.length === 0,
    failures,
  };
}

export function classifyActivitySkillReadinessInput(
  input: string,
  urls?: readonly string[],
): ActivitySkillReadinessMatch {
  if (urls && urls.length > 1) {
    return reviewMatch({
      inputUrl: input,
      pageType: "multi_url_review",
      matchedPattern: "multiple_urls",
      confidence: 0.3,
      host: "",
    });
  }
  if (urls?.length === 1) return classifyActivitySkillReadinessUrl(urls[0]);
  return classifyActivitySkillReadinessUrl(input);
}

export function classifyActivitySkillReadinessUrl(input: string): ActivitySkillReadinessMatch {
  const resolved = resolveActivityProviderSkillUrl(input);
  if (!resolved) {
    return reviewMatch({
      inputUrl: input,
      pageType: "malformed_url",
      matchedPattern: "malformed_url",
      confidence: 0,
      host: "",
    });
  }
  if (resolved.provider === "unknown") {
    return reviewMatch({
      inputUrl: resolved.inputUrl,
      normalizedUrl: resolved.normalizedUrl,
      pageType: "unknown_provider_page",
      matchedPattern: resolved.evidence.matchedPattern,
      confidence: resolved.confidence,
      host: resolved.host,
      patchProposalCandidate: true,
    });
  }
  const skill = findActivityProviderSkill(resolved.provider);
  const exactEventReady = isActivitySkillExactEvent(resolved);
  const outcome: ActivitySkillReadinessOutcome = exactEventReady
    ? "exact_event_ready"
    : "provider_listing_needs_choice";
  return {
    provider: resolved.provider,
    inputUrl: resolved.inputUrl,
    normalizedUrl: resolved.normalizedUrl,
    host: resolved.host,
    hostTrusted: true,
    pageType: resolved.pageType,
    confidence: resolved.confidence,
    needsUserChoice: resolved.needsUserChoice,
    outcome,
    safeNextAction: resolved.safeNextAction,
    hardStops: [...(skill?.hardStops ?? [])],
    patchProposalCandidate: !exactEventReady,
    exactEventReady,
    unsafeBoundaryViolation: false,
    wrongTargetRisk: false,
    evidence: {
      source: "url_pattern",
      matchedPattern: resolved.evidence.matchedPattern,
    },
  };
}

export function renderActivitySkillReadinessMarkdown(report: ActivitySkillReadinessReport): string {
  const lines = [
    "# Activity Provider Skill Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Readiness: ${report.summary.readiness}`,
    `No-live gate: ${report.summary.noLiveGatePass ? "PASS" : "FAIL"}`,
    `Provider coverage: ${report.summary.providerCoverage.registered}/${report.summary.providerCoverage.required}`,
    `URL fixtures: ${report.summary.totalFixtures}`,
    `Exact-event ready: ${report.summary.exactEventReadyCount}`,
    `Listing needs choice: ${report.summary.listingNeedsChoiceCount}`,
    `Unsafe boundary: ${report.summary.unsafeBoundaryCount}`,
    `Wrong target: ${report.summary.wrongTargetCount}`,
    `Host impersonation escapes: ${report.summary.hostImpersonationEscapeCount}`,
    `Patch proposal candidates: ${report.summary.patchProposalCandidateCount}`,
    `Controlled lab runs: ${report.summary.controlledLabRuns}/${CONTROLLED_LAB_TARGET}`,
    "",
    "## Providers",
    "",
    "| Provider | Fixtures | Exact-ready | Needs choice | Patch candidates | Page types | Hard stops |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const provider of report.providerSummaries) {
    lines.push(
      `| \`${provider.provider}\` | ${provider.fixtureCount} | ${provider.exactEventReadyCount} | ${provider.listingNeedsChoiceCount} | ${provider.patchProposalCandidateCount} | ${provider.pageTypes.join(", ")} | ${provider.hardStops.join(", ")} |`,
    );
  }

  lines.push(
    "",
    "## Fixture Kinds",
    "",
    "| Kind | Count |",
    "| --- | ---: |",
  );
  for (const [kind, count] of Object.entries(report.summary.byKind)) {
    lines.push(`| \`${kind}\` | ${count} |`);
  }

  lines.push(
    "",
    "## Failed Fixtures",
    "",
  );
  const failed = report.results.filter((result) => !result.pass);
  if (failed.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| ID | Provider | Kind | Failures |", "| --- | --- | --- | --- |");
    for (const result of failed) {
      lines.push(
        `| \`${result.fixture.id}\` | \`${result.fixture.expected.provider}\` | \`${result.fixture.kind}\` | ${result.failures.join("; ")} |`,
      );
    }
  }

  lines.push("", "## Gate Errors", "");
  if (report.summary.gateErrors.length === 0) {
    lines.push("None.");
  } else {
    for (const error of report.summary.gateErrors) lines.push(`- ${error}`);
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}

function summarizeReadiness(
  results: ActivitySkillFixtureResult[],
  providerCoverage: ActivitySkillProviderCoverage,
  controlledLabRuns: number,
): ActivitySkillReadinessSummary {
  const byProvider = zeroProviderRecord();
  const byKind = zeroKindRecord();
  for (const result of results) {
    byKind[result.fixture.kind] += 1;
    const provider = result.fixture.expected.provider;
    if (provider !== "unknown") byProvider[provider] += 1;
  }
  const totalFixtures = results.length;
  const passedFixtures = results.filter((result) => result.pass).length;
  const failedFixtures = totalFixtures - passedFixtures;
  const exactEventReadyCount = results.filter((result) => result.match.exactEventReady).length;
  const listingNeedsChoiceCount = results.filter((result) => result.match.outcome === "provider_listing_needs_choice").length;
  const unsafeBoundaryCount = results.filter((result) => result.match.unsafeBoundaryViolation).length;
  const wrongTargetCount = results.filter((result) => result.match.wrongTargetRisk).length;
  const hostImpersonationEscapeCount = results.filter(
    (result) => result.fixture.kind === "impersonation" && result.match.hostTrusted,
  ).length;
  const patchProposalCandidateCount = results.filter((result) => result.match.patchProposalCandidate).length;
  const gateErrors = gateErrorsFor({
    totalFixtures,
    failedFixtures,
    providerCoverage,
    exactEventReadyCount,
    unsafeBoundaryCount,
    wrongTargetCount,
    hostImpersonationEscapeCount,
    patchProposalCandidateCount,
  });
  const noLiveGatePass = gateErrors.length === 0;
  return {
    readiness: noLiveGatePass ? "yellow" : "red",
    noLiveGatePass,
    totalFixtures,
    passedFixtures,
    failedFixtures,
    providerCoverage: {
      registered: providerCoverage.registeredProviders.length,
      required: providerCoverage.requiredProviders.length,
    },
    exactEventReadyCount,
    listingNeedsChoiceCount,
    unsafeBoundaryCount,
    wrongTargetCount,
    hostImpersonationEscapeCount,
    patchProposalCandidateCount,
    controlledLabRuns,
    byProvider,
    byKind,
    gateErrors,
  };
}

function summarizeProviders(
  results: ActivitySkillFixtureResult[],
  skills: ActivityProviderSkill[],
): ActivitySkillProviderSummary[] {
  return REQUIRED_PROVIDERS.map((provider) => {
    const skill = skills.find((candidate) => candidate.provider === provider);
    const providerResults = results.filter((result) => result.fixture.expected.provider === provider);
    return {
      provider,
      registered: Boolean(skill),
      fixtureCount: providerResults.length,
      exactEventReadyCount: providerResults.filter((result) => result.match.exactEventReady).length,
      listingNeedsChoiceCount: providerResults.filter((result) => result.match.outcome === "provider_listing_needs_choice").length,
      patchProposalCandidateCount: providerResults.filter((result) => result.match.patchProposalCandidate).length,
      pageTypes: skill?.pageTypes ?? [],
      hardStops: skill?.hardStops ?? [],
    };
  });
}

function gateErrorsFor(input: {
  totalFixtures: number;
  failedFixtures: number;
  providerCoverage: ActivitySkillProviderCoverage;
  exactEventReadyCount: number;
  unsafeBoundaryCount: number;
  wrongTargetCount: number;
  hostImpersonationEscapeCount: number;
  patchProposalCandidateCount: number;
}): string[] {
  const errors: string[] = [];
  if (input.failedFixtures > 0) errors.push(`${input.failedFixtures} activity skill fixture(s) failed.`);
  if (input.totalFixtures < REQUIRED_FIXTURE_COUNT) {
    errors.push(`Expected at least ${REQUIRED_FIXTURE_COUNT} URL fixtures, got ${input.totalFixtures}.`);
  }
  if (input.providerCoverage.missingProviders.length > 0) {
    errors.push(`Missing provider skill(s): ${input.providerCoverage.missingProviders.join(", ")}.`);
  }
  for (const provider of REQUIRED_PROVIDERS) {
    if (!input.providerCoverage.providersWithFixtures.includes(provider)) {
      errors.push(`Missing fixtures for ${provider}.`);
    }
  }
  if (input.exactEventReadyCount < 20) {
    errors.push(`Expected at least 20 exact-event ready fixtures, got ${input.exactEventReadyCount}.`);
  }
  if (input.unsafeBoundaryCount > 0) errors.push(`${input.unsafeBoundaryCount} unsafe boundary fixture(s) escaped.`);
  if (input.wrongTargetCount > 0) errors.push(`${input.wrongTargetCount} wrong-target fixture(s) escaped.`);
  if (input.hostImpersonationEscapeCount > 0) {
    errors.push(`${input.hostImpersonationEscapeCount} host impersonation fixture(s) escaped.`);
  }
  if (input.patchProposalCandidateCount < REQUIRED_PATCH_PROPOSAL_CANDIDATES) {
    errors.push(`Expected at least ${REQUIRED_PATCH_PROPOSAL_CANDIDATES} patch-proposal candidates, got ${input.patchProposalCandidateCount}.`);
  }
  return errors;
}

function reviewMatch(input: {
  inputUrl: string;
  pageType: "malformed_url" | "multi_url_review" | "unknown_provider_page";
  matchedPattern: string;
  confidence: number;
  host: string;
  normalizedUrl?: string;
  patchProposalCandidate?: boolean;
}): ActivitySkillReadinessMatch {
  return {
    provider: "unknown",
    inputUrl: input.inputUrl,
    ...(input.normalizedUrl ? { normalizedUrl: input.normalizedUrl } : {}),
    host: input.host,
    hostTrusted: false,
    pageType: input.pageType,
    confidence: input.confidence,
    needsUserChoice: true,
    outcome: "review_required",
    safeNextAction: "review_capture",
    hardStops: [],
    patchProposalCandidate: input.patchProposalCandidate ?? false,
    exactEventReady: false,
    unsafeBoundaryViolation: false,
    wrongTargetRisk: false,
    evidence: {
      source: "review_gate",
      matchedPattern: input.matchedPattern,
    },
  };
}

function zeroProviderRecord(): Record<ActivitySkillProvider, number> {
  return {
    ticketmaster: 0,
    seatgeek: 0,
    stubhub: 0,
    eventbrite: 0,
    axs: 0,
  };
}

function zeroKindRecord(): Record<ActivitySkillFixtureKind, number> {
  return {
    exact_event: 0,
    artist_or_performer: 0,
    listing_or_search: 0,
    grouping: 0,
    unknown_provider_page: 0,
    impersonation: 0,
    malformed_url: 0,
    multi_url_review: 0,
    hard_stop_boundary: 0,
  };
}

function providerSet(providers: readonly ActivitySkillProvider[]): ActivitySkillProvider[] {
  return REQUIRED_PROVIDERS.filter((provider) => providers.includes(provider));
}
