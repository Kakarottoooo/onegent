/**
 * Public surface for the ProfileGapCard package.
 *
 * Consumed by:
 *   - Homepage chat (when codex's Track A emits `needs_profile_data`)
 *   - /dev/profile-gap-demo (preview route)
 *
 * `__fixtures.ts` is intentionally NOT re-exported — fixtures must never
 * leak into production data paths. The demo route imports them directly.
 */

export { default as ProfileGapCard } from "./ProfileGapCard";
export { default as FieldRow } from "./FieldRow";
export { default as PaymentRedirect } from "./PaymentRedirect";
export {
  FIELD_DEFINITIONS,
  categoryOfField,
  isPaymentField,
  listFieldsByCategory,
  normalizeMissingFields,
  partitionMissing,
} from "./field-vocabulary";
export type { FieldCategory, FieldDefinition } from "./field-vocabulary";
export {
  CANONICAL_FIELD_IDS,
} from "./types";
export type {
  ProfileFieldId,
  CanonicalProfileFieldId,
  GapTrigger,
  FieldSensitivity,
  ProfileGapState,
  GapFormValues,
  GapSavePayload,
  ProfileGapCardProps,
} from "./types";
