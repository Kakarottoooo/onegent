/**
 * Phase 1 #7 path B — pure decision helper for the homepage chat
 * direct_booking flow.
 *
 * Given the inputs available at the moment `/api/chat/commit` returns
 * a direct_booking payload, decide which UI path to take:
 *
 *   1. **inline**   — render <ProfileGapCard /> as a chat message
 *                     (preferred path; consumes backend-emitted
 *                     `payload.profile_gap` if present)
 *   2. **legacy_modal** — pop the legacy InlineBookingProfileGate
 *                     (fallback when feature flag is off)
 *   3. **no_gap**   — profile is complete, proceed straight to direct
 *                     booking
 *
 * Extracted from `app/page.tsx:handleDirectBooking` so the decision is:
 *  - testable in isolation (4 scenarios codex listed)
 *  - explicit about its inputs (no ambient state)
 *  - reused by `/dev/path-b-demo` to flip between fixture cases
 *
 * Q15 contract (codex `7289ba0`): backend `/api/chat/commit` direct_booking
 * branch already calls `buildProfileGap(execution, profile)` and emits
 * `payload.profile_gap` (canonical 13-field, scenario-aware). Client trusts
 * that emit and does NOT reimplement scenario logic. The legacy 4-field
 * fallback exists only for defensive cases where the backend forgot to emit.
 */

import type { NeedsProfileDataPayload } from "@/lib/core/execution/types";
import type {
  GapTrigger,
  ProfileFieldId,
  ProfileGapState,
} from "@/components/profile-gap/types";
import type { CommitResponse } from "@/components/ConfirmCard";

/**
 * Discriminated union — `kind` switches the UI path.
 *
 * Notes:
 * - `assistantMessage` is the chat bubble copy to inject before the gate
 *   renders. Caller is responsible for `chat.injectAssistantMessage(...)`
 *   + `persistThreadMessage(...)`.
 * - For `inline`, `cardId` is stable (caller can use it for React `key=`
 *   and any later "remove this card" logic).
 * - For `legacy_modal`, `missing` is the legacy 4-field array shape that
 *   `InlineBookingProfileGate` consumes directly.
 */
export type ProfileGapDecision =
  | {
      kind: "no_gap";
    }
  | {
      kind: "inline";
      cardId: string;
      gapState: ProfileGapState;
      assistantMessage: string;
    }
  | {
      kind: "legacy_modal";
      missing: string[];
      assistantMessage: string;
    };

export interface ProfileGapDecisionInput {
  /**
   * From backend `payload.profile_gap` (codex `7289ba0` emit). When
   * present, takes priority over the legacy 4-field check — backend's
   * `buildProfileGap` is the single source of truth (canonical, scenario-
   * aware).
   */
  backendGap: NeedsProfileDataPayload | null | undefined;
  /**
   * Client-side 4-field check result. Used ONLY as defensive fallback
   * when backend didn't emit `profile_gap` (e.g. older API version, or
   * commit-route edge case). 4 fields: first_name, last_name, email, phone.
   */
  legacyMissing: string[];
  /**
   * True when user has at least one saved booking profile row in DB.
   * False on brand-new accounts. Combined with `legacyMissing.length > 0`
   * to detect the "no profile at all yet" case for the legacy fallback.
   */
  profileExists: boolean;
  /**
   * Feature-flag gate. `process.env.NEXT_PUBLIC_PROFILE_GAP_INLINE !== "0"`.
   * Default = ON (inline). Set "0" to fall back to the legacy modal during
   * debugging.
   */
  useInlineGate: boolean;
  /**
   * Venue name from `CommitResponse.venue_name`. Used for assistant copy
   * AND for the legacy-fallback ProfileGapState reason text when backend
   * didn't emit `profile_gap.message`.
   */
  venueName: string;
  /**
   * Scenario from `CommitResponse.scenario`. Used for legacy-fallback
   * ProfileGapState.trigger when backend didn't emit one. Restaurant /
   * hotel / flight / activity all map directly; unknown → "generic".
   */
  scenario?: string;
  /**
   * Stable card id factory. Defaults to `${time}-${random6}`. Injectable
   * for deterministic test output.
   */
  cardIdFactory?: () => string;
}

