"use client";

/**
 * Payment-redirect block — rendered when the missing fields include any
 * payment field (card number / expiry / billing address).
 *
 * We deliberately do NOT collect card data inline. Cards live in the
 * /permissions Profile flow where they're encrypted at rest, and the
 * "止步 CVV" rule means even AI-driven flows never type card details.
 *
 * This block surfaces a clear "open Settings" affordance and explains why.
 */

import { FIELD_DEFINITIONS } from "./field-vocabulary";
import type { ProfileFieldId } from "./types";

interface Props {
  /** Which payment-related fields are missing. */
  fields: ProfileFieldId[];
  /** Override the destination if /permissions is renamed in the future. */
  href?: string;
}

export default function PaymentRedirect({ fields, href = "/permissions" }: Props) {
  if (fields.length === 0) return null;

  const labels = fields.map((id) => FIELD_DEFINITIONS[id].label);
  const label = humanList(labels);

  return (
    <div className="profile-gap__payment">
      <span className="profile-gap__payment-icon" aria-hidden>
        🔒
      </span>
      <div className="profile-gap__payment-text">
        <p className="profile-gap__payment-title">
          Add payment in Settings
        </p>
        <p className="profile-gap__payment-body">
          Card details are encrypted at rest, so we can't accept them inline. Open
          Settings to add {label}, then come back here to keep going.
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="profile-gap__payment-cta"
      >
        Open Settings ↗
      </a>
    </div>
  );
}

function humanList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0].toLowerCase();
  if (items.length === 2) return `${items[0].toLowerCase()} and ${items[1].toLowerCase()}`;
  const all = items.map((s) => s.toLowerCase());
  return `${all.slice(0, -1).join(", ")}, and ${all.at(-1)}`;
}
