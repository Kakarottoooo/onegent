"use client";

/**
 * Single field row inside ProfileGapCard. Pure presentational — owns no
 * state. Parent owns the form value and validation result.
 */

import type { ProfileFieldId } from "./types";
import { FIELD_DEFINITIONS } from "./field-vocabulary";

interface Props {
  id: ProfileFieldId;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  /** Visually emphasize this row (used for the very first focused field). */
  autoFocus?: boolean;
}

export default function FieldRow({ id, value, error, onChange, autoFocus }: Props) {
  const def = FIELD_DEFINITIONS[id];
  const inputId = `profile-gap-${id}`;

  const commonProps = {
    id: inputId,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(e.currentTarget.value),
    placeholder: def.placeholder,
    autoFocus: autoFocus ?? false,
    "aria-invalid": !!error,
    "aria-describedby": [
      def.helper ? `${inputId}-helper` : null,
      error ? `${inputId}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined,
    className: [
      "profile-gap__input",
      error ? "profile-gap__input--error" : "",
    ]
      .filter(Boolean)
      .join(" "),
  };

  return (
    <div className="profile-gap__field">
      <label htmlFor={inputId} className="profile-gap__field-label">
        {def.label}
      </label>

      {def.inputType === "select" ? (
        <select {...commonProps}>
          <option value="" disabled>
            Choose…
          </option>
          {(def.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input type={def.inputType} {...commonProps} />
      )}

      {def.helper && !error && (
        <p id={`${inputId}-helper`} className="profile-gap__field-helper">
          {def.helper}
        </p>
      )}

      {error && (
        <p id={`${inputId}-error`} className="profile-gap__field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
