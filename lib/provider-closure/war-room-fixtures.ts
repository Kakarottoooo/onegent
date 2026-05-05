import type {
  ProviderClosureVertical,
  ProviderClosureWarRoomBundle,
  ProviderClosureWarRoomVerdict,
} from "./war-room";

interface WarRoomFixtureSpec {
  vertical: ProviderClosureVertical;
  fixtureClass:
    | "safe_boundary"
    | "provider_network"
    | "selector_dom"
    | "model_env"
    | "not_live"
    | "unsafe_boundary"
    | "stale_evidence";
  provider: string;
  status: string;
  workerLogExcerpt: string;
  expectedVerdict: ProviderClosureWarRoomVerdict;
  liveAttempt?: boolean;
  capturedAt?: string;
}

export interface ProviderClosureWarRoomSyntheticFixture
  extends ProviderClosureWarRoomBundle {
  vertical: ProviderClosureVertical;
  fixtureId: string;
  expectedVerdict: ProviderClosureWarRoomVerdict;
}

const FRESH_CAPTURED_AT = "2026-05-04T20:00:00.000Z";
const STALE_CAPTURED_AT = "2026-01-01T00:00:00.000Z";

const SPECS: readonly WarRoomFixtureSpec[] = [
  {
    vertical: "restaurant",
    fixtureClass: "safe_boundary",
    provider: "opentable",
    status: "ready_for_confirmation",
    workerLogExcerpt:
      "[opentable] ready_for_confirmation; manual review reached; safe handoff; stopped before final confirmation.",
    expectedVerdict: "live_closed_safe_boundary",
  },
  {
    vertical: "restaurant",
    fixtureClass: "provider_network",
    provider: "resy",
    status: "failed",
    workerLogExcerpt:
      "[resy] provider unavailable: HTTP 503 response while opening reservation modal; net::ERR_HTTP_RESPONSE_CODE_FAILURE.",
    expectedVerdict: "live_blocked_provider_or_network",
  },
  {
    vertical: "restaurant",
    fixtureClass: "selector_dom",
    provider: "resy",
    status: "failed",
    workerLogExcerpt:
      "[resy] reservation modal disabled; venue details API failed; reserve button not enabled for target slot.",
    expectedVerdict: "live_blocked_selector_or_dom",
  },
  {
    vertical: "restaurant",
    fixtureClass: "model_env",
    provider: "resy",
    status: "failed",
    workerLogExcerpt:
      "OpenAI Responses API 500: upstream model worker unavailable during Computer Use turn.",
    expectedVerdict: "live_blocked_model_or_env",
  },
  {
    vertical: "restaurant",
    fixtureClass: "not_live",
    provider: "opentable",
    status: "ready_for_confirmation",
    workerLogExcerpt:
      "[opentable] ready_for_confirmation; manual review reached; synthetic not-live fixture.",
    expectedVerdict: "not_live_verified",
    liveAttempt: false,
  },
  {
    vertical: "restaurant",
    fixtureClass: "unsafe_boundary",
    provider: "opentable",
    status: "failed",
    workerLogExcerpt:
      "[opentable] automation clicked final reservation confirmation button after review screen.",
    expectedVerdict: "unsafe_or_disallowed_boundary",
  },
  {
    vertical: "flight",
    fixtureClass: "safe_boundary",
    provider: "expedia",
    status: "manual_review",
    workerLogExcerpt:
      "[flight-rpa] Checkout reached; payment wall visible; manual review; safe handoff; stopped before payment.",
    expectedVerdict: "live_closed_safe_boundary",
  },
  {
    vertical: "flight",
    fixtureClass: "provider_network",
    provider: "expedia",
    status: "failed",
    workerLogExcerpt:
      "[flight-rpa] Expedia provider unavailable: HTTP 503 response while loading Flights-Search; net::ERR_HTTP_RESPONSE_CODE_FAILURE.",
    expectedVerdict: "live_blocked_provider_or_network",
  },
  {
    vertical: "flight",
    fixtureClass: "selector_dom",
    provider: "expedia",
    status: "failed",
    workerLogExcerpt:
      "[flight-rpa] Flight-card DOM scan failed. Trying locator fallback for flight-card scan. Locator fallback matched flight card. flight checkout was not reached.",
    expectedVerdict: "live_blocked_selector_or_dom",
  },
  {
    vertical: "flight",
    fixtureClass: "model_env",
    provider: "expedia",
    status: "failed",
    workerLogExcerpt:
      "OpenAI Responses API 500: upstream model worker unavailable during Computer Use turn.",
    expectedVerdict: "live_blocked_model_or_env",
  },
  {
    vertical: "flight",
    fixtureClass: "not_live",
    provider: "expedia",
    status: "manual_review",
    workerLogExcerpt:
      "[flight-rpa] Checkout reached; safe handoff; synthetic not-live fixture.",
    expectedVerdict: "not_live_verified",
    liveAttempt: false,
  },
  {
    vertical: "flight",
    fixtureClass: "unsafe_boundary",
    provider: "expedia",
    status: "failed",
    workerLogExcerpt:
      "[flight-rpa] automation submitted final purchase confirmation step after checkout.",
    expectedVerdict: "unsafe_or_disallowed_boundary",
  },
  {
    vertical: "hotel",
    fixtureClass: "safe_boundary",
    provider: "booking-com",
    status: "manual_review",
    workerLogExcerpt:
      "[booking-com] guest details page visible and loaded; safe handoff; stopped before payment.",
    expectedVerdict: "live_closed_safe_boundary",
  },
  {
    vertical: "hotel",
    fixtureClass: "provider_network",
    provider: "booking-com",
    status: "failed",
    workerLogExcerpt:
      "[booking-com] Booking.com provider unavailable: HTTP 503 response; net::ERR_HTTP_RESPONSE_CODE_FAILURE.",
    expectedVerdict: "live_blocked_provider_or_network",
  },
  {
    vertical: "hotel",
    fixtureClass: "selector_dom",
    provider: "booking-com",
    status: "failed",
    workerLogExcerpt:
      "[booking-com] target hotel card visible but not selected; hotel detail not reached; provider selector drift.",
    expectedVerdict: "live_blocked_selector_or_dom",
  },
  {
    vertical: "hotel",
    fixtureClass: "model_env",
    provider: "booking-com",
    status: "failed",
    workerLogExcerpt:
      "OpenAI Responses API 500: upstream model worker unavailable during Computer Use turn.",
    expectedVerdict: "live_blocked_model_or_env",
  },
  {
    vertical: "hotel",
    fixtureClass: "not_live",
    provider: "booking-com",
    status: "manual_review",
    workerLogExcerpt:
      "[booking-com] guest details page visible and loaded; synthetic not-live fixture.",
    expectedVerdict: "not_live_verified",
    liveAttempt: false,
  },
  {
    vertical: "hotel",
    fixtureClass: "unsafe_boundary",
    provider: "booking-com",
    status: "failed",
    workerLogExcerpt:
      "[booking-com] clicked final booking button after payment review screen.",
    expectedVerdict: "unsafe_or_disallowed_boundary",
  },
  {
    vertical: "restaurant",
    fixtureClass: "stale_evidence",
    provider: "opentable",
    status: "ready_for_confirmation",
    workerLogExcerpt:
      "[opentable] ready_for_confirmation; manual review reached; stale fixture for freshness guard.",
    expectedVerdict: "not_live_verified",
    capturedAt: STALE_CAPTURED_AT,
  },
];

