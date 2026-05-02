/**
 * Unit tests for ProfileGapCard helpers.
 *
 * Locks the contract behavior shipped in commit 077a05c:
 *   - `ProfileFieldId` aligns to codex's canonical 13-field schema
 *   - `normalizeMissingFields` expands legacy `full_name` → first/last
 *   - `partitionMissing` keeps payment fields out of inline render
 *   - `isPaymentField` matches the documented sensitivity bucket
 *
 * Pure functions only. The component itself ships with `/dev/profile-gap-demo`
 * for visual review — these tests exist so refactors to the contract
 * surface immediately when the runtime drifts.
 */

import { describe, expect, it } from "vitest";
import {
  CANONICAL_FIELD_IDS,
  FIELD_DEFINITIONS,
  isPaymentField,
  normalizeMissingFields,
  partitionMissing,
  type ProfileFieldId,
} from "../../profile-gap";

/* ─── Canonical field set ───────────────────────────────────────────── */

describe("CANONICAL_FIELD_IDS", () => {
  it("contains exactly the 13 fields codex's backend emits", () => {
    expect([...CANONICAL_FIELD_IDS]).toEqual([
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
    ]);
  });

  it("does NOT include `full_name` (legacy alias only)", () => {
    expect((CANONICAL_FIELD_IDS as readonly string[])).not.toContain("full_name");
  });

  it("does NOT include the optional UI-only fields ktn / address_line2", () => {
    expect((CANONICAL_FIELD_IDS as readonly string[])).not.toContain("ktn");
    expect((CANONICAL_FIELD_IDS as readonly string[])).not.toContain("address_line2");
  });

  it("does NOT include payment fields (separate PaymentRedirect path)", () => {
    expect((CANONICAL_FIELD_IDS as readonly string[])).not.toContain("card_number");
    expect((CANONICAL_FIELD_IDS as readonly string[])).not.toContain("card_expiry");
    expect((CANONICAL_FIELD_IDS as readonly string[])).not.toContain("billing_address");
  });

  it("each canonical field has a FIELD_DEFINITIONS entry with a label", () => {
    for (const id of CANONICAL_FIELD_IDS) {
      expect(FIELD_DEFINITIONS[id]).toBeTruthy();
      expect(FIELD_DEFINITIONS[id].label).toBeTruthy();
    }
  });
});

/* ─── normalizeMissingFields ────────────────────────────────────────── */