/**
 * Pure decision function. No side effects, no I/O.
 *
 * Logic (in priority order):
 *   1. If backendGap OR (no profile yet) OR (legacyMissing has items)
 *      → user needs to fill profile.
 *      a. If useInlineGate → kind: "inline" (build ProfileGapState from
 *         backendGap if present, else from legacy info).
 *      b. Otherwise → kind: "legacy_modal" (caller pops modal).
 *   2. Otherwise → kind: "no_gap" (caller proceeds to direct booking).
 *
 * Test scenarios (codex's 4 specified in PHASE_1_7_SPEC.md hardening
 * brief):
 *   - PB-1: backend `payload.profile_gap` priority → inline + state from
 *     backend.
 *   - PB-2: feature flag off → legacy_modal.
 *   - PB-3 / PB-4: covered by `makeProfileGapOnSave` tests (PATCH
 *     success / failure control flow).
 */
export function decideProfileGap(
  input: ProfileGapDecisionInput,
): ProfileGapDecision {
  const {
    backendGap,
    legacyMissing,
    profileExists,
    useInlineGate,
    venueName,
    scenario,
    cardIdFactory = defaultCardIdFactory,
  } = input;

  const needsProfile =
    Boolean(backendGap) || !profileExists || legacyMissing.length > 0;

  if (!needsProfile) {
    return { kind: "no_gap" };
  }

  if (!useInlineGate) {
    // Legacy fallback path. Caller pops the InlineBookingProfileGate modal.
    return {
      kind: "legacy_modal",
      missing: legacyMissing,
      assistantMessage: `I'm ready to book ${venueName}. I just need your contact details first.`,
    };
  }

  // Inline path — preferred. Build ProfileGapState from backend payload
  // if present, else fall back to legacy 4-field shape.
  const gapState: ProfileGapState = backendGap
    ? {
        trigger: backendGap.scenario as GapTrigger,
        missing: backendGap.missing as ProfileFieldId[],
        reason: backendGap.message,
      }
    : {
        trigger: normalizeTriggerFromScenario(scenario),
        missing: legacyMissing as ProfileFieldId[],
        reason: `${venueName} needs a few details to confirm.`,
      };

  return {
    kind: "inline",
    cardId: cardIdFactory(),
    gapState,
    assistantMessage: `I'm ready to book ${venueName}. I just need a few details first.`,
  };
}

/**
 * Helper for the caller — given a `CommitResponse`, extract the inputs
 * `decideProfileGap` needs so the page-level code stays a one-liner.
 *
 * `legacyMissing` and `profileExists` come from the page's own profile
 * fetch path; we don't reach for them here to keep this module pure.
 */
export function commitResponseToDecisionInput(args: {
  payload: CommitResponse;
  legacyMissing: string[];
  profileExists: boolean;
  useInlineGate: boolean;
  cardIdFactory?: () => string;
}): ProfileGapDecisionInput {
  return {
    backendGap: args.payload.profile_gap ?? null,
    legacyMissing: args.legacyMissing,
    profileExists: args.profileExists,
    useInlineGate: args.useInlineGate,
    venueName: args.payload.venue_name ?? "this place",
    scenario: args.payload.scenario,
    cardIdFactory: args.cardIdFactory,
  };
}

function defaultCardIdFactory(): string {
  return `profile-gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTriggerFromScenario(scenario: string | undefined): GapTrigger {
  switch (scenario) {
    case "restaurant":
    case "hotel":
    case "flight":
    case "activity":
      return scenario;
    default:
      return "generic";
  }
}
