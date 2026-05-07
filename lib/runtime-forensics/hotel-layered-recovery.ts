/**
 * Pure no-live Hotel L1/L2 layered recovery helpers.
 *
 * These helpers consume already-collected artifact text and metadata. They do
 * not read from disk, touch the network, invoke providers, call OpenAI, or
 * start browser automation.
 */

export type HotelL1Stage =
  | "provider_search"
  | "hotel_detail"
  | "room_selection"
  | "guest_review"
  | "human_boundary"
  | "unknown";

export type HotelNoAvailabilityEvidenceState =
  | "verified_true_no_availability"
  | "weak_no_availability"
  | "not_no_availability";

export interface HotelLayeredContext {
  provider?: string | null;
  state?: string | null;
  currentUrl?: string | null;
  pageText?: string | null;
  workerLogExcerpt?: string | null;
  notes?: readonly string[] | null;
  screenshotPaths?: readonly string[] | null;
  liveSnapshotPaths?: readonly string[] | null;
  targetHotelName?: string | null;
  city?: string | null;
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
  rooms?: number | null;
  budget?: string | null;
}

export interface HotelNoAvailabilityEvidenceVerdict {
  state: HotelNoAvailabilityEvidenceState;
  hasNoAvailabilitySignal: boolean;
  hasExactHotelEvidence: boolean;
  hasExactStayEvidence: boolean;
  hasScopedInventoryEvidence: boolean;
  missingEvidence: string[];
  reason: string;
}

export interface HotelFallbackEligibility {
  eligible: boolean;
  reason: string;
  nextProviders: string[];
  preservedParams: HotelFallbackPreservedParams;
}

export interface HotelFallbackPreservedParams {
  hotel: string | null;
  city: string | null;
  checkin: string | null;
  checkout: string | null;
  adults: number | null;
  rooms: number | null;
  budget: string | null;
}

export interface HotelArtifactCompleteness {
  complete: boolean;
  missing: string[];
  summary: string;
}

export interface HotelLayeredRecoverySummary {
  l1Stage: HotelL1Stage;
  noAvailabilityEvidence: HotelNoAvailabilityEvidenceVerdict;
  fallbackEligibility: HotelFallbackEligibility;
  artifactCompleteness: HotelArtifactCompleteness;
}

type UnknownRecord = Record<string, unknown>;

const NO_AVAILABILITY_RX =
  /\b(sold[-\s]?out|fully booked|no rooms? available|no availability|not available|no properties match|no stays? available|nothing available|unavailable for (your|the selected|selected|requested|these) dates?|target hotel unavailable)\b/i;

const SCOPED_INVENTORY_RX =
  /\b(for (your|the selected|selected|requested|these|approved) dates?|for (the )?requested stay|for this stay|selected dates?|requested dates?|exact stay|target hotel unavailable)\b/i;

const STRONG_INVENTORY_UNAVAILABLE_RX =
  /\b(sold[-\s]?out|fully booked|no rooms? available|target hotel unavailable|unavailable for (your|the selected|selected|requested|these) dates?)\b/i;

const HUMAN_BOUNDARY_RX =
  /\b(payment|billing|card entry|credit card|cvv|cvc|security code|complete booking|confirm and pay|final confirmation|login|sign[-\s]?in|captcha|otp|verification code|phone verification|verify you are human)\b/i;

const SAFE_BOUNDARY_NARRATION_RX =
  /\b(before|without|no)\s+(payment|billing|card entry|credit card|cvv|cvc|security code|complete booking|confirm and pay|final confirmation|login|sign[-\s]?in|captcha|otp|verification code|phone verification)\b/i;

