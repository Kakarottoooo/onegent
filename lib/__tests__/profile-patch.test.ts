import { describe, expect, it } from "vitest";

import {
  findProfilePaymentFields,
  parseProfilePatch,
  paymentFieldsError,
} from "@/lib/profile-patch";

describe("profile patch payment guard", () => {
  it("detects card and CVV fields before auth", () => {
    expect(
      findProfilePaymentFields({
        card_number: "4111111111111111",
        cvv: "123",
        first_name: "Ada",
      }),
    ).toEqual(["card_number", "cvv"]);
  });

  it("detects payment fields inside the profile wrapper", () => {
    const rawBody = {
      profile: {
        card_cvc: "123",
        security_code: "999",
      },
    };
    const rawPatch = rawBody.profile;

    expect(findProfilePaymentFields(rawPatch)).toEqual([
      "card_cvc",
      "security_code",
    ]);
  });

  it("returns a 4xx-safe payment field error payload", () => {
    const parsed = paymentFieldsError(["card_number", "cvv"]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("invalid_profile_patch");
      expect(parsed.error.message).toMatch(/payment fields/i);
      expect(parsed.error.fields?.card_number).toMatch(/not allowed/i);
      expect(parsed.error.fields?.cvv).toMatch(/not allowed/i);
    }
  });

  it("rejects CVV aliases in normal profile patch parsing too", () => {
    const parsed = parseProfilePatch({
      cvc: "123",
      card_cvv: "456",
      phone: "+15555550123",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(Object.keys(parsed.error.fields ?? {})).toEqual([
        "cvc",
        "card_cvv",
      ]);
    }
  });
});
