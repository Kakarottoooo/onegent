/**
 * ProfileGapCard — types
 *
 * The card renders inline in chat when the agent detects that the user's
 * profile is missing one or more fields required for the booking they
 * just described. Replaces the previous "Missing travel documents → go to
 * Settings → My Profile" error string with an inline form they can fill
 * without leaving the conversation.
 *
 * Stays out of any payment-card territory — credit card / banking fields
 * always redirect to /permissions where they're encrypted at rest. The
 * card refuses to inline-collect those (see PaymentRedirect.tsx).
 *
 * ─── Backend contract ─────────────────────────────────────────────────
 *
 * Wire format expected from codex's Track A status response:
 *   { status: "needs_profile_data", missing: ProfileFieldId[] }
 *
 * Canonical field set (`CANONICAL_FIELD_IDS`, 13 entries) is what
 * `/api/v1/travel-tasks/:id/needs` actually emits. The card's `onSave`
 * payload uses these same canonical keys, so the parent can POST
 *   { profile: payload.values }
 * directly to `/api/v1/travel-tasks/:id/continue` without renaming.
 *
 * `full_name` is kept as a legacy alias only — older code paths and demo
 * fixtures may still emit it. At render time we expand it into
 * `first_name` + `last_name` (see `normalizeMissingFields`). Backend
 * never marks `full_name` as required.
 *
 * `ktn` and `address_line2` stay UI-only optional. Backend never includes
 * them in the required `missing[]` blocking path.
 *
 * Payment fields (`card_number`, `card_expiry`, `billing_address`) live
 * outside `needs_profile_data` entirely — backend never emits them in
 * `missing[]`. They survive in this union solely so the demo route can
 * preview the PaymentRedirect block.
 */

/** Identifier of a single profile field the agent might ask for. */
export type ProfileFieldId =
  // ── Personal (low sensitivity — inline-collectable) ─────────
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  // ── Travel docs (medium sensitivity — inline-collectable but flagged) ─
  | "date_of_birth"
  | "passport_number"
  | "passport_expiry"
  | "passport_country"
  | "ktn" // optional UI-only — never appears in required missing[]
  // ── Address (medium — inline) ───────────────────────────────
  | "address_line1"
  | "address_line2" // optional UI-only — never required
  | "city"
  | "state"
  | "zip"
  | "country"
  // ── Payment (high sensitivity — NEVER inline; redirects to Settings) ──
  | "card_number"
  | "card_expiry"
  | "billing_address"
  // ── Legacy alias (expanded to first_name + last_name at render time) ──
  | "full_name";

/**
 * The 13 canonical fields backend emits in `missing[]`. Anything outside
 * this set is either a UI-only optional (ktn, address_line2), a payment
 * redirect (cards), or a legacy alias (full_name).
 *
 * Source of truth lives on codex's side; this constant is the frontend's
 * mirror — keep it in sync if the backend schema evolves.
 */
export const CANONICAL_FIELD_IDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "date_of_birth",
  "passport_number",
  "passport_expiry",
  "passport_country",
  "address_line1",
  "city",
  "state",
  "zip",
  "country",
] as const satisfies readonly ProfileFieldId[];

export type CanonicalProfileFieldId = (typeof CANONICAL_FIELD_IDS)[number];

/** Why are we asking? Drives copy + which scenario triggered the card. */
export type GapTrigger =
  | "restaurant"
  | "hotel"
  | "flight"
  | "activity"
  | "generic";

/** Sensitivity bucket — drives which UI branch renders the field. */
export type FieldSensitivity = "personal" | "travel" | "address" | "payment";

export interface ProfileGapState {
  /** Which booking scenario triggered the gap. */
  trigger: GapTrigger;
  /**
   * The fields the booking needs but the user's profile lacks. Backend
   * sends canonical IDs; legacy `full_name` is accepted and expanded
   * client-side via `normalizeMissingFields`.
   */
  missing: ProfileFieldId[];
  /** Optional: short explanation surfaced near the title. */
  reason?: string;
}

/** Form values keyed by ProfileFieldId. All optional — partial fills allowed. */
export type GapFormValues = Partial<Record<ProfileFieldId, string>>;

/** Result returned to the parent (chat handler) when user clicks Save. */
export interface GapSavePayload {
  /**
   * Field values the user actually filled in, keyed by canonical IDs.
   * Parent POSTs these as `{ profile: values }` to
   * `/api/v1/travel-tasks/:id/continue`.
   */
  values: GapFormValues;
  /**
   * Fields the user skipped — usually because they redirected to Settings
   * for payment, or chose "maybe later".
   */
  skipped: ProfileFieldId[];
}

/** Public props for the card. */
export interface ProfileGapCardProps {
  state: ProfileGapState;
  /**
   * Submit handler. The wiring code (chat / autopilot start) is responsible
   * for POSTing to `/api/v1/travel-tasks/:id/continue` — this component
   * never touches the network. Keeps the component pure & testable, and
   * prevents Track B from inventing a new API surface.
   */
  onSave: (payload: GapSavePayload) => Promise<void> | void;
  /** Called when user clicks "Maybe later" / dismisses without saving. */
  onDismiss?: () => void;
  /** Optional initial values (e.g. partial profile already on file). */
  initialValues?: GapFormValues;
  /**
   * When set, ignores network state and renders fixture-driven UI for
   * /dev/profile-gap-demo previewing.
   */
  demo?: "submitting" | "saved" | "error" | "idle";
}
