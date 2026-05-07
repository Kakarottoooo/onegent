import type {
  IntentState,
  NluScenario,
  NluV2ParseResult,
  RouterAction,
} from "@/lib/agent/nlu-v2";
import type { NluCategory } from "@/lib/agent/nlu-v2/types";
import type { TripIntentState } from "@/lib/agent/trip-intent-state";
import { readDirectActivityProviderUrlFromConstraints } from "@/lib/capture/direct-provider-url";
import type { CaptureSourceType, CaptureTravelObject } from "@/lib/capture/travel-object";

export type CaptureTaskBoundaryNextAction =
  | "run_direct_booking"
  | "show_confirmation"
  | "ask_clarification"
  | "review_capture";

export type CaptureTaskConfirmationKind = "plan" | "room" | "trip";

export interface CaptureTaskSourceMetadata {
  original_input: string;
  source_type: CaptureSourceType;
  captured_at: string;
  extraction_confidence: number;
  parser: CaptureTravelObject["provenance"]["parser"];
  url?: string;
  host?: string;
  source_session_id?: string;
  source_chat_id?: string;
}

export interface CaptureTaskConfirmationPayload {
  kind: CaptureTaskConfirmationKind;
  nlu: NluV2ParseResult;
  message: string;
  capture_metadata: CaptureTaskSourceMetadata;
}

export interface CaptureTaskBoundaryResult {
  ok: boolean;
  scenario: NluScenario | null;
  missingFields: string[];
  nextAction: CaptureTaskBoundaryNextAction;
  sourceMetadata: CaptureTaskSourceMetadata;
  payload?: CaptureTaskConfirmationPayload;
  reason?: string;
}

export interface BuildCaptureTaskBoundaryOptions {
  sourceSessionId?: string | null;
  sourceChatId?: string | null;
}

export function buildCaptureTaskBoundary(
  capture: CaptureTravelObject,
  options: BuildCaptureTaskBoundaryOptions = {},
): CaptureTaskBoundaryResult {
  const sourceMetadata = buildSourceMetadata(capture, options);
  const scenario = resolveScenario(capture);
  const ambiguity = describeAmbiguity(capture, scenario);
  const missingFields = collectMissingFields(capture, scenario, ambiguity);
  const directActivityUrl = scenario === "activity"
    ? readDirectActivityProviderUrlFromConstraints({
        ...capture.constraints,
        _capture_source: sourceMetadata,
      })
    : null;

  if (!scenario) {
    return {
      ok: false,
      scenario,
      missingFields: missingFields.length > 0 ? missingFields : ["scenario"],
      nextAction: "ask_clarification",
      sourceMetadata,
      reason: "scenario_missing",
    };
  }

  if (directActivityUrl) {
    const payload = buildConfirmationPayload(capture, scenario, sourceMetadata);
    return {
      ok: true,
      scenario,
      missingFields: [],
      nextAction: "run_direct_booking",
      sourceMetadata,
      payload,
    };
  }

  if (ambiguity) {
    return {
      ok: false,
      scenario,
      missingFields,
      nextAction: "review_capture",
      sourceMetadata,
      reason: ambiguity,
    };
  }

  if (missingFields.length > 0 || !capture.task_readiness.ready) {
    return {
      ok: false,
      scenario,
      missingFields,
      nextAction: capture.task_readiness.reason === "missing_fields"
        ? "ask_clarification"
        : "review_capture",
      sourceMetadata,
      reason: capture.task_readiness.reason,
    };
  }

  const payload = buildConfirmationPayload(capture, scenario, sourceMetadata);
  return {
    ok: true,
    scenario,
    missingFields: [],
    nextAction: "show_confirmation",
    sourceMetadata,
    payload,
  };
}