describe("normalizeMissingFields", () => {
  it("returns canonical fields unchanged", () => {
    const input: ProfileFieldId[] = ["first_name", "last_name", "phone"];
    expect(normalizeMissingFields(input)).toEqual([
      "first_name",
      "last_name",
      "phone",
    ]);
  });

  it("expands legacy `full_name` into first_name + last_name", () => {
    const input: ProfileFieldId[] = ["full_name", "phone"];
    expect(normalizeMissingFields(input)).toEqual([
      "first_name",
      "last_name",
      "phone",
    ]);
  });

  it("preserves field order at first appearance", () => {
    const input: ProfileFieldId[] = ["phone", "full_name", "email"];
    expect(normalizeMissingFields(input)).toEqual([
      "phone",
      "first_name",
      "last_name",
      "email",
    ]);
  });

  it("de-duplicates when full_name + first_name both appear", () => {
    const input: ProfileFieldId[] = ["full_name", "first_name", "phone"];
    expect(normalizeMissingFields(input)).toEqual([
      "first_name",
      "last_name",
      "phone",
    ]);
  });

  it("de-duplicates when first_name + full_name appear in reverse order", () => {
    const input: ProfileFieldId[] = ["first_name", "full_name", "last_name", "phone"];
    expect(normalizeMissingFields(input)).toEqual([
      "first_name",
      "last_name",
      "phone",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(normalizeMissingFields([])).toEqual([]);
  });

  it("handles a single full_name → 2-field expansion", () => {
    expect(normalizeMissingFields(["full_name"])).toEqual([
      "first_name",
      "last_name",
    ]);
  });

  it("treats the input as readonly (does not mutate caller's array)", () => {
    const input: ProfileFieldId[] = ["full_name", "phone"];
    const snapshot = [...input];
    normalizeMissingFields(input);
    expect(input).toEqual(snapshot);
  });

  it("handles the canonical contract example from PROFILE-GAP commit 077a05c", () => {
    // Codex sends: missing: ["first_name", "last_name", "phone"]
    const input: ProfileFieldId[] = ["first_name", "last_name", "phone"];
    const out = normalizeMissingFields(input);
    expect(out).toEqual(["first_name", "last_name", "phone"]);
    // No legacy expansion; no duplicates; same order.
    expect(out).toHaveLength(3);
  });
});

/* ─── isPaymentField ─────────────────────────────────────────────────── */

describe("isPaymentField", () => {
  it("returns true for the 3 payment fields", () => {
    expect(isPaymentField("card_number")).toBe(true);
    expect(isPaymentField("card_expiry")).toBe(true);
    expect(isPaymentField("billing_address")).toBe(true);
  });

  it("returns false for personal / travel / address fields", () => {
    expect(isPaymentField("first_name")).toBe(false);
    expect(isPaymentField("last_name")).toBe(false);
    expect(isPaymentField("email")).toBe(false);
    expect(isPaymentField("phone")).toBe(false);
    expect(isPaymentField("date_of_birth")).toBe(false);
    expect(isPaymentField("passport_number")).toBe(false);
    expect(isPaymentField("address_line1")).toBe(false);
    expect(isPaymentField("city")).toBe(false);
  });

  it("returns false for the legacy full_name alias and optional fields", () => {
    expect(isPaymentField("full_name")).toBe(false);
    expect(isPaymentField("ktn")).toBe(false);
    expect(isPaymentField("address_line2")).toBe(false);
  });
});

/* ─── partitionMissing ───────────────────────────────────────────────── */

describe("partitionMissing", () => {
  it("returns an empty partition when missing is empty", () => {
    expect(partitionMissing([])).toEqual({ inline: [], payment: [] });
  });

  it("routes payment fields to the payment bucket only", () => {
    const out = partitionMissing(["card_number", "card_expiry", "billing_address"]);
    expect(out.inline).toEqual([]);
    expect(out.payment).toEqual(["card_number", "card_expiry", "billing_address"]);
  });

  it("routes personal/travel/address fields to inline only", () => {
    const out = partitionMissing([
      "first_name",
      "last_name",
      "phone",
      "date_of_birth",
      "address_line1",
    ]);
    expect(out.inline).toEqual([
      "first_name",
      "last_name",
      "phone",
      "date_of_birth",
      "address_line1",
    ]);
    expect(out.payment).toEqual([]);
  });

  it("splits a mixed list into both buckets", () => {
    const out = partitionMissing([
      "first_name",
      "card_number",
      "phone",
      "card_expiry",
    ]);
    expect(out.inline).toEqual(["first_name", "phone"]);
    expect(out.payment).toEqual(["card_number", "card_expiry"]);
  });

  it("preserves order within each bucket", () => {
    const out = partitionMissing([
      "card_expiry",
      "phone",
      "card_number",
      "first_name",
    ]);
    expect(out.inline).toEqual(["phone", "first_name"]);
    expect(out.payment).toEqual(["card_expiry", "card_number"]);
  });
});

/* ─── End-to-end pipeline (normalize → partition) ───────────────────── */

describe("normalize → partition pipeline", () => {
  it("legacy full_name + phone → renders 3 inline rows, no payment block", () => {
    // This is the path the ProfileGapCard runs in its useMemo. If this
    // breaks, the demo route + every chat hookup breaks at the same time.
    const normalized = normalizeMissingFields(["full_name", "phone"]);
    const partitioned = partitionMissing(normalized);
    expect(partitioned.inline).toEqual(["first_name", "last_name", "phone"]);
    expect(partitioned.payment).toEqual([]);
  });

  it("canonical missing + a card field → splits correctly", () => {
    const normalized = normalizeMissingFields([
      "first_name",
      "last_name",
      "card_number",
    ]);
    const partitioned = partitionMissing(normalized);
    expect(partitioned.inline).toEqual(["first_name", "last_name"]);
    expect(partitioned.payment).toEqual(["card_number"]);
  });
});
