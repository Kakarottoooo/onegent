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
 */

/** Identifier of a single profile field the agent might ask for. */
export type ProfileFieldId =
  // ── Personal (low sensitivity — inline-collectable) ─────────
  | "full_name"
  | "email"
  | "phone"
  // ── Travel docs (medium sensitivity — inline-collectable but flagged) ─
  | "date_of_birth"
  | "passport_number"
  | "passport_expiry"
  | "passport_country"
  | "ktn"
  // ── Address (medium — inline) ───────────────────────────────
  | "address_line1"
  | "address_line2"
  | "city"
  | "state"
  | "zip"
  | "country"
  // ── Payment (high sensitivity — NEVER inline; redirects to Settings) ──
  | "card_number"
  | "card_expiry"
  | "billing_address";

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
  /** The fields the booking needs but the user's profile lacks. */
  missing: ProfileFieldId[];
  /** Optional: short explanation surfaced near the title. */
  reason?: string;
}

/** Form values keyed by ProfileFieldId. All optional — partial fills allowed. */
export type GapFormValues = Partial<Record<ProfileFieldId, string>>;

/** Result returned to the parent (chat handler) when user clicks Save. */
export interface GapSavePayload {
  /** Field values the user actually filled in. */
  values: GapFormValues;
  /** Fields the user skipped — usually because they redirected to Settings
   *  for payment, or chose "maybe later". */
  skipped: ProfileFieldId[];
}

/** Public props for the card. */
export interface ProfileGapCardProps {
  state: ProfileGapState;
  /**
   * Submit handler. The wiring code (chat / autopilot start) is responsible
   * for POSTing to /api/profile/update — this component never touches the
   * network. Keeps the component pure & testable, and prevents Track B from
   * inventing a new API surface.
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