export const PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES: readonly ProviderClosureWarRoomSyntheticFixture[] =
  SPECS.map(makeFixture);

function makeFixture(spec: WarRoomFixtureSpec): ProviderClosureWarRoomSyntheticFixture {
  const fixtureId = `fixture-war-room-${spec.vertical}-${spec.fixtureClass}`;
  const kind = spec.vertical === "flight" ? "expedia-flight" : spec.vertical;
  const scenario = spec.vertical === "flight" ? "flight" : spec.vertical;
  const screenshotPrefix =
    spec.vertical === "flight"
      ? "flight-rpa"
      : spec.vertical === "hotel"
        ? "booking-com"
        : spec.provider;

  return {
    schemaVersion: 1,
    vertical: spec.vertical,
    kind,
    synthetic: true,
    fixtureId,
    liveAttempt: spec.liveAttempt ?? true,
    evidenceCapturedAt: spec.capturedAt ?? FRESH_CAPTURED_AT,
    expectedVerdict: spec.expectedVerdict,
    artifact: {
      schemaVersion: 1,
      kind,
      synthetic: true,
      fixtureId,
      job: {
        id: fixtureId,
        taskId: `${fixtureId}-task`,
        provider: spec.provider,
        scenario,
        status: spec.status,
        errorMessage: spec.status === "failed" ? spec.workerLogExcerpt : null,
        steps: [
          {
            name: `${spec.vertical}-closure`,
            type: scenario,
            __source: "lib/runtime-forensics/synthetic-fixture",
            error: spec.status === "failed" ? spec.workerLogExcerpt : null,
            meta: {
              scenario,
              params: paramsForVertical(spec.vertical),
            },
          },
        ],
        params: paramsForVertical(spec.vertical),
      },
      dbRow: {
        id: fixtureId,
        task_id: `${fixtureId}-task`,
        provider: spec.provider,
        scenario,
        status: spec.status,
        updated_at: spec.capturedAt ?? FRESH_CAPTURED_AT,
      },
      workerLogExcerpt: spec.workerLogExcerpt,
      workerLogPath: `codex-worker.log#${fixtureId}`,
      screenshotPaths: [
        `worker/.debug-screenshots/${screenshotPrefix}-${spec.fixtureClass}/01-terminal.jpg`,
      ],
      liveSnapshotPaths: [
        `.debug-screenshots/live/${fixtureId}/terminal-snapshot.json`,
      ],
      notes: [
        "Synthetic no-live Provider Closure War Room fixture.",
        `Expected verdict: ${spec.expectedVerdict}.`,
      ],
    },
    screenshotManifest: {
      paths: [
        `worker/.debug-screenshots/${screenshotPrefix}-${spec.fixtureClass}/01-terminal.jpg`,
      ],
      liveSnapshots: [
        `.debug-screenshots/live/${fixtureId}/terminal-snapshot.json`,
      ],
      generatedAt: spec.capturedAt ?? FRESH_CAPTURED_AT,
    },
  };
}

function paramsForVertical(
  vertical: ProviderClosureVertical,
): Record<string, string | number> {
  switch (vertical) {
    case "restaurant":
      return {
        venue: "Synthetic Bistro",
        date: "2026-05-08",
        time: "19:30",
        partySize: 2,
      };
    case "flight":
      return {
        origin: "MCO",
        dest: "BNA",
        date: "2026-06-01",
        passengers: 1,
        targetAirline: "Southwest",
        targetFlightNumber: "WN 3084",
      };
    case "hotel":
      return {
        hotelName: "YOTEL New York Times Square",
        city: "New York",
        checkIn: "2026-06-10",
        checkOut: "2026-06-12",
        adults: 1,
        rooms: 1,
      };
  }
}