function buildConfirmationPayload(
  capture: CaptureTravelObject,
  scenario: NluScenario,
  sourceMetadata: CaptureTaskSourceMetadata,
): CaptureTaskConfirmationPayload {
  const kind = inferConfirmKind(capture, scenario);
  const constraints = {
    ...flattenCaptureEntities(capture, scenario),
    ...stripUndefined(capture.constraints),
    _capture_source: sourceMetadata,
  };
  const directProviderActivity = scenario === "activity" &&
    readDirectActivityProviderUrlFromConstraints(constraints) !== null;
  const directBooking = capture.classification.direct_booking || directProviderActivity;
  const existingState = capture.provenance.nlu_state;
  const state = existingState ?? synthesizeIntentState(capture, scenario, constraints, kind);
  const action: RouterAction = capture.provenance.nlu_action?.type === "show_confirm_card"
    ? {
        ...capture.provenance.nlu_action,
        ...(directBooking ? { directBooking: true } : {}),
      }
    : {
        type: "show_confirm_card",
        kind,
        state,
        ...(directBooking ? { directBooking: true } : {}),
      };

  const nlu: NluV2ParseResult = {
    intent: state.intent,
    scenario,
    categories: normalizeCategories(capture.classification.categories, scenario),
    party_type: state.party_type,
    member_names: state.member_names,
    collected_constraints: constraints,
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: true,
    refined_target_id: state.refined_target_id,
    assistant_reply: "Ready to confirm this travel task.",
    ...(directBooking ? { direct_booking: true } : {}),
    __v2_state: state,
    __v2_action: action,
  };

  return {
    kind,
    nlu,
    message: sourceMetadata.original_input,
    capture_metadata: sourceMetadata,
  };
}

function buildSourceMetadata(
  capture: CaptureTravelObject,
  options: BuildCaptureTaskBoundaryOptions,
): CaptureTaskSourceMetadata {
  const original = capture.source.raw_text ?? capture.source.url ?? "";
  return {
    original_input: original,
    source_type: capture.source.type,
    captured_at: capture.source.captured_at,
    extraction_confidence: capture.classification.confidence,
    parser: capture.provenance.parser,
    ...(capture.source.url ? { url: capture.source.url } : {}),
    ...(capture.source.host ? { host: capture.source.host } : {}),
    ...(options.sourceSessionId ?? capture.provenance.session_id
      ? { source_session_id: options.sourceSessionId ?? capture.provenance.session_id }
      : {}),
    ...(options.sourceChatId ?? capture.provenance.chat_id
      ? { source_chat_id: options.sourceChatId ?? capture.provenance.chat_id }
      : {}),
  };
}

function resolveScenario(capture: CaptureTravelObject): NluScenario | null {
  if (capture.classification.scenario) return capture.classification.scenario;
  if (capture.entities.trip) return "trip";
  const categories = capture.classification.categories;
  if (categories.length === 1) return categories[0];
  if (hasAllTripCategories(categories)) return "trip";
  return null;
}

function describeAmbiguity(capture: CaptureTravelObject, scenario: NluScenario | null): string | null {
  if (!scenario || scenario === "trip") return null;
  const populatedEntities = populatedEntityScenarios(capture);
  if (populatedEntities.length > 1) return "multiple_capture_entities";
  const categories = capture.classification.categories;
  if (categories.length > 1 && !hasAllTripCategories(categories)) return "multiple_capture_categories";
  return null;
}

function collectMissingFields(
  capture: CaptureTravelObject,
  scenario: NluScenario | null,
  ambiguity: string | null,
): string[] {
  const missing = new Set<string>();
  for (const field of capture.missing_fields) missing.add(field);
  for (const field of capture.task_readiness.next_missing_fields) missing.add(field);
  if (ambiguity) missing.add("scenario");
  for (const field of scenarioRequiredMissing(capture, scenario)) missing.add(field);
  return [...missing];
}

function scenarioRequiredMissing(capture: CaptureTravelObject, scenario: NluScenario | null): string[] {
  if (!scenario) return ["scenario"];
  if (scenario === "restaurant") {
    const fields = capture.entities.restaurant ?? {};
    return missingRequired(fields, [
      ...(capture.classification.direct_booking ? ["restaurant_name"] : []),
      "city",
      "date",
      "time",
      "party_size",
    ]);
  }
  if (scenario === "hotel") {
    const fields = capture.entities.hotel ?? {};
    return missingRequired(fields, [
      ...(capture.classification.direct_booking ? ["hotel_name"] : []),
      "city",
      "check_in",
      "check_out",
      "guests",
    ]);
  }
  if (scenario === "flight") {
    const fields = capture.entities.flight ?? {};
    return missingRequired(fields, ["origin", "dest", "date", "passengers"]);
  }
  if (scenario === "activity") {
    const fields = capture.entities.activity ?? {};
    return missingRequired(fields, ["event_name", "city", "event_date", "num_tickets"]);
  }
  return missingTripFields(capture.entities.trip);
}

function missingRequired(source: object, fields: string[]): string[] {
  const values = source as Record<string, unknown>;
  return fields.filter((field) => !hasValue(values[field]));
}

