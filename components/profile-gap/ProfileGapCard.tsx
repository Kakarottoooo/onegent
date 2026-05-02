"use client";

/**
 * ProfileGapCard — inline chat card that asks the user to fill in
 * missing profile fields without leaving the conversation.
 *
 * Replaces the previous "Missing travel documents → go to Settings"
 * error string. Renders a small form for personal/travel/address
 * fields and a separate redirect block for payment.
 *
 * Pure presentational + local form state. Network is the parent's job
 * (passed via props.onSave). Track B never invents an API surface.
 *
 * ─── onSave contract ──────────────────────────────────────────────
 *
 * `state.missing` is normalized through `normalizeMissingFields` before
 * partition + render. That collapses the legacy `full_name` alias into
 * `first_name + last_name` so the card always shows the canonical
 * 13-field schema (see `CANONICAL_FIELD_IDS` in `./types.ts`).
 *
 * `payload.values` is keyed by canonical IDs only. Parent should POST:
 *   POST /api/v1/travel-tasks/:id/continue
 *   { profile: payload.values }
 * — no key renaming required.
 */

import { useMemo, useState } from "react";
import FieldRow from "./FieldRow";
import PaymentRedirect from "./PaymentRedirect";
import {
  FIELD_DEFINITIONS,
  normalizeMissingFields,
  partitionMissing,
} from "./field-vocabulary";
import type {
  GapFormValues,
  GapTrigger,
  ProfileFieldId,
  ProfileGapCardProps,
} from "./types";
import "./profile-gap.css";

/* ─── Per-trigger copy ────────────────────────────────────────────────── */

const TRIGGER_COPY: Record<
  GapTrigger,
  { eyebrow: string; title: string; icon: string }
> = {
  restaurant: {
    eyebrow: "Restaurant booking",
    title: "Add a few details to confirm",
    icon: "🍽️",
  },
  hotel: {
    eyebrow: "Hotel booking",
    title: "Add a few details to confirm",
    icon: "🏨",
  },
  flight: {
    eyebrow: "Flight booking",
    title: "We need your travel info",
    icon: "✈️",
  },
  activity: {
    eyebrow: "Activity booking",
    title: "Add a few details to confirm",
    icon: "🎟️",
  },
  generic: {
    eyebrow: "Booking",
    title: "Add a few details to continue",
    icon: "✨",
  },
};

/* ─── Component ───────────────────────────────────────────────────────── */

export default function ProfileGapCard({
  state,
  onSave,
  onDismiss,
  initialValues,
  demo,
}: ProfileGapCardProps) {
  const { inline, payment } = useMemo(() => {
    // Expand legacy `full_name` → first_name + last_name and de-dupe before
    // splitting into inline / payment buckets. Backend sends canonical IDs
    // already; this is purely a back-compat shim for older code paths.
    const normalized = normalizeMissingFields(state.missing);
    return partitionMissing(normalized);
  }, [state.missing]);

  const [values, setValues] = useState<GapFormValues>(() => seedValues(inline, initialValues));
  const [errors, setErrors] = useState<Partial<Record<ProfileFieldId, string>>>({});
  const [submitting, setSubmitting] = useState(demo === "submitting");
  const [savedOk, setSavedOk] = useState(demo === "saved");
  const [submitError, setSubmitError] = useState<string | null>(
    demo === "error" ? "Could not save profile. Try again." : null,
  );

  const copy = TRIGGER_COPY[state.trigger];

  const isFormEmpty = inline.length === 0;
  const onlyPayment = isFormEmpty && payment.length > 0;

  function handleChange(id: ProfileFieldId, val: string) {
    setValues((v) => ({ ...v, [id]: val }));
    // Clear field error optimistically as the user types — re-validation
    // happens on submit anyway.
    if (errors[id]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[id];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || demo === "submitting" || demo === "saved") return;
    const nextErrors = validateAll(inline, values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSave({
        values,
        skipped: payment, // payment fields are intentionally redirected
      });
      setSavedOk(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not save. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={[
        "profile-gap-card",
        savedOk ? "profile-gap-card--saved" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="region"
      aria-label="Add missing profile information"
    >
      {/* Header */}
      <header className="profile-gap-card__header">
        <span className="profile-gap-card__icon" aria-hidden>
          {copy.icon}
        </span>
        <div className="profile-gap-card__heading">
          <p className="profile-gap-card__eyebrow">{copy.eyebrow}</p>
          <h3 className="profile-gap-card__title">{copy.title}</h3>
          {state.reason && (
            <p className="profile-gap-card__reason">{state.reason}</p>
          )}
        </div>
      </header>

      {/* Form body */}
      <form className="profile-gap-card__form" onSubmit={handleSubmit} noValidate>
        {inline.length > 0 && (
          <div className="profile-gap-card__fields">
            {inline.map((id, i) => (
              <FieldRow
                key={id}
                id={id}
                value={values[id] ?? ""}
                error={errors[id]}
                onChange={(v) => handleChange(id, v)}
                autoFocus={i === 0}
              />
            ))}
          </div>
        )}

        {payment.length > 0 && <PaymentRedirect fields={payment} />}

        {submitError && (
          <p className="profile-gap-card__submit-error" role="alert">
            {submitError}
          </p>
        )}

        {savedOk ? (
          <div className="profile-gap-card__saved" aria-live="polite">
            <span className="profile-gap-card__saved-glyph" aria-hidden>✓</span>
            <span>Saved. Continuing your booking…</span>
          </div>
        ) : (
          <div className="profile-gap-card__actions">
            {onDismiss && !onlyPayment && (
              <button
                type="button"
                className="profile-gap-card__dismiss"
                onClick={onDismiss}
                disabled={submitting}
              >
                Maybe later
              </button>
            )}
            {!onlyPayment && (
              <button
                type="submit"
                className="profile-gap-card__submit"
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Save and continue"}
              </button>
            )}
            {onlyPayment && onDismiss && (
              <button
                type="button"
                className="profile-gap-card__dismiss"
                onClick={onDismiss}
              >
                I'll come back after Settings
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function seedValues(
  inline: ProfileFieldId[],
  initial: GapFormValues | undefined,
): GapFormValues {
  const out: GapFormValues = {};
  for (const id of inline) {
    out[id] = initial?.[id] ?? "";
  }
  return out;
}

function validateAll(
  inline: ProfileFieldId[],
  values: GapFormValues,
): Partial<Record<ProfileFieldId, string>> {
  const errs: Partial<Record<ProfileFieldId, string>> = {};
  for (const id of inline) {
    const def = FIELD_DEFINITIONS[id];
    if (!def.validate) continue;
    const err = def.validate(values[id] ?? "");
    if (err) errs[id] = err;
  }
  return errs;
}