export function evaluateHotelNoAvailabilityEvidence(
  context: HotelLayeredContext,
): HotelNoAvailabilityEvidenceVerdict {
  const corpus = buildEvidenceCorpus(context);
  const lowerCorpus = corpus.toLowerCase();
  const urlStay = extractStayEvidenceFromUrl(context.currentUrl);

  const hasNoAvailabilitySignal = NO_AVAILABILITY_RX.test(corpus);
  const hasExactHotelEvidence =
    Boolean(context.targetHotelName) &&
    containsNormalizedPhrase(corpus, context.targetHotelName ?? "");
  const hasCheckin =
    Boolean(context.checkin) &&
    (lowerCorpus.includes((context.checkin ?? "").toLowerCase()) ||
      urlStay.checkin === context.checkin);
  const hasCheckout =
    Boolean(context.checkout) &&
    (lowerCorpus.includes((context.checkout ?? "").toLowerCase()) ||
      urlStay.checkout === context.checkout);
  const hasAdultCount =
    context.adults == null ||
    countEvidenceMatches(lowerCorpus, context.adults, "adult") ||
    urlStay.adults === context.adults;
  const hasRoomCount =
    context.rooms == null ||
    countEvidenceMatches(lowerCorpus, context.rooms, "room") ||
    urlStay.rooms === context.rooms;
  const hasExactStayEvidence = hasCheckin && hasCheckout && hasAdultCount && hasRoomCount;
  const hasScopedInventoryEvidence =
    SCOPED_INVENTORY_RX.test(corpus) || STRONG_INVENTORY_UNAVAILABLE_RX.test(corpus);

  if (!hasNoAvailabilitySignal) {
    return {
      state: "not_no_availability",
      hasNoAvailabilitySignal,
      hasExactHotelEvidence,
      hasExactStayEvidence,
      hasScopedInventoryEvidence,
      missingEvidence: [],
      reason: "No hotel no-availability signal was present.",
    };
  }

  const missingEvidence: string[] = [];
  if (!hasExactHotelEvidence) missingEvidence.push("exact hotel");
  if (!hasExactStayEvidence) missingEvidence.push("exact dates/adults/rooms");
  if (!hasScopedInventoryEvidence) missingEvidence.push("scoped room inventory");

  if (missingEvidence.length === 0) {
    return {
      state: "verified_true_no_availability",
      hasNoAvailabilitySignal,
      hasExactHotelEvidence,
      hasExactStayEvidence,
      hasScopedInventoryEvidence,
      missingEvidence,
      reason:
        "No-availability evidence is scoped to the exact hotel, dates, adult count, and room count.",
    };
  }

  return {
    state: "weak_no_availability",
    hasNoAvailabilitySignal,
    hasExactHotelEvidence,
    hasExactStayEvidence,
    hasScopedInventoryEvidence,
    missingEvidence,
    reason: `No-availability evidence is weak; missing ${missingEvidence.join(", ")} evidence.`,
  };
}

export function classifyHotelL1Stage(context: HotelLayeredContext): HotelL1Stage {
  const corpus = buildEvidenceCorpus(context);
  const lowerCorpus = corpus.toLowerCase();
  const currentUrl = (context.currentUrl ?? "").toLowerCase();

  if (hasHumanOnlyBoundary(corpus)) return "human_boundary";
  if (/\b(guest details|contact details|traveler details|reservation details)\b/i.test(corpus)) {
    return "guest_review";
  }
  if (/\b(room selection|room type|select a room|selected room|room quantity|reserve controls?)\b/i.test(corpus)) {
    return "room_selection";
  }
  if (currentUrl.includes("/hotel/") || containsNormalizedPhrase(corpus, context.targetHotelName ?? "")) {
    return "hotel_detail";
  }
  if (
    currentUrl.includes("searchresults") ||
    currentUrl.includes("hotel-search") ||
    /\b(search results|listing page|hotel card|property card)\b/i.test(corpus)
  ) {
    return "provider_search";
  }
  return "unknown";
}

export function classifyHotelProviderFallbackEligibility(
  context: HotelLayeredContext,
  noAvailabilityEvidence = evaluateHotelNoAvailabilityEvidence(context),
): HotelFallbackEligibility {
  const state = context.state ?? "insufficient_evidence";
  const provider = normalizeProvider(context.provider);
  const nextProviders = nextHotelProviders(provider);
  const preservedParams = buildHotelFallbackPreservedParams(context);

  if (nextProviders.length === 0) {
    return {
      eligible: false,
      nextProviders,
      preservedParams,
      reason: "No configured L2 hotel provider remains after the current provider.",
    };
  }

  if (noAvailabilityEvidence.state === "verified_true_no_availability") {
    return {
      eligible: false,
      nextProviders: [],
      preservedParams,
      reason: "Do not use L2 fallback when exact hotel/date/stay no-availability is verified.",
    };
  }

  if (noAvailabilityEvidence.state === "weak_no_availability") {
    return {
      eligible: true,
      nextProviders,
      preservedParams,
      reason:
        "Weak no-availability evidence is L2-eligible; try an alternate hotel provider before terminal inventory classification.",
    };
  }

  if (
    state === "provider_selector_drift" ||
    state === "room_selection_drift" ||
    state === "network_provider_failure"
  ) {
    return {
      eligible: true,
      nextProviders,
      preservedParams,
      reason: `${state} is L2-eligible when no human-only boundary or verified no-availability is present.`,
    };
  }

  return {
    eligible: false,
    nextProviders: [],
    preservedParams,
    reason: `${state} is not L2-eligible; preserve evidence and do not switch providers automatically.`,
  };
}