function missingTripFields(trip: TripIntentState | undefined): string[] {
  if (!trip) return ["destination_city", "date_range", "departure_city", "traveler_count"];
  const missing: string[] = [];
  if (!hasValue(trip.destination_city)) missing.push("destination_city");
  const hasStart = hasValue(trip.start_date);
  const hasEnd = hasValue(trip.end_date);
  const hasNights = typeof trip.nights === "number" && trip.nights > 0;
  if (!hasStart || (!hasEnd && !hasNights)) missing.push("date_range");
  if (!hasValue(trip.departure_city)) missing.push("departure_city");
  if (typeof trip.travelers !== "number" || trip.travelers < 1) missing.push("traveler_count");
  return missing;
}

function inferConfirmKind(capture: CaptureTravelObject, scenario: NluScenario): CaptureTaskConfirmationKind {
  const action = capture.provenance.nlu_action;
  if (action?.type === "show_confirm_card") {
    if (action.kind === "room") return "room";
    if (action.kind === "trip") return "trip";
  }
  if (scenario === "trip") return "trip";
  if (capture.provenance.nlu_state?.party_type === "multi") return "room";
  return "plan";
}

function synthesizeIntentState(
  capture: CaptureTravelObject,
  scenario: NluScenario,
  constraints: Record<string, unknown>,
  kind: CaptureTaskConfirmationKind,
): IntentState {
  const partyType = kind === "room" ? "multi" : "solo";
  return {
    confidence: capture.classification.confidence,
    turn_count: 1,
    updated_at: capture.source.captured_at,
    intent: kind === "room" ? "create_room" : "create_plan",
    scenario,
    categories: normalizeCategories(capture.classification.categories, scenario),
    party_type: partyType,
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
    ...(scenario === "restaurant" && capture.entities.restaurant ? { restaurant: capture.entities.restaurant } : {}),
    ...(scenario === "hotel" && capture.entities.hotel ? { hotel: capture.entities.hotel } : {}),
    ...(scenario === "flight" && capture.entities.flight ? { flight: capture.entities.flight } : {}),
    ...(scenario === "activity" && capture.entities.activity ? { activity: capture.entities.activity } : {}),
    ...(scenario === "trip" && capture.entities.trip ? { trip: capture.entities.trip } : {}),
    ...(constraints.proxy_member_constraints &&
    typeof constraints.proxy_member_constraints === "object" &&
    !Array.isArray(constraints.proxy_member_constraints)
      ? { proxy_member_constraints: constraints.proxy_member_constraints as IntentState["proxy_member_constraints"] }
      : {}),
  };
}

function flattenCaptureEntities(
  capture: CaptureTravelObject,
  scenario: NluScenario,
): Record<string, unknown> {
  if (scenario === "restaurant") return stripUndefined(capture.entities.restaurant ?? {});
  if (scenario === "hotel") {
    const hotel = stripUndefined(capture.entities.hotel ?? {}) as Record<string, unknown>;
    if ("star_rating" in hotel) {
      hotel.stars = hotel.star_rating;
      delete hotel.star_rating;
    }
    return hotel;
  }
  if (scenario === "flight") {
    const flight = stripUndefined(capture.entities.flight ?? {}) as Record<string, unknown>;
    if ("date" in flight) {
      flight.departure_date = flight.date;
      delete flight.date;
    }
    return flight;
  }
  if (scenario === "activity") return stripUndefined(capture.entities.activity ?? {});
  return stripUndefined(capture.entities.trip ?? {});
}

function normalizeCategories(categories: NluCategory[], scenario: NluScenario): NluCategory[] {
  if (scenario === "trip") {
    return hasAllTripCategories(categories)
      ? categories
      : ["hotel", "flight", "restaurant", "activity"];
  }
  return categories.length > 0 ? categories : [scenario];
}

function populatedEntityScenarios(capture: CaptureTravelObject): NluScenario[] {
  const out: NluScenario[] = [];
  if (hasObjectValues(capture.entities.restaurant)) out.push("restaurant");
  if (hasObjectValues(capture.entities.hotel)) out.push("hotel");
  if (hasObjectValues(capture.entities.flight)) out.push("flight");
  if (hasObjectValues(capture.entities.activity)) out.push("activity");
  if (hasObjectValues(capture.entities.trip)) out.push("trip");
  return out;
}

function hasAllTripCategories(categories: NluCategory[]): boolean {
  const set = new Set(categories);
  return set.has("hotel") && set.has("flight") && set.has("restaurant") && set.has("activity");
}

function hasObjectValues(value: object | undefined): boolean {
  if (!value) return false;
  return Object.values(value as Record<string, unknown>).some(hasValue);
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function stripUndefined<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