function buildHotelFallbackPreservedParams(
  context: HotelLayeredContext,
): HotelFallbackPreservedParams {
  return {
    hotel: context.targetHotelName ?? null,
    city: context.city ?? null,
    checkin: context.checkin ?? null,
    checkout: context.checkout ?? null,
    adults: context.adults ?? null,
    rooms: context.rooms ?? null,
    budget: context.budget ?? null,
  };
}

export function validateHotelLayeredArtifactCompleteness(bundle: unknown): HotelArtifactCompleteness {
  const context = extractHotelLayeredContextFromArtifact(bundle);
  const job = readRecord(bundle, "job");
  const missing: string[] = [];

  if (!firstString(readString(job, "id"), readString(readRecord(bundle, "dbRow"), "id"))) {
    missing.push("job.id");
  }
  if (!context.provider) missing.push("job.provider");
  if ((context.provider ?? "") === "unknown") missing.push("job.provider");
  if (firstString(readString(job, "scenario"), readString(readRecord(bundle, "dbRow"), "scenario")) !== "hotel") {
    missing.push("job.scenario=hotel");
  }
  if (!firstString(readString(job, "status"), readString(readRecord(bundle, "dbRow"), "status"))) {
    missing.push("job.status");
  }
  if (!context.targetHotelName) missing.push("hotel name");
  if (!context.city) missing.push("city");
  if (!context.checkin) missing.push("checkin");
  if (!context.checkout) missing.push("checkout");
  if (context.adults == null) missing.push("adults");
  if (context.rooms == null) missing.push("rooms");
  if (!context.currentUrl) missing.push("currentUrl");
  if (!context.workerLogExcerpt) missing.push("workerLogExcerpt");
  if (!readString(asRecord(bundle), "workerLogPath")) missing.push("workerLogPath");
  if (cleanStringList(readUnknown(asRecord(bundle), "screenshotPaths")).length === 0) {
    missing.push("screenshotPaths");
  }
  if (cleanStringList(readUnknown(asRecord(bundle), "liveSnapshotPaths")).length === 0) {
    missing.push("liveSnapshotPaths");
  }

  return {
    complete: missing.length === 0,
    missing,
    summary: missing.length === 0 ? "artifact bundle complete" : `missing: ${missing.join(", ")}`,
  };
}

export function summarizeHotelLayeredRecovery(context: HotelLayeredContext): HotelLayeredRecoverySummary {
  const noAvailabilityEvidence = evaluateHotelNoAvailabilityEvidence(context);
  return {
    l1Stage: classifyHotelL1Stage(context),
    noAvailabilityEvidence,
    fallbackEligibility: classifyHotelProviderFallbackEligibility(context, noAvailabilityEvidence),
    artifactCompleteness: {
      complete: false,
      missing: [],
      summary: "not evaluated from raw artifact bundle",
    },
  };
}

export function extractHotelLayeredContextFromArtifact(bundle: unknown): HotelLayeredContext {
  const root = asRecord(bundle);
  const job = readRecord(root, "job");
  const dbRow = readRecord(root, "dbRow");
  const steps = readArray(job, "steps");
  const step0 = asRecord(steps[0]);
  const body = readRecord(step0, "body");
  const bodyParams = readRecord(body, "params");
  const jobParams = readRecord(job, "params");
  const params = Object.keys(jobParams).length > 0 ? jobParams : bodyParams;

  const currentUrl = firstString(
    readString(job, "handoffUrl"),
    readString(job, "handoff_url"),
    readString(step0, "handoffUrl"),
    readString(step0, "handoff_url"),
    readString(dbRow, "handoff_url"),
  );

  return {
    provider: firstString(readString(job, "provider"), readString(dbRow, "provider")) ?? "unknown",
    currentUrl,
    pageText: firstString(readString(job, "pageText"), readString(dbRow, "pageText")),
    workerLogExcerpt: firstString(
      readString(root, "workerLogExcerpt"),
      readString(job, "rawWorkerLogExcerpt"),
    ),
    notes: cleanStringList(readUnknown(root, "notes")),
    screenshotPaths: cleanStringList(readUnknown(root, "screenshotPaths")),
    liveSnapshotPaths: cleanStringList(readUnknown(root, "liveSnapshotPaths")),
    targetHotelName: firstString(
      readString(params, "hotelName"),
      readString(params, "hotel_name"),
      readString(bodyParams, "hotel_name"),
    ),
    city: firstString(readString(params, "city"), readString(bodyParams, "city")),
    checkin: firstString(
      readString(params, "checkin"),
      readString(params, "checkIn"),
      readString(bodyParams, "checkin"),
    ),
    checkout: firstString(
      readString(params, "checkout"),
      readString(params, "checkOut"),
      readString(bodyParams, "checkout"),
    ),
    adults: firstNumber(readUnknown(params, "adults"), readUnknown(bodyParams, "adults")),
    rooms: firstNumber(readUnknown(params, "rooms"), readUnknown(bodyParams, "rooms")),
    budget: firstString(
      scalarString(readUnknown(params, "budget")),
      scalarString(readUnknown(params, "budgetPerNight")),
      scalarString(readUnknown(params, "budget_per_night")),
      scalarString(readUnknown(params, "budgetTotal")),
      scalarString(readUnknown(params, "budget_total")),
      scalarString(readUnknown(params, "maxPrice")),
      scalarString(readUnknown(params, "max_price")),
      scalarString(readUnknown(bodyParams, "budget")),
      scalarString(readUnknown(bodyParams, "budget_per_night")),
    ),
  };
}

function buildEvidenceCorpus(context: HotelLayeredContext): string {
  return [
    context.currentUrl,
    context.pageText,
    context.workerLogExcerpt,
    ...(context.notes ?? []),
    ...(context.screenshotPaths ?? []),
    ...(context.liveSnapshotPaths ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function hasHumanOnlyBoundary(text: string): boolean {
  const match = HUMAN_BOUNDARY_RX.exec(text);
  if (!match) return false;
  const start = Math.max(0, match.index - 32);
  const end = Math.min(text.length, match.index + match[0].length + 32);
  const excerpt = text.slice(start, end);
  return !SAFE_BOUNDARY_NARRATION_RX.test(excerpt);
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  if (!phrase.trim()) return false;
  return normalizeText(text).includes(normalizeText(phrase));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function countEvidenceMatches(text: string, count: number, unit: "adult" | "room"): boolean {
  const plural = unit === "adult" ? "adults" : "rooms";
  return (
    text.includes(`${unit}s=${count}`) ||
    text.includes(`${plural}=${count}`) ||
    text.includes(`group_${plural}=${count}`) ||
    text.includes(`no_${plural}=${count}`) ||
    new RegExp(`\\b${count}\\s+${unit}s?\\b`, "i").test(text)
  );
}

function extractStayEvidenceFromUrl(url: string | null | undefined): {
  checkin: string | null;
  checkout: string | null;
  adults: number | null;
  rooms: number | null;
} {
  const empty = { checkin: null, checkout: null, adults: null, rooms: null };
  if (!url) return empty;
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    return {
      checkin: params.get("checkin") ?? dateFromSplitParams(params, "checkin"),
      checkout: params.get("checkout") ?? dateFromSplitParams(params, "checkout"),
      adults: positiveInteger(params.get("group_adults")),
      rooms: positiveInteger(params.get("no_rooms")),
    };
  } catch {
    return empty;
  }
}

function dateFromSplitParams(params: URLSearchParams, prefix: "checkin" | "checkout"): string | null {
  const year = params.get(`${prefix}_year`);
  const month = params.get(`${prefix}_month`);
  const day = params.get(`${prefix}_monthday`);
  if (!year || !month || !day) return null;
  const monthNumber = Number.parseInt(month, 10);
  const dayNumber = Number.parseInt(day, 10);
  if (!/^\d{4}$/.test(year)) return null;
  if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  if (!Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeProvider(provider: string | null | undefined): string {
  const normalized = (provider ?? "").toLowerCase().trim();
  if (normalized === "expedia") return "expedia-hotel";
  return normalized;
}

function nextHotelProviders(provider: string): string[] {
  switch (provider) {
    case "booking-com":
      return ["hotels-com", "expedia-hotel"];
    case "hotels-com":
      return ["expedia-hotel"];
    default:
      return [];
  }
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readRecord(value: unknown, key: string): UnknownRecord {
  return asRecord(readUnknown(asRecord(value), key));
}

function readArray(value: unknown, key: string): unknown[] {
  const candidate = readUnknown(asRecord(value), key);
  return Array.isArray(candidate) ? candidate : [];
}

function readUnknown(value: UnknownRecord, key: string): unknown {
  return value[key];
}

function readString(value: UnknownRecord, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function firstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
